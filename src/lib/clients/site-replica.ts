// A replica of the client's own website, for the onboarding call.
//
// Matthew, 2026-09-04: "it might be good that part of the onboarding is create a replica of the
// customer's website with all of the pages at least visible to the internet, and add the virtual
// agent box at the bottom right side of the page." So the call has something real to walk, and
// so the concierge is demoed on pages the client recognises as their own.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ‼️ THE DECISION: GENERATED SHADOW PAGES, ON OUR HOST, NEVER PUBLISHED. WRITTEN DOWN HERE
//    BECAUSE THE TWO REJECTED DESIGNS ARE BOTH MORE OBVIOUS THAN THIS ONE.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ── (a) CRAWL AND REHOST THEIR ACTUAL SITE. REFUSED. Three independent reasons, any one enough:
//
//   1. LEGAL. The replica is wanted BEFORE the call, and `agreement_signed` is PHASE_DURING. A
//      rehost would put a byte-for-byte copy of somebody's copyrighted site on a hostname their
//      own registrar points at us, before they have signed anything.
//   2. IT WOULD HARM THE CLIENT. Hub pages are `index, follow` with a canonical on the client
//      host, a per-host sitemap.xml and llms.txt. A rehosted copy of their real /services on
//      learn.{domain} competes with their real /services for their own money terms. We would be
//      selling them visibility and taking some away in the same week.
//   3. NOTHING HERE CAN DO IT. site-research.ts fetches at most 3 pages and extracts TEXT with
//      regexes; medspa-owner-scrape.fetchPage is a UA-spoofed HTML GET. There is no asset proxy,
//      no CSS URL rewriter, no headless browser. Building one means an asset proxy on a
//      client-controlled hostname, which is an open-proxy surface pointed straight at everything
//      middleware.ts exists to prevent.
//
// ── (b) A SCREENSHOT WALK. REFUSED. This repo has no screenshot capability at all: no puppeteer,
//    no playwright, no @vercel/og. hub/skin-vision.ts reads a screenshot a HUMAN pasted. It would
//    mean a new external service, and the widget cannot sit on an image, which is half the ask.
//    It is also strictly worse than what already exists: hub/page-preview.ts already posts a
//    themed self-contained HTML file into the client's thread for exactly this moment.
//
// ── (c) GENERATED SHADOW PAGES. CHOSEN, and narrower than it was proposed.
//
//    Three quarters of it was already here: site-research reads their site, recordWebsiteSnapshot
//    files it, theme.ts and skin.ts already make our pages look like theirs, and hub-bodies.tsx
//    already renders. It is also the only one of the three where the widget mounts naturally.
//
//    ‼️ BUT THE REPLICA IS NEVER PUBLISHED ON A CLIENT HOST. It was proposed as "hub pages whose
//    slugs follow their URL structure", which would have meant publishing. It lives on
//    /preview/{token}?kind=site instead, which is ours, noindex, needs no login and is safe to
//    screen-share. That one narrowing dissolves four problems at once:
//
//      · the Day 0 wall, which refuses page_publish while day_0_archived_at is NULL, so a
//        PHASE_BEFORE step could not have published anything anyway;
//      · the duplicate-content harm in (a)2 above, which does not go away just because we wrote
//        the words instead of copying them;
//      · the legal exposure of hosting their material pre-signature;
//      · middleware.ts, see below.
//
// ‼️ middleware.ts IS UNCHANGED AND NEEDS NO CHANGE. HUB_SLUG forbids a slash, so a nested path
//    cannot be served on a client-controlled hostname. The replica does not need that rule
//    widened, because it never lives on a client hostname:
//    /preview/[token]/[[...slug]] is already a catch-all on the INTERNAL host, where the external
//    allowlist does not apply. So the replica keeps their real structure (services/botox) for
//    free. That route's own header already says do not add it to the external allowlist. Do not.
//
// ‼️ IT RESTATES, IT DOES NOT COPY. See the header of hub/draft-replica.ts. A verbatim rehost is
//    (a) with extra steps and it carries (a)'s legal problem into a different file.

