// Proves the audit stops throwing away what it already computed, and that client_id still means
// what four readers think it means.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-audit-foundation.ts
//
// ‼️ NO MODEL CALL AND NO WRITES. Every statement is a pure function call or a SELECT, so this is
// safe to run against production at any moment, including mid-audit.
//
// WHAT IT PROVES
//   1. THE CRAWL IS STORED WITHOUT THE TWO UNBOUNDED FIELDS. homepageHtml is raw markup and
//      pages[].text has no per-page cap, so both can dwarf the 16,000-char bodyText they feed.
//      Storing either would put a multi-megabyte blob on a row read by the whole sales lane.
//   2. EVERYTHING ELSE SURVIVES VERBATIM, including `blocked` and `source`. A reader asking what
//      we actually saw needs to know we saw nothing just as much as it needs the text.
//   3. client_id STILL SEPARATES "FIRED FOR THIS CLIENT" FROM "MATCHED BY HOST AFTERWARDS".
//      The 2026-09-14 backfill linked 13 prospect audits by website host, which is the domain
//      fallback step-verify.ts refuses in capitals. BASELINE_ONLY cannot see the difference,
//      because it filters by exclusion and prospect_audit is not excluded.
//   4. A COMPETITOR NAME IS A NAME. prior-report.ts read [{name, domain}] with map(String) and
//      produced five copies of "[object Object]", which filter(Boolean) kept because it is truthy.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storableCrawl, type SiteResearch } from "@/lib/audit-engine/site-research";
import { BASELINE_ONLY, FIRED_FOR_CLIENT } from "@/lib/audit-engine/run-labels";
import type { CrawlBlock } from "@/lib/audit-engine/types";
import { supabaseAdmin } from "@/lib/db";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── 1 and 2. The crawl, shaped for storage ───────────────────────────────────────────────────

function crawl(): void {
  console.log("\n1. storableCrawl: the crawl is kept, the unbounded fields are not");

  const research: SiteResearch = {
    website: "https://elmstreetaesthetics.com",
    title: "Elm Street Aesthetics",
    metaDescription: "Injectables and laser in Greensboro",
    siteName: "Elm Street Aesthetics",
    headings: ["Botox", "Lip filler"],
    pages: [
      { url: "https://elmstreetaesthetics.com", text: "x".repeat(40_000) },
      { url: "https://elmstreetaesthetics.com/services", text: "y".repeat(12_345) },
    ],
    bodyText: "the combined body text",
    schemaHints: [{ "@type": "LocalBusiness" }],
    homepageHtml: "<html>" + "z".repeat(900_000) + "</html>",
    source: "site",
    blocked: null,
  };

  const out = storableCrawl(research);
  const json = JSON.stringify(out);

  check("homepageHtml is not in the stored object", !("homepageHtml" in out));
  check(
    "and none of its 900KB leaks through another field",
    !json.includes("zzzzzzzzzz"),
    `${json.length} chars serialized`
  );

  const pages = out.pages as Array<{ url: string; chars: number }>;
  check("pages keeps one entry per crawled URL", pages.length === 2);
  check("a page carries its url", pages[0].url === "https://elmstreetaesthetics.com");
  check("a page carries how much text it had, not the text", pages[0].chars === 40_000);
  check("the second page too", pages[1].chars === 12_345);
  check(
    "no page text leaks into the stored object",
    !json.includes("xxxxxxxxxx") && !json.includes("yyyyyyyyyy")
  );

  // The whole point of dropping pages[].text: it is bigger than the field it feeds.
  const pageChars = research.pages.reduce((n, p) => n + p.text.length, 0);
  check(
    `pages[].text (${pageChars}) really is larger than bodyText (${research.bodyText.length})`,
    pageChars > research.bodyText.length
  );
  check(
    "the whole stored crawl is smaller than the html alone by orders of magnitude",
    json.length < research.homepageHtml.length / 100,
    `${json.length} vs ${research.homepageHtml.length}`
  );

  console.log("\n2. storableCrawl: everything else survives verbatim");
  check("website", out.website === research.website);
  check("title", out.title === research.title);
  check("metaDescription", out.metaDescription === research.metaDescription);
  check("siteName", out.siteName === research.siteName);
  check("headings", JSON.stringify(out.headings) === JSON.stringify(research.headings));
  check("bodyText", out.bodyText === research.bodyText);
  check("schemaHints", JSON.stringify(out.schemaHints) === JSON.stringify(research.schemaHints));
  check("source", out.source === research.source);

  // ‼️ Tri-state. null means nobody looked; a CrawlBlock means we looked and were refused.
  check("blocked survives as null when nothing blocked us", out.blocked === null);
  const block = {
    reason: "forbidden" as CrawlBlock["reason"],
    status: 403,
    detail: "403 from the origin",
    checked_at: "2026-09-14T00:00:00.000Z",
    engines_cited_site: null,
  };
  const blockedOut = storableCrawl({ ...research, blocked: block });
  check(
    "and survives whole when something did, so a later reader can tell blocked from timed out",
    JSON.stringify(blockedOut.blocked) === JSON.stringify(block)
  );
}

