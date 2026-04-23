import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "./slack-approval";
import { buildMerchantContext, whyThisLead, type MerchantContext } from "./merchant-context";
import { decideTouch } from "./touch-policy";
import { decideCadence } from "./cadence-scheduler";
import { getMattVoiceExamples, renderVoiceExamplesForPrompt } from "./voice-examples";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { slack } from "@/lib/slack-bot";
import type { PendingActionPayload, MarketingCampaignKey } from "./types";

// ── Email Marketing Director ─────────────────────────────────────────────
// Single drafter called per contact by the cron. Given a contact:
//   1. Build merchant context (Zoho notes, deal events, activity, cadence).
//   2. Apply touch policy (skip / handoff / proceed).
//   3. Decide cadence position (D1/2/3 ladder or confirmation-daily).
//   4. Draft personalized email with {magic_link} placeholder.
//   5. Post approval card to #vektor-email-director for Matt's 👍.

export interface DraftResult {
  contact_id: string;
  outcome:
    | "drafted"
    | "skip_no_email"
    | "skip_touch_policy"
    | "skip_cadence"
    | "handoff_posted"
    | "error";
  detail?: string;
  slack_ts?: string;
  campaign_key?: MarketingCampaignKey;
}

export async function draftForContact(contactId: string): Promise<DraftResult> {
  try {
    const ctx = await buildMerchantContext({ contactId });
    if (!ctx) return { contact_id: contactId, outcome: "error", detail: "no_context" };
    if (!ctx.contact.email) return { contact_id: contactId, outcome: "skip_no_email" };

    const touch = await decideTouch(ctx);
    if (touch.kind === "skip_recent_touch") {
      return { contact_id: contactId, outcome: "skip_touch_policy", detail: touch.reason };
    }
    if (touch.kind === "handoff_to_rep") {
      const ts = await postHandoffCard(ctx, touch.reason);
      return { contact_id: contactId, outcome: "handoff_posted", detail: touch.reason, slack_ts: ts ?? undefined };
    }

    const cadence = decideCadence(ctx);
    if (!cadence.should_draft || !cadence.campaign_key || !cadence.track || !cadence.cadence_day) {
      return { contact_id: contactId, outcome: "skip_cadence", detail: cadence.reason };
    }

    const draft = await draftEmail(ctx, cadence.campaign_key, cadence.cadence_day);
    if (!draft) return { contact_id: contactId, outcome: "error", detail: "claude_draft_failed" };

    const payload: PendingActionPayload = {
      action_type: "send_marketing_email",
      to: ctx.contact.email,
      subject: draft.subject,
      body: draft.body,
      is_html: true,
      contact_id: ctx.contact.id,
      zoho_id: ctx.contact.zoho_lead_id ?? undefined,
      campaign_key: cadence.campaign_key,
      cadence_day: cadence.cadence_day,
      sequence_position: cadence.sequence_position,
      magic_link_redirect: draft.redirectPath,
    };

    const summary = [
      `*${ctx.contact.business_name ?? ctx.contact.first_name ?? "Merchant"}* — ${whyThisLead(ctx)}`,
      ``,
      `*Campaign:* ${cadence.campaign_key} (D${cadence.cadence_day}/${cadence.sequence_position})`,
      `*To:* ${ctx.contact.email}`,
      `*Subject:* ${draft.subject}`,
      ``,
      "```",
      draft.body.replace(/<[^>]+>/g, "").slice(0, 1200),
      "```",
      ``,
      `_Hook:_ ${draft.hook}`,
    ].join("\n");

    const res = await postApprovalRequest({
      summary,
      payload,
      merchantId: ctx.contact.id,
      zohoId: ctx.contact.zoho_lead_id ?? undefined,
      category: "marketing_email",
    });

    return {
      contact_id: contactId,
      outcome: "drafted",
      campaign_key: cadence.campaign_key,
      slack_ts: res.slackTs ?? undefined,
    };
  } catch (e) {
    console.error("[email-director] draft failed:", (e as Error).message);
    return { contact_id: contactId, outcome: "error", detail: (e as Error).message };
  }
}

interface DraftedEmail {
  subject: string;
  body: string;          // HTML-ready, with `{magic_link}` placeholder unresolved
  hook: string;          // 1-line "why this angle" for Matt
  redirectPath: string;  // which portal page the magic link should land on
}

const SYSTEM_PROMPT_BASE = `You are SRT Agency's Email Marketing Director. You write short, personal, one-to-one emails to business owners who are our merchant leads. You are NOT a mass-marketer — you write like a human rep sending from his laptop.

Hard rules:
- Under 6 sentences of body (a short paragraph is fine).
- Include EXACTLY ONE CTA, rendered as the literal placeholder "{magic_link}" — no invented URLs. The placeholder will be replaced at send time with a real one-click portal login link.
- Sign off exactly: "Matt" (no title, no phone, no signature block — we append the full signature automatically).
- No subject-line clichés (no "Quick question?", no ALL CAPS, no "[Name]").
- No emojis inside the body unless the prior voice examples use them.
- Personalize: reference one specific detail from their context (business, amount, industry, signed-but-no-statements, etc.) — do not repeat a generic hook you've used on prior emails to this contact.

Return JSON: { subject, body, hook, redirectPath }.
  subject: <60 chars, natural, not clickbait.
  body: HTML string, use <p> paragraphs, ends with the "{magic_link}" CTA on its own line.
  hook: one short sentence explaining the angle you chose (for Matt's review).
  redirectPath: portal path the magic link should land on — pick based on campaign/state:
    - "/portal/statements" if the lead is signed but hasn't uploaded statements
    - "/portal/dashboard" for general check-ins
    - "/portal/apply" for partial applications
    - "/portal/dashboard" default`;

