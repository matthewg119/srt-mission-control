import { supabaseAdmin } from "@/lib/db";
import { searchLeads, updateLead, addNoteToLead } from "@/lib/zoho";
import type { ZohoApiRecord } from "@/lib/zoho";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "./slack-approval";
import type { GuardianDecision, PendingActionPayload } from "./types";

const TERMINAL_ZOHO_STATUSES = [
  // Hard closed / dead
  "Closed - Not Converted",
  "Closed - Converted",
  "Junk Lead",
  "Lost Lead",
  "Dead Declined",
  "Deal Lost",
  "Closed",
  "Funded",
  "Declined",
  "Not Interested",
  "Unresponsive",
  "Lost",
  "Bad Lead",
  "Wrong Number",
  "Duplicate",
  // Pre-contact — no action possible yet; excluded to stop webhook quota flooding.
  "Not Contacted",
  "Open - Not Contacted",
  "Working - No Contact",
  "New",
];

// Defense in depth: picklist labels drift; match the keyword regardless of exact casing/wording.
const TERMINAL_KEYWORDS = ["declined", "dead", "dnq", "lost", "not interested", "junk", "duplicate"];

function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = String(status).trim();
  if (TERMINAL_ZOHO_STATUSES.includes(s)) return true;
  const lower = s.toLowerCase();
  return TERMINAL_KEYWORDS.some((k) => lower.includes(k));
}

const SCHEMA_HINT = `{
  "merchant_id": string,
  "zoho_id": string | null,
  "state": "funded" | "declined" | "dead" | "approved_no_response" | "underwriting_stale" | "active_application" | "missing_stips" | "awaiting_statements" | "normal_nurture" | "needs_data_cleanup",
  "days_since_last_touch": number,
  "action": "suppress" | "submit_deal" | "draft_email" | "slack_alert" | "clean_zoho_data" | "none",
  "urgency": "high" | "medium" | "low",
  "draft_subject": string | null,
  "draft_body": string | null,
  "slack_message": string | null,
  "suppress_sequences": boolean,
  "fire_meta_capi_event": "Purchase" | "DealDeclined" | null,
  "zoho_cleanup_fields": { [fieldName: string]: string } | null,
  "reasoning": string
}`;

const SYSTEM_PROMPT = `You are VeKtor, SRT Agency's merchant state classifier. You read Zoho CRM Lead data and classify the merchant's state.

Zoho is the source of truth for stage (Lead_Status), notes, and custom MCA fields.

Possible states: funded | declined | dead | approved_no_response | underwriting_stale | active_application | missing_stips | awaiting_statements | normal_nurture | needs_data_cleanup

Possible actions: suppress | submit_deal | slack_alert | clean_zoho_data | none

Email drafts are owned by the Email Marketing Director pipeline — this classifier never drafts merchant emails, only Slack alerts / cleanup / suppression.

Rules:
- funded/declined/dead → action=suppress, suppress_sequences=true.
- funded → fire_meta_capi_event="Purchase".
- declined → fire_meta_capi_event="DealDeclined".
- approved_no_response (48h+ since last activity, Lead_Status=Approved/Pre-Approved) → action=slack_alert. Email drafts are owned by the Email Marketing Director pipeline (not this classifier).
- underwriting_stale (72h+ in Underwriting/Shopping) → action=slack_alert.
- active_application, no stips → action=slack_alert, urgency=medium.
- awaiting_statements: merchant signed the portal application (portal_app_completed=true) but has NOT uploaded bank statements (portal_statements_uploaded=false), AND at least 24 hours have passed since signature (hours_since_signature ≥ 24). This is the highest-intent re-engagement segment — they are one step from an offer.
  - Choose cadence based on hours_since_signature: 24–72h = T+24h SMS nudge, 72h–168h = T+3d email nudge, 168h+ = T+7d SMS nudge (last chance, soft close).
  - For SMS nudges: action="slack_alert". Matt does NOT have A2P with RingCentral yet, so the Slack message must be copy/paste-ready. Set slack_message with EXACTLY this structure:
    "📱 Text to: {formatted_phone}\\n\\n{sms_body}"
    where {formatted_phone} is the merchant's phone in (XXX) XXX-XXXX form and {sms_body} is the drafted SMS under 300 chars, in Matt's voice (first name of merchant, friendly, no emojis in the body).
  - For T+24h SMS template: "Hey {first_name}, Matt from SRT. Saw you wrapped the application yesterday — one last step to get you a number today: send me your last 3 months of business bank statements. I can text you the secure Plaid link if easier — just say the word."
  - For T+7d SMS template: "Hey {first_name}, this is Matt again — want to keep your SRT app open or should I close it out? No pressure either way."
  - For T+3d: action="slack_alert" with the same copy/paste SMS structure — no email drafts here. All merchant email drafts are owned by the Email Marketing Director pipeline (separate flow, separate channel).
  - urgency="high" for T+24h, "medium" for T+3d, "low" for T+7d.
- If required fields are missing, malformed, or inconsistent (e.g., phone with letters, missing EIN on a funded deal, duplicate note content) → state="needs_data_cleanup", action="clean_zoho_data". Populate zoho_cleanup_fields with a map of Zoho field names to their corrected values. Only include fields where you have high confidence in the correction.
- normal_nurture → action=none.

Speak in Benjamin's voice for draft_body (direct, friendly, no fluff). Sign as "Benjamin". Reasoning = one sentence.`;