// ── 3. client_id still separates the two meanings ────────────────────────────────────────────

async function linkMeaning(): Promise<void> {
  console.log("\n3. client_id: fired for this client, or matched by host afterwards");

  check(
    "BASELINE_ONLY does NOT exclude prospect_audit, which is why it is not enough on its own",
    !BASELINE_ONLY.includes("prospect_audit"),
    BASELINE_ONLY
  );

  // ‼️ ITS OWN SELECT. One unknown column fails the WHOLE PostgREST select and supabase-js RETURNS
  // that error rather than throwing, so reading a new column beside old ones would make an
  // unapplied migration look like an empty table.
  const probe = await supabaseAdmin.from("audit_reports").select("client_link_source").limit(1);
  if (probe.error) {
    check(
      "audit_reports.client_link_source exists",
      false,
      `${probe.error.message}. Run docs/2026-09-14-audit-foundation.sql against production first.`
    );
    return;
  }
  check("audit_reports.client_link_source exists", true);

  const { data: linked, error } = await supabaseAdmin
    .from("audit_reports")
    .select("client_link_source")
    .not("client_id", "is", null);
  if (error) {
    check("the linked rows are readable", false, error.message);
    return;
  }

  const tally = new Map<string, number>();
  for (const r of linked ?? []) {
    const k = String((r as { client_link_source: string | null }).client_link_source);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  console.log(`        linked rows by link source: ${JSON.stringify(Object.fromEntries(tally))}`);

  check(
    "every linked row says how it was linked",
    !tally.has("null"),
    `${tally.get("null") ?? 0} linked rows have no client_link_source`
  );
  check(
    "the host-match backfill is recorded as such, not as a baseline",
    (tally.get("backfilled_by_domain") ?? 0) > 0
  );

  // What the baseline verifier now resolves, per client.
  const { data: own } = await supabaseAdmin
    .from("audit_reports")
    .select("client_id, created_at, score")
    .not("client_id", "is", null)
    .or(BASELINE_ONLY)
    .eq("client_link_source", FIRED_FOR_CLIENT);

  const byClient = new Set((own ?? []).map((r) => (r as { client_id: string }).client_id));
  console.log(`        ${(own ?? []).length} baseline photograph(s) across ${byClient.size} client(s)`);
  check(
    "at least one client has a baseline fired for it",
    byClient.size > 0,
    "if this is zero, step 2 refuses for every client: no audit was fired for a client row that still exists"
  );

  // The regression, stated as a check: a prospect audit adopted by host must NOT be reachable
  // as a baseline photograph.
  const { data: leak } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("client_link_source", "backfilled_by_domain")
    .or(BASELINE_ONLY)
    .eq("client_link_source", FIRED_FOR_CLIENT);
  check(
    "no adopted prospect audit can be read as a baseline photograph",
    (leak ?? []).length === 0,
    `${(leak ?? []).length} row(s) satisfy both`
  );
}

// ── 4. A competitor name is a name ───────────────────────────────────────────────────────────

function competitorNames(): void {
  console.log("\n4. prior-report: a competitor is quoted by name, never as [object Object]");

  const src = readFileSync(join(process.cwd(), "src/lib/audit-engine/prior-report.ts"), "utf8");
  const shaped = src.slice(src.indexOf("competitors: Array.isArray(row.competitors)"));

  check(
    "the competitors read no longer calls map(String) on the rows",
    !/competitors as unknown\[\]\)\s*\.map\(String\)/.test(shaped)
  );
  check("it reads the name off each object instead", /typeof c\?\.name === "string"/.test(shaped));

  // The bug, reproduced, so the reason is visible rather than asserted.
  const rows = [{ name: "Oak Avenue Med Spa", domain: "oak.com", hypothesis: true }];
  const wrong = rows.map(String).filter(Boolean);
  const right = rows.map((c) => (typeof c?.name === "string" ? c.name.trim() : "")).filter(Boolean);
  check("map(String) really did produce [object Object]", wrong[0] === "[object Object]");
  check("and filter(Boolean) really did keep it, because it is truthy", wrong.length === 1);
  check("the fixed read produces the name", right[0] === "Oak Avenue Med Spa");
}

async function main(): Promise<void> {
  crawl();
  await linkMeaning();
  competitorNames();

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nprobe crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