async function draftEmail(
  ctx: MerchantContext,
  campaignKey: MarketingCampaignKey,
  cadenceDay: number
): Promise<DraftedEmail | null> {
  const voice = await getMattVoiceExamples(6);
  const voiceBlock = renderVoiceExamplesForPrompt(voice);

  const priorSubjects = ctx.recent_sends.map((s) => `- ${s.subject}`).join("\n") || "(none)";
  const notesBlock =
    ctx.zoho?.notes.slice(0, 6).map((n) => `• [${n.modified_at.slice(0, 10)}] ${n.title}: ${n.content.slice(0, 200)}`).join("\n") ||
    "(no Zoho notes)";

  const user = [
    `Merchant: ${ctx.contact.business_name ?? "unknown"} | Contact: ${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim(),
    `Email: ${ctx.contact.email}`,
    `Industry: ${ctx.contact.industry ?? "—"}`,
    `Amount needed: ${ctx.contact.amount_needed ? `$${ctx.contact.amount_needed.toLocaleString()}` : "—"}`,
    `Monthly revenue: ${ctx.contact.monthly_revenue ? `$${ctx.contact.monthly_revenue.toLocaleString()}` : "—"}`,
    `Credit score: ${ctx.contact.credit_score ?? "—"}`,
    `Zoho Lead Status: ${ctx.zoho?.lead_status ?? "—"}`,
    `Portal: signed=${ctx.contact.portal_app_completed}, statements_uploaded=${ctx.contact.portal_statements_uploaded}, logins=${ctx.contact.portal_login_count}`,
    `Days since lead created: ${ctx.days_since_created ?? "—"}`,
    `Hours since application signature: ${ctx.hours_since_signature ?? "—"}`,
    ``,
    `Cadence: ${campaignKey} — Day ${cadenceDay}, sequence position ${ctx.cadence?.sends_today ?? 0 + 1}.`,
    ``,
    `Recent Zoho notes:`,
    notesBlock,
    ``,
    `Subjects of prior emails you've already sent this contact (DO NOT repeat them):`,
    priorSubjects,
  ].join("\n");

  const system = `${SYSTEM_PROMPT_BASE}\n\n${voiceBlock}`;

  const schemaHint = `{ "subject": string, "body": string, "hook": string, "redirectPath": string }`;

  try {
    const result = await callClaudeJSON<DraftedEmail>({
      model: "claude-sonnet-4-6",
      system,
      user,
      schemaHint,
      maxTokens: 1200,
      temperature: 0.6,
    });
    return result.data;
  } catch (e) {
    console.error("[email-director] Claude draft error:", (e as Error).message);
    return null;
  }
}

async function postHandoffCard(ctx: MerchantContext, reason: string): Promise<string | null> {
  const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
  if (!channel) return null;

  const nameFallback = `${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim();
  const who = ctx.contact.business_name || nameFallback || "lead";
  const text = `⚠️ Stale lead — ${who}\n${reason}\nLast Zoho status: ${ctx.zoho?.lead_status ?? "(none)"}\nOpen tasks: ${ctx.open_tasks.length}\n\nAssign a rep to clean, or flip do-not-contact.`;

  const resp = (await slack.postMessage(channel, text, [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Assign Matt" }, action_id: "handoff_assign_matt", value: ctx.contact.id },
        { type: "button", text: { type: "plain_text", text: "Assign Benjamin" }, action_id: "handoff_assign_benjamin", value: ctx.contact.id },
        { type: "button", text: { type: "plain_text", text: "Mark DNC" }, style: "danger", action_id: "handoff_mark_dnc", value: ctx.contact.id },
      ],
    },
  ])) as { ok: boolean; ts?: string };

  return resp.ok ? resp.ts ?? null : null;
}

// ── Cron entry point ─────────────────────────────────────────────────────
export async function runEmailDirector(opts: { limit?: number } = {}): Promise<{
  processed: number;
  drafted: number;
  skipped: number;
  handoffs: number;
  errors: number;
  by_campaign: Record<string, number>;
}> {
  // Eligible contacts: anyone with an email, not DNC, updated in last 60 days,
  // and either no cadence_state yet OR cadence_state.paused = false.
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id, cadence_state(paused)")
    .not("email", "is", null)
    .eq("do_not_contact", false)
    .gte("updated_at", since)
    .limit(opts.limit ?? 150);

  const eligible = ((contacts ?? []) as Array<{ id: string; cadence_state?: { paused?: boolean } | null }>)
    .filter((c) => !c.cadence_state?.paused)
    .map((c) => c.id);

  const stats = {
    processed: 0,
    drafted: 0,
    skipped: 0,
    handoffs: 0,
    errors: 0,
    by_campaign: {} as Record<string, number>,
  };

  const BATCH = 3;
  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((cid) => draftForContact(cid)));
    for (const r of results) {
      stats.processed++;
      if (r.status === "rejected") {
        stats.errors++;
        continue;
      }
      const o = r.value.outcome;
      if (o === "drafted") {
        stats.drafted++;
        if (r.value.campaign_key) {
          stats.by_campaign[r.value.campaign_key] = (stats.by_campaign[r.value.campaign_key] ?? 0) + 1;
        }
      } else if (o === "handoff_posted") {
        stats.handoffs++;
      } else if (o === "error") {
        stats.errors++;
      } else {
        stats.skipped++;
      }
    }
  }

  return stats;
}
