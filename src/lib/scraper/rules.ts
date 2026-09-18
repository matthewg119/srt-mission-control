// The cheap half of the cold-list filter: everything decidable from the string itself.
//
// Ported from Matthew's apollo_prefilter.py. The ORDER in filter.ts is the script's order and is
// load-bearing for cost, not for correctness: every check here is free and the MX lookup is not, so
// a role account or a disposable domain must be rejected before anything resolves DNS for it.
//
// ‼️ THIS FILE MAKES NO NETWORK CALLS AND MUST NOT START. It is the half the probe can exercise
// offline, which is what makes "is the port faithful to the Python" a question that can be answered
// without a resolver, a Slack token or a database.

import { DISPOSABLE_DOMAINS } from "@/data/disposable-domains";
import type { Workflow } from "./store";

/** Every reason a row can be dropped. Written to `scraper_rows.reason` and to junk.csv. */
export type JunkReason =
  | "no_email"
  | "duplicate_in_file"
  // Caught by the drop's dedupe (dedup.ts) against `scraper_seen`, before the picker. The row is
  // carried into the workflow rather than sliced out of the file so its row_index stays honest.
  | "duplicate_prior_batch"
  | "already_in_crm"
  | "bad_syntax"
  | "role_account"
  | "disposable_domain"
  | "no_mx";

/**
 * Role accounts, ported VERBATIM from the Python's ROLE_PATTERN.
 *
 * Anchored at the start and terminated by `@`, so it matches the whole local part and never a
 * substring: `sales@` is a role account, `salesian@` and `jsales@` are people.
 */
export const ROLE_PATTERN =
  /^(info|admin|sales|contact|support|hello|team|marketing|noreply|no-reply|billing|hr|jobs|careers|help|office|webmaster|postmaster|abuse|feedback|enquiries|inquiries)@/i;

/** The header names an Apollo export has actually used, best first. Matched case-insensitively. */
const EMAIL_HEADER_CANDIDATES = ["email", "primary email", "email address", "work email"];

/**
 * The company, city and website columns.
 *
 * Company is REQUIRED for scoring the way email is required for filtering: there is nothing to
 * search for without it. City stays OPTIONAL everywhere, and its absence is a *not measured*
 * signal in `score.ts` rather than a zero.
 *
 * ‼️ WEBSITE IS OPTIONAL FOR 2️⃣ AND REQUIRED FOR 3️⃣, so the same resolver now carries two
 * different stakes. On the scoring arm a miss costs a measurement; on the list-prep arm it costs
 * the entire run, because the only enrichment rung is a crawler and there is nothing to crawl.
 *
 * `website` deliberately does NOT accept a bare `url`, and the third arm makes that stricter
 * rather than looser. An Apollo export uses that header for the LinkedIn profile URL. Scoring
 * "does their own domain rank #1" against a linkedin.com address measures nothing while looking
 * like it measured something; CRAWLING a linkedin.com address for a clinic's email finds nothing,
 * burns a fetch against a host that rate-limits hard, and reports the lead as enriched-and-empty.
 * Do not add `url` here to raise coverage.
 */
const COMPANY_HEADER_CANDIDATES = ["company", "company name", "business", "business name", "name", "organization", "account name"];
const CITY_HEADER_CANDIDATES = ["city", "company city", "business city", "location", "town"];
const WEBSITE_HEADER_CANDIDATES = ["website", "company website", "website url", "domain", "company domain", "web site"];
/**
 * The state column, for the United States filter in `geo.ts`.
 *
 * A miss is NOT an error and must never become one. Plenty of exports carry the state inside the
 * city cell ("Charlotte, NC") and nothing else, which `locationVerdict` reads perfectly well; a
 * required state column would refuse those files outright.
 */
const STATE_HEADER_CANDIDATES = ["state", "company state", "business state", "region", "province", "state/province", "state or province"];
/**
 * The phone column, for the drop's dedupe key.
 *
 * A miss is never an error: plenty of exports carry no phone at all, and a row with no phone simply
 * dedupes on its domain or its address instead. The business line comes before the personal one,
 * because two contacts at one clinic share the clinic's number and that is exactly the collision
 * worth catching.
 */
const PHONE_HEADER_CANDIDATES = [
  "phone", "phone number", "company phone", "business phone", "primary phone",
  "work direct phone", "corporate phone", "telephone", "tel", "mobile phone", "mobile",
];

