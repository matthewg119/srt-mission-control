// One-off: set Lead_Source on the med-spa leads already in Zoho (today's batch and
// any earlier ones), by their stored zoho_lead_id. Future runs already default to
// the same value via src/lib/medspa-zoho-sync.ts, so this only fixes existing rows.
//
//   bun run scripts/set-medspa-lead-source.ts
//   MEDSPA_ZOHO_LEAD_SOURCE="Med Spa Scrape" bun run scripts/set-medspa-lead-source.ts
//
// NOTE: the value must exist as a Zoho *Lead Source* picklist option, or Zoho
// rejects it (INVALID_DATA) — the script prints any such failures.

import { supabaseAdmin } from "@/lib/db";
import { zohoRequest } from "@/lib/zoho";
import { MEDSPA_LEAD_SOURCE } from "@/lib/medspa-zoho-sync";

interface PutResp {
  data?: Array<{ code?: string; status?: string; message?: string; details?: { id?: string } }>;
}

async function main() {
  const source = MEDSPA_LEAD_SOURCE;
  console.log(`🏷️  Setting Zoho Lead_Source = "${source}" on synced med-spa leads…`);

  const { data, error } = await supabaseAdmin
    .from("med_spa_leads")
    .select("zoho_lead_id")
    .not("zoho_lead_id", "is", null);
  if (error) throw new Error(error.message);

  const ids = Array.from(new Set((data ?? []).map((r) => r.zoho_lead_id as string).filter(Boolean)));
  console.log(`   ${ids.length} leads to update.`);
  if (!ids.length) return;

  let ok = 0;
  let failed = 0;
  const errs: string[] = [];

  // Zoho bulk update: PUT /Leads with up to 100 records, each carrying its id.
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const body = { data: batch.map((id) => ({ id, Lead_Source: source })) };
    try {
      const res = (await zohoRequest("PUT", "/Leads", body)) as PutResp;
      const rows = res.data ?? [];
      for (const r of rows) {
        if (r?.status === "success") ok++;
        else {
          failed++;
          if (errs.length < 6) errs.push(`${r?.details?.id ?? "?"}: ${r?.code ?? ""} ${r?.message ?? ""}`.trim());
        }
      }
    } catch (e) {
      failed += batch.length;
      if (errs.length < 6) errs.push(e instanceof Error ? e.message : String(e));
    }
    process.stdout.write(`\r   ${Math.min(i + 100, ids.length)}/${ids.length}   `);
    if (i + 100 < ids.length) await new Promise((r) => setTimeout(r, 200));
  }
  process.stdout.write("\n");

  console.log(`✅ updated ${ok}, ❌ failed ${failed}`);
  if (errs.length) {
    console.log("   sample errors:");
    errs.forEach((e) => console.log("   - " + e));
    console.log(`\n   If these say INVALID_DATA, add "${source}" as a Lead Source picklist option in`);
    console.log("   Zoho (Setup → Modules → Leads → Lead Source), then re-run this script.");
  }
}

main().catch((err) => {
  console.error("❌ set-medspa-lead-source failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
