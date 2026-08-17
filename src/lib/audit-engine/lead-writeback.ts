// What an audit tells the CRM.
//
// Until now an audit wrote to exactly one table, audit_reports, and nothing it learned
// ever reached the lead. So the only way to find out what a scan discovered about a
// business was to go back and read the Slack thread. This closes that: when a report
// finishes, the lead gets one timeline entry and its business fields get filled in.
//
// THE AUDIT WINS on conflicts, by decision. It read the live website; a value typed
// months ago may be stale. But nothing is destroyed: updateLeadFields() writes
// lead_field_history before every change, so an overwrite is visible on the lead page as
// "Industry was updated from X to Y, by audit engine" and can be put back by hand.
//
// BEST EFFORT, ALWAYS. Every call here is caught. A finished audit that produced a real
// scorecard must never report failure because a CRM bookkeeping write failed.

import { supabaseAdmin } from "@/lib/db";
import { logActivity, updateLeadFields } from "@/lib/crm";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

/** Fields the audit is allowed to touch. Anything not listed is never overwritten. */
type ContactPatch = {
  business_name?: string;
  industry?: string;
  city?: string;
  website?: string;
};

export async function writeAuditToLead(
  report: AuditReportRow,
  view: ReportView,
  score: number
): Promise<void> {
  const contactId = report.contact_id;

  // Cold /audit runs from Slack and unclaimed /scan runs have no contact at all. That is
  // expected: there is no lead to write to, not a failure to report.
  if (!contactId) return;

  await logAuditActivity(report, view, score).catch((e) =>
    console.error("[lead-writeback] activity failed:", (e as Error).message)
  );

  await patchLeadFields(report, contactId).catch((e) =>
    console.error("[lead-writeback] field patch failed:", (e as Error).message)
  );
}

async function logAuditActivity(
  report: AuditReportRow,
  view: ReportView,
  score: number
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  const body = [
    `Named in ${view.totalMentioned} of ${view.totalPrompts} questions.`,
    report.business_type ? `Read as: ${report.business_type}.` : null,
    report.city ? `City: ${report.city}.` : null,
    view.mostRecommended?.length
      ? `Recommended instead: ${view.mostRecommended.slice(0, 5).join(", ")}.`
      : null,
    report.slug ? `${appUrl.replace("mission.", "")}/r/${report.slug}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await logActivity({
    contactId: report.contact_id as string,
    activityType: "audit",
    direction: "internal",
    channel: "web",
    subject: `AI visibility audit: ${score}/100`,
    body,
    actor: "Audit engine",
    source: "audit_engine",
    // THE idempotency guard. logActivity is unique on (source, external_id), so the
    // watchdog re-finishing a report, or a manual re-run of finishReport, is a no-op
    // instead of a duplicate row on the timeline.
    externalId: report.id,
    metadata: {
      reportId: report.id,
      slug: report.slug,
      score,
      city: report.city,
      businessType: report.business_type,
      verticalSlug: report.vertical_slug,
      totalMentioned: view.totalMentioned,
      totalPrompts: view.totalPrompts,
      competitors: report.competitors ?? null,
      mostRecommended: view.mostRecommended ?? null,
      citedDomains: view.citedDomains ?? null,
    },
  });
}

async function patchLeadFields(report: AuditReportRow, contactId: string): Promise<void> {
  const patch: ContactPatch = {};

  // business_type is the audit's read of what this business actually is, in buyer
  // language. It is the field that was empty in every screenshot.
  if (report.business_type) patch.industry = report.business_type;
  if (report.city) patch.city = report.city;
  if (report.website) patch.website = report.website;

  // The business NAME is the one thing the audit does NOT overwrite. client_name is
  // inferred from a website's title tag and og:site_name, which are frequently a tagline
  // rather than a name. Overwriting a name someone typed with "Best HVAC In Dallas | Call
  // Now" would be worse than leaving it, and unlike industry it is a field you would
  // notice being wrong only after mail-merging it into an email.
  if (report.client_name) {
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("business_name")
      .eq("id", contactId)
      .maybeSingle();
    if (!existing?.business_name) patch.business_name = report.client_name;
  }

  if (Object.keys(patch).length === 0) return;

  await updateLeadFields({
    contactId,
    patch,
    origin: "audit_engine",
    actor: "Audit engine",
  });
}
