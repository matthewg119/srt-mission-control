// The one answer to "what do we call this business on screen".
//
// This was three identical private copies (slack-format, finish-report, outreach-intake) plus
// two inlined ones (pdf-scorecard, loom-beatsheet), all reading
// `client_name || business_type || website`. That chain ended in the website, and the website
// is now NULL on a name-mode run, so every copy of it needed the same new last rung at the
// same time. One function is what makes that true by construction.

import type { AuditReportRow } from "./types";

/**
 * ‼️ The fallback is deliberately not a plausible business name.
 *
 * `client_name` comes from classifyBusiness, whose validator rejects an empty business_name, so
 * in practice the first rung always answers. If it ever does not, this string goes in a PDF
 * title and an email subject line, and the one thing worse than an obviously broken name there
 * is a quietly generic one that reads as intentional.
 */
const UNRESOLVED = "an unidentified business";

export function displayName(report: AuditReportRow): string {
  return report.client_name || report.business_type || report.website || UNRESOLVED;
}

/**
 * How to re-run this audit, quoted back to Matthew in failure messages.
 *
 * A name-mode row has no website to print, and `/audit ` with a trailing space is not a command
 * anyone can act on.
 */
export function rerunCommand(report: AuditReportRow): string {
  if (report.website) return `/audit ${report.website}`;
  const name = report.client_name ?? "";
  const quoted = name.includes(".") ? `"${name}"` : name;
  return report.city ? `/audit ${quoted} | ${report.city}` : `/audit ${quoted}`;
}