/**
 * Which column holds a given field.
 *
 * The Python hardcoded `"email"` and told you to edit the constant. Apollo exports it as `Email`,
 * so the script's own default was wrong for its own stated input and every first run died on
 * "Column 'email' not in CSV". Case-insensitive with fallbacks, and a miss returns null so the
 * caller can NAME THE HEADERS IT FOUND rather than throwing a message nobody can act on.
 */
function resolveColumn(headers: string[], candidates: string[]): string | null {
  const byLower = new Map<string, string>();
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    if (!byLower.has(key)) byLower.set(key, h);
  }
  for (const candidate of candidates) {
    const hit = byLower.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function resolveEmailColumn(headers: string[]): string | null {
  return resolveColumn(headers, EMAIL_HEADER_CANDIDATES);
}

export function resolveCompanyColumn(headers: string[]): string | null {
  return resolveColumn(headers, COMPANY_HEADER_CANDIDATES);
}

export function resolveCityColumn(headers: string[]): string | null {
  return resolveColumn(headers, CITY_HEADER_CANDIDATES);
}

export function resolveWebsiteColumn(headers: string[]): string | null {
  return resolveColumn(headers, WEBSITE_HEADER_CANDIDATES);
}

export function resolveStateColumn(headers: string[]): string | null {
  return resolveColumn(headers, STATE_HEADER_CANDIDATES);
}

export function resolvePhoneColumn(headers: string[]): string | null {
  return resolveColumn(headers, PHONE_HEADER_CANDIDATES);
}

/** What a required column is called in the thread. Not the header, the concept. */
export type RequiredLabel = "email" | "company" | "website";

/**
 * The columns each workflow cannot run without.
 *
 * Workflow 1 needs an address to filter and verify; workflow 2 needs a name to search for;
 * workflow 3 needs BOTH a name and a website. City is NOT here on purpose: its absence is a "not
 * measured" signal in score.ts rather than a zero, so it changes what a number means and never
 * whether the run can happen.
 *
 * ‼️ WEBSITE IS GENUINELY REQUIRED FOR 3️⃣, NOT MERELY USEFUL. The only enrichment rung is a site
 * crawler, and `enrichOne` degrades to "not enriched" rather than throwing. So a website-less file
 * would not error: it would run a full paid Claude qualification sweep over thousands of rows and
 * then produce zero sendable leads. That is a slow, expensive way of saying "no website column",
 * and it is exactly the shape of failure the column check exists to make cheap.
 *
 * ‼️ AND THE NAME IS REQUIRED TOO. `raw_leads.business_name` is NOT NULL, and qualify.ts's
 * `describe()` leads with the name, so a nameless row cannot be stored and could not be judged if
 * it were.
 */
const REQUIRED_COLUMNS: Record<
  Workflow,
  ReadonlyArray<{ label: RequiredLabel; resolve: (headers: string[]) => string | null }>
> = {
  filter: [{ label: "email", resolve: resolveEmailColumn }],
  score: [{ label: "company", resolve: resolveCompanyColumn }],
  listprep: [
    { label: "company", resolve: resolveCompanyColumn },
    { label: "website", resolve: resolveWebsiteColumn },
  ],
};

/**
 * Every workflow that could run on these headers, in picker order.
 *
 * ‼️ ONE FUNCTION, READ BY BOTH `columnVerdict` AND `formatWorkflowPicker`. The card telling
 * somebody which arms are available and the verdict deciding whether their pick bounces must be
 * the same computation or the lane lies to them. Same discipline as `GATE_COLUMNS` and
 * `WRITE_KEY_TYPES` in store.ts: the drift is prevented by there being nowhere for it to happen.
 */
export function runnableWorkflows(headers: string[]): Workflow[] {
  const all: Workflow[] = ["filter", "score", "listprep"];
  return all.filter((w) => REQUIRED_COLUMNS[w].every((c) => c.resolve(headers)));
}

/** The columns a workflow wants but these headers do not have. */
export function missingColumns(workflow: Workflow, headers: string[]): RequiredLabel[] {
  return REQUIRED_COLUMNS[workflow].filter((c) => !c.resolve(headers)).map((c) => c.label);
}

/** The resolved header for each required column, once a workflow is known to be runnable. */
export function resolvedColumns(workflow: Workflow, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of REQUIRED_COLUMNS[workflow]) {
    const h = c.resolve(headers);
    if (h) out[c.label] = h;
  }
  return out;
}

