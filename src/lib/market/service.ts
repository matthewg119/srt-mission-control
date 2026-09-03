// One key for one market, whatever the report happened to type.
//
// ‼️ audit_reports.vertical_slug IS FREE TEXT, typed per report, so the same market arrives spelled
// several ways and an exact match splits it in half. Measured on the live dataset before this
// existed: "St Johns, FL" + "med-spa" returned 5 competitor lines and "St Johns, FL" + "medspa"
// returned none, for the same city and the same businesses. Ocala held 26 med spas under "medspa"
// and answered "med-spa" with nothing.
//
// ‼️ AND THE FAILURE IS INVISIBLE, WHICH IS WHY THIS IS A FILE AND NOT AN INLINE .replace(). An
// empty competitor list is ALSO the correct answer for a city we never audited, and that is the
// common case: about 80 percent of leads are in one. So a punctuation bug and honest silence look
// identical from the outside, and nothing downstream can tell them apart.
//
// ‼️ SPELLING ONLY. THIS MUST NEVER GROW INTO A SYNONYM MAP. Squashing punctuation is a fact about
// the string. Deciding "medical-aesthetics" and "medspa" are one market is a claim about the
// business, and if it is wrong this starts naming a day spa's rivals to a med spa as measured fact.
// If those should merge, the right shape is an explicit curated table somebody signed off on, not a
// looser regex here.

/** Lowercased with every non-alphanumeric character removed. Mirrors market_mentions.service_key. */
export function serviceKey(service: string | null | undefined): string {
  if (!service) return "";
  return service.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
