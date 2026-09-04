// The magnet lane's write half, proved.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
// The structural half needs no database and runs with no env at all.
//
// ‼️ NO MODEL CALL AND NO WRITES. Every check is either pure or a SELECT. Drafting five offers
// costs a Sonnet call and minting one inserts into a catalogue every client's ladder walks, so
// neither belongs in something anybody is meant to run casually.
//
// WHAT IT PROVES
//  1. proposeAudience is total and closed: every unmapped vertical, null included, is ambiguous.
//  2. A minted client-scoped magnet lands on the client rung and is invisible to every other
//     client and to the other audience.
//  3. The two copy rules the catalogue-wide probe enforces are enforced BEFORE a row is minted.
//  4. Nothing under src/lib/concierge decides an audience by reading a vertical.
//  5. No `cand:` transport value can reach client_pages.lead_magnet_key.
//  6. Live: every stored candidate obeys the copy rules, and every approved one agrees with the
//     page it belongs to.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { supabaseAdmin } from "@/lib/db";
import { proposeAudience } from "@/lib/concierge/audience-proposal";
import { conciergeLaneName } from "@/lib/concierge/lane-name";
import { rungOf, type LeadMagnet } from "@/lib/concierge/magnets";
import { CTA_MAX, MIN_CANDIDATES } from "@/lib/concierge/magnet-drafts";
import { hasBannedDash } from "@/lib/copy-guard";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── 1. The audience proposal ─────────────────────────────────────────────────
function audienceProposal(): void {
  console.log("\n1. proposeAudience is a closed allowlist, not a heuristic");

  check(
    "the AEO agency verticals propose owner, unambiguously",
    ["aeo-agency", "aeo-agency-med-spa", "aeo-marketing-agency"].every((v) => {
      const p = proposeAudience(v);
      return p.audience === "owner" && p.unambiguous;
    })
  );

  check(
    "case and whitespace do not change the answer",
    proposeAudience("  AEO-Agency  ").audience === "owner"
  );

  // ‼️ THE WHOLE POINT OF THE MAP BEING CLOSED. A substring match on "agency" would claim every
  // marketing client that ever onboards, and a med spa whose classifier wrote something unusual
  // would silently get the owner bot in front of its patients.
  const unknowns = [null, "", "medspa", "med-spa", "trt", "dermatology", "agency", "seo-agency"];
  check(
    "every vertical the map has not seen is patient AND flagged ambiguous",
    unknowns.every((v) => {
      const p = proposeAudience(v);
      return p.audience === "patient" && !p.unambiguous;
    }),
    unknowns
      .filter((v) => {
        const p = proposeAudience(v);
        return p.audience !== "patient" || p.unambiguous;
      })
      .map((v) => JSON.stringify(v))
      .join(", ")
  );

  check(
    "every proposal explains itself, because the reason goes straight onto the card",
    [null, "aeo-agency", "medspa"].every((v) => proposeAudience(v).reason.trim().length > 20)
  );

  check(
    "no proposal reason carries a banned dash",
    [null, "", "aeo-agency", "aeo-agency-med-spa", "medspa", "trt"].every(
      (v) => !hasBannedDash(proposeAudience(v).reason)
    )
  );

  check(
    "the two lanes are named differently, which is the whole of requirement 4",
    conciergeLaneName("owner") !== conciergeLaneName("patient") &&
      !hasBannedDash(conciergeLaneName("owner")) &&
      !hasBannedDash(conciergeLaneName("patient"))
  );
}

