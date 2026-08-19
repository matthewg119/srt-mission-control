// The lead detail page's left-hand panels, in one place because two components
// now need them: the server page renders the values, the client island edits them.
//
// The `kind` on each field is not decoration. Four columns on `contacts` are
// numeric (amount_needed, monthly_revenue, monthly_deposits, ownership) and two
// are dates (dob, inc_date), and PostgREST rejects "$5,000" or "" on those by
// failing the WHOLE row rather than the one field — see the NUMERIC_COLUMNS /
// DATE_COLUMNS note in src/lib/field-map.ts. A text input wired straight to a
// PATCH would therefore lose the other five edits in the same save, silently.
//
// `url` is the same idea pointed at a different consumer. website is not merely
// displayed: runAuditPipeline() hands it to researchWebsite() verbatim, so
// "acme dot com" typed here becomes a fetch that fails minutes into a run that
// already spent a classification call. It is normalized and rejected at the input.
//
// `readonly` is the other half of that: created_at is displayed here but is not
// in CONTACT_EDITABLE_COLUMNS, so sending it earns a 400. The list below is the
// only place that knows which is which.

export type LeadFieldKind =
  | "text"
  | "number"
  | "date"
  | "phone"
  | "email"
  | "url"
  | "readonly";

export interface LeadFieldDef {
  /** contacts column name */
  key: string;
  label: string;
  kind: LeadFieldKind;
}

export interface LeadFieldGroup {
  title: string;
  fields: LeadFieldDef[];
}

export const LEAD_FIELD_GROUPS: LeadFieldGroup[] = [
  {
    title: "Contact",
    fields: [
      { key: "first_name", label: "First name", kind: "text" },
      { key: "last_name", label: "Last name", kind: "text" },
      { key: "email", label: "Email", kind: "email" },
      { key: "phone", label: "Phone", kind: "phone" },
      { key: "mobile_phone", label: "Mobile", kind: "phone" },
      { key: "home_address", label: "Home address", kind: "text" },
    ],
  },
  {
    title: "Business",
    fields: [
      { key: "business_name", label: "Business", kind: "text" },
      { key: "website", label: "Website", kind: "url" },
      { key: "legal_name", label: "Legal name", kind: "text" },
      { key: "dba", label: "DBA", kind: "text" },
      { key: "industry", label: "Industry", kind: "text" },
      { key: "ein", label: "EIN", kind: "text" },
      { key: "inc_date", label: "Incorporated", kind: "date" },
      { key: "biz_address", label: "Address", kind: "text" },
      { key: "biz_city", label: "City", kind: "text" },
      { key: "biz_state", label: "State", kind: "text" },
      { key: "biz_zip", label: "Zip", kind: "text" },
    ],
  },
  {
    title: "Financials",
    fields: [
      { key: "amount_needed", label: "Requested", kind: "number" },
      { key: "monthly_revenue", label: "Monthly revenue", kind: "number" },
      { key: "monthly_deposits", label: "Monthly deposits", kind: "number" },
      { key: "credit_score", label: "Credit", kind: "text" },
      { key: "use_of_funds", label: "Use of funds", kind: "text" },
      { key: "existing_loans", label: "Existing loans", kind: "text" },
    ],
  },
  {
    title: "Source",
    fields: [
      { key: "source", label: "Lead source", kind: "text" },
      { key: "utm_campaign", label: "Campaign", kind: "text" },
      { key: "utm_medium", label: "Medium", kind: "text" },
      { key: "created_at", label: "Created", kind: "readonly" },
    ],
  },
];

/** Every column the panels can send in a PATCH. */
export const LEAD_PANEL_COLUMNS: readonly string[] = LEAD_FIELD_GROUPS.flatMap((g) =>
  g.fields.filter((f) => f.kind !== "readonly").map((f) => f.key)
);

/**
 * The subset of a contacts row the panels actually render.
 *
 * The page selects `*`, which includes ssn_full. Handing that whole object to a
 * client component would serialize it into the HTML payload, so the page passes
 * this instead. Values are stringified here because the client only ever needs
 * them as form input values.
 */
export function pickLeadPanelValues(
  lead: Record<string, unknown>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const g of LEAD_FIELD_GROUPS) {
    for (const f of g.fields) {
      const v = lead[f.key];
      out[f.key] =
        v === null || v === undefined || v === "" ? null : String(v);
    }
  }
  return out;
}
