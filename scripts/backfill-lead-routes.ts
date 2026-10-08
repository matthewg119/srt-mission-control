/**
 * Re-route the stored leads the SQL backfill could not reach.
 *
 *   bun run scripts/backfill-lead-routes.ts            report only, writes nothing
 *   bun run scripts/backfill-lead-routes.ts --write    apply it
 *
 * ‼️ bun run, NOT bunx tsx. Bun auto-loads .env.local and reads DATABASE_URL; Node does not, and the
 * query then fails with a bare connection error that says nothing about the missing variable.
 *
 * WHY A SCRIPT RATHER THAN MORE SQL. docs/2026-10-08-lead-tiers.sql backfills `route` from what SQL
 * can know on its own: a blank website is a call, a kept row is an email, a dropped row is a drop.
 * It deliberately stops there, because the two remaining rules live in TypeScript and copying them
 * into SQL would be the second copy that always ends up disagreeing:
 *
 *   NON_IDENTIFYING_HOSTS   27 hosts in src/lib/scraper/dedup.ts, read here through `domainKey`
 *   the chain rule          "how many rows share this domain" needs the pull in hand
 *
 * ‼️ AND IT IS ROUTING, NEVER RE-JUDGING. `qualify_keep`, `qualify_reason` and `qualify_model` are
 * never touched. A row that Haiku dropped on 2026-10-06 for "no website domain, Instagram only"
 * stays dropped with that reason; what changes is that it now goes on the call list instead of
 * nowhere, which is the operator's own standing rule about leads without an email.
 *
 * ‼️ IT WILL NOT MOVE A ROW OUT OF 'email'. A lead already routed to enrichment may be mid-crawl or
 * already have a sendable_leads row, and re-routing it to 'call' would strand that address. Only
 * 'drop' rows are candidates, which is the direction that can only give leads back.
 */

import { SQL } from "bun";
import { domainKey } from "../src/lib/scraper/dedup";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. It lives in .env.local; run this with `bun run`, not tsx.");
  process.exit(1);
}
const write = process.argv.includes("--write");

const sql = new SQL(url) as unknown as TagSQL;

// ‼️ THE CROSS-RUN DUPLICATE IS EXCLUDED BY ITS EXACT REASON STRING, AND THAT IS SAFE HERE FOR
// ONE REASON: this reason is a CONSTANT this codebase writes, not model prose.
// dropCrossRunDuplicates in src/lib/scraper/listprep.ts writes it verbatim, so an equality test
// cannot miss a spelling the way a test against a Haiku reason would. Measured on the stored rows:
// three of the twenty platform-only drops are second copies of a business already in the list, and
// routing both to 'call' would have the person dialling ring the same clinic twice.
//
// Every dropped row that still has a website cell. The blank-website rows are already 'call'.
const rows = (await sql.unsafe(`
  select id, business_name, website, domain, qualify_reason
  from raw_leads
  where route = 'drop'
    and website is not null
    and website <> ''
    and qualify_reason <> 'already pulled under an earlier run (overlapping cell)'
  order by created_at
`)) as Array<Record<string, unknown>>;

// ‼️ THE AGGREGATOR TEST IS `domainKey() IS null ON A HOST WE DID GET`. domainKey returns null for a
// host in NON_IDENTIFYING_HOSTS, for a bare hostname and for an IP literal, and all three mean the
// same thing here: the cell gave us something and the something identifies nobody.
const aggregator = rows.filter((r) => {
  const site = String(r.website ?? "");
  return site.trim().length > 0 && domainKey(site) === null;
});

console.log("dropped rows with a website : " + rows.length);
console.log("  of those, platform-only   : " + aggregator.length);
for (const r of aggregator.slice(0, 15)) {
  console.log("    " + String(r.website) + "   " + String(r.business_name) + "   _" + String(r.qualify_reason) + "_");
}
if (aggregator.length > 15) console.log("    ... and " + (aggregator.length - 15) + " more");

if (!write) {
  console.log("\nNothing was written. Re-run with --write to route these " + aggregator.length + " to the call list.");
  await sql.end();
  process.exit(0);
}

if (!aggregator.length) {
  console.log("\nNothing to do.");
  await sql.end();
  process.exit(0);
}

// One statement, with the ids as a literal list. They are uuids straight out of the select above,
// never user input, and the `route = 'drop'` guard is re-checked at write time so a concurrent
// qualification sweep cannot be overwritten.
const ids = aggregator.map((r) => "'" + String(r.id) + "'").join(",");
const updated = (await sql.unsafe(`
  update raw_leads
  set route = 'call'
  where id in (${ids})
    and route = 'drop'
  returning id
`)) as Array<Record<string, unknown>>;

console.log("\nrouted to the call list: " + updated.length);
console.log("Check it with: bun run scripts/export-cold-call-leads.ts");

await sql.end();
