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
import { slackThreadLink } from "@/lib/slack-bot";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

// Fields the audit is allowed to touch. Anything not listed is never overwritten.
//
// ‼️ `biz_city`, NOT `city`. There is no bare `city` column on contacts and there never
// was, and this wrote one until 2026-08-19. It did not degrade: updateLeadFields() does
// select(fields) then update(patch), PostgREST fails the WHOLE statement on one unknown
// column, and patchLeadFields() only console.errors the result. So a single wrong name
// meant industry and website were never written back either, for every audit ever run.
// Same trap as docs/2026-08-19-contacts-drift-repair.sql. Verify any addition here with
// `bun run scripts/_probe-contacts-columns.ts <name>` before committing it.
type ContactPatch = {
  business_name?: string;
  industry?: string;
  biz_city?: string;
  biz_state?: string;
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
    // Where the report was POSTED, not just where it can be read. Everything that
    // happens to an audit after it finishes -- the intake card, every draft, the
    // avatars, the call script, the loom wizard -- happens in that thread, and
    // until now the only way to find it from a lead was to scroll the channel.
    report.slack_channel_id && report.slack_thread_ts
      ? `Report posted in Slack: ${slackThreadLink(report.slack_channel_id, report.slack_thread_ts)}`
      : null,
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
  // audit_reports.city is whatever was typed after the pipe on /audit, so it is
  // "Homestead, FL" about as often as it is "Homestead". Writing the whole string
  // into a city field is the kind of garbage that reads fine until it is
  // mail-merged. Split only on an unambiguous trailing two-letter code.
  if (report.city) {
    const m = report.city.trim().match(/^(.+?),\s*([A-Za-z]{2})$/);
    if (m) {
      patch.biz_city = m[1].trim();
      patch.biz_state = m[2].toUpperCase();
    } else {
      patch.biz_city = report.city.trim();
    }
  }
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
