/**
 * Every business this lane routed to a CALL rather than an email, as a call list.
 *
 *   bun run scripts/export-cold-call-leads.ts                       every med spa run, dry
 *   bun run scripts/export-cold-call-leads.ts --run=<uuid>          one run
 *   bun run scripts/export-cold-call-leads.ts --out="C:\path.csv"   write it somewhere else
 *
 * ‼️ bun run, NOT bunx tsx. Bun auto-loads .env.local and reads DATABASE_URL; Node does not, and the
 * query then fails with a bare connection error that says nothing about the missing variable.
 *
 * WHY THESE ROWS ARE THE INTERESTING ONES, NOT THE LEFTOVERS. `dropWebsiteless` cuts them before the
 * model is asked, because the only enrichment rung this lane has is crawling a website, so a business
 * without one can never yield an email. That makes them worthless to the EMAIL pipeline and arguably
 * the best prospects in the pull for an AEO pitch: a clinic with no website at all is the one with the
 * most to gain and the least to defend. They are dropped for being unreachable by the channel, never
 * for being a bad fit.
 *
 * ‼️ IT SELECTS ON `route = 'call'` AND NO LONGER ON `website is null`, WHICH WIDENS IT ON PURPOSE.
 * The old filter was this rule spelled a second time in SQL, so it only ever found the one case SQL
 * could see. Four kinds of business are now routed here and three of them have a website:
 *
 *   no website at all                    128 of the 550 stored rows
 *   Instagram, Facebook or Vagaro only   measured at 15 rows across those three hosts on the Dallas 500
 *   a domain with no MX record           26 of 75 measured, so the address can never be delivered
 *   Tier C: nail bar, barber, tattoo     kept and never emailed, by the operator's own rule
 *
 * Every one of them is a real trading business with a front desk, and for a three-person clinic a
 * phone call often beats a cold email anyway.
 *
 * ‼️ A ROW WITH NO PHONE IS KEPT AND MARKED, NOT SILENTLY DISCARDED. Same rule as `locationVerdict`'s
 * `unknown`: an empty cell is a fact about the EXPORT, not about the business, and a call list that
 * quietly drops a fifth of its rows is worse than one that says which rows need a number looked up.
 */

import { SQL } from "bun";
import { writeFileSync } from "node:fs";

/**
 * Bun's SQL is a callable template tag, which its shipped types do not express, so `tsc --noEmit`
 * (which CI runs) reports "no call signatures". Same minimal shape and same cast
 * `scripts/_probe-list-prep.ts` already declares, rather than a second spelling of it.
 */
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

const runArg = process.argv.find((a) => a.startsWith("--run="))?.slice("--run=".length) ?? null;
const outArg = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
const out = outArg ?? "C:\\Users\\matth\\Desktop\\cold-call-no-website.csv";

/** RFC 4180: quote everything, double the quotes inside. Never hand-roll this per column. */
function csv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((r) => r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
}

// ‼️ THE RUN FILTER IS VALIDATED AS A UUID BEFORE IT IS INTERPOLATED. It comes from argv, and the
// query below is assembled as text; anything that is not exactly a uuid is refused rather than
// escaped, which is the only version of this that cannot be got wrong later.
if (runArg !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runArg)) {
  console.error("--run= must be a uuid, and `" + runArg + "` is not one. Nothing was read.");
  process.exit(1);
}

const sql = new SQL(url) as unknown as TagSQL;