import { supabaseAdmin } from "@/lib/db";
import { fetchPage, fetchText, textFromHtml } from "@/lib/medspa-owner-scrape";
import { discoverNavSections, type NavSection } from "@/lib/audit-engine/site-research";
import { loadNumberedEvidence, recordWebsiteSnapshot } from "@/lib/clients/page-evidence";
import { magnetsForClient } from "@/lib/concierge/for-client";
import { draftSection } from "@/lib/hub/draft-replica";
import { saveReplicaPage, pruneReplica } from "@/lib/hub/replica-pages";
import { clientPreviewUrl, previewLinkLine } from "@/lib/clients/review-preview";
import type { AutoResult } from "@/lib/clients/artifacts/registry";

/**
 * How many pages of their site the replica covers.
 *
 * ‼️ A CEILING, NOT A TARGET, AND IT IS DELIBERATELY SMALL. Every section is one model call and
 * one magnet decision, and the point of the artifact is a five minute walk on a call, not a
 * complete index. Their top-level navigation is where a business already ranks its own pages,
 * so taking the first few in document order takes the ones they put first.
 */
const MAX_SECTIONS = 8;

/** The homepage's own text is worth more than an inner page's, so it gets the larger budget. */
const HOME_TEXT_BUDGET = 12000;
const SECTION_TEXT_BUDGET = 8000;

const HOMEPAGE_TIMEOUT_MS = 20000;

interface ReplicaClient {
  id: string;
  legal_name: string | null;
  dba_name: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  domain: string | null;
  vertical_slug: string | null;
}

function normalizeUrl(input: string): string {
  return input.startsWith("http") ? input : `https://${input}`;
}

/**
 * `site_replica`: read their navigation, rebuild each section, put the widget on it.
 *
 * Idempotent by construction. recordWebsiteSnapshot keeps one row per URL and saveReplicaPage
 * upserts on (client_id, path), so re-running after a client redesigns their site refreshes the
 * replica rather than colliding. pruneReplica then drops sections that left their nav, because a
 * page we show on a call that no longer exists on their site is the opposite of the point.
 */
