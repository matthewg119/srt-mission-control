// The pipeline, in the Python's order: cheapest checks first, so the expensive DNS step only ever
// sees survivors.
//
//   1 no_email           blank cell
//   2 duplicate_in_file  the same address twice in one export
//   3 already_in_crm     already in outreach_prospects
//   4 bad_syntax
//   5 role_account
//   6 disposable_domain
//   7 no_mx              <- resolved separately, see below
//
// ‼️ THIS FUNCTION IS PURE AND STOPS AT STEP 6. It takes the CRM's addresses as a Set rather than
// querying, and it does not resolve anything. MX is a separate pass because it is the only step
// that can outlive a serverless invocation, so its verdicts arrive later and are applied by
// `applyMxVerdicts`. Keeping the string half pure is what lets `_probe-scraper.ts` prove the port
// is faithful with no network, no Slack and no database.
//
// `duplicate_in_file` is the one check the Python does not have. Apollo repeats addresses across
// pages of one export and MillionVerifier bills per row, so paying twice for the same address is a
// live cost rather than a tidiness point. The FIRST occurrence survives.

import { emailDomain, isDisposableDomain, isRoleAccount, type JunkReason } from "./rules";

export interface FilteredRow {
  /** 0-based index into the parsed CSV, so a row can be found again in the original file. */
  rowIndex: number;
  raw: Record<string, string>;
  email: string | null;
  domain: string | null;
  /** null = survived the string checks and is waiting on MX. */
  reason: JunkReason | null;
}

export interface FilterResult {
  rows: FilteredRow[];
  /** Domains that still need an MX answer, deduped. */
  pendingDomains: string[];
}

export interface FilterInput {
  rows: Array<Record<string, string>>;
  emailColumn: string;
  /** Lowercased addresses already in outreach_prospects. */
  knownEmails: ReadonlySet<string>;
}

export function filterRows(input: FilterInput): FilterResult {
  const { rows, emailColumn, knownEmails } = input;
  const seen = new Set<string>();
  const out: FilteredRow[] = [];
  const pending = new Set<string>();

  rows.forEach((raw, rowIndex) => {
    const email = (raw[emailColumn] ?? "").trim().toLowerCase();

    const push = (reason: JunkReason | null, domain: string | null = null) => {
      out.push({ rowIndex, raw, email: email || null, domain, reason });
    };

    if (!email) return push("no_email");
    if (seen.has(email)) return push("duplicate_in_file");
    seen.add(email);

    if (knownEmails.has(email)) return push("already_in_crm");

    const domain = emailDomain(email);
    if (!domain) return push("bad_syntax");

    if (isRoleAccount(email)) return push("role_account", domain);
    if (isDisposableDomain(domain)) return push("disposable_domain", domain);

    pending.add(domain);
    push(null, domain);
  });

  return { rows: out, pendingDomains: Array.from(pending) };
}

/**
 * Turn MX verdicts into final reasons.
 *
 * ‼️ A NULL VERDICT LEAVES THE ROW PENDING. It is not clean and it is not junk: nobody managed to
 * ask. Writing it either way is the failure `mx.ts` exists to prevent, so the row keeps a null
 * reason and the next tick asks again.
 */
export function applyMxVerdicts(
  rows: FilteredRow[],
  verdicts: ReadonlyMap<string, boolean | null>
): { clean: FilteredRow[]; junk: FilteredRow[]; stillPending: FilteredRow[] } {
  const clean: FilteredRow[] = [];
  const junk: FilteredRow[] = [];
  const stillPending: FilteredRow[] = [];

  for (const row of rows) {
    if (row.reason) {
      junk.push(row);
      continue;
    }
    const verdict = row.domain ? verdicts.get(row.domain) : undefined;
    if (verdict === true) clean.push(row);
    else if (verdict === false) junk.push({ ...row, reason: "no_mx" });
    else stillPending.push(row);
  }

  return { clean, junk, stillPending };
}
