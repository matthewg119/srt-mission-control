/**
 * Does Prospeo actually know our buyer? Measured before a single credit is wired into the pipeline.
 *
 *   bun run scripts/_probe-prospeo-coverage.ts              refuses, prints what it would spend
 *   bun run scripts/_probe-prospeo-coverage.ts --yes        SPENDS credits, default 15 domains
 *   bun run scripts/_probe-prospeo-coverage.ts --yes --n=30
 *
 * ‼️ THIS IS A MEASUREMENT, NOT AN INTEGRATION, AND THE ORDER IS THE WHOLE POINT. The advice this
 * came from says: run the free system, measure the real failure rate, then send only the failures to
 * ONE paid provider. That is right, and it has a step before it which is easy to skip: find out
 * whether the provider knows this vertical at all.
 *
 * The first three live lookups on 2026-10-04 were not encouraging:
 *   secretmedspa.com      1 person, "Business Owner", located in SUFFOLK, VIRGINIA for a DALLAS
 *                         clinic, company industry "Law Enforcement", company domain resolved to
 *                         zenoti.com (a booking platform), and email status UNAVAILABLE.
 *   chameleonmedspa.com   NO_RESULTS
 *   weightloss4texas.com  rate limited
 *
 * That is a plausible shape for a 200M B2B contact database meeting an owner-operated clinic with
 * three staff: these businesses are exactly the segment least likely to be in it. One bad sample is
 * not a verdict though, which is what this script is for.
 *
 * ‼️ IT SPENDS, SO IT IS OPT-IN AND NEVER IN CI. Prospeo charges 1 credit per search that returns at
 * least one person, so a NO_RESULTS is free and the cost here is bounded by the hit rate itself.
 *
 * ‼️ bun run, NOT bunx tsx, for DATABASE_URL and PROSPEO_API_KEY out of .env.local.
 */

import { SQL } from "bun";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

const key = process.env.PROSPEO_API_KEY;
const dbUrl = process.env.DATABASE_URL;
const go = process.argv.includes("--yes");
const n = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 15);

if (!go) {
  console.log(
    `This probe SPENDS Prospeo credits: up to ${n} searches, 1 credit each when a search finds somebody.\n` +
    "A search that finds nobody is free. Re-run with --yes."
  );
  process.exit(0);
}
if (!key) { console.error("PROSPEO_API_KEY is not set in .env.local."); process.exit(1); }
if (!dbUrl) { console.error("DATABASE_URL is not set in .env.local."); process.exit(1); }

const sql = new SQL(dbUrl) as unknown as TagSQL;

// ‼️ THE SAMPLE IS THE FAILURES, NOT A RANDOM SLICE. A paid rung is only ever asked about the
// companies the free rungs could not answer, so measuring it on companies that already have an
// address would report a coverage number that means nothing about the job it would actually do.
const targets = (await sql.unsafe(`
  select l.business_name, l.domain, l.city, l.state
  from raw_leads l
  where l.vertical_slug = 'medspa'
    and l.qualify_keep
    and l.domain is not null
    and l.owner_name is null
    and not exists (select 1 from sendable_leads s where s.raw_lead_id = l.id)
  order by l.review_count desc nulls last
  limit ${Math.max(1, Math.min(100, n))}
`)) as Array<Record<string, string | null>>;

console.log(`Measuring Prospeo against ${targets.length} companies the free rungs could not answer.\n`);

interface Outcome {
  domain: string;
  businessName: string;
  found: number;
  name: string | null;
  title: string | null;
  personState: string | null;
  emailStatus: string | null;
  sameState: boolean | null;
  error: string | null;
}

const outcomes: Outcome[] = [];

for (const t of targets) {
  const domain = String(t.domain);
  const res = await fetch("https://api.prospeo.io/search-person", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-KEY": key },
    body: JSON.stringify({
      page: 1,
      filters: {
        company: { websites: { include: [domain] } },
        person_seniority: { include: ["Founder/Owner"] },
      },
    }),
  });
  const body = (await res.json()) as {
    error?: boolean;
    error_code?: string;
    error_toast?: string;
    results?: Array<{ person?: Record<string, unknown>; company?: Record<string, unknown> }>;
  };

  if (body.error || !Array.isArray(body.results)) {
    const err = body.error_code ?? body.error_toast ?? "unknown";
    outcomes.push({
      domain, businessName: String(t.business_name), found: 0, name: null, title: null,
      personState: null, emailStatus: null, sameState: null, error: err,
    });
    console.log(`  ${domain.padEnd(32)} -  ${err}`);
    // Rate limited: back off hard rather than burning the rest of the sample on 429s.
    if (/rate/i.test(err)) await new Promise((r) => setTimeout(r, 20_000));
    else await new Promise((r) => setTimeout(r, 2_500));
    continue;
  }

  const first = body.results[0];
  const p = (first?.person ?? {}) as Record<string, unknown>;
  const loc = (p.location ?? {}) as Record<string, unknown>;
  const email = (p.email ?? {}) as Record<string, unknown>;
  const personState = (loc.state as string | null) ?? null;
  const leadState = (t.state ?? "").trim();

  // ‼️ A STATE MISMATCH IS THE SIGNAL TO WATCH, NOT A CURIOSITY. Our buyer is an owner-operated
  // clinic with one to three locations; its owner lives near it. A "Business Owner" two thousand
  // miles away is the database matching a website string to the wrong company, which is precisely
  // how a stranger's name ends up in a greeting.
  const sameState =
    personState && leadState
      ? personState.toLowerCase() === leadState.toLowerCase()
      : null;

  outcomes.push({
    domain,
    businessName: String(t.business_name),
    found: body.results.length,
    name: (p.full_name as string | null) ?? null,
    title: (p.current_job_title as string | null) ?? null,
    personState,
    emailStatus: (email.status as string | null) ?? null,
    sameState,
    error: null,
  });

  console.log(
    `  ${domain.padEnd(32)} ${String(body.results.length).padStart(2)} found  ` +
    `${(p.full_name as string ?? "-").padEnd(22)} ${(personState ?? "?").padEnd(14)} ` +
    `email=${(email.status as string) ?? "-"}  ${sameState === false ? "<- WRONG STATE" : ""}`
  );
  await new Promise((r) => setTimeout(r, 2_500));
}

const withResults = outcomes.filter((o) => o.found > 0);
const rightState = withResults.filter((o) => o.sameState === true);
const wrongState = withResults.filter((o) => o.sameState === false);
const withEmail = withResults.filter((o) => (o.emailStatus ?? "").toUpperCase() === "VERIFIED");
const rateLimited = outcomes.filter((o) => /rate/i.test(o.error ?? ""));

console.log("\n─── coverage on the companies the free rungs could not answer ───");
console.log(`  asked                       ${outcomes.length}`);
console.log(`  rate limited (not a miss)   ${rateLimited.length}`);
console.log(`  returned somebody           ${withResults.length}`);
console.log(`    of those, same state      ${rightState.length}`);
console.log(`    of those, WRONG state     ${wrongState.length}   <- would misattribute`);
console.log(`    of those, email VERIFIED  ${withEmail.length}`);
const asked = outcomes.length - rateLimited.length;
if (asked > 0) {
  console.log(`\n  usable owner rate           ${Math.round((rightState.length / asked) * 100)}%  (same state, somebody named)`);
  console.log(`  usable EMAIL rate           ${Math.round((withEmail.length / asked) * 100)}%  (what you would actually mail)`);
}
console.log("\nA usable email rate near zero means this vertical is not in the database, and the");
console.log("answer is to spend nothing here rather than to tune the query.");

await sql.end();
