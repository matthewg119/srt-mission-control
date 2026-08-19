// Reading a record id out of a URL.
//
// This is the cheapest and by far the most accurate half of "scan the screen". Chrome already
// knows the URL of the CRM tab, so when that resolves there is no vision call, no model, no
// misread, and no cost. The screenshot is the fallback and the confirmation, not the primary.
//
// Ordering it this way is what makes wrong-lead risk manageable: a model reading pixels can pick
// the wrong business off a "recently viewed" sidebar, and a wrong lead poisons the whole call
// AND writes a note to the wrong record afterwards. A URL cannot be misread.
//
// ‼️ The Zoho patterns are kept ON PURPOSE even though Zoho is gone. Parsing is pure string
// matching — it costs nothing and calls no API — and a parsed Zoho id resolves through the
// contacts.zoho_lead_id column, which is staying. That is what lets the shipped Chrome extension
// and the Auto-Dialer keep identifying leads without a coordinated release, and it keeps every
// old Zoho link anyone has pasted into Slack working.

/** What a URL turned out to point at. */
export type RecordRef =
  | { kind: "contact"; contactId: string }
  | { kind: "zohoLead"; zohoLeadId: string };

/**
 * Two families of pattern, tight first.
 *
 * Zoho: the loose one is the same match the dialer has used since v43
 * (`/(Leads|Deals|Contacts)/(\d+)/` against location.href), kept because Zoho's URL shape varied
 * by org, by sandbox and by whether the record was opened from a list view or a search.
 *
 * The Zoho id is required to be 6+ digits. Zoho record ids are 18 to 19 digits, so a short number
 * is a page index or a tab ordinal, and matching one would send us to look up a record that is
 * not there.
 *
 * Only Leads are recognised. Deals was the funding module and is decommissioned; Contacts and
 * Accounts were accepted by the old parser but then fetched through getLead(), which would have
 * 404'd — that was a latent bug, not a feature worth porting.
 */
export function parseRecordUrl(input: string | null | undefined): RecordRef | null {
  if (!input) return null;
  const url = String(input);

  // Mission Control's own contact page.
  const mc = url.match(
    /\/contacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i
  );
  if (mc) return { kind: "contact", contactId: mc[1].toLowerCase() };

  const tight = url.match(
    /crm\.zoho(?:cloud)?\.(?:com|ca|eu|in|com\.au|jp)\/crm\/(?:org\d+\/)?tab\/Leads\/(\d{6,})/i
  );
  if (tight) return { kind: "zohoLead", zohoLeadId: tight[1] };

  const loose = url.match(/\/Leads\/(\d{6,})(?:[/?#]|$)/i);
  if (loose) return { kind: "zohoLead", zohoLeadId: loose[1] };

  return null;
}

/** The link back, for the WHO line and the wrap card. */
export function crmRecordUrl(contactId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  return `${base}/contacts/${contactId}`;
}
