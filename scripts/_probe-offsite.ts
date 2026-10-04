// The off-site target classifier: deterministic, and it must stay that way.
//
// Run:
//   bun run scripts/_probe-offsite.ts                            (pure, offline)
//   bun run --env-file=.env.local scripts/_probe-offsite.ts --live   (adds the tables)

import { readFileSync } from "node:fs";
import { classifyTarget, domainOf } from "../src/lib/clients/offsite-targets";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const NONE = { clientDomain: null, competitorDomains: [] as string[] };

// ── 1. domainOf ─────────────────────────────────────────────────────────────
section("1. domainOf");

ok("strips www", domainOf("https://www.yelp.com/biz/x") === "yelp.com");
ok("lowercases", domainOf("https://YELP.com/x") === "yelp.com");
ok("keeps a real subdomain", domainOf("https://boards.reddit.com/x") === "boards.reddit.com");
ok("a non-URL is null", domainOf("yelp.com") === null);
ok("junk is null", domainOf("not a url at all") === null);

// ── 2. The kinds ────────────────────────────────────────────────────────────
section("2. the kinds");

ok("yelp is reviews", classifyTarget({ domain: "yelp.com", exampleUrl: null, ...NONE }) === "review_platform");
ok("bbb is a directory", classifyTarget({ domain: "bbb.org", exampleUrl: null, ...NONE }) === "directory");
ok("nytimes is press", classifyTarget({ domain: "nytimes.com", exampleUrl: null, ...NONE }) === "news");
ok("reddit is a forum", classifyTarget({ domain: "reddit.com", exampleUrl: null, ...NONE }) === "forum");
ok(
  "a subdomain of a forum is a forum",
  classifyTarget({ domain: "old.reddit.com", exampleUrl: null, ...NONE }) === "forum"
);

// ── 3. ‼️ The two that must win before anything else ─────────────────────────
section("3. the client and the competitors win first");

// An engine citing the client's own site is the thing we are trying to CAUSE. On a list of
// people to email it would be asking a client for a link to themselves.
ok(
  "the client's own domain is client_own",
  classifyTarget({
    domain: "aclinic.com",
    exampleUrl: null,
    clientDomain: "https://www.aclinic.com",
    competitorDomains: [],
  }) === "client_own"
);
ok(
  "and it wins even when the domain is also a known directory",
  classifyTarget({
    domain: "bbb.org",
    exampleUrl: null,
    clientDomain: "bbb.org",
    competitorDomains: [],
  }) === "client_own"
);
ok(
  "a selected competitor is a competitor",
  classifyTarget({
    domain: "rival.com",
    exampleUrl: null,
    clientDomain: null,
    competitorDomains: ["https://www.rival.com"],
  }) === "competitor"
);

// ── 4. The listicle path ────────────────────────────────────────────────────
section("4. the listicle path");

for (const url of [
  "https://blog.example.com/best-med-spas-in-charlotte",
  "https://example.com/top-10-clinics",
  "https://example.com/botox-vs-dysport",
  "https://example.com/compare/providers",
]) {
  ok(`${url.slice(8, 48)} reads as a ranked list`, classifyTarget({ domain: "example.com", exampleUrl: url, ...NONE }) === "listicle");
}

// The reverse gate. A pattern loose enough to match anything makes every unknown a listicle.
for (const url of [
  "https://example.com/about",
  "https://example.com/services/botox",
  "https://example.com/bestseller",
]) {
  ok(`${url.slice(8, 48)} does not`, classifyTarget({ domain: "example.com", exampleUrl: url, ...NONE }) === "unknown");
}

// ── 5. ‼️ unknown is a real answer ──────────────────────────────────────────
section("5. unknown is a real answer");

ok(
  "an ordinary site nobody listed is unknown",
  classifyTarget({ domain: "somebodysblog.net", exampleUrl: "https://somebodysblog.net/post", ...NONE }) === "unknown"
);
// ‼️ THE HOST IS MATCHED, NOT THE STRING. "reddit" appears in plenty of URLs that are not it.
ok(
  "a lookalike host is not a forum",
  classifyTarget({ domain: "reddit-clone.example.com", exampleUrl: null, ...NONE }) === "unknown"
);
ok(
  "a path containing a known host is not that host",
  classifyTarget({ domain: "example.com", exampleUrl: "https://example.com/we-love-yelp", ...NONE }) === "unknown"
);

// ── 6. ‼️ The ban this lane inherits ────────────────────────────────────────
section("6. it does not post, anywhere, ever");

const SRC = readFileSync("src/lib/clients/offsite-targets.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

ok("no fetch", !/\bfetch\s*\(/.test(SRC));
ok("no model call", !/callClaudeJSON|anthropic|claude-/.test(SRC));
ok("no mail", !/sendMail|sendDraft|createReply/.test(SRC));

// ‼️ DETERMINISTIC, WHICH IS WHY THE DAY-THIRTY COMPARISON MEANS ANYTHING. The same corpus
// must classify the same way twice, or a before-and-after says nothing about the work between.
const twice = new Set(
  [1, 2].map(() =>
    JSON.stringify(
      ["yelp.com", "reddit.com", "example.com", "bbb.org"].map((d) =>
        classifyTarget({ domain: d, exampleUrl: null, ...NONE })
      )
    )
  )
);
ok("classification is stable across reads", twice.size === 1);

async function live(): Promise<void> {
  section("7. LIVE: the tables");
  const { supabaseAdmin } = await import("../src/lib/db");
  for (const t of ["offsite_targets", "listing_submissions"] as const) {
    const { error } = await supabaseAdmin.from(t).select("id").limit(1);
    ok(`${t} exists`, !error, error?.message);
  }
  // The two widened CHECKs.
  const { error: q } = await supabaseAdmin.from("outreach_send_queue").select("id, kind").limit(1);
  ok("outreach_send_queue is readable", !q, q?.message);
  const { error: ps } = await supabaseAdmin.from("page_sources").select("id, collected_via").limit(1);
  ok("page_sources is readable", !ps, ps?.message);
}

async function main(): Promise<void> {
  if (process.argv.includes("--live")) {
    try {
      await live();
    } catch (e) {
      ok("the live half ran", false, (e as Error).message);
    }
  } else {
    console.log("\n(pure half only. Add --env-file=.env.local and --live for the tables.)");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
