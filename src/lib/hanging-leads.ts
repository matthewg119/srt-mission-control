// Daily morning digest — the "organize my day" board, posted to
// SLACK_FOLLOWUPS_CHANNEL. Each lead that needs working, listed with why, plus
// a VeKtor-drafted follow-up email card (✅ Approve to send) for the priority
// subset that has an email address.
//
// ── This file used to scan Zoho ───────────────────────────────────────
// It ran two paginated /Leads/search calls plus one /Notes call per lead —
// several hundred Zoho API credits every morning — to work out which leads had
// gone quiet. All of that now lives in src/lib/worklist.ts and reads Supabase.
// This file kept its Slack presentation and its dedup cadences and lost its
// data layer entirely: ZERO Zoho calls.
//
// The upside beyond the API bill is consistency. buildWorklist() is the same
// function behind /dashboard/worklist and behind the chatbot's get_worklist
// tool, so the morning digest, the call board and asking Vektor "who do we
// need to call today?" cannot disagree with each other.
//
// Deal Lost revival (follow up a week after it was lost, then every two weeks)
// is now a scoring rule inside worklist.ts rather than a second full scan; the
// contacts.last_lost_followup_at cadence guard below still applies on top so
// the same lead isn't carded fortnightly AND daily.
//
// Driven by /api/cron/hanging-leads (8am ET weekday mornings).

import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { buildMerchantContext } from "@/lib/ai-intel/merchant-context";
import { draftFollowupEmail } from "@/lib/ai-intel/followup-director";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import { buildWorklist, type WorklistItem } from "@/lib/worklist";

const DIGEST_MAX = 30; // leads listed in detail per run
const EMAIL_CARD_MAX = 10; // email drafts per run (LLM cost)
const RENUDGE_DAYS = 7; // don't re-card the same contact within a week
const LOST_REPEAT_DAYS = 14; // Deal Lost re-engagement cadence

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// Deep link into the new CRM, not Zoho. Kept as a function so the Phase 6
// cutover is one line if the host ever changes.
const LEAD_URL = (contactId: string) =>
  `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/dashboard/leads/${contactId}`;

function money(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
}

function digestLine(item: WorklistItem): string {
  const ask = money(item.amountNeeded);
  const age =
    item.daysSinceActivity != null
      ? `${item.daysSinceActivity}d since contact`
      : "never contacted";

  const head =
    `*<${LEAD_URL(item.contactId)}|${item.name}>* — _${item.status ?? "No status"}_ · ${age}` +
    (ask ? ` · ${ask} ask` : "");

  // The scorer's own sentences, verbatim. The board, the chatbot and this
  // digest all explain a lead the same way.
  const why = item.reasons.length > 0 ? `\n> ${item.reasons.join(" · ")}` : "";
  const note = item.lastNote?.body ? `\n> _${item.lastNote.body.slice(0, 160)}_` : "";

  return head + why + note;
}

// Chunk leads into Slack messages (≤ ~40 section blocks per message, under the 50 cap).
function buildDigestMessages(header: string, lines: string[]): SlackBlock[][] {
  const messages: SlackBlock[][] = [];
  const PER_MSG = 40;
  for (let i = 0; i < lines.length; i += PER_MSG) {
    const slice = lines.slice(i, i + PER_MSG);
    const blocks: SlackBlock[] = [];
    if (i === 0) {
      blocks.push({ type: "header", text: { type: "plain_text", text: header, emoji: true } } as SlackBlock);
    }
    for (const line of slice) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: line } } as SlackBlock);
    }
    messages.push(blocks);
  }
  return messages;
}

// Post a VeKtor-drafted follow-up email card for one contact (reuses the
// followup-director flow). Returns true if a card was posted.
async function postEmailCard(contactId: string, channel: string, reason: string): Promise<boolean> {
  const ctx = await buildMerchantContext({ contactId });
  if (!ctx || ctx.contact.do_not_contact || !ctx.contact.email) return false;

  const draft = await draftFollowupEmail(ctx, reason);
  if (!draft) return false;

  const firstName = (ctx.contact.first_name ?? "").trim() || "there";
  const payload: PendingActionPayload = {
    action_type: "send_email",
    to: ctx.contact.email,
    subject: draft.subject,
    body: `Hello ${firstName},\n\n${draft.copy}`,
    is_html: false,
    zoho_id: ctx.contact.zoho_lead_id ?? undefined,
    contact_id: ctx.contact.id,
    signature_name: "S",
    note: { title: "Email sent", content: `Follow-up email sent — Subject: ${draft.subject}` },
  };
  const summary = [
    `*Follow-up email* — ${ctx.contact.business_name ?? firstName}`,
    `_Why now:_ ${reason}`,
    ``,
    `*To:* ${ctx.contact.email}`,
    `*Subject:* ${draft.subject}`,
    "```",
    `Hello ${firstName},`,
    ``,
    draft.copy,
    "```",
    `_+ your Outlook "S" signature (appended on send)_`,
  ].join("\n");

  const res = await postApprovalRequest({
    summary,
    payload,
    channel,
    zohoId: ctx.contact.zoho_lead_id ?? undefined,
    merchantId: ctx.contact.id,
  });
  return Boolean(res.slackTs);
}

