import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { ZOHO_TERMINAL_STAGES } from "@/config/stage-display";
import type { GuardianDecision } from "./types";

const SCHEMA_HINT = `{
  "merchant_id": string,
  "zoho_id": string | null,
  "state": "funded" | "declined" | "dead" | "approved_no_response" | "underwriting_stale" | "active_application" | "missing_stips" | "normal_nurture",
  "days_since_last_touch": number,
  "action": "suppress" | "submit_deal" | "draft_email" | "slack_alert" | "none",
  "urgency": "high" | "medium" | "low",
  "draft_subject": string | null,
  "draft_body": string | null,
  "slack_message": string | null,
  "suppress_sequences": boolean,
  "fire_meta_capi_event": "Purchase" | "DealDeclined" | null,
  "reasoning": string
}`;

const SYSTEM_PROMPT = `You are the SRT Agency merchant state classifier.
Given merchant data, classify their state and return a decision object.

Possible states: funded | declined | dead | approved_no_response | underwriting_stale | active_application | missing_stips | normal_nurture

Possible actions: suppress | submit_deal | slack_alert | none

Rules:
- funded/declined/dead → always suppress, never email again (action=suppress, suppress_sequences=true).
- funded → also fire_meta_capi_event="Purchase".
- declined → also fire_meta_capi_event="DealDeclined".
- approved_no_response (48h+ since last touch with merchant, deal stage Approved/Pre-Approved) → action=slack_alert. Email drafts are owned by the Email Marketing Director pipeline (separate flow).
- underwriting_stale (72h+ with no movement in Underwriting/Shopping) → slack Benjamin with last touch summary (action=slack_alert).
- active_application, no stips → slack Benjamin reminder (action=slack_alert, urgency=medium).
- normal_nurture → action=none (let sequences run).

Reasoning must be one sentence explaining the classification.`;

export interface MerchantContext {
  contact_id: string;
  zoho_lead_id?: string | null;
  business_name?: string | null;
  contact_name?: string | null;
  deal_stage?: string | null;
  deal_pipeline?: string | null;
  days_since_last_touch: number;
  active_sequences: string[];
  last_email_summary?: string | null;
  last_call_outcome?: string | null;
  amount?: number | null;
}

export async function classifyMerchant(ctx: MerchantContext): Promise<{
  decision: GuardianDecision;
  rawResponse: string;
  tokens: { input: number; output: number };
  latencyMs: number;
}> {
  const userPrompt = `Merchant: ${ctx.business_name ?? ctx.contact_name ?? "Unknown"}
Contact ID: ${ctx.contact_id}
Zoho ID: ${ctx.zoho_lead_id ?? "none"}
Deal Stage: ${ctx.deal_stage ?? "no deal"}
Pipeline: ${ctx.deal_pipeline ?? "none"}
Amount Requested: ${ctx.amount ? `$${ctx.amount.toLocaleString()}` : "unknown"}
Days Since Last Touch: ${ctx.days_since_last_touch}
Active Sequences: ${ctx.active_sequences.length ? ctx.active_sequences.join(", ") : "none"}
Last Inbound Email Summary: ${ctx.last_email_summary ?? "none"}
Last Call Outcome: ${ctx.last_call_outcome ?? "none"}`;

  const result = await callClaudeJSON<GuardianDecision>({
    model: "claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    user: userPrompt,
    schemaHint: SCHEMA_HINT,
    maxTokens: 1500,
    temperature: 0.2,
    validate: isGuardianDecision,
  });

  return {
    decision: result.data,
    rawResponse: result.raw,
    tokens: { input: result.usage.input_tokens, output: result.usage.output_tokens },
    latencyMs: result.latencyMs,
  };
}

function isGuardianDecision(v: unknown): v is GuardianDecision {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const validStates = [
    "funded", "declined", "dead", "approved_no_response",
    "underwriting_stale", "active_application", "missing_stips", "normal_nurture",
  ];
  const validActions = ["suppress", "submit_deal", "draft_email", "slack_alert", "none"];
  return (
    typeof r.merchant_id === "string" &&
    typeof r.state === "string" && validStates.includes(r.state as string) &&
    typeof r.action === "string" && validActions.includes(r.action as string) &&
    typeof r.suppress_sequences === "boolean" &&
    typeof r.reasoning === "string"
  );
}