const rows = (await sql.unsafe(`
  -- ‼️ ONE ROW PER BUSINESS, NOT ONE PER PULL, AND THE COST OF GETTING THIS WRONG IS SOMEBODY'S
  -- TIME. Overlapping cells deliver the same clinic under several runs by design, and raw_leads is
  -- unique on (run_id, place_id) only WITHIN a run. dropCrossRunDuplicates catches most of the
  -- second copies, but only the ones it reaches before the model does; measured on the stored rows,
  -- Bethespa is routed to a call twice under two different reasons. An email pipeline shrugs that
  -- off because sendable_leads is unique on the address. A person dialling rings the clinic twice.
  --
  -- ‼️ KEYED ON place_id WITH A NAME FALLBACK, NEVER ON NAME ALONE. place_id is per LOCATION, so a
  -- genuine two-site local group keeps both of its rows, which is correct: they are two front desks.
  -- Falling back to the lower-cased name only covers the rows that have no place_id at all.
  select distinct on (coalesce(l.place_id, lower(l.business_name)))
    l.business_name,
    l.phone,
    l.full_address,
    l.city,
    l.state,
    l.postal_code,
    l.categories,
    l.rating,
    l.review_count,
    l.source_metro,
    l.created_at,
    -- Already in the CRM? Matched on the last ten digits, which is how contacts stores the key.
    --
    -- ‼️ BOTH SIDES MUST BE A FULL TEN DIGITS, OR EVERY PHONELESS ROW MATCHES EVERY PHONELESS CONTACT.
    -- A row with no phone yields right('',10) = '', an "is not null" guard lets that through, and the
    -- empty string then equals every contact whose own phone_last10 is empty. The 22 rows with no
    -- number were all reported "already in CRM" on the first run of this script, which is exactly the
    -- false-positive that would stop somebody ever looking their numbers up.
    (select count(*) from contacts c
      where length(c.phone_last10) = 10
        and length(right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 10)) = 10
        and c.phone_last10 = right(regexp_replace(coalesce(l.phone,''), '[^0-9]', '', 'g'), 10)
    ) as already_in_crm,
    -- Why this one is a call rather than an email, verbatim from the pipeline. On the CSV so the
    -- person dialling knows whether they are ringing a clinic with no website or a nail bar.
    l.qualify_reason,
    l.tier,
    l.is_claimed
  from raw_leads l
  where l.route = 'call'
    and l.vertical_slug = 'medspa'
    ${runArg ? "and l.run_id = '" + runArg + "'" : ""}
  -- distinct on requires its key to lead the sort. The ordering a person reads by is applied after,
  -- in the outer query, rather than being quietly dropped.
  order by coalesce(l.place_id, lower(l.business_name)), l.created_at
`)) as Array<Record<string, unknown>>;

// The reading order, applied after the per-business dedupe above. Callable first, then the biggest
// names, which is the order somebody actually works a list in.
rows.sort((a, b) => {
  const aPhone = a.phone ? 0 : 1;
  const bPhone = b.phone ? 0 : 1;
  if (aPhone !== bPhone) return aPhone - bPhone;
  const aRev = Number(a.review_count ?? -1);
  const bRev = Number(b.review_count ?? -1);
  if (aRev !== bRev) return bRev - aRev;
  return String(a.business_name ?? "").localeCompare(String(b.business_name ?? ""));
});

const header = [
  "business_name", "phone", "full_address", "city", "state", "postal_code",
  "categories", "rating", "review_count", "pulled_from", "callable", "already_in_crm",
  "why_called", "tier", "google_listing",
];

const body = rows.map((r) => [
  String(r.business_name ?? ""),
  String(r.phone ?? ""),
  String(r.full_address ?? ""),
  String(r.city ?? ""),
  String(r.state ?? ""),
  String(r.postal_code ?? ""),
  String(r.categories ?? ""),
  r.rating === null || r.rating === undefined ? "" : String(r.rating),
  r.review_count === null || r.review_count === undefined ? "" : String(r.review_count),
  String(r.source_metro ?? ""),
  r.phone ? "yes" : "NO PHONE - look it up",
  Number(r.already_in_crm ?? 0) > 0 ? "already in CRM" : "new",
  String(r.qualify_reason ?? ""),
  String(r.tier ?? ""),
  // ‼️ null IS PRINTED AS "not recorded", NEVER AS "claimed". 429 of the Dallas 500 are claimed and
  // 71 are not; a blank that reads as claimed would hide the strongest opener on the list.
  r.is_claimed === false ? "UNCLAIMED" : r.is_claimed === true ? "claimed" : "not recorded",
]);

writeFileSync(out, csv([header, ...body]), "utf8");

const withPhone = body.filter((b) => b[10] === "yes").length;
const dupes = body.filter((b) => b[11] === "already in CRM").length;

console.log("routed to a call    : " + rows.length);
console.log("  callable now      : " + withPhone);
console.log("  no phone on file  : " + (rows.length - withPhone));
console.log("  already in the CRM: " + dupes);
console.log("\nwrote " + out);

await sql.end();
