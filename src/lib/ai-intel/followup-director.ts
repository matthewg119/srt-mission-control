import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "./slack-approval";
import { buildLeadContext, whyThisLead, type LeadContext } from "./lead-context";
import { getMattVoiceExamples, renderVoiceExamplesForPrompt } from "./voice-examples";
import type { PendingActionPayload } from "./types";

// ── Follow-up Suggestion Director ────────────────────────────────────────
// Scans leads that have a per-lead Slack channel and are either DUE for a
// follow-up (an open task whose due_at has passed) or UNCONTACTED (no recent
// send and at least a couple days old). For each, drafts a custom-pitch
// follow-up email (copy only — greeting + "S" signature added by the send
// pipeline) and posts a send_email approval card into that lead's Slack
// channel. Matthew 👍s to send.

const RECENT_SEND_DAYS = 5; // a send in the last N days = "recently contacted"
const MIN_LEAD_AGE_DAYS = 2; // don't nudge brand-new leads

export interface FollowupResult {
  contact_id: string;
  outcome: "suggested" | "skip_no_email" | "skip_not_due" | "skip_no_channel" | "error";
  detail?: string;
}

interface ChannelRow {
  contact_id: string;
  slack_channel_id: string;
}

export async function runFollowupSuggestions(opts: { limit?: number } = {}): Promise<{
  processed: number;
  suggested: number;
  skipped: number;
  errors: number;
}> {
  // Only leads that already have a per-lead Slack channel — that's where the
  // suggestion card goes.
  const { data: convs } = await supabaseAdmin
    .from("sms_conversations")
    .select("contact_id, slack_channel_id")
    .not("slack_channel_id", "is", null)
    .not("contact_id", "is", null)
    .limit(opts.limit ?? 100);

  const rows = ((convs ?? []) as Array<{ contact_id: string | null; slack_channel_id: string | null }>)
    .filter((r): r is ChannelRow => Boolean(r.contact_id && r.slack_channel_id));

  // Dedupe by contact (a contact could have multiple conversations).
  const byContact = new Map<string, string>();
  for (const r of rows) if (!byContact.has(r.contact_id)) byContact.set(r.contact_id, r.slack_channel_id);

  const stats = { processed: 0, suggested: 0, skipped: 0, errors: 0 };
  const entries = [...byContact.entries()];
  const BATCH = 3;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(([contactId, channelId]) => suggestForContact(contactId, channelId))
    );
    for (const r of results) {
      stats.processed++;
      if (r.status === "rejected") { stats.errors++; continue; }
      if (r.value.outcome === "suggested") stats.suggested++;
      else if (r.value.outcome === "error") stats.errors++;
      else stats.skipped++;
    }
  }
  return stats;
}

async function suggestForContact(contactId: string, channelId: string): Promise<FollowupResult> {
  try {
    const ctx = await buildLeadContext({ contactId });
    if (!ctx) return { contact_id: contactId, outcome: "error", detail: "no_context" };
    if (ctx.contact.do_not_contact) return { contact_id: contactId, outcome: "skip_not_due", detail: "dnc" };
    if (!ctx.contact.email) return { contact_id: contactId, outcome: "skip_no_email" };

    const due = followupReason(ctx);
    if (!due) return { contact_id: contactId, outcome: "skip_not_due" };

    const draft = await draftFollowupEmail(ctx, due);
    if (!draft) return { contact_id: contactId, outcome: "error", detail: "claude_draft_failed" };

    const firstName = (ctx.contact.first_name ?? "").trim() || "there";
    const payload: PendingActionPayload = {
      action_type: "send_email",
      to: ctx.contact.email!,
      subject: draft.subject,
      body: `Hello ${firstName},\n\n${draft.copy}`,
      is_html: false,
      zoho_id: ctx.contact.zoho_lead_id ?? undefined,
      contact_id: ctx.contact.id,
      signature_name: "S",
      note: {
        title: "Email sent",
        content: `Email sent successfully from matthew@srtagency.com — Subject: ${draft.subject}`,
      },
    };

    const summary = [
      `*Follow-up suggestion* — ${whyThisLead(ctx)}`,
      `_Why now:_ ${due}`,
      ``,
      `*To:* ${ctx.contact.email}`,
      `*Subject:* ${draft.subject}`,
      ``,
      "```",
      `Hello ${firstName},`,
      ``,
      draft.copy,
      "```",
      `_Hook:_ ${draft.hook}`,
      `_+ your Outlook "S" signature (appended on send)_`,
    ].join("\n");

    const res = await postApprovalRequest({
      summary,
      payload,
      channel: channelId,
      zohoId: ctx.contact.zoho_lead_id ?? undefined,
      merchantId: ctx.contact.id,
    });

    if (!res.slackTs) return { contact_id: contactId, outcome: "error", detail: res.skipped || "post_failed" };
    return { contact_id: contactId, outcome: "suggested" };
  } catch (e) {
    return { contact_id: contactId, outcome: "error", detail: (e as Error).message };
  }
}

