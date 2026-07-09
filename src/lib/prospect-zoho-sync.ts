// Push scraped pest-control prospects (prospect_leads) into Zoho CRM as Leads,
// SILENTLY — no Speed-to-Lead / #hot-leads alerts (see bulkCreateLeadsSilent,
// which passes trigger: []). Each row is pushed at most once, tracked by
// zoho_synced_at / zoho_lead_id on prospect_leads.
//
// Used by Route B (per daily batch) and scripts/sync-prospects-to-zoho.ts (backfill).

import { supabaseAdmin } from "@/lib/db";
import { bulkCreateLeadsSilent } from "@/lib/zoho";

export const PROSPECT_LEAD_SOURCE = process.env.PROSPECT_ZOHO_LEAD_SOURCE || "Pest Control Scrape";

/** A prospect_leads row (the subset we need to build a Zoho Lead). */
export interface ProspectRow {
  id: string;
  business_name: string;
  phone?: string | null;
  website?: string | null;
  full_address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  categories?: string | null;
  rating?: number | null;
  review_count?: number | null;
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

/** Map a prospect_leads row into a Zoho Leads record (raw field API names). */
export function mapProspectToZohoLead(row: ProspectRow): Record<string, unknown> {
  const name = (row.business_name || "Unknown").trim();
  const descParts: string[] = [];
  if (row.categories) descParts.push(row.categories);
  if (row.rating != null) descParts.push(`Rating: ${row.rating}${row.review_count != null ? ` (${row.review_count} reviews)` : ""}`);
  if (row.full_address) descParts.push(row.full_address);

  const record: Record<string, unknown> = {
    // Zoho Leads requires Last_Name + Company; these are businesses, so use the name for both.
    Last_Name: truncate(name, 80),
    Company: truncate(name, 200),
    Lead_Source: PROSPECT_LEAD_SOURCE,
    Lead_Status: "Not Contacted",
  };
  if (row.phone) record.Phone = row.phone;
  if (row.website) record.Website = row.website;
  if (row.full_address) record.Street = row.full_address;
  if (row.city) record.City = row.city;
  if (row.state) record.State = row.state;
  if (row.postal_code) record.Zip_Code = row.postal_code;
  if (descParts.length) record.Description = descParts.join(" | ");
  return record;
}

/**
 * Push a set of prospect rows to Zoho and write the result back onto each
 * prospect_leads row. Returns aggregate counts for the Slack report.
 */
export async function syncProspectRows(rows: ProspectRow[]): Promise<SyncResult> {
  if (process.env.PROSPECT_ZOHO_SYNC === "false") {
    return { ok: 0, failed: 0, disabled: true, errors: [] };
  }
  if (!rows.length) return { ok: 0, failed: 0, errors: [] };

  const results = await bulkCreateLeadsSilent(rows.map(mapProspectToZohoLead));

  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  const nowIso = new Date().toISOString();

  // results are in the same order as rows.
  await Promise.all(
    rows.map(async (row, i) => {
      const r = results[i];
      if (r && r.status === "success" && r.id) {
        ok++;
        await supabaseAdmin
          .from("prospect_leads")
          .update({ zoho_lead_id: r.id, zoho_synced_at: nowIso, zoho_sync_error: null })
          .eq("id", row.id);
      } else {
        failed++;
        const msg = r?.message || r?.code || "unknown Zoho error";
        if (errors.length < 5) errors.push(`${row.business_name}: ${msg}`);
        await supabaseAdmin
          .from("prospect_leads")
          .update({ zoho_sync_error: msg })
          .eq("id", row.id);
      }
    })
  );

  return { ok, failed, errors };
}

/** Backfill / safety-net: push every prospect_leads row not yet in Zoho. */
export async function syncUnsyncedProspects(limit = 2000): Promise<SyncResult> {
  if (process.env.PROSPECT_ZOHO_SYNC === "false") {
    return { ok: 0, failed: 0, disabled: true, errors: [] };
  }
  const { data, error } = await supabaseAdmin
    .from("prospect_leads")
    .select("id, business_name, phone, website, full_address, city, state, postal_code, categories, rating, review_count")
    .is("zoho_synced_at", null)
    .not("business_name", "is", null)
    .limit(limit);

  if (error) return { ok: 0, failed: 0, errors: [error.message] };
  return syncProspectRows((data ?? []) as ProspectRow[]);
}
