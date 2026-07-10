// Standalone best-effort owner-name backfill for med_spa_leads. Fetches each spa's
// website (homepage + a few About/Team paths) and pulls a plausible owner name.
// Use this for the deployed webhook path (which skips scraping to stay under the
// serverless timeout) or to re-scan rows that never got a name.
//
//   bun run medspa:owners                # up to 500 rows missing an owner
//   bun run medspa:owners -- --limit 200
//
// After filling owner_name, it re-pushes those rows to Zoho so the CRM lead gets
// the person's name (skips rows already synced? no — updates in place via re-sync).

import { supabaseAdmin } from "@/lib/db";
import { enrichOwners } from "@/lib/medspa-owner-scrape";
import { syncMedSpaRows, MedSpaZohoRow } from "@/lib/medspa-zoho-sync";

const argv = process.argv.slice(2);
const li = argv.indexOf("--limit");
const LIMIT = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : 500;
const RESYNC = argv.includes("--resync-zoho");

async function main() {
  console.log(`🔎 owner backfill — up to ${LIMIT} rows missing owner_name…`);
  const { data, error } = await supabaseAdmin
    .from("med_spa_leads")
    .select("id, business_name, owner_name, phone, website, full_address, city, state, postal_code, categories, rating, review_count, instagram_handle, days_open, lead_score")
    .is("owner_name", null)
    .not("website", "is", null)
    .limit(LIMIT);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as (MedSpaZohoRow & { website?: string | null })[];
  console.log(`   ${rows.length} candidates with a website.`);
  if (!rows.length) return;

  const found = await enrichOwners(rows, {
    onProgress: (d, t) => process.stdout.write(`\r   scraping… ${d}/${t}   `),
  });
  process.stdout.write("\n");
  console.log(`   owner names found: ${found}`);

  const filled = rows.filter((r) => r.owner_name && r.id);
  await Promise.all(
    filled.map((r) => supabaseAdmin.from("med_spa_leads").update({ owner_name: r.owner_name }).eq("id", r.id as string))
  );
  console.log(`   updated ${filled.length} rows in Supabase.`);

  if (RESYNC && filled.length) {
    const zoho = await syncMedSpaRows(filled);
    console.log(`   Zoho re-sync: ${zoho.ok} ok, ${zoho.failed} failed.`);
  }
}

main().catch((err) => {
  console.error("❌ medspa:owners failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