// Returns a human reason this lead is due for a follow-up, or null to skip.
function followupReason(ctx: LeadContext): string | null {
  const now = Date.now();

  // 1) An open task whose due date has passed.
  const overdueTask = ctx.open_tasks.find((t) => t.due_at && new Date(t.due_at).getTime() <= now);
  if (overdueTask) {
    return `open task due${overdueTask.title ? ` — "${overdueTask.title}"` : ""}`;
  }

  // 2) Uncontacted / gone quiet: no send in the last RECENT_SEND_DAYS days and
  //    the lead is at least MIN_LEAD_AGE_DAYS old.
  const lastSentMs = ctx.recent_sends[0]?.sent_at ? new Date(ctx.recent_sends[0].sent_at).getTime() : null;
  const sentRecently = lastSentMs != null && now - lastSentMs < RECENT_SEND_DAYS * 86_400_000;
  const oldEnough = ctx.days_since_created != null && ctx.days_since_created >= MIN_LEAD_AGE_DAYS;
  if (!sentRecently && oldEnough) {
    return ctx.recent_sends.length === 0
      ? "no prior email — haven't been contacted yet"
      : `no contact in ${RECENT_SEND_DAYS}+ days`;
  }

  return null;
}

export interface DraftedFollowup {
  subject: string;
  copy: string; // body AFTER the greeting; no greeting, no signature
  hook: string;
}

const SYSTEM_PROMPT = `You are SRT Agency's follow-up writer. You write short, personal, one-to-one follow-up emails to local business owners. Write like a human rep, not a marketer.

WHAT SRT SELLS: AEO. We build the part of a business's own website that AI assistants can actually read and cite, so that when someone asks an assistant for a business like theirs, they get named. We lead with a free first build: one section of their site, no charge, no card. All they have to do is say yes.

SRT DOES NOT DO BUSINESS FUNDING. Never mention financing, loans, lenders, funders, bank statements, advances, approvals or capital. Many of these contacts were funding leads years ago. That is not why we are writing.

Hard rules:
- Return only the body COPY that comes AFTER the greeting. DO NOT write a greeting ("Hello/Hi ...") — it is added automatically.
- DO NOT write a sign-off, name, title, phone, or signature block — the signature is appended automatically.
- Under 6 sentences. One clear ask, and the ask is a reply: say yes and we start the free build.
- Personalize: reference ONE concrete detail from the context (their business, city, industry, website, or the follow-up reason). Don't repeat a hook from a prior email to this contact.
- No clichéd subject lines, no ALL CAPS, no "[Name]" tokens, no emojis unless the voice examples use them.
- Never use an em dash. Commas, periods and hyphens only.

Return JSON: { "subject": string, "copy": string, "hook": string }.
  subject: <60 chars, natural.
  copy: plain text, the message after the greeting.
  hook: one short sentence explaining the angle (for Matthew's review).`;

export async function draftFollowupEmail(ctx: LeadContext, reason: string): Promise<DraftedFollowup | null> {
  const voice = await getMattVoiceExamples(6).catch(() => []);
  const voiceBlock = renderVoiceExamplesForPrompt(voice);

  const priorSubjects = ctx.recent_sends.map((s) => `- ${s.subject}`).join("\n") || "(none)";
  const notesBlock =
    ctx.crm.notes.slice(0, 6).map((n) => `• [${n.modified_at.slice(0, 10)}] ${n.title}: ${n.content.slice(0, 200)}`).join("\n") ||
    "(no notes on file)";

  const user = [
    `Business: ${ctx.contact.business_name ?? "unknown"} | Contact: ${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim(),
    `Industry: ${ctx.contact.industry ?? "—"}`,
    `Location: ${[ctx.contact.biz_city, ctx.contact.biz_state].filter(Boolean).join(", ") || "—"}`,
    `Website: ${ctx.contact.website ?? "— (none on file, do not claim to have looked at it)"}`,
    `Stage: ${ctx.crm.lead_status ?? "—"}`,
    `Days since lead created: ${ctx.days_since_created ?? "—"}`,
    `Follow-up reason (why we're reaching out now): ${reason}`,
    ``,
    `Recent notes (may be stale funding-era history — use only for who they are, never as a reason to write):`,
    notesBlock,
    ``,
    `Subjects of prior emails already sent (DO NOT repeat):`,
    priorSubjects,
  ].join("\n");

  try {
    const result = await callClaudeJSON<DraftedFollowup>({
      model: "claude-sonnet-4-6",
      system: `${SYSTEM_PROMPT}\n\n${voiceBlock}`,
      user,
      schemaHint: `{ "subject": string, "copy": string, "hook": string }`,
      maxTokens: 1000,
      temperature: 0.6,
    });
    return result.data;
  } catch (e) {
    console.error("[followup-director] Claude draft error:", (e as Error).message);
    return null;
  }
}