// ── 2. A minted magnet cannot leak ───────────────────────────────────────────
function mintedShape(): void {
  console.log("\n2. a minted magnet sits on the client rung and leaks nowhere");

  // Exactly what approveMagnetCandidate inserts: client scoped, every placement axis null.
  const minted: LeadMagnet = {
    id: "x",
    magnetKey: "acme-clinic-the-five-questions",
    chainsToKey: null,
    audience: "patient",
    clientId: "client-a",
    vertical: null,
    treatment: null,
    category: null,
    title: "The Five Questions",
    promise: "p",
    ctaLabel: "The five questions",
    assetUrl: null,
    conciergeEntry: "e",
    sortOrder: 50,
  };

  const q = {
    audience: "patient" as const,
    clientId: "client-a",
    vertical: "medspa",
    treatment: null,
    category: null,
  };

  // 8 is the client rung in rungOf: client_id set, every axis a wildcard on the row.
  check("it scores the client rung", rungOf(minted, q) === 8, `got ${rungOf(minted, q)}`);

  check(
    "another client cannot see it",
    rungOf(minted, { ...q, clientId: "client-b" }) === null
  );

  // ‼️ THE FIREWALL 2026-09-03-concierge-audience.sql EXISTS FOR. An owner offer reaching a
  // patient conversation is the failure the audience column was added to prevent, and minting is
  // the first thing in this codebase that can create a row on the wrong side of it.
  check(
    "the other audience cannot see it",
    rungOf(minted, { ...q, audience: "owner" }) === null
  );

  check(
    "an unclassified page still reaches it, because the page names it by key",
    rungOf(minted, { ...q, vertical: null }) === 8
  );
}

// ── 3. The copy rules, which are somebody else's probe ───────────────────────
function copyRules(): void {
  console.log("\n3. the rules the catalogue-wide probe enforces are enforced before minting");

  check(`the pill limit is still ${CTA_MAX}`, CTA_MAX === 28, `got ${CTA_MAX}`);
  check(`at least ${MIN_CANDIDATES} offers are demanded`, MIN_CANDIDATES >= 5);

  const src = readFileSync("src/lib/concierge/magnet-drafts.ts", "utf8");

  // Both checks must exist on the APPROVE path and not only on the draft path. The drafter's
  // validation ran against one model response; approval runs against what is in the table now,
  // and the table is what _probe-concierge-lane.ts section 9b reads.
  const approve = src.slice(src.indexOf("export async function approveMagnetCandidate"));
  check(
    "approveMagnetCandidate re-checks the pill length",
    approve.includes("CTA_MAX"),
    "a row that got into the table some other way would reach the catalogue unchecked"
  );
  check(
    "approveMagnetCandidate re-checks for banned dashes",
    approve.includes("hasBannedDash")
  );
  // ‼️ THIS ONE EXISTS BECAUSE THE FIRST LIVE RUN BROKE IT. Asked for five offers for SRT, the
  // model wrote "Because 97 percent of med spas run one location" into a promise and cited
  // nothing. The prompt already forbade it in words; a rule a model is asked to follow is not a
  // rule. Same doctrine as checkOrphanNumbers() in hub/page-gate.ts.
  check(
    "the drafter refuses a figure no source contains",
    src.includes("function orphanNumbers") && src.includes("orphanNumbers(value, numberHaystack)"),
    "a promise is read by a stranger in the widget and is as publishable-and-false as a page body"
  );

  check(
    "approveMagnetCandidate refuses a candidate whose audience has since changed",
    approve.includes("cand.audience !== tenant.audience")
  );
  check(
    "a minted magnet is always deliverable: asset_url null, no env-backed key",
    approve.includes("asset_url: null")
  );
  check(
    "a minted magnet claims no placement, so the ladder cannot hand it to another page",
    approve.includes("vertical: null") &&
      approve.includes("treatment: null") &&
      approve.includes("category: null")
  );
}

