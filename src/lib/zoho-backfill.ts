// Zoho CRM backfill — checks every contact and ensures it has a Zoho lead with
// the latest field data from Supabase. Used for the initial sweep + on-demand
// re-sync from the admin panel.
//
// Idempotent: safe to re-run any number of times.

import { supabaseAdmin } from "@/lib/db";
import { createLead, updateLead, searchLeads, ZohoLeadData } from "@/lib/zoho";
import { buildZohoPayloadFromContact } from "@/lib/field-map";

interface BackfillResult {
  checked: number;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  errored: number;
  errors: Array<{ contactId: string; email: string | null; reason: string }>;
}

interface BackfillOptions {
  /** If true, log what would happen but don't write to Zoho. */
  dryRun?: boolean;
  /** Limit how many contacts to process. */
  limit?: number;
  /** Optional: only contacts updated since this ISO timestamp. */
  since?: string;
  /** Progress callback (for CLI runs). */
  onProgress?: (n: number, total: number, current: { id: string; email: string }) => void;
}

const SLEEP_MS = 150; // ~6 req/sec, well under Zoho's 10/sec cap

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a ZohoLeadData payload from a Supabase contact row.
 * Used for createLead() calls — for updateLead() we use the simpler
 * buildZohoPayloadFromContact() helper that returns a flat field-map.
 */
function buildLeadDataFromContact(c: Record<string, unknown>): ZohoLeadData {
  return {
    firstName: (c.first_name as string) || undefined,
    lastName: (c.last_name as string) || (c.business_name as string) || undefined,
    businessName: (c.business_name as string) || undefined,
    legalName: (c.legal_name as string) || undefined,
    dba: (c.dba as string) || undefined,
    email: (c.email as string) || undefined,
    phone: (c.phone as string) || (c.mobile_phone as string) || undefined,
    source: (c.source as string) || "Backfill",
    Lead_Status: (c.application_stage as string) || "New Lead",
    industry: (c.industry as string) || undefined,
    ein: (c.ein as string) || undefined,
    bizAddress: (c.biz_address as string) || undefined,
    bizCity: (c.biz_city as string) || undefined,
    bizState: (c.biz_state as string) || undefined,
    bizZip: (c.biz_zip as string) || undefined,
    timeInBusiness:
      (c.inc_date as string) ||
      (c.start_month && c.start_year ? `${c.start_month} ${c.start_year}` : undefined),
    creditScoreRange: (c.credit_score as string) || undefined,
    fundingAmount: (c.amount_needed as string | number) || undefined,
    monthlyRevenue: (c.monthly_revenue as string | number) || undefined,
    monthlyDeposits: (c.monthly_deposits as string | number) || undefined,
    useOfFunds: (c.use_of_funds as string) || undefined,
    existingLoans: (c.existing_loans as string) || undefined,
    ownership: c.ownership ? String(c.ownership) : undefined,
    dob: (c.dob as string) || undefined,
    ssn4: (c.ssn4 as string) || undefined,
    homeAddress: (c.home_address as string) || undefined,
    incDate: (c.inc_date as string) || undefined,
  };
}

export async function runZohoBackfill(
  opts: BackfillOptions = {}
): Promise<BackfillResult> {
  const result: BackfillResult = {
    checked: 0,
    created: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
    errored: 0,
    errors: [],
  };

  let query = supabaseAdmin
    .from("contacts")
    .select("*")
    .not("email", "is", null)
    .order("created_at", { ascending: false });

  if (opts.since) query = query.gte("updated_at", opts.since);
  if (opts.limit && opts.limit > 0) query = query.limit(opts.limit);

  const { data: contacts, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch contacts: ${error.message}`);
  }
  if (!contacts || contacts.length === 0) {
    return result;
  }

  const total = contacts.length;
  console.log(`[zoho-backfill] processing ${total} contacts (dryRun=${!!opts.dryRun})`);

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i] as Record<string, unknown>;
    const contactId = contact.id as string;
    const email = ((contact.email as string) || "").trim().toLowerCase();
    result.checked++;

    if (opts.onProgress) {
      opts.onProgress(i + 1, total, { id: contactId, email });
    }

    if (!email) {
      result.skipped++;
      continue;
    }

    try {
      let zohoLeadId = (contact.zoho_lead_id as string) || null;

      // Step 1: If no linked Zoho lead, search for one by email
      if (!zohoLeadId) {
        const found = await searchLeads({ email });
        if (found && found.length > 0) {
          zohoLeadId = (found[0].id as string) || null;
          if (zohoLeadId && !opts.dryRun) {
            await supabaseAdmin
              .from("contacts")
              .update({ zoho_lead_id: zohoLeadId })
              .eq("id", contactId);
            result.linked++;
            console.log(`[zoho-backfill] linked existing Zoho lead: ${email} → ${zohoLeadId}`);
          } else if (zohoLeadId) {
            result.linked++;
          }
        }
      }

      // Step 2: If still no Zoho lead, create one
      if (!zohoLeadId) {
        if (opts.dryRun) {
          console.log(`[zoho-backfill] [DRY] would CREATE: ${email}`);
          result.created++;
        } else {
          const newId = await createLead(buildLeadDataFromContact(contact));
          if (newId) {
            zohoLeadId = newId;
            await supabaseAdmin
              .from("contacts")
              .update({ zoho_lead_id: newId })
              .eq("id", contactId);
            result.created++;
            console.log(`[zoho-backfill] created Zoho lead: ${email} → ${newId}`);
          }
        }
      } else {
        // Step 3: Update existing Zoho lead with current Supabase data
        const payload = buildZohoPayloadFromContact(contact);
        if (Object.keys(payload).length > 0) {
          if (opts.dryRun) {
            console.log(
              `[zoho-backfill] [DRY] would UPDATE ${zohoLeadId} (${email}) with ${Object.keys(payload).length} fields`
            );
            result.updated++;
          } else {
            await updateLead(zohoLeadId, payload);
            result.updated++;
            console.log(
              `[zoho-backfill] updated Zoho lead ${zohoLeadId} (${email}): ${Object.keys(payload).length} fields`
            );
          }
        } else {
          result.skipped++;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.errored++;
      result.errors.push({ contactId, email, reason });
      console.error(`[zoho-backfill] error for ${email}:`, reason);
    }

    // Throttle to respect Zoho rate limits
    if (!opts.dryRun) await sleep(SLEEP_MS);
  }

  console.log(
    `[zoho-backfill] done: checked=${result.checked} created=${result.created} updated=${result.updated} linked=${result.linked} skipped=${result.skipped} errored=${result.errored}`
  );

  return result;
}
