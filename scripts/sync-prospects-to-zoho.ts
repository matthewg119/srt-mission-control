// Backfill: push every prospect_leads row not yet in Zoho (zoho_synced_at IS NULL)
// into Zoho CRM as silent Leads (Lead_Source = "Pest Control Scrape").
//
//   bun run sync:zoho
//
// Requires ZOHO_* + Supabase keys in .env.local. Safe to re-run — already-synced
// rows are skipped. PREREQUISITE: "Pest Control Scrape" must exist in the Zoho
// Lead_Source picklist, or every insert fails with INVALID_DATA.

import { syncUnsyncedProspects } from "@/lib/prospect-zoho-sync";

async function main() {
  console.log("⬆️  Syncing un-synced prospect_leads to Zoho...");
  let totalOk = 0;
  let totalFailed = 0;
  // Loop in pages of 2000 until nothing is left to sync.
  for (let pass = 1; pass <= 100; pass++) {
    const res = await syncUnsyncedProspects(2000);
    if (res.disabled) {
      console.log("⏸️  PROSPECT_ZOHO_SYNC=false — sync disabled. Nothing done.");
      return;
    }
    totalOk += res.ok;
    totalFailed += res.failed;
    console.log(`   pass ${pass}: ${res.ok} ok, ${res.failed} failed (running: ${totalOk} ok / ${totalFailed} failed)`);
    if (res.errors.length) console.log("   sample errors:", res.errors.join(" | "));
    if (res.ok + res.failed === 0) break; // nothing left
    if (res.ok === 0 && res.failed > 0) {
      console.log("   all remaining rows are failing — stopping (likely the Lead_Source picklist value is missing in Zoho).");
      break;
    }
  }
  console.log(`✅ Done. ${totalOk} added to Zoho, ${totalFailed} failed.`);
}

main().catch((err) => {
  console.error("❌ sync:zoho failed:", err);
  process.exit(1);
});