export interface ZohoActiveLead {
  zoho_id: string;
  data: ZohoApiRecord;
  supabase_contact_id: string | null;
  last_activity_days: number;
  portal_funnel: {
    first_name: string | null;
    phone: string | null;
    portal_app_completed: boolean;
    portal_statements_uploaded: boolean;
    application_signed_at: string | null;
    statements_uploaded_at: string | null;
    hours_since_signature: number | null;
    last_nudge_posted_at: string | null;
  } | null;
}

export async function fetchActiveZohoLeads(limit = 100): Promise<ZohoActiveLead[]> {
  const criteria = TERMINAL_ZOHO_STATUSES
    .map((s) => `(Lead_Status:not_equal:${s})`)
    .join("and");
  const searchResults = await searchLeads({ criteria });

  const recent = searchResults.slice(0, limit);
  const out: ZohoActiveLead[] = [];

  for (const lead of recent) {
    const zoho_id = String(lead.id ?? "");
    if (!zoho_id) continue;
    const modified = (lead.Modified_Time as string) || (lead.Created_Time as string) || new Date().toISOString();
    const daysSince = Math.floor((Date.now() - new Date(modified).getTime()) / (1000 * 60 * 60 * 24));

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, phone, mobile_phone, portal_app_completed, portal_statements_uploaded, application_signed_at, statements_uploaded_at, last_nudge_posted_at, do_not_contact")
      .eq("zoho_lead_id", zoho_id)
      .maybeSingle();

    // Skip anything the human side has explicitly flagged, plus keyword-match
    // the Zoho status (handles picklist label drift like Codi's "Dead Declined"
    // → new variants). Defense in depth over the Zoho-side criteria filter.
    if (contact?.do_not_contact === true) continue;
    if (isTerminalStatus(lead.Lead_Status as string | null | undefined)) continue;

    const signedAt = (contact?.application_signed_at as string) || null;
    const hoursSinceSig = signedAt
      ? Math.floor((Date.now() - new Date(signedAt).getTime()) / (1000 * 60 * 60))
      : null;

    out.push({
      zoho_id,
      data: lead,
      supabase_contact_id: (contact?.id as string) ?? null,
      last_activity_days: daysSince,
      portal_funnel: contact ? {
        first_name: (contact.first_name as string) || null,
        phone: ((contact.phone as string) || (contact.mobile_phone as string)) || null,
        portal_app_completed: Boolean(contact.portal_app_completed),
        portal_statements_uploaded: Boolean(contact.portal_statements_uploaded),
        application_signed_at: signedAt,
        statements_uploaded_at: (contact.statements_uploaded_at as string) || null,
        hours_since_signature: hoursSinceSig,
        last_nudge_posted_at: (contact.last_nudge_posted_at as string) || null,
      } : null,
    });
  }

  return out;
}

