// Standalone best-effort owner/provider-name backfill for trt_leads. Fetches each
// clinic's website (homepage + a few About/Team paths) and pulls a plausible
// owner name. Use this for the deployed webhook path (which skips scraping to
// stay under the serverless timeout) or to re-scan rows that never got a name.
//
//   bun run trt:owners                 # up to 500 rows missing an owner
//   bun run trt:owners -- --limit 200
//   bun run trt:owners -- --resync-zoho
//
// The scraper heuristics are shared with the med-spa vertical (same cues:
// owner / founder / CEO / medical director).

import { supabaseAdmin } from "@/lib/db";
import { enrichOwners } from "@/lib/medspa-owner-scrape";
import { syncTrtRows, TrtZohoRow } from "@/lib/trt-zoho-sync";

const argv = process.argv.slice(2);
const li = argv.indexOf("--limit");
const LIMIT = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : 500;
const RESYNC = argv.includes("--resync-zoho");

async function main() {
  console.log(`🔎 TRT owner backfill — up to ${LIMIT} rows missing owner_name…`);
  const { data, error } = await supabaseAdmin
    .from("trt_leads")
    .select("id, business_name, owner_name, email, phone, website, full_address, city, state, postal_code, categories, rating, review_count, google_maps_url, multi_location_flag, lead_score")
    .is("owner_name", null)
    .not("website", "is", null)
    .limit(LIMIT);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as (TrtZohoRow & { website?: string | null })[];
  console.log(`   ${rows.length} candidates with a website.`);
  if (!rows.length) return;

  const found = await enrichOwners(rows, {
    onProgress: (d, t) => process.stdout.write(`\r   scraping… ${d}/${t}   `),
  });
  process.stdout.write("\n");
  console.log(`   owner names found: ${found}`);

  const filled = rows.filter((r) => r.owner_name && r.id);
  await Promise.all(
    filled.map((r) => supabaseAdmin.from("trt_leads").update({ owner_name: r.owner_name }).eq("id", r.id as string))
  );
  console.log(`   updated ${filled.length} rows in Supabase.`);

  if (RESYNC && filled.length) {
    const zoho = await syncTrtRows(filled);
    console.log(`   Zoho re-sync: ${zoho.ok} ok, ${zoho.failed} failed.`);
  }
}

main().catch((err) => {
  console.error("❌ trt:owners failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
