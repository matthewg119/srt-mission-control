// Reconcile trt_leads Zoho bookkeeping against Zoho itself.
// The push can succeed while the local write-back fails (see syncTrtRows), which
// makes syncUnsyncedTrt re-push rows and create duplicate Zoho leads. This
// script is the repair: pull every "TRT Clinic Scrape" lead from Zoho, match by
// normalized phone, and backfill zoho_lead_id / zoho_synced_at with checked,
// sequential updates.
//
// Run: bun run scripts/reconcile-trt-zoho.ts [--dry-run]

import { supabaseAdmin } from "@/lib/db";
import { zohoRequest } from "@/lib/zoho";
import { TRT_LEAD_SOURCE } from "@/lib/trt-zoho-sync";

const dryRun = process.argv.includes("--dry-run");

function norm(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

async function fetchZohoTrtLeads(): Promise<Array<{ id: string; phone: string | null }>> {
  // COQL needs a scope this token lacks; the search API works with plain
  // ZohoCRM.modules access. Search caps at 2000 records (10 x 200) which is
  // plenty for one vertical's scrape source.
  const out: Array<{ id: string; phone: string | null }> = [];
  const criteria = encodeURIComponent(`(Lead_Source:equals:${TRT_LEAD_SOURCE})`);
  for (let page = 1; page <= 10; page++) {
    const result = (await zohoRequest(
      "GET",
      `/Leads/search?criteria=${criteria}&fields=id,Phone&per_page=200&page=${page}`
    )) as { data?: Array<{ id: string; Phone?: string }>; info?: { more_records?: boolean } };
    const batch = result?.data ?? [];
    for (const r of batch) out.push({ id: r.id, phone: r.Phone ?? null });
    if (!result?.info?.more_records || batch.length === 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

async function main() {
  const zohoLeads = await fetchZohoTrtLeads();
  console.log(`Zoho leads with source "${TRT_LEAD_SOURCE}": ${zohoLeads.length}`);

  const byPhone = new Map<string, string>(); // phone10 -> zoho id (first wins)
  let zohoDupPhones = 0;
  for (const l of zohoLeads) {
    const p = norm(l.phone);
    if (!p) continue;
    if (byPhone.has(p)) zohoDupPhones++;
    else byPhone.set(p, l.id);
  }
  if (zohoDupPhones) console.log(`NOTE: ${zohoDupPhones} duplicate phone(s) already in Zoho.`);

  const { data: rows, error } = await supabaseAdmin
    .from("trt_leads")
    .select("id, phone_normalized, zoho_lead_id")
    .is("zoho_lead_id", null)
    .not("phone_normalized", "is", null);
  if (error) throw new Error(error.message);

  console.log(`trt_leads rows missing zoho_lead_id (with phone): ${rows?.length ?? 0}`);

  let matched = 0;
  let updated = 0;
  let failed = 0;
  let unmatched = 0;
  const nowIso = new Date().toISOString();

  for (const row of rows ?? []) {
    const zid = byPhone.get(row.phone_normalized as string);
    if (!zid) {
      unmatched++;
      continue;
    }
    matched++;
    if (dryRun) continue;
    const { error: upErr } = await supabaseAdmin
      .from("trt_leads")
      .update({ zoho_lead_id: zid, zoho_synced_at: nowIso, zoho_sync_error: null })
      .eq("id", row.id);
    if (upErr) {
      failed++;
      console.error(`update failed for ${row.id}: ${upErr.message}`);
    } else {
      updated++;
    }
  }

  console.log(`matched: ${matched}${dryRun ? " (dry run, no writes)" : ""}, updated: ${updated}, update failures: ${failed}, unmatched (truly not in Zoho): ${unmatched}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("reconcile failed:", e);
  process.exit(1);
});