export async function classifyZohoLead(lead: ZohoActiveLead): Promise<{
  decision: GuardianDecision & { zoho_cleanup_fields?: Record<string, string> | null };
  tokens: { input: number; output: number };
  latencyMs: number;
}> {
  const d = lead.data;

  const userPrompt = `Zoho Lead ID: ${lead.zoho_id}
Business: ${d.Company ?? "—"}
Contact: ${(d.First_Name ?? "") + " " + (d.Last_Name ?? "")}
Email: ${d.Email ?? "—"}
Phone: ${d.Phone ?? "—"}
Lead Status: ${d.Lead_Status ?? "—"}
Lead Source: ${d.Lead_Source ?? "—"}
Industry: ${d.Industry ?? "—"}
EIN: ${d.EIN ?? "—"}
Funding Requested: ${d.Funding_Amount_Requested ?? "—"}
Monthly Revenue: ${d.Monthly_Revenue ?? "—"}
Credit Score: ${d.Credit_Score_Range ?? "—"}
Time in Business: ${d.Time_in_Business ?? "—"}
Use of Funds: ${d.Use_of_Funds ?? "—"}
Days Since Last Activity: ${lead.last_activity_days}

MCA Offer (if present):
  Factor Rate: ${d.MCA_Factor_Rate ?? "—"}
  Total Payback: ${d.MCA_Total_Payback ?? "—"}
  Term Months: ${d.MCA_Term_Months ?? "—"}
  Net Funded: ${d.MCA_Net_Funded ?? "—"}

Portal Funnel (Supabase source of truth):
  First Name: ${lead.portal_funnel?.first_name ?? "—"}
  Phone (for copy/paste SMS): ${lead.portal_funnel?.phone ?? "—"}
  Application Signed: ${lead.portal_funnel?.portal_app_completed ? "yes" : "no"}
  Statements Uploaded: ${lead.portal_funnel?.portal_statements_uploaded ? "yes" : "no"}
  Signed At: ${lead.portal_funnel?.application_signed_at ?? "—"}
  Hours Since Signature: ${lead.portal_funnel?.hours_since_signature ?? "—"}
  Last Nudge Posted: ${lead.portal_funnel?.last_nudge_posted_at ?? "never"}`;

  const result = await callClaudeJSON<GuardianDecision & { zoho_cleanup_fields?: Record<string, string> | null }>({
    model: "claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    schemaHint: SCHEMA_HINT,
    maxTokens: 2000,
    temperature: 0.2,
  });

  return {
    decision: result.data,
    tokens: { input: result.usage.input_tokens, output: result.usage.output_tokens },
    latencyMs: result.latencyMs,
  };
}

export interface ZohoGuardianRunResult {
  processed: number;
  actions: Record<string, number>;
  cleanup_applied: number;
  slack_posted: number;
  errors: number;
}

export async function runZohoGuardian(opts: { dryRun?: boolean; limit?: number } = {}): Promise<ZohoGuardianRunResult> {
  const leads = await fetchActiveZohoLeads(opts.limit ?? 100);

  const stats: ZohoGuardianRunResult = {
    processed: 0,
    actions: {},
    cleanup_applied: 0,
    slack_posted: 0,
    errors: 0,
  };

  const BATCH = 3;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((l) => processZohoLead(l, opts.dryRun ?? false)));
    for (const r of results) {
      stats.processed++;
      if (r.status === "rejected") {
        stats.errors++;
        console.error("[zoho-guardian] error:", r.reason);
        continue;
      }
      stats.actions[r.value.decision.action] = (stats.actions[r.value.decision.action] ?? 0) + 1;
      if (r.value.cleanupApplied) stats.cleanup_applied++;
      if (r.value.slackPosted) stats.slack_posted++;
    }
  }

  return stats;
}