export type ColumnVerdict =
  /** The chosen workflow can run. `columns` is keyed by label: email / company / website. */
  | { kind: "ok"; columns: Record<string, string> }
  /** It cannot, but at least one other can, so this was a wrong pick rather than a bad file. */
  | {
      kind: "rewind";
      missing: RequiredLabel[];
      runnable: Array<{ workflow: Workflow; columns: Record<string, string> }>;
    }
  /** No workflow has its columns. Nothing in this lane can work the file. */
  | { kind: "terminal"; missing: RequiredLabel[] };

/**
 * Can this workflow run on these headers, and if not, which ones can?
 *
 * ‼️ THE TERMINATION BOUND CHANGED WHEN THE THIRD ARM LANDED, AND IT IS NOW WEAKER. Say so rather
 * than reusing the old wording.
 *
 * With two arms the proof was free: "this arm cannot run and some arm can" forces the runnable set
 * to be a singleton, the card names it, and the next pick is `ok`. One hop, no counter.
 *
 * With three arms that inference fails. A file carrying only a company column leaves 2️⃣ runnable
 * while BOTH 1️⃣ and 3️⃣ bounce, so somebody can bounce twice. The bound is now
 * **at most |workflows| - |runnable| distinct bounces**, which is two.
 *
 * It is still counter-free, and that is the part worth keeping:
 *  - `runnable` is a pure function of the headers, and the headers never change for the life of a
 *    batch, so the set cannot shrink under anybody's feet.
 *  - Every bounce inserts nothing and spends nothing. A rewind is only legal before the first row
 *    insert (see `rewindPick`), so a bounced batch is in exactly the state it started in.
 *  - `runnable` is the COMPLETE set, not one representative, and the picker card enumerates all
 *    three arms with the missing column named on each. So a second bounce is always a pick the
 *    operator was explicitly told would bounce. The lane cannot loop on its own and it cannot
 *    mislead; it can only be disbelieved.
 *
 * A file carrying no workflow's columns is genuinely terminal and must stay terminal: offering a
 * picker there is offering a choice between three refusals. Note terminality is arm-independent,
 * so `terminal` for one workflow implies `terminal` for all.
 *
 * Pure, so `_probe-scraper.ts` can enumerate all 8 header subsets x 3 arms offline. That
 * exhaustive table is what pays for the weaker bound: the old proof was stronger and checked by
 * six examples, this one is weaker and checked completely.
 */
export function columnVerdict(workflow: Workflow, headers: string[]): ColumnVerdict {
  const missing = missingColumns(workflow, headers);
  if (missing.length === 0) return { kind: "ok", columns: resolvedColumns(workflow, headers) };

  const runnable = runnableWorkflows(headers).map((w) => ({
    workflow: w,
    columns: resolvedColumns(w, headers),
  }));
  if (runnable.length === 0) return { kind: "terminal", missing };
  return { kind: "rewind", missing, runnable };
}

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Syntax, replacing the `email-validator` dependency.
 *
 * Returns the lowercased domain on success and null on failure, so a caller gets the one thing it
 * needs next (the domain, for the disposable and MX checks) without parsing the address twice.
 *
 * ‼️ NO IDNA. A non-ASCII domain is rejected as bad_syntax rather than punycoded, which is a real
 * behaviour difference from the Python and is stated here rather than discovered. It is the right
 * call for a US B2B Apollo pull and the wrong one for a list that is not: if that day comes, the
 * fix is a punycode pass here, NOT loosening the label check.
 */
export function emailDomain(email: string): string | null {
  if (email.length > 254) return null;

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();

  if (local.length > 64) return null;
  // Quoted local parts ("john doe"@x.com) are legal and are never a real Apollo row. Rejecting
  // them keeps the check simple and cannot cost a lead.
  if (!LOCAL_PART.test(local)) return null;

  if (domain.length > 253) return null;
  const labels = domain.split(".");
  // A bare hostname is not a deliverable business address.
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return null;
    if (!DOMAIN_LABEL.test(label)) return null;
  }
  // The TLD carries no digits and no hyphens. This is what rejects an IP-literal domain.
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return null;

  return domain;
}

export function isRoleAccount(email: string): boolean {
  return ROLE_PATTERN.test(email);
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

/** Human-readable order for the junk breakdown, so two runs print their reasons the same way. */
export const JUNK_REASON_ORDER: JunkReason[] = [
  "no_email",
  "duplicate_in_file",
  "duplicate_prior_batch",
  "already_in_crm",
  "bad_syntax",
  "role_account",
  "disposable_domain",
  "no_mx",
];
