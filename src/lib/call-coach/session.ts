// The call_coach_sessions row, as the identity + wrap record for one call.
//
// Extended rather than sidecarred: there is already exactly one row per call, call_coach_transcripts
// is already keyed to it, and the session id is already the token the extension carries end to end.
// Same precedent as loom_state / auto_send_state living on audit_reports.

import { supabaseAdmin } from "@/lib/db";
import type { CallBrief } from "./brief";
import type { CallTarget, TargetConfidence } from "./resolve-target";

export interface SessionIdentity {
  sessionId: string;
  contactId: string | null;
  zohoLeadId: string | null;
  businessName: string | null;
  personName: string | null;
  prospectEmail: string | null;
  prospectPhone: string | null;
  auditReportId: string | null;
  callType: string | null;
  briefText: string | null;
  slackChannel: string | null;
  slackThreadTs: string | null;
}

/**
 * ‼️ Callers must pass `brief.who`, not the target they handed to buildCallBrief.
 *
 * buildCallBrief resolves a missing business name from the audit report and then the website host,
 * and this row is what the post-call wrap card reads back hours later. Storing the pre-correction
 * copy means the Zoho note and the Slack card both say "unknown business" for a lead whose name
 * was sitting on the report the whole time.
 */
function identityColumns(target: CallTarget, brief: CallBrief, confidence: TargetConfidence) {
  return {
    contact_id: target.contactId,
    // Still written so a session opened from an old Zoho link keeps its trail.
    // contact_id is the identity; this is provenance.
    zoho_record_id: target.zohoLeadId,
    audit_report_id: brief.auditReportId,
    business_name: target.businessName,
    person_name: target.personName,
    prospect_email: target.email,
    prospect_phone: target.phone,
    call_type: brief.callType,
    identify_confidence: confidence,
    identify_source: target.source,
    brief_text: brief.text,
    slack_channel: brief.slackChannel,
    slack_thread_ts: brief.slackThreadTs,
  };
}

/**
 * Write the resolved identity onto an existing session.
 *
 * Used when the coach is already capturing and Matthew scans mid-call, which is the common case:
 * he starts listening, the phone connects, then he hits Scan.
 */
export async function attachIdentityToSession(
  sessionId: string,
  target: CallTarget,
  brief: CallBrief,
  confidence: TargetConfidence
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("call_coach_sessions")
    .update(identityColumns(target, brief, confidence))
    .eq("id", sessionId);
  if (error) console.error("[call-coach/session] identity update failed:", error.message);
}

/**
 * Create a session row that has no capture behind it yet.
 *
 * This is what lets the DIALER ask for a brief. It has a record and no coach session, and
 * inventing a second table for "a brief that has not become a call yet" would mean two places to
 * look for the same thing. The coach adopts this id instead of minting its own.
 */
export async function createPendingSession(
  userId: string | null,
  target: CallTarget,
  brief: CallBrief,
  confidence: TargetConfidence
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("call_coach_sessions")
    .insert({
      user_id: userId,
      started_at: new Date().toISOString(),
      wrap_state: "pending",
      ...identityColumns(target, brief, confidence),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[call-coach/session] insert failed:", error.message);
    return null;
  }
  return data.id as string;
}

/**
 * The most recent identified session for this rep, for the coach's "Load latest" button.
 *
 * Scoped by user and by age. An hour-old brief is from a different call, and silently loading it
 * would put the wrong prospect on screen with no indication that anything was stale.
 */
export async function latestPendingTarget(userId: string): Promise<SessionIdentity | null> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("call_coach_sessions")
    .select(
      "id, contact_id, zoho_record_id, business_name, person_name, prospect_email, prospect_phone, audit_report_id, call_type, brief_text, slack_channel, slack_thread_ts"
    )
    .eq("user_id", userId)
    .not("contact_id", "is", null)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    sessionId: data.id as string,
    contactId: data.contact_id as string | null,
    zohoLeadId: data.zoho_record_id as string | null,
    businessName: data.business_name as string | null,
    personName: data.person_name as string | null,
    prospectEmail: data.prospect_email as string | null,
    prospectPhone: data.prospect_phone as string | null,
    auditReportId: data.audit_report_id as string | null,
    callType: data.call_type as string | null,
    briefText: data.brief_text as string | null,
    slackChannel: data.slack_channel as string | null,
    slackThreadTs: data.slack_thread_ts as string | null,
  };
}
