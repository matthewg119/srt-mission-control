import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "./slack-approval";
import { buildLeadContext, whyThisLead, type LeadContext } from "./lead-context";
import { decideTouch } from "./touch-policy";
import { decideCadence } from "./cadence-scheduler";
import { getMattVoiceExamples, renderVoiceExamplesForPrompt } from "./voice-examples";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { slack } from "@/lib/slack-bot";
import type { PendingActionPayload, MarketingCampaignKey } from "./types";

// ── Email Marketing Director ─────────────────────────────────────────────
// Single drafter called per contact by the cron. Given a contact:
//   1. Build lead context (CRM notes, activity, cadence).
//   2. Apply touch policy (skip / handoff / proceed).
//   3. Decide cadence position (D1/2/3 ladder or confirmation-daily).
//   4. Draft a personalized email whose only ask is a reply.
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
    const ctx = await buildLeadContext({ contactId });
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
    };

    const summary = [
      `*${ctx.contact.business_name ?? ctx.contact.first_name ?? "Lead"}* — ${whyThisLead(ctx)}`,
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

export interface DraftedEmail {
  subject: string;
  body: string;  // HTML-ready
  hook: string;  // 1-line "why this angle" for Matt
}

const SYSTEM_PROMPT_BASE = `You are SRT Agency's Email Marketing Director. You write short, personal, one-to-one emails to local business owners. You are NOT a mass-marketer — you write like a human rep sending from his laptop.

WHAT SRT SELLS: AEO. We build the part of a business's own website that AI assistants can actually read and cite, so that when someone asks an assistant for a business like theirs, they get named. We lead with a free first build: one section of their site, no charge, no card. All they have to do is say yes.

SRT DOES NOT DO BUSINESS FUNDING. Never mention financing, loans, lenders, funders, bank statements, advances, approvals or capital. Many of these contacts were funding leads years ago. That is not why we are writing.

Hard rules:
- Under 6 sentences of body (a short paragraph is fine).
- EXACTLY ONE ask, and the ask is a reply. "Reply yes and I'll get it started" or a close variant. No links, no booking pages, no invented URLs.
- Sign off exactly: "Matt" (no title, no phone, no signature block — we append the full signature automatically).
- No subject-line clichés (no "Quick question?", no ALL CAPS, no "[Name]").
- No emojis inside the body unless the prior voice examples use them.
- Never use an em dash. Commas, periods and hyphens only.
- Personalize: reference one specific detail from their context (their business, city, industry, or website) — do not repeat a generic hook you've used on prior emails to this contact.

Return JSON: { subject, body, hook }.
  subject: <60 chars, natural, not clickbait.
  body: HTML string, use <p> paragraphs, ends with the reply ask on its own line.
  hook: one short sentence explaining the angle you chose (for Matt's review).`;

export async function draftEmail(
  ctx: LeadContext,
  campaignKey: MarketingCampaignKey,
  cadenceDay: number
): Promise<DraftedEmail | null> {
  const voice = await getMattVoiceExamples(6);
  const voiceBlock = renderVoiceExamplesForPrompt(voice);

  const priorSubjects = ctx.recent_sends.map((s) => `- ${s.subject}`).join("\n") || "(none)";
  const notesBlock =
    ctx.crm.notes.slice(0, 6).map((n) => `• [${n.modified_at.slice(0, 10)}] ${n.title}: ${n.content.slice(0, 200)}`).join("\n") ||
    "(no notes on file)";

  const user = [
    `Business: ${ctx.contact.business_name ?? "unknown"} | Contact: ${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim(),
    `Email: ${ctx.contact.email}`,
    `Industry: ${ctx.contact.industry ?? "—"}`,
    `Location: ${[ctx.contact.biz_city, ctx.contact.biz_state].filter(Boolean).join(", ") || "—"}`,
    `Website: ${ctx.contact.website ?? "— (none on file, do not claim to have looked at it)"}`,
    `Stage: ${ctx.crm.lead_status ?? "—"}`,
    `Days since lead created: ${ctx.days_since_created ?? "—"}`,
    ``,
    `Cadence: ${campaignKey} — Day ${cadenceDay}, sequence position ${ctx.cadence?.sends_today ?? 0 + 1}.`,
    ``,
    `Recent notes (may be stale funding-era history — use only for who they are, never as a reason to write):`,
    notesBlock,
    ``,
    `Subjects of prior emails you've already sent this contact (DO NOT repeat them):`,
    priorSubjects,
  ].join("\n");

  const system = `${SYSTEM_PROMPT_BASE}\n\n${voiceBlock}`;

  const schemaHint = `{ "subject": string, "body": string, "hook": string }`;

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

async function postHandoffCard(ctx: LeadContext, reason: string): Promise<string | null> {
  const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
  if (!channel) return null;

  const nameFallback = `${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim();
  const who = ctx.contact.business_name || nameFallback || "lead";
  const text = `⚠️ Stale lead — ${who}\n${reason}\nStage: ${ctx.crm.lead_status ?? "(none)"}\nOpen tasks: ${ctx.open_tasks.length}\n\nAssign a rep to clean, or flip do-not-contact.`;

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