// ── 4. The audience is never derived at read time ────────────────────────────
function noDerivedAudience(): void {
  console.log("\n4. nothing under lib/concierge decides an audience from a vertical");

  // docs/2026-09-03-concierge-audience.sql, section 1: "AND THE COLUMN IS EXPLICIT, NEVER DERIVED
  // FROM vertical". audience-proposal.ts is the one deliberate exception and it PROPOSES a seed
  // that a person then ratifies, which is why it is named here rather than matched loosely.
  const allowed = new Set(["audience-proposal.ts"]);
  const dir = "src/lib/concierge";
  const offenders: string[] = [];

  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name) || allowed.has(name)) continue;
      const text = readFileSync(full, "utf8");
      // A file that mentions vertical_slug at all in this directory is a file about to guess.
      if (text.includes("vertical_slug")) offenders.push(full);
    }
  };
  walk(dir);

  check(
    "no concierge module reads clients.vertical_slug",
    offenders.length === 0,
    offenders.join(", ")
  );

  const proposal = readFileSync("src/lib/concierge/audience-proposal.ts", "utf8");
  check(
    "the one exception is pure: it takes a string and touches no database",
    !proposal.includes("supabaseAdmin") && !proposal.includes("from(")
  );
}

// ── 5. The transport value cannot be stored ──────────────────────────────────
function candPrefix(): void {
  console.log("\n5. `cand:` is a transport form and never reaches the database");

  const route = readFileSync("src/app/api/clients/[id]/hub/route.ts", "utf8");

  check(
    "the hub route has a resolver for it",
    route.includes("async function resolveMagnetChoice") && route.includes('startsWith("cand:")')
  );

  // ‼️ BOTH WRITERS, NOT ONE. page_draft passes the key to the drafter and page_save stores it.
  // A resolver on only one of them would mean the picker worked until somebody pressed the other
  // button, and the page would then hold a key magnetByKey cannot resolve, which offerForPage
  // reports as a chosen offer that hands over nothing.
  const draftCase = route.slice(route.indexOf('case "page_draft"'), route.indexOf('case "page_save"'));
  const saveCase = route.slice(route.indexOf('case "page_save"'));
  check("page_draft resolves it", draftCase.includes("resolveMagnetChoice"));
  check("page_save resolves it", saveCase.includes("resolveMagnetChoice"));

  const pages = readFileSync("src/lib/hub/pages.ts", "utf8");
  check(
    "hub/pages.ts knows nothing about the prefix, so there is one place it can be resolved",
    !pages.includes("cand:")
  );
}

