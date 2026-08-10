// Reading a Zoho record id out of a URL.
//
// This is the cheapest and by far the most accurate half of "scan the screen". Chrome already
// knows the URL of the CRM tab, so when that resolves there is no vision call, no model, no
// misread, and no cost. The screenshot is the fallback and the confirmation, not the primary.
//
// Ordering it this way is what makes wrong-lead risk manageable: a model reading pixels can pick
// the wrong business off Zoho's "recently viewed" sidebar, and a wrong lead poisons the whole call
// AND writes a note to the wrong record afterwards. A URL cannot be misread.

export type ZohoModule = "Leads" | "Deals" | "Contacts" | "Accounts";

export interface ZohoRecordRef {
  module: ZohoModule;
  recordId: string;
}

const MODULES = ["Leads", "Deals", "Contacts", "Accounts"] as const;

/**
 * Two patterns, tight first.
 *
 * The loose one is the same match the dialer has used since v43
 * (`/(Leads|Deals|Contacts)/(\d+)/` against location.href), kept because Zoho's URL shape varies
 * by org, by sandbox and by whether the record was opened from a list view or a search.
 *
 * The id is required to be 6+ digits. Zoho record ids are 18 to 19 digits, so a short number is a
 * page index or a tab ordinal, and matching one would send us to look up a record that is not there.
 */
export function parseZohoRecordUrl(input: string | null | undefined): ZohoRecordRef | null {
  if (!input) return null;
  const url = String(input);

  const tight = url.match(
    /crm\.zoho(?:cloud)?\.(?:com|ca|eu|in|com\.au|jp)\/crm\/(?:org\d+\/)?tab\/(Leads|Deals|Contacts|Accounts)\/(\d{6,})/i
  );
  if (tight) return normalize(tight[1], tight[2]);

  const loose = url.match(/\/(Leads|Deals|Contacts|Accounts)\/(\d{6,})(?:[/?#]|$)/i);
  if (loose) return normalize(loose[1], loose[2]);

  return null;
}

function normalize(rawModule: string, recordId: string): ZohoRecordRef | null {
  const found = MODULES.find((m) => m.toLowerCase() === rawModule.toLowerCase());
  if (!found) return null;
  return { module: found, recordId };
}

/** The link back, for the WHO line and the wrap card. */
export function zohoRecordUrl(ref: ZohoRecordRef): string {
  return `https://crm.zoho.com/crm/tab/${ref.module}/${ref.recordId}`;
}
