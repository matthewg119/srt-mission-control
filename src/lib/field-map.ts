// Shared field map: Supabase contacts column → Zoho CRM field
// Used by lead-thread (Slack snapshots) and zoho-backfill.
//
// Mirrors the FIELD_MAP in srt-portal/src/app/api/leads/update/route.ts
// — keep them in sync. The portal version is the source of truth for
// portal-specific keys; this version focuses on the canonical
// Supabase column names.

export interface FieldEntry {
  /** Supabase contacts column name */
  supabase: string;
  /** Zoho field name (omit if Supabase-only) */
  zoho?: string;
  /** Human-readable label for Slack messages and logs */
  label: string;
}

// ── WHAT ZOHO ACTUALLY HAS ───────────────────────────────────────────
// Verified 2026-08-16 against /settings/fields?module=Leads (62 fields, one
// "Standard" layout) AND against full single-record GETs on live leads (77 keys
// returned, including every $-prefixed system key).
//
// Fourteen entries in this map named Zoho fields THAT DO NOT EXIST:
//   Date_of_Birth, SSN, SSN_Last_4, Home_Address, Legal_Name, DBA, EIN,
//   Ownership_Percentage, Incorporation_Date, Funding_Amount_Requested,
//   Monthly_Deposits, Credit_Score_Range, Use_of_Funds, Existing_Loans
//
// Two of them were near-misses for a field that IS there:
//   Funding_Amount_Requested -> Funding_Amount
//   Use_of_Funds             -> Use_of_funds   (lower-case f)
//
// The rest have no Zoho counterpart at all and are now marked Supabase-only.
// This is not a downgrade: on READ those names silently returned nothing (Zoho
// ignores an unknown name in `fields` rather than erroring), and on WRITE they
// were sent as unknown keys in every updateLead payload. Supabase has been the
// only real home for this data the whole time. Do not re-add a `zoho:` key here
// without confirming the api_name against /settings/fields first.
export const CONTACT_FIELD_MAP: FieldEntry[] = [
  // Identity
  { supabase: "first_name",       zoho: "First_Name",            label: "First Name" },
  { supabase: "last_name",        zoho: "Last_Name",             label: "Last Name" },
  { supabase: "email",            zoho: "Email",                 label: "Email" },
  { supabase: "phone",            zoho: "Phone",                 label: "Phone" },
  { supabase: "mobile_phone",     zoho: "Mobile",                label: "Mobile" },
  { supabase: "dob",                                             label: "DOB" },
  { supabase: "ssn_full",                                        label: "SSN" },
  { supabase: "ssn4",                                            label: "SSN-4" },
  { supabase: "home_address",                                    label: "Home Address" },

  // Business
  { supabase: "business_name",    zoho: "Company",               label: "Business" },
  { supabase: "legal_name",                                      label: "Legal Name" },
  { supabase: "dba",                                             label: "DBA" },
  { supabase: "industry",         zoho: "Industry",              label: "Industry" },
  { supabase: "ein",                                             label: "EIN" },
  { supabase: "ownership",                                       label: "Ownership %" },
  { supabase: "inc_date",                                        label: "Inc Date" },
  { supabase: "start_month",                                     label: "Start Month" },
  { supabase: "start_year",                                      label: "Start Year" },

  // Address
  { supabase: "biz_address",      zoho: "Street",                label: "Business Address" },
  { supabase: "biz_city",         zoho: "City",                  label: "City" },
  { supabase: "biz_state",        zoho: "State",                 label: "State" },
  { supabase: "biz_zip",          zoho: "Zip_Code",              label: "Zip" },

  // Financial
  { supabase: "amount_needed",    zoho: "Funding_Amount",        label: "Funding Requested" },
  { supabase: "monthly_revenue",  zoho: "Monthly_Revenue",       label: "Monthly Revenue" },
  { supabase: "monthly_deposits",                                label: "Monthly Deposits" },
  { supabase: "credit_score",                                    label: "Credit" },
  { supabase: "use_of_funds",     zoho: "Use_of_funds",          label: "Use of Funds" },
  { supabase: "existing_loans",                                  label: "Existing Loans" },
  { supabase: "has_business_checking",                           label: "Business Checking" },

  // Source / attribution
  { supabase: "source",           zoho: "Lead_Source",           label: "Source" },
  { supabase: "utm_campaign",                                    label: "Campaign" },
  { supabase: "utm_content",                                     label: "UTM Content" },
  { supabase: "utm_medium",                                      label: "UTM Medium" },
  { supabase: "ad_id",                                           label: "Ad ID" },

  // Funnel state
  { supabase: "application_stage",        zoho: "Lead_Status",   label: "Stage" },
  { supabase: "application_completion_pct",                      label: "Completion %" },
  { supabase: "portal_statements_uploaded",                      label: "Statements Uploaded" },
  { supabase: "portal_app_completed",                            label: "App Completed" },
  { supabase: "plaid_verified",                                  label: "Plaid Verified" },
  { supabase: "zoho_lead_id",                                    label: "Zoho Lead ID" },
  { supabase: "zoho_deal_id",                                    label: "Zoho Deal ID" },
  { supabase: "last_portal_login_at",                            label: "Last Login" },
  { supabase: "portal_login_count",                              label: "Login Count" },
];