export async function fetchActiveMerchants(limit = 200): Promise<MerchantContext[]> {
  const { data: deals, error } = await supabaseAdmin
    .from("deals")
    .select("id, contact_id, stage, pipeline, amount, updated_at, contacts!inner(id, business_name, first_name, last_name, zoho_lead_id)")
    .not("zoho_stage", "in", `(${ZOHO_TERMINAL_STAGES.map((s) => `"${s}"`).join(",")})`)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error || !deals) {
    console.error("[guardian] fetchActiveMerchants error:", error?.message);
    return [];
  }

  const contexts: MerchantContext[] = [];
  type DealRow = {
    id: string;
    contact_id: string;
    stage: string;
    pipeline: string;
    amount: number | null;
    updated_at: string;
    contacts: { id: string; business_name: string | null; first_name: string | null; last_name: string | null; zoho_lead_id: string | null };
  };
  for (const deal of deals as unknown as DealRow[]) {
    const daysSince = Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / (1000 * 60 * 60 * 24));

    const { data: seqs } = await supabaseAdmin
      .from("sequence_enrollments")
      .select("sequence_id, email_sequences(name)")
      .eq("contact_id", deal.contact_id)
      .eq("status", "active");

    const activeSeqs = ((seqs ?? []) as unknown as Array<{ email_sequences: { name: string } | null }>).map((s) => s.email_sequences?.name ?? "unknown");

    const { data: lastCall } = await supabaseAdmin
      .from("call_log")
      .select("outcome, created_at")
      .eq("contact_id", deal.contact_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    contexts.push({
      contact_id: deal.contact_id,
      zoho_lead_id: deal.contacts.zoho_lead_id,
      business_name: deal.contacts.business_name,
      contact_name: `${deal.contacts.first_name ?? ""} ${deal.contacts.last_name ?? ""}`.trim() || null,
      deal_stage: deal.stage,
      deal_pipeline: deal.pipeline,
      amount: deal.amount,
      days_since_last_touch: daysSince,
      active_sequences: activeSeqs,
      last_email_summary: null,
      last_call_outcome: lastCall?.outcome ?? null,
    });
  }

  return contexts;
}

export interface GuardianRunResult {
  processed: number;
  actions: Record<string, number>;
  errors: number;
  skipped: number;
  suppressed_sequences: number;
  slack_posted: number;
}

export async function runGuardian(opts: { dryRun?: boolean; limit?: number } = {}): Promise<GuardianRunResult> {
  const merchants = await fetchActiveMerchants(opts.limit ?? 200);

  const stats: GuardianRunResult = {
    processed: 0,
    actions: {},
    errors: 0,
    skipped: 0,
    suppressed_sequences: 0,
    slack_posted: 0,
  };

  const BATCH_SIZE = 5;
  for (let i = 0; i < merchants.length; i += BATCH_SIZE) {
    const batch = merchants.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((m) => processMerchant(m, opts.dryRun ?? false)));

    for (const r of results) {
      stats.processed++;
      if (r.status === "rejected") {
        stats.errors++;
        console.error("[guardian] merchant error:", r.reason);
        continue;
      }
      const { decision, outcome } = r.value;
      stats.actions[decision.action] = (stats.actions[decision.action] ?? 0) + 1;
      if (outcome.suppressedSequences > 0) stats.suppressed_sequences += outcome.suppressedSequences;
      if (outcome.slackPosted) stats.slack_posted++;
    }
  }

  return stats;
}

async function processMerchant(
  ctx: MerchantContext,
  dryRun: boolean
): Promise<{ decision: GuardianDecision; outcome: { suppressedSequences: number; slackPosted: boolean } }> {
  const { decision, rawResponse, tokens, latencyMs } = await classifyMerchant(ctx);

  const { data: aiDecision } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      merchant_id: ctx.contact_id,
      zoho_id: ctx.zoho_lead_id ?? null,
      trigger_type: "cron",
      state_classified: decision.state,
      action_taken: decision.action,
      was_approved: null,
      sequences_suppressed: decision.suppress_sequences,
      reasoning: decision.reasoning,
      raw_response: { decision, tokens },
      model_used: "claude-sonnet-4-6",
      latency_ms: latencyMs,
      meta_capi_event_fired: decision.fire_meta_capi_event ?? null,
    })
    .select("id")
    .single();

  const aiDecisionId = aiDecision?.id as string | undefined;

  let suppressedSequences = 0;
  let slackPosted = false;

  if (dryRun) {
    return { decision, outcome: { suppressedSequences, slackPosted } };
  }

  if (decision.suppress_sequences) {
    const { data: cancelled } = await supabaseAdmin
      .from("sequence_enrollments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("contact_id", ctx.contact_id)
      .eq("status", "active")
      .select("id");
    suppressedSequences = cancelled?.length ?? 0;
  }

  if (decision.action === "slack_alert" && decision.slack_message) {
    const { slack } = await import("@/lib/slack-bot");
    const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (channel) {
      await slack.postMessage(channel, `🔔 *${ctx.business_name ?? ctx.contact_name}* — ${decision.state}\n${decision.slack_message}\n_Reason:_ ${decision.reasoning}`);
      slackPosted = true;
    }
  }

  if (decision.fire_meta_capi_event) {
    try {
      const { maybeFireMetaEvent } = await import("./meta-events");
      await maybeFireMetaEvent({
        eventName: decision.fire_meta_capi_event,
        contactId: ctx.contact_id,
        value: ctx.amount ?? undefined,
      });
    } catch (e) {
      console.error("[guardian] meta event error:", (e as Error).message);
    }
  }

  return { decision, outcome: { suppressedSequences, slackPosted } };
}
