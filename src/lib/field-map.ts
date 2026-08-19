// Shared field map: the contacts columns worth tracking, and what to call them.
// Used by lead-thread (Slack snapshots) and the contact editor.
//
// Mirrors the FIELD_MAP in srt-portal/src/app/api/leads/update/route.ts
// — keep them in sync. The portal version is the source of truth for
// portal-specific keys; this version focuses on the canonical
// Supabase column names.

export interface FieldEntry {
  /** Supabase contacts column name */
  supabase: string;
  /** Human-readable label for Slack messages and logs */
  label: string;
}

export const CONTACT_FIELD_MAP: FieldEntry[] = [
  // Identity
  { supabase: "first_name", label: "First Name" },
  { supabase: "last_name", label: "Last Name" },
  { supabase: "email", label: "Email" },
  { supabase: "phone", label: "Phone" },
  { supabase: "mobile_phone", label: "Mobile" },
  { supabase: "dob", label: "DOB" },
  { supabase: "ssn_full", label: "SSN" },
  { supabase: "ssn4", label: "SSN-4" },
  { supabase: "home_address", label: "Home Address" },

  // Business
  { supabase: "business_name", label: "Business" },
  { supabase: "website", label: "Website" },
  { supabase: "legal_name", label: "Legal Name" },
  { supabase: "dba", label: "DBA" },
  { supabase: "industry", label: "Industry" },
  { supabase: "ein", label: "EIN" },
  { supabase: "ownership", label: "Ownership %" },
  { supabase: "inc_date", label: "Inc Date" },
  { supabase: "start_month", label: "Start Month" },
  { supabase: "start_year", label: "Start Year" },

  // Address
  { supabase: "biz_address", label: "Business Address" },
  { supabase: "biz_city", label: "City" },
  { supabase: "biz_state", label: "State" },
  { supabase: "biz_zip", label: "Zip" },

  // Financial
  { supabase: "amount_needed", label: "Funding Requested" },
  { supabase: "monthly_revenue", label: "Monthly Revenue" },
  { supabase: "monthly_deposits", label: "Monthly Deposits" },
  { supabase: "credit_score", label: "Credit" },
  { supabase: "use_of_funds", label: "Use of Funds" },
  { supabase: "existing_loans", label: "Existing Loans" },
  { supabase: "has_business_checking", label: "Business Checking" },

  // Source / attribution
  { supabase: "source", label: "Source" },
  { supabase: "utm_campaign", label: "Campaign" },
  { supabase: "utm_content", label: "UTM Content" },
  { supabase: "utm_medium", label: "UTM Medium" },
  { supabase: "ad_id", label: "Ad ID" },

  // Funnel state
  { supabase: "application_stage", label: "Stage" },
  { supabase: "application_completion_pct", label: "Completion %" },
  { supabase: "portal_statements_uploaded", label: "Statements Uploaded" },
  { supabase: "portal_app_completed", label: "App Completed" },
  { supabase: "plaid_verified", label: "Plaid Verified" },
  { supabase: "zoho_lead_id", label: "Zoho Lead ID" },
  { supabase: "zoho_deal_id", label: "Zoho Deal ID" },
  { supabase: "last_portal_login_at", label: "Last Login" },
  { supabase: "portal_login_count", label: "Login Count" },
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
        "application_stage", // owned by crm.setLeadStatus (writes status history)
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