/** Pick only the tracked fields from a contact row. */
export function pickTrackedFields(
  contact: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of CONTACT_FIELD_MAP) {
    out[f.supabase] = contact[f.supabase] ?? null;
  }
  return out;
}

/** Format a value for display in Slack messages. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// ── Reverse direction: Zoho Lead → Supabase contact ──────────────────
//
// CONTACT_FIELD_MAP has always been bidirectional data, but only the
// push direction (buildZohoPayloadFromContact) had a function. The Zoho
// retirement needs the pull, so here it is.
//
// Coercion matters here in a way it doesn't on the push: Zoho returns
// currency fields as numbers OR as formatted strings depending on how the
// record was created, and PostgREST will reject "$5,000" for a numeric
// column by failing the WHOLE row insert, not just the field.

/** Supabase columns that are numeric and must never receive a string. */
const NUMERIC_COLUMNS = new Set([
  "amount_needed",
  "monthly_revenue",
  "monthly_deposits",
  "ownership",
]);

/** Supabase columns that are date/timestamp and must never receive "". */
const DATE_COLUMNS = new Set(["dob", "inc_date"]);

/** Zoho sometimes returns a lookup as { id, name }. Take something useful. */
function flattenZohoValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return o.name ?? o.id ?? null;
  }
  return v;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // "$12,500.00" / "12,500" / "45%"
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Map a Zoho Lead record onto Supabase `contacts` columns.
 *
 * Only returns keys whose Zoho side had a real value — an absent field is
 * omitted rather than set to null, so a partial Zoho record can never blank
 * out data the portal or an inbound funnel already captured.
 */
export function buildContactFromZohoLead(
  lead: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const f of CONTACT_FIELD_MAP) {
    if (!f.zoho) continue;
    // zoho_lead_id / zoho_deal_id have no `zoho` entry and are set by the caller.
    const raw = flattenZohoValue(lead[f.zoho]);
    if (raw === null || raw === undefined || raw === "") continue;

    if (NUMERIC_COLUMNS.has(f.supabase)) {
      const n = toNumberOrNull(raw);
      if (n !== null) out[f.supabase] = n;
    } else if (DATE_COLUMNS.has(f.supabase)) {
      const d = toDateOrNull(raw);
      if (d !== null) out[f.supabase] = d;
    } else {
      out[f.supabase] = typeof raw === "string" ? raw.trim() : raw;
    }
  }

  return out;
}

/**
 * Columns a client is allowed to PATCH on a contact.
 *
 * Derived from CONTACT_FIELD_MAP rather than hand-listed, because the
 * hand-listed version in /api/contacts/[id] drifted out of sync with the
 * real column names and silently no-opped on half the fields.
 * Funnel-state columns are excluded — those are owned by the portal and by
 * src/lib/crm.ts, not by a form.
 */
export const CONTACT_EDITABLE_COLUMNS: readonly string[] = CONTACT_FIELD_MAP
  .map((f) => f.supabase)
  .filter(
    (c) =>
      ![
        "application_stage", // owned by crm.setLeadStatus (status history + Zoho push)
        "application_completion_pct",
        "portal_statements_uploaded",
        "portal_app_completed",
        "plaid_verified",
        "zoho_lead_id",
        "zoho_deal_id",
        "last_portal_login_at",
        "portal_login_count",
      ].includes(c)
  );

/** Build a Zoho update payload from a contact row, using fields that map to Zoho. */
export function buildZohoPayloadFromContact(
  contact: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of CONTACT_FIELD_MAP) {
    if (!f.zoho) continue;
    const val = contact[f.supabase];
    if (val === null || val === undefined || val === "") continue;
    payload[f.zoho] = val;
  }
  return payload;
}