async function processZohoLead(
  lead: ZohoActiveLead,
  dryRun: boolean
): Promise<{
  decision: GuardianDecision & { zoho_cleanup_fields?: Record<string, string> | null };
  cleanupApplied: boolean;
  slackPosted: boolean;
}> {
  const { decision, tokens, latencyMs } = await classifyZohoLead(lead);

  const { data: ai } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      merchant_id: lead.supabase_contact_id,
      zoho_id: lead.zoho_id,
      trigger_type: "cron",
      state_classified: decision.state,
      action_taken: decision.action,
      reasoning: decision.reasoning,
      raw_response: { decision, tokens, zoho_snapshot_keys: Object.keys(lead.data) },
      model_used: "claude-sonnet-4-6",
      latency_ms: latencyMs,
    })
    .select("id")
    .single();

  if (dryRun) return { decision, cleanupApplied: false, slackPosted: false };

  let cleanupApplied = false;
  let slackPosted = false;

  if (decision.action === "clean_zoho_data" && decision.zoho_cleanup_fields && Object.keys(decision.zoho_cleanup_fields).length > 0) {
    const payload: PendingActionPayload = {
      action_type: "update_zoho",
      zoho_id: lead.zoho_id,
      cleanup_fields: decision.zoho_cleanup_fields,
    };
    const lines = Object.entries(decision.zoho_cleanup_fields)
      .map(([k, v]) => `  • ${k} → ${v}`)
      .join("\n");
    const summary = `🧹 *Zoho data cleanup suggested* — ${lead.data.Company ?? lead.zoho_id}\nProposed changes:\n${lines}\n_Reason:_ ${decision.reasoning}`;
    const res = await postApprovalRequest({
      summary,
      payload,
      merchantId: lead.supabase_contact_id ?? undefined,
      zohoId: lead.zoho_id,
      aiDecisionId: ai?.id as string | undefined,
      category: "merchant_state",
    });
    if (res.slackTs) slackPosted = true;
  }

  if (decision.action === "slack_alert" && decision.slack_message) {
    const { slack } = await import("@/lib/slack-bot");
    const { routeToChannel } = await import("@/config/vektor");
    const channel = routeToChannel("working_lead");
    if (channel) {
      await slack.postMessage(channel, `🔔 *${lead.data.Company ?? "Merchant"}* — ${decision.state}\n${decision.slack_message}\n_Reason:_ ${decision.reasoning}`);
      slackPosted = true;

      // Stamp last_nudge_posted_at so the RingOut escalation cron can detect
      // when the Slack message has sat unactioned for 5+ minutes.
      if (decision.state === "awaiting_statements" && lead.supabase_contact_id) {
        await supabaseAdmin
          .from("contacts")
          .update({ last_nudge_posted_at: new Date().toISOString() })
          .eq("id", lead.supabase_contact_id);
      }
    }
  }

  if (decision.fire_meta_capi_event && lead.supabase_contact_id) {
    try {
      const { maybeFireMetaEvent } = await import("./meta-events");
      await maybeFireMetaEvent({
        eventName: decision.fire_meta_capi_event,
        contactId: lead.supabase_contact_id,
        value: Number(lead.data.MCA_Net_Funded ?? lead.data.Funding_Amount_Requested ?? 0) || undefined,
      });
    } catch (e) {
      console.error("[zoho-guardian] meta event error:", (e as Error).message);
    }
  }

  if (decision.action === "suppress" && lead.supabase_contact_id) {
    const { data: cancelled } = await supabaseAdmin
      .from("sequence_enrollments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("contact_id", lead.supabase_contact_id)
      .eq("status", "active")
      .select("id");
    if (cancelled && cancelled.length > 0) {
      await addNoteToLead(lead.zoho_id, "Sequences suppressed", `VeKtor cancelled ${cancelled.length} active email sequence(s) because state=${decision.state}.`).catch(() => {});
    }
  }

  void cleanupApplied;
  void updateLead;
  return { decision, cleanupApplied, slackPosted };
}
