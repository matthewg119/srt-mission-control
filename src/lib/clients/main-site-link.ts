// Does the client's own homepage link to their pillar page on the hub?
//
// docs/specs/SRT-AEO-Client-Onboarding-SOP.md:243, "the interlink is what passes authority in both
// directions". Hub to main site already exists (NAP and sameAs). Main site to pillar is a link only
// the client can add, so it is a checklist item, and this is the check behind its tick.
//
// ‼️ NO GREEN TICK WITHOUT THE FETCH. `checked` is true only when their homepage was actually read.
// Every path that did not fetch (no pillar published, no website, a failed request) returns
// checked:false with `detail` saying which, and never found:true. A verifier that guessed would be
// a tick on the board that means nothing, which is worse than no tick.

import { supabaseAdmin } from "@/lib/db";
import { fetchPage } from "@/lib/medspa-owner-scrape";
import { subdomainLabel } from "@/lib/clients/normalize";

export interface MainSiteLinkResult {
  checked: boolean;
  found: boolean;
  homepage: string | null;
  pillarUrl: string | null;
  detail: string;
}

const HOMEPAGE_TIMEOUT_MS = 20000;

function normalizeUrl(input: string): string {
  return input.startsWith("http") ? input : `https://${input}`;
}

/** www and scheme are the same site for this question; case is not part of a hostname. */
function hostKey(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function pathKey(path: string): string {
  return (path.replace(/\/+$/, "") || "/").toLowerCase();
}

/** The few entities that turn up inside href values. Enough to compare a URL, not a parser. */
function decodeHref(raw: string): string {
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/gi, '"')
    .trim();
}

/** Every <a href> in the served HTML, resolved against the page it came from. */
function anchorHrefs(html: string, base: string): URL[] {
  const out: URL[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = decodeHref(m[1] ?? m[2] ?? m[3] ?? "");
    if (!raw) continue;
    try {
      const u = new URL(raw, base);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u);
    } catch {
      // A malformed href is not a link to anything.
    }
  }
  return out;
}

function notChecked(detail: string, extra?: Partial<MainSiteLinkResult>): MainSiteLinkResult {
  return { checked: false, found: false, homepage: null, pillarUrl: null, detail, ...extra };
}

/**
 * Fetch the client's homepage and look for an <a href> to their published pillar on the hub host.
 *
 * ‼️ A CLIENT MAY HAVE MORE THAN ONE PILLAR, so a link to ANY published pillar counts, and
 * `pillarUrl` names the one that matched (or the first by plan rank when none did).
 */
export async function mainSiteLinksPillar(clientId: string): Promise<MainSiteLinkResult> {
  // ── The published pillar(s) ───────────────────────────────────────────────
  const { data: planRows, error: planError } = await supabaseAdmin
    .from("page_plan")
    .select("id, page_id, rank")
    .eq("client_id", clientId)
    .eq("role", "pillar")
    .not("page_id", "is", null)
    .order("rank", { ascending: true });

  if (planError) {
    return notChecked(
      `The page plan could not be read (${planError.message}). If that names role, ` +
        "docs/2026-09-11-one-strategy.sql has not been run, so there is no pillar to look for."
    );
  }
  const pillarPageIds = (planRows ?? []).map((r) => r.page_id as string);
  if (pillarPageIds.length === 0) {
    return notChecked("No pillar on the page plan has a page yet, so there is nothing for their homepage to link to.");
  }

  const { data: pages, error: pagesError } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug")
    .eq("client_id", clientId)
    .eq("status", "published")
    .in("id", pillarPageIds);

  if (pagesError) return notChecked(`The pillar page could not be read (${pagesError.message}).`);
  const slugById = new Map((pages ?? []).map((p) => [p.id as string, p.slug as string]));
  const pillarSlugs = pillarPageIds.map((id) => slugById.get(id)).filter((s): s is string => !!s);
  if (pillarSlugs.length === 0) {
    return notChecked(
      "The pillar page is not published yet. Asking them to link to it now would put a 404 on their own homepage."
    );
  }

  // ── The hub host, as attached, else as derived ─────────────────────────────
  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("website, domain, subdomain")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) return notChecked(`The client could not be read (${clientError.message}).`);
  if (!client) return notChecked("That client does not exist.");

  // ‼️ THE ATTACHED HOST FIRST, for the reason CLAUDE.md gives for client_hosts: what was attached,
  // not what a string on the board says it should be. Derivation (hostsFor's rule) is the fallback.
  const { data: hostRows } = await supabaseAdmin
    .from("client_hosts")
    .select("host, enabled")
    .eq("client_id", clientId)
    .eq("kind", "hub");

  const attached =
    (hostRows ?? []).find((h) => h.enabled === true)?.host ?? (hostRows ?? [])[0]?.host ?? null;
  const domain = ((client.domain as string | null) ?? "").trim().toLowerCase();
  const hubHost =
    (attached as string | null) ??
    (domain ? `${subdomainLabel(client.subdomain as string | null, domain)}.${domain}` : null);

  if (!hubHost) {
    return notChecked("No hub host is attached and there is no domain to derive one from.");
  }

  const pillarUrls = pillarSlugs.map((slug) => `https://${hubHost}/${slug}`);

  // ── Their homepage ─────────────────────────────────────────────────────────
  const site = ((client.website as string | null) || domain || "").trim();
  if (!site) {
    return notChecked("No website or domain on file for this client, so there is no homepage to read.", {
      pillarUrl: pillarUrls[0],
    });
  }

  const homepage = normalizeUrl(site);
  const res = await fetchPage(homepage, { timeoutMs: HOMEPAGE_TIMEOUT_MS, retries: 1 });
  if (!res.ok) {
    // ‼️ A FAILED FETCH IS NOT A MISSING LINK. "We could not read it" and "it is not there" are
    // different facts, and only the second is something to ask the client to fix.
    return notChecked(
      `Could not read ${homepage} (${res.reason}${res.detail ? `: ${res.detail}` : ""}), so whether it links to the pillar is unknown.`,
      { homepage, pillarUrl: pillarUrls[0] }
    );
  }

  const readFrom = res.finalUrl || homepage;
  const hrefs = anchorHrefs(res.html, readFrom);
  const hubKey = hostKey(hubHost);
  const wanted = new Map(pillarSlugs.map((slug, i) => [pathKey(`/${slug}`), pillarUrls[i]]));

  const onHub = hrefs.filter((u) => hostKey(u.hostname) === hubKey);
  const hit = onHub.find((u) => wanted.has(pathKey(u.pathname)));

  if (hit) {
    return {
      checked: true,
      found: true,
      homepage: readFrom,
      pillarUrl: wanted.get(pathKey(hit.pathname)) ?? pillarUrls[0],
      detail: `Their homepage links to the pillar: ${hit.href}.`,
    };
  }

  return {
    checked: true,
    found: false,
    homepage: readFrom,
    pillarUrl: pillarUrls[0],
    detail:
      `Read ${readFrom}: none of the ${hrefs.length} links in the served HTML points at ${pillarUrls.join(" or ")}` +
      (onHub.length
        ? `. It does link to the hub (${onHub[0].href}), just not to the pillar.`
        : ". It has no link to the hub at all."),
  };
}
