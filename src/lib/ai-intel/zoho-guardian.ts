import { supabaseAdmin } from "@/lib/db";
import { searchLeads, updateLead, addNoteToLead } from "@/lib/zoho";
import type { ZohoApiRecord } from "@/lib/zoho";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "./slack-approval";
import type { GuardianDecision, PendingActionPayload } from "./types";

const TERMINAL_ZOHO_STATUSES = [
  "Closed - Not Converted",
  "Closed - Converted",
  "Junk Lead",
  "Lost Lead",
  "Not Contacted",
  "Dead Declined",
  "Deal Lost",
  "Closed",
  "Funded",
  "Declined",
];

const SCHEMA_HINT = `{
  "merchant_id": string,
  "zoho_id": string | null,
  "state": "funded" | "declined" | "dead" | "approved_no_response" | "underwriting_stale" | "active_application" | "missing_stips" | "normal_nurture" | "needs_data_cleanup",
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

Possible states: funded | declined | dead | approved_no_response | underwriting_stale | active_application | missing_stips | normal_nurture | needs_data_cleanup

Possible actions: suppress | submit_deal | draft_email | slack_alert | clean_zoho_data | none

Rules:
- funded/declined/dead → action=suppress, suppress_sequences=true.
- funded → fire_meta_capi_event="Purchase".
- declined → fire_meta_capi_event="DealDeclined".
- approved_no_response (48h+ since last activity, Lead_Status=Approved/Pre-Approved) → action=draft_email.
- underwriting_stale (72h+ in Underwriting/Shopping) → action=slack_alert.
- active_application, no stips → action=slack_alert, urgency=medium.
- If required fields are missing, malformed, or inconsistent (e.g., phone with letters, missing EIN on a funded deal, duplicate note content) → state="needs_data_cleanup", action="clean_zoho_data". Populate zoho_cleanup_fields with a map of Zoho field names to their corrected values. Only include fields where you have high confidence in the correction.
- normal_nurture → action=none.

Speak in Benjamin's voice for draft_body (direct, friendly, no fluff). Sign as "Benjamin". Reasoning = one sentence.`;

export interface ZohoActiveLead {
  zoho_id: string;
  data: ZohoApiRecord;
  supabase_contact_id: string | null;
  last_activity_days: number;
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
      .select("id")
      .eq("zoho_lead_id", zoho_id)
      .maybeSingle();

    out.push({
      zoho_id,
      data: lead,
      supabase_contact_id: (contact?.id as string) ?? null,
      last_activity_days: daysSince,
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
  Net Funded: ${d.MCA_Net_Funded ?? "—"}`;

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

  if (decision.action === "draft_email" && decision.draft_subject && decision.draft_body) {
    const payload: PendingActionPayload = {
      action_type: "send_email",
      subject: decision.draft_subject,
      body: decision.draft_body,
      to: (lead.data.Email as string) || undefined,
      is_html: false,
      zoho_id: lead.zoho_id,
      amount: Number(lead.data.Funding_Amount_Requested ?? 0) || undefined,
      requires_matthew: Number(lead.data.Funding_Amount_Requested ?? 0) > 50_000,
    };
    const summary = `*${lead.data.Company ?? "Merchant"}* — ${decision.state}\nSubject: ${decision.draft_subject}\n\`\`\`${decision.draft_body.slice(0, 600)}\`\`\`\n_Reason:_ ${decision.reasoning}`;
    const res = await postApprovalRequest({
      summary,
      payload,
      merchantId: lead.supabase_contact_id ?? undefined,
      zohoId: lead.zoho_id,
      aiDecisionId: ai?.id as string | undefined,
      category: "working_lead",
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