export async function runHangingLeadScan(): Promise<{
  hanging: number;
  lostDue: number;
  emailCards: number;
  posted: boolean;
}> {
  const channel =
    process.env.SLACK_FOLLOWUPS_CHANNEL ||
    process.env.SLACK_TEAM_CHANNEL ||
    process.env.SLACK_AI_APPROVALS_CHANNEL ||
    process.env.SLACK_HOT_LEADS_CHANNEL ||
    "";
  if (!channel) {
    console.error("[hanging-leads] no Slack channel configured");
    return { hanging: 0, lostDue: 0, emailCards: 0, posted: false };
  }

  // ── 1. One Supabase-backed scan replaces both Zoho scans ──────────────
  const all = await buildWorklist({ limit: DIGEST_MAX * 2 });

  // Deal Lost revivals are separated for presentation only — they are a
  // different ask ("re-engage") than the working leads above them.
  const lostRaw = all.filter((i) => i.status === "Deal Lost");
  const working = all.filter((i) => i.status !== "Deal Lost").slice(0, DIGEST_MAX);

  // Fortnightly cadence guard, so a revived-lost lead isn't listed every day
  // just because it stays stale by definition.
  const lostDue: WorklistItem[] = [];
  for (const item of lostRaw) {
    if (lostDue.length >= DIGEST_MAX) break;
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, last_lost_followup_at")
      .eq("id", item.contactId)
      .maybeSingle();

    const last = (contact?.last_lost_followup_at as string | null) ?? null;
    const since = daysSince(last);
    if (last && since != null && since < LOST_REPEAT_DAYS) continue;

    lostDue.push(item);
    if (contact?.id) {
      await supabaseAdmin
        .from("contacts")
        .update({ last_lost_followup_at: new Date().toISOString() })
        .eq("id", contact.id);
    }
  }

  // ── 2. Build + post the digest ────────────────────────────────────────
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const lines: string[] = [];

  // Leads with nothing scheduled lead the board — that is the bucket the whole
  // follow-up rule exists to keep empty.
  const unscheduled = working.filter((i) => i.bucket === "unscheduled");
  const rest = working.filter((i) => i.bucket !== "unscheduled");

  if (unscheduled.length) {
    lines.push(`*📌 No follow-up scheduled — set a date on these:*`);
    unscheduled.forEach((i) => lines.push(digestLine(i)));
  }
  if (rest.length) {
    lines.push(`*🧵 Needs a touch today:*`);
    rest.forEach((i) => lines.push(digestLine(i)));
  }
  if (lostDue.length) {
    lines.push(`*♻️ Deal Lost — time to re-engage:*`);
    lostDue.forEach((i) => lines.push(digestLine(i)));
  }
  if (!lines.length) {
    lines.push(
      "✅ Nothing hanging. Every working lead has a follow-up scheduled and nothing is overdue."
    );
  }

  const header = `☀️ Morning Follow-up Board — ${date}`;
  const messages = buildDigestMessages(header, lines);
  for (const blocks of messages) {
    await slack.postMessage(channel, header, blocks);
  }

  // ── 3. Email follow-up cards for the priority subset ──────────────────
  let emailCards = 0;
  for (const item of [...working, ...lostDue]) {
    if (emailCards >= EMAIL_CARD_MAX) break;

    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, email, last_digest_nudge_at, do_not_contact")
      .eq("id", item.contactId)
      .maybeSingle();
    if (!contact?.id || !contact.email || contact.do_not_contact) continue;

    const sinceCard = daysSince(contact.last_digest_nudge_at as string | null);
    if (contact.last_digest_nudge_at && sinceCard != null && sinceCard < RENUDGE_DAYS) continue;

    // The scorer already wrote the "why now" in plain English — hand it
    // straight to the email drafter instead of recomputing a reason.
    const reason =
      item.reasons[0] ??
      `${item.status ?? "No status"} · ${item.daysSinceActivity ?? "?"} days since contact`;

    const ok = await postEmailCard(contact.id as string, channel, reason).catch(() => false);
    if (ok) {
      emailCards++;
      await supabaseAdmin
        .from("contacts")
        .update({ last_digest_nudge_at: new Date().toISOString() })
        .eq("id", contact.id);
    }
  }

  return { hanging: working.length, lostDue: lostDue.length, emailCards, posted: true };
}
