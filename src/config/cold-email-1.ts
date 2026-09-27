// Email 1 for the cold list, written for a SHARED INBOX.
//
// WHY THIS IS ITS OWN FILE. src/config/pitch.ts is the audit pipeline's copy: a different stage, a
// different audience, and already a thousand lines. dialer-email-templates.ts is full HTML keyed by
// template_key and sent verbatim. Neither is a home for the first touch on a scraped list.
//
// OPTION A, DECIDED 2026-09-25: info@ IS AN ACCEPTABLE TARGET AND THE COPY DOES THE WORK. For a one
// to three person med spa the shared inbox IS the owner's inbox, so sends are not gated on finding a
// personal address. Measured on 60 live sites the same day: of 35 addresses found, 19 were role
// addresses, and of the 16 non-role ones almost all were business webmail rather than a person.
// Writing as though the reader is the owner would be wrong most of the time.
//
// SO first_name IS USUALLY BLANK, AND THAT IS THE HARD CONSTRAINT HERE. After the name-scraper fix
// the crawl finds a real person on 27% of sites, which means roughly three quarters of rows carry no
// first name at all. Every line below has to read correctly with it empty, which is why there is no
// greeting token: "Hi ," is worse than no greeting.

import { guard } from "@/lib/copy-guard";

/**
 * The merge variables a send list can actually fill.
 *
 * Kept in step with SENDABLE_HEADERS in src/lib/scraper/lane.ts. A template referencing anything
 * outside this list is a blank in the send, so the probe checks the template against it rather than
 * trusting the author to remember.
 */
export const COLD_MERGE_FIELDS = [
  "email", "first_name", "last_name", "company", "owner_name", "website", "domain",
  "city", "state", "phone",
] as const;

/**
 * Subject: the business name, and nothing that pretends to know the reader.
 *
 * It names the business because a shared inbox is triaged by whoever is on the desk, and a subject
 * about THEM gets forwarded where a subject about us gets deleted.
 */
export const COLD_SUBJECT = guard("cold subject", "{{company}} in ChatGPT results");

/**
 * Body.
 *
 * The first line is the pass-along, before anything else, because the reader is usually not the
 * decision maker and the cheapest useful action they can take is forwarding it. No links: the
 * signature policy in email-signature.ts already states that a permission-stage email 1 carries none,
 * and a first touch into a shared inbox is the worst place to spend domain reputation on a URL.
 *
 * ‼️ `[[ ... ]]` MARKS A CLAUSE THAT DISAPPEARS WHEN ITS TOKEN IS EMPTY, AND IT IS NOT DECORATION.
 * The first draft read "is not coming up for {{city}} right now", which with no city renders as
 * "is not coming up for right now": an orphaned preposition, in the FIRST email, on a list where the
 * field is often blank. Tidying spaces and commas afterwards cannot fix that, because the debris is
 * a word. The whole clause has to go, so the clause is marked.
 */
export const COLD_BODY = guard(
  "cold body",
  [
    "If you are not the person who handles marketing for {{company}}, would you pass this along to whoever does.",
    "",
    "I check which med spas get named when someone asks ChatGPT for recommendations in their area. {{company}} is not coming up[[ for {{city}}]] right now, and the businesses that are tend to be the ones whose own site answers the questions people actually type.",
    "",
    "Want me to send over what it says about {{company}} specifically. No charge, and I am not asking for a call.",
  ].join("\n")
);

/** The whole thing, so a sender does not have to know which pieces exist. */
export const COLD_EMAIL_1 = {
  subject: COLD_SUBJECT,
  body: COLD_BODY,
} as const;

/**
 * Fill the template. Missing values become empty strings.
 *
 * ‼️ IT TIDIES AFTER ITSELF, BECAUSE A BLANK MERGE FIELD LEAVES DEBRIS. "for  right now" and a line
 * ending in " ." are what an unfilled token looks like in a real inbox, and with first_name blank on
 * three quarters of rows that is the common case rather than the edge one. Collapsing runs of spaces
 * and repairing punctuation is what makes Option A safe to send.
 */
export function renderColdEmail(vars: Record<string, string | null | undefined>): {
  subject: string;
  body: string;
} {
  const value = (key: string): string => (vars[key] ?? "").toString().trim();

  const fill = (tpl: string): string =>
    tpl
      // Optional clauses first: a [[ ... ]] block survives only if every token inside it has a value.
      .replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
        const tokens = [...inner.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        return tokens.every((t) => value(t).length > 0) ? inner : "";
      })
      .replace(/\{\{(\w+)\}\}/g, (_, key: string) => value(key))
      // Debris from an empty token, in the order it appears.
      .replace(/ +([,.])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  return { subject: fill(COLD_EMAIL_1.subject), body: fill(COLD_EMAIL_1.body) };
}