// ── 6. Live rows ─────────────────────────────────────────────────────────────
async function liveRows(): Promise<void> {
  console.log("\n6. live rows");

  const { data, error } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("id, page_id, status, title, promise, cta_label, concierge_entry, minted_magnet_key");

  if (error) {
    if (/relation|does not exist|schema cache/i.test(error.message)) {
      check("page_magnet_candidates exists", false, "docs/2026-09-04-magnet-lane.sql has not been run");
      return;
    }
    console.log(`  skip  the database did not answer: ${error.message}`);
    return;
  }

  const rows = data ?? [];
  console.log(`        ${rows.length} candidate row(s) on file`);

  check(
    "every stored candidate's pill label is within the limit",
    rows.every((r) => ((r.cta_label as string) ?? "").length <= CTA_MAX),
    rows
      .filter((r) => ((r.cta_label as string) ?? "").length > CTA_MAX)
      .map((r) => `${r.id}: ${(r.cta_label as string).length}`)
      .join(", ")
  );

  check(
    "no stored candidate carries a banned dash",
    rows.every(
      (r) =>
        !hasBannedDash((r.title as string) ?? "") &&
        !hasBannedDash((r.promise as string) ?? "") &&
        !hasBannedDash((r.cta_label as string) ?? "") &&
        !hasBannedDash((r.concierge_entry as string) ?? "")
    )
  );

  check(
    "every approved candidate records the key it minted",
    rows.filter((r) => r.status === "approved").every((r) => Boolean(r.minted_magnet_key))
  );

  // ‼️ THE INVARIANT approveMagnetCandidate MAINTAINS, CHECKED FROM THE OTHER SIDE. An approved
  // candidate whose page points somewhere else means the mint succeeded and setPageMagnet did not,
  // which the approve path reports but cannot itself repair.
  const approved = rows.filter((r) => r.status === "approved");
  if (approved.length) {
    const { data: pages } = await supabaseAdmin
      .from("client_pages")
      .select("id, slug, lead_magnet_key")
      .in("id", approved.map((r) => r.page_id as string));

    const byId = new Map((pages ?? []).map((p) => [p.id as string, p]));
    const mismatched = approved.filter(
      (r) => byId.get(r.page_id as string)?.lead_magnet_key !== r.minted_magnet_key
    );
    check(
      "every approved candidate agrees with the page it belongs to",
      mismatched.length === 0,
      mismatched.map((r) => `${byId.get(r.page_id as string)?.slug ?? r.page_id}`).join(", ")
    );
  }

  // ‼️ A CLIENT-SCOPED DRAFT MUST NEVER BE GROUPED UNDER A PAGE. page_id is nullable since
  // 2026-09-04 so offers can exist before the first page does, and the board's per-page optgroup
  // reads draftsByPageFor(). A null slipping into that map would offer the same five under every
  // page on the hub, each claiming to have been written for it.
  const { draftsByPageFor } = await import("@/lib/concierge/magnet-drafts");
  const { data: scoped } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("client_id")
    .is("page_id", null)
    .limit(1);

  if ((scoped ?? []).length > 0) {
    const owner = (scoped ?? [])[0].client_id as string;
    const grouped = await draftsByPageFor(owner);
    const leaked = Object.entries(grouped).filter(([, list]) => list.some((c) => !c.pageId));
    check(
      "no client-scoped draft is grouped under a page",
      leaked.length === 0,
      leaked.map(([k]) => k).join(", ")
    );
  } else {
    check("no client-scoped draft is grouped under a page", true, "none on file to check");
  }

  // ‼️ ONE APPROVED CLIENT-SCOPED OFFER PER CLIENT, WHICH THE FIRST PARTIAL INDEX CANNOT SEE.
  // page_magnet_candidates_one_approved is UNIQUE on (page_id) WHERE status='approved', and
  // Postgres treats two NULLs as distinct, so it permits any number of approved client-scoped
  // rows. Two of those means two client-rung magnets at the same sort_order and rankMagnets
  // breaking the tie alphabetically, which is a coin toss deciding what a stranger is offered.
  // docs/2026-09-04-client-magnets.sql adds the second index; this asserts the outcome.
  const { data: approvedScoped } = await supabaseAdmin
    .from("page_magnet_candidates")
    .select("client_id")
    .is("page_id", null)
    .eq("status", "approved");

  const perClient = new Map<string, number>();
  for (const r of approvedScoped ?? []) {
    const k = String(r.client_id);
    perClient.set(k, (perClient.get(k) ?? 0) + 1);
  }
  const doubled = [...perClient.entries()].filter(([, n]) => n > 1);
  check(
    "no client has two approved client-scoped offers",
    doubled.length === 0,
    doubled.map(([k, n]) => `${k} has ${n}`).join(", ")
  );

  // Who is on which lane, and whether anybody said so.
  const { data: configs } = await supabaseAdmin
    .from("concierge_configs")
    .select("client_id, audience, enabled, audience_confirmed_at");

  const unratifiedLive = (configs ?? []).filter((c) => c.enabled && !c.audience_confirmed_at);
  check(
    "no LIVE widget is running on an audience nobody confirmed",
    unratifiedLive.length === 0,
    unratifiedLive.map((c) => `${c.client_id} (${c.audience})`).join(", ") +
      ". concierge_live now refuses this, but a row enabled before that landed is still live."
  );
}

async function main(): Promise<void> {
  audienceProposal();
  mintedShape();
  copyRules();
  noDerivedAudience();
  candPrefix();

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await liveRows();
  } else {
    console.log("\n6. live rows\n  skip  no database env. Re-run with --env-file=.env.local");
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
