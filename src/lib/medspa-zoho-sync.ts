// Push scraped med-spa prospects (med_spa_leads) into Zoho CRM as Leads, SILENTLY
// (no Speed-to-Lead / #hot-leads alerts — bulkCreateLeadsSilent passes trigger: []).
// Each row is pushed at most once, tracked by zoho_synced_at / zoho_lead_id.
//
// Used by the med-spa webhook (per batch) and scripts/run-medspa.ts (poll runner).

import { supabaseAdmin } from "@/lib/db";
import { bulkCreateLeadsSilent } from "@/lib/zoho";

export const MEDSPA_LEAD_SOURCE = process.env.MEDSPA_ZOHO_LEAD_SOURCE || "Med Spa Scrape";

/** A med_spa_leads row (the subset we need to build a Zoho Lead). */
export interface MedSpaZohoRow {
  id?: string;
  business_name: string;
  owner_name?: string | null;
  phone?: string | null;
  website?: string | null;
  full_address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  categories?: string | null;
  rating?: number | null;
  review_count?: number | null;
  instagram_handle?: string | null;
  days_open?: number | null;
  lead_score?: number | null;
}

export interface SyncResult {
  ok: number;
  failed: number;
  disabled?: boolean;
  errors: string[];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Split a scraped owner name into first/last for Zoho's person fields. */
function splitName(owner: string): { first?: string; last: string } {
  const parts = owner.trim().split(/\s+/);
  if (parts.length === 1) return { last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Map a med_spa_leads row into a Zoho Leads record (raw field API names). */
export function mapMedSpaToZohoLead(row: MedSpaZohoRow): Record<string, unknown> {
  const business = (row.business_name || "Unknown").trim();

  const descParts: string[] = [];
  if (row.categories) descParts.push(row.categories);
  if (row.rating != null) descParts.push(`Rating: ${row.rating}${row.review_count != null ? ` (${row.review_count} reviews)` : ""}`);
  if (row.days_open != null) descParts.push(`Open ${row.days_open} days/wk`);
  if (row.instagram_handle) descParts.push(`IG: ${row.instagram_handle}`);
  if (row.lead_score != null) descParts.push(`Lead score: ${row.lead_score}/10`);
  if (row.full_address) descParts.push(row.full_address);

  const record: Record<string, unknown> = {
    Company: truncate(business, 200),
    Lead_Source: MEDSPA_LEAD_SOURCE,
    Lead_Status: "Not Contacted",
  };

  // Owner name (when the website scrape found a real person) -> First/Last;
  // otherwise fall back to the business name as Last_Name (Zoho requires it).
  if (row.owner_name && row.owner_name.trim()) {
    const { first, last } = splitName(row.owner_name);
    record.Last_Name = truncate(last, 80);
    if (first) record.First_Name = truncate(first, 40);
    record.Description = `Owner: ${row.owner_name}${descParts.length ? " | " + descParts.join(" | ") : ""}`;
  } else {
    record.Last_Name = truncate(business, 80);
    if (descParts.length) record.Description = descParts.join(" | ");
  }

  if (row.phone) record.Phone = row.phone;
  if (row.website) record.Website = row.website;
  if (row.full_address) record.Street = row.full_address;
  if (row.city) record.City = row.city;
  if (row.state) record.State = row.state;
  if (row.postal_code) record.Zip_Code = row.postal_code;
  return record;
}

/**
 * Push a set of med-spa rows to Zoho and write the result back onto each
 * med_spa_leads row. Returns aggregate counts for the Slack report. Rows must
 * carry `id` (skips those without, e.g. dry-run rows).
 */
export async function syncMedSpaRows(rows: MedSpaZohoRow[]): Promise<SyncResult> {
  if (process.env.MEDSPA_ZOHO_SYNC === "false") {
    return { ok: 0, failed: 0, disabled: true, errors: [] };
  }
  const withId = rows.filter((r) => r.id);
  if (!withId.length) return { ok: 0, failed: 0, errors: [] };

  const results = await bulkCreateLeadsSilent(withId.map(mapMedSpaToZohoLead));

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  await Promise.all(
    withId.map(async (row, i) => {
      const r = results[i];
      if (r && r.status === "success" && r.id) {
        ok++;
        await supabaseAdmin
          .from("med_spa_leads")
          .update({ zoho_lead_id: r.id, zoho_synced_at: nowIso, zoho_sync_error: null })
          .eq("id", row.id as string);
      } else {
        failed++;
        const msg = r?.message || r?.code || "unknown Zoho error";
        if (errors.length < 5) errors.push(`${row.business_name}: ${msg}`);
        await supabaseAdmin
          .from("med_spa_leads")
          .update({ zoho_sync_error: msg })
          .eq("id", row.id as string);
      }
    })
  );

  return { ok, failed, errors };
}

/** Backfill / safety-net: push every med_spa_leads row not yet in Zoho. */
export async function syncUnsyncedMedSpas(limit = 2000): Promise<SyncResult> {
  if (process.env.MEDSPA_ZOHO_SYNC === "false") {
    return { ok: 0, failed: 0, disabled: true, errors: [] };
  }
  const { data, error } = await supabaseAdmin
    .from("med_spa_leads")
    .select("id, business_name, owner_name, phone, website, full_address, city, state, postal_code, categories, rating, review_count, instagram_handle, days_open, lead_score")
    .is("zoho_synced_at", null)
    .not("business_name", "is", null)
    .limit(limit);

  if (error) return { ok: 0, failed: 0, errors: [error.message] };
  return syncMedSpaRows((data ?? []) as MedSpaZohoRow[]);
}
