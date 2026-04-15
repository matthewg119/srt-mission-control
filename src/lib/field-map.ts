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

export const CONTACT_FIELD_MAP: FieldEntry[] = [
  // Identity
  { supabase: "first_name",       zoho: "First_Name",            label: "First Name" },
  { supabase: "last_name",        zoho: "Last_Name",             label: "Last Name" },
  { supabase: "email",            zoho: "Email",                 label: "Email" },
  { supabase: "phone",            zoho: "Phone",                 label: "Phone" },
  { supabase: "mobile_phone",     zoho: "Mobile",                label: "Mobile" },
  { supabase: "dob",              zoho: "Date_of_Birth",         label: "DOB" },
  { supabase: "ssn_full",         zoho: "SSN",                   label: "SSN" },
  { supabase: "ssn4",             zoho: "SSN_Last_4",            label: "SSN-4" },
  { supabase: "home_address",     zoho: "Home_Address",          label: "Home Address" },

  // Business
  { supabase: "business_name",    zoho: "Company",               label: "Business" },
  { supabase: "legal_name",       zoho: "Legal_Name",            label: "Legal Name" },
  { supabase: "dba",              zoho: "DBA",                   label: "DBA" },
  { supabase: "industry",         zoho: "Industry",              label: "Industry" },
  { supabase: "ein",              zoho: "EIN",                   label: "EIN" },
  { supabase: "ownership",        zoho: "Ownership_Percentage",  label: "Ownership %" },
  { supabase: "inc_date",         zoho: "Incorporation_Date",    label: "Inc Date" },
  { supabase: "start_month",                                     label: "Start Month" },
  { supabase: "start_year",                                      label: "Start Year" },

  // Address
  { supabase: "biz_address",      zoho: "Street",                label: "Business Address" },
  { supabase: "biz_city",         zoho: "City",                  label: "City" },
  { supabase: "biz_state",        zoho: "State",                 label: "State" },
  { supabase: "biz_zip",          zoho: "Zip_Code",              label: "Zip" },

  // Financial
  { supabase: "amount_needed",    zoho: "Funding_Amount_Requested", label: "Funding Requested" },
  { supabase: "monthly_revenue",  zoho: "Monthly_Revenue",       label: "Monthly Revenue" },
  { supabase: "monthly_deposits", zoho: "Monthly_Deposits",      label: "Monthly Deposits" },
  { supabase: "credit_score",     zoho: "Credit_Score_Range",    label: "Credit" },
  { supabase: "use_of_funds",     zoho: "Use_of_Funds",          label: "Use of Funds" },
  { supabase: "existing_loans",   zoho: "Existing_Loans",        label: "Existing Loans" },
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
