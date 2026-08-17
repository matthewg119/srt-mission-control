// One-shot archive of the imported Zoho funding history, taken BEFORE the
// business-funding decommission wipes lead_activities.
//
// SRT pivoted off business funding onto AEO. The contacts stay (they are still
// good AEO prospects) but every note on them is about money — "needs $200K",
// "wants a new truck", "construction always has 4-3 loans". That context must
// not reach the CRM or Vektor, but it is genuine leverage when selling AEO
// later: it is what these owners told us, in their own words, about what their
// business was trying to do.
//
// So it lands as a flat CSV on the Desktop and nowhere else. Nothing in the app
// reads this file.
//
//   bun run notes:archive -- --dry-run     # count rows, write nothing
//   bun run notes:archive                  # write the CSV
//   bun run notes:archive -- --out "C:\path\to\file.csv"
//
// Run the DELETE in docs/2026-08-17-funding-decommission.sql only after the
// row count printed here matches:
//   select count(*) from lead_activities where source = 'zoho';

import { supabaseAdmin } from "@/lib/db";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const oi = argv.indexOf("--out");
const OUT =
  oi >= 0 && argv[oi + 1]
    ? argv[oi + 1]
    : `${process.env.USERPROFILE || process.env.HOME}/Desktop/SRT-Funding-Notes-Archive.csv`;

// PostgREST caps a single response, so both tables are paged. 1000 matches the
// page size fetchCandidatesUncached() uses in src/lib/worklist.ts.
const PAGE = 1000;

interface ActivityRow {
  id: string;
  contact_id: string | null;
  activity_type: string | null;
  direction: string | null;
  channel: string | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  occurred_at: string | null;
  actor: string | null;
  external_module: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  email: string | null;
  application_stage: string | null;
  // Optional, not because they are nullable but because `contacts` has drifted
  // and these may not exist as columns at all. Read with `?.` everywhere.
  biz_city?: string | null;
  biz_state?: string | null;
  industry?: string | null;
}

/** RFC 4180: quote everything, double any embedded quote. Note bodies are
 *  free text full of commas and newlines, so half-measures corrupt the file. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
}

const ACTIVITY_COLS =
  "id, contact_id, activity_type, direction, channel, subject, body, outcome, occurred_at, actor, external_module";

// `contacts` was built in the Supabase console and has documented drift, and
// PostgREST fails the WHOLE query on one unknown column. A named column list
// here is a guess that takes the export down; `*` cannot be wrong. Every field
// is read optionally below, so a missing one is an empty CSV cell, not a crash.
const CONTACT_COLS = "*";

// PostgREST puts `.in()` in the query STRING, so a batch of 1,000 uuids is a
// ~37KB URL and the server answers 400 Bad Request. 100 keeps it well inside
// any proxy's limit; the extra round trips cost nothing on a one-off script.
const ID_BATCH = 100;

async function main() {
  console.log(`📦 Archiving imported Zoho activity${DRY_RUN ? " (DRY RUN)" : ""}…`);

  const activities: ActivityRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("lead_activities")
      .select(ACTIVITY_COLS)
      .eq("source", "zoho")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`lead_activities: ${error.message}`);
    const rows = (data ?? []) as unknown as ActivityRow[];
    activities.push(...rows);
    process.stdout.write(`\r  lead_activities: ${activities.length} rows…`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write("\n");

  if (!activities.length) {
    console.log("Nothing to archive — no lead_activities rows with source='zoho'.");
    return;
  }

  // Only the contacts these activities belong to, fetched in id batches so the
  // query stays proportional to the archive rather than to the whole book.
  const wanted = [...new Set(activities.map((a) => a.contact_id).filter(Boolean) as string[])];
  const byId = new Map<string, ContactRow>();
  for (let i = 0; i < wanted.length; i += ID_BATCH) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select(CONTACT_COLS)
      .in("id", wanted.slice(i, i + ID_BATCH));
    if (error) throw new Error(`contacts: ${error.message}`);
    for (const c of (data ?? []) as unknown as ContactRow[]) byId.set(c.id, c);
    process.stdout.write(`\r  contacts: ${byId.size} / ${wanted.length} rows…`);
  }
  process.stdout.write("\n");

  const byType = activities.reduce<Record<string, number>>((acc, a) => {
    const k = a.activity_type ?? "(null)";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n  ${activities.length} activities across ${byId.size} contacts`);
  for (const [k, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${n}`);
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would have written ${OUT}`);
    return;
  }

  const header = [
    "occurred_at", "activity_type", "direction", "channel", "zoho_module",
    "subject", "body", "outcome", "actor",
    "contact_name", "business_name", "phone", "mobile_phone", "email",
    "industry", "city", "state", "stage_at_export", "contact_id",
  ];

  // Newest first: the last thing an owner said matters more than the first.
  const sorted = [...activities].sort((a, b) =>
    String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? ""))
  );

  const lines = [header.map(csvCell).join(",")];
  for (const a of sorted) {
    const c = a.contact_id ? byId.get(a.contact_id) : undefined;
    const name = [c?.first_name, c?.last_name].filter(Boolean).join(" ");
    lines.push([
      a.occurred_at, a.activity_type, a.direction, a.channel, a.external_module,
      a.subject, a.body, a.outcome, a.actor,
      name, c?.business_name, c?.phone, c?.mobile_phone, c?.email,
      c?.industry, c?.biz_city, c?.biz_state, c?.application_stage, a.contact_id,
    ].map(csvCell).join(","));
  }

  // BOM so Excel opens it as UTF-8 instead of mangling accented business names.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, "\ufeff" + lines.join("\r\n") + "\r\n", "utf8");

  console.log(`\n✅ Wrote ${activities.length} rows to ${OUT}`);
  console.log("   Verify before deleting anything:");
  console.log("   select count(*) from lead_activities where source = 'zoho';");
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