export async function buildSiteReplica(clientId: string): Promise<AutoResult> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, state, website, domain, vertical_slug")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: `clients lookup failed: ${error.message}` };
  if (!data) return { ok: false, error: "That client could not be read." };

  const client = data as ReplicaClient;
  const clientName = client.dba_name || client.legal_name || "this client";

  const site = (client.website || client.domain || "").trim();
  if (!site) {
    return {
      ok: false,
      error:
        "No website on file for this client, so there is no site to replicate. " +
        "Set `website` or `domain` on the client and re-run.",
    };
  }

  const home = normalizeUrl(site);
  let origin: string;
  try {
    origin = new URL(home).origin;
  } catch {
    return { ok: false, error: `${site} is not a usable web address.` };
  }

  // ── Read their homepage ────────────────────────────────────────────────────
  //
  // ‼️ A BLOCK IS REPORTED, NEVER PAPERED OVER. A replica of a site we could not read would be
  // eight pages of invention shown to the person who wrote the original. Same doctrine
  // site-research.ts states for the audit: "blocked" is a fact about THEM and every other reason
  // is a fact about US, and the two must not print the same sentence.
  const res = await fetchPage(home, { timeoutMs: HOMEPAGE_TIMEOUT_MS, retries: 1 });
  if (!res.ok) {
    return {
      ok: false,
      error:
        `Could not read ${home} (${res.reason}${res.detail ? `: ${res.detail}` : ""}), so there ` +
        "is nothing to replicate. A site that blocks us is a finding for the call, not a failure " +
        "to work around.",
    };
  }

  // MAX_SECTIONS - 1, because the homepage is added below and counts toward the ceiling. A
  // "bounded at 8" that quietly produces 9 is a bound nobody can rely on.
  const sections: NavSection[] = discoverNavSections(res.html, origin, MAX_SECTIONS - 1);

  // The homepage is always the first page of the replica and is not one of its own sections.
  const targets: Array<NavSection & { html: string | null }> = [
    { url: home, label: "Home", path: "", order: 0, html: res.html },
    ...sections.map((s, i) => ({ ...s, order: i + 1, html: null })),
  ];

  // ── The two things every section draft shares. Read once, not once per page ─
  const evidence = await loadNumberedEvidence(clientId, null);
  const magnets = await magnetsForClient(clientId);

  const written: string[] = [];
  const failures: string[] = [];
  const keptUrls: string[] = [];
  let offered = 0;

  for (const target of targets) {
    const html = target.html ?? (await fetchText(target.url));
    if (!html) {
      failures.push(`${target.label} (could not be read)`);
      continue;
    }

    const budget = target.path === "" ? HOME_TEXT_BUDGET : SECTION_TEXT_BUDGET;
    const text = textFromHtml(html).slice(0, budget);
    if (!text.trim()) {
      failures.push(`${target.label} (no readable text)`);
      continue;
    }

    // File it as evidence BEFORE drafting. The snapshot is what the page was written from, and
    // the step verifier checks for it rather than trusting that a crawl happened.
    const sourceId = await recordWebsiteSnapshot({
      clientId,
      url: target.url,
      content: text,
    });

    const drafted = await draftSection({
      clientName,
      navLabel: target.label,
      sourceUrl: target.url,
      sourceText: text,
      city: client.city,
      state: client.state,
      businessType: client.vertical_slug,
      evidence,
      magnets,
    });

    if (!drafted.ok) {
      failures.push(`${target.label} (${drafted.error})`);
      continue;
    }

    const saved = await saveReplicaPage({
      clientId,
      sourceUrl: target.url,
      navLabel: target.label,
      path: target.path,
      title: drafted.section.title,
      bodyMd: drafted.section.bodyMd,
      leadMagnetKey: drafted.section.leadMagnetKey,
      navOrder: target.order,
      sourceId,
    });

    if (!saved.ok) {
      // A table that does not exist fails every page identically, so say it once and stop rather
      // than printing the same migration notice eight times.
      if (saved.error.includes("client_replica_pages does not exist")) {
        return { ok: false, error: saved.error };
      }
      failures.push(`${target.label} (${saved.error})`);
      continue;
    }

    written.push(target.label);
    keptUrls.push(target.url);
    if (drafted.section.leadMagnetKey) offered += 1;
  }

  if (written.length === 0) {
    return {
      ok: false,
      error:
        `Nothing could be replicated from ${home}. ` +
        (failures.length ? `Failures: ${failures.join("; ")}` : "No sections were found."),
    };
  }

  const pruned = await pruneReplica(clientId, keptUrls);

  // ── The card ───────────────────────────────────────────────────────────────
  const url = clientPreviewUrl(clientId, "site");
  const lines: string[] = [
    `:globe_with_meridians: *${clientName}: ${written.length} page${written.length === 1 ? "" : "s"} of their own site rebuilt*`,
    "",
    ...written.map((label) => `  • ${label}`),
  ];

  if (pruned > 0) {
    lines.push("");
    lines.push(
      `:wastebasket: ${pruned} page${pruned === 1 ? "" : "s"} dropped: no longer in their navigation.`
    );
  }

  if (failures.length > 0) {
    lines.push("");
    lines.push(`:warning: Skipped: ${failures.join("; ")}`);
  }

  lines.push("");
  lines.push(
    previewLinkLine(url, "Their site with the assistant on it", "shows every page of the replica")
  );

  // ── Will the widget actually be there? Say so rather than let them find out ─
  //
  // The pill needs a concierge_configs row, which `concierge_preview` creates. Without one the
  // replica renders as pages and nothing else, and finding that out mid-call is exactly the
  // failure the theme line on hub_preview was written to prevent.
  const { data: conf } = await supabaseAdmin
    .from("concierge_configs")
    .select("enabled")
    .eq("client_id", clientId)
    .maybeSingle();

  lines.push("");
  if (!conf) {
    lines.push(
      ":warning: *No assistant on these pages yet.* This client has no `concierge_configs` row, " +
        "so run the AI Skin Concierge preview step first and then re-run this one."
    );
  } else if (conf.enabled === true) {
    lines.push(":white_check_mark: The assistant is live and appears on every page above.");
  } else {
    lines.push(
      ":white_check_mark: The assistant appears on every page above, through the preview link " +
        "only. It is still switched off everywhere else until the `concierge_live` step, and it " +
        "is not on their real website."
    );
  }

  lines.push("");
  lines.push(
    `:eyes: *Open it before the call.* It is their words, rebuilt, not a copy of their site: ` +
      `${offered} of ${written.length} page${written.length === 1 ? "" : "s"} carry a chosen ` +
      `offer and the rest fall back to the standard one. Nothing here is published and nothing ` +
      `on their own domain has changed.`
  );

  return {
    ok: true,
    note: lines.join("\n"),
  };
}
