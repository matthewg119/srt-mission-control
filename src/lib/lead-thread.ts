// Lead Slack thread manager.
//
// One Slack thread per contact in #hot-leads. The first call posts a top-level
// message with all known fields. Every subsequent call posts a thread reply
// with the diff of what changed since the last post (plus action-specific
// context: login, phone capture, statements upload, application complete).

import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { CONTACT_FIELD_MAP, pickTrackedFields, formatValue } from "@/lib/field-map";

export type LeadThreadAction =
  | "create"
  | "update"
  | "phone"
  | "login"
  | "statements"
  | "milestone_50"
  | "milestone_75"
  | "milestone_80"
  | "plaid"
  | "complete"
  | "auto_dnq";

/** Subset of fields shown in the initial top-level Slack message.
 *  Empty values are filtered out at render time, so the message stays short. */
const INITIAL_KEY_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "mobile_phone",
  "business_name",
  "industry",
  "amount_needed",
  "monthly_revenue",
  "credit_score",
  "source",
  "application_stage",
  "application_completion_pct",
] as const;

/** Lead outcomes reported back to Meta so the ad algorithm optimizes for quality
 *  rather than volume. Slack-only by design: these deliberately do NOT write
 *  Zoho Lead_Status, which would round-trip through /api/webhooks/zoho-lead. */
export const LEAD_DISPOSITIONS = {
  dnq: { actionId: "lead_dnq", label: "Did Not Qualify", button: "⛔ DNQ", style: "danger" },
  booked_call: { actionId: "lead_booked_call", label: "Booked a Call", button: "📅 Booked Call", style: "primary" },
  converted: { actionId: "lead_converted", label: "Converted", button: "💰 Converted", style: "primary" },
} as const;

export type LeadDisposition = keyof typeof LEAD_DISPOSITIONS;

export const DISPOSITION_BY_ACTION_ID = Object.fromEntries(
  Object.entries(LEAD_DISPOSITIONS).map(([key, meta]) => [meta.actionId, key as LeadDisposition])
) as Record<string, LeadDisposition>;

interface DiffEntry {
  label: string;
  from: unknown;
  to: unknown;
}

interface ContactRow {
  id: string;
  slack_thread_ts?: string | null;
  slack_channel?: string | null;
  slack_last_snapshot?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** Stable hash → bigint for Postgres advisory locks. */
function lockKeyForContactId(contactId: string): number {
  let h = 0;
  for (let i = 0; i < contactId.length; i++) {
    h = (h * 31 + contactId.charCodeAt(i)) | 0;
  }
  // Postgres advisory lock takes a bigint; positive 32-bit value is fine.
  return Math.abs(h);
}

/** Compute changed-field list between two snapshots. */
export function computeContactDiff(
  prev: Record<string, unknown> | null,
  curr: Record<string, unknown>
): DiffEntry[] {
  const diff: DiffEntry[] = [];
  for (const f of CONTACT_FIELD_MAP) {
    const a = prev?.[f.supabase] ?? null;
    const b = curr[f.supabase] ?? null;
    // Treat null/undefined/"" as equivalent
    const aEmpty = a === null || a === undefined || a === "";
    const bEmpty = b === null || b === undefined || b === "";
    if (aEmpty && bEmpty) continue;
    if (a === b) continue;
    if (typeof a === "object" || typeof b === "object") {
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
    }
    diff.push({ label: f.label, from: a, to: b });
  }
  return diff;
}

/** Format the initial top-level Slack message. Shows only the key fields
 *  that are actually populated, so the message stays compact. */
function formatInitialBlocks(contact: ContactRow): SlackBlock[] {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || (contact.email as string) || "New Lead";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔥 New Lead — ${name}`, emoji: true },
    },
  ];

  // Build a single mrkdwn section with non-empty key fields only.
  const lines: string[] = [];
  for (const key of INITIAL_KEY_FIELDS) {
    const entry = CONTACT_FIELD_MAP.find((f) => f.supabase === key);
    if (!entry) continue;
    const v = contact[key];
    if (v === null || v === undefined || v === "") continue;
    lines.push(`*${entry.label}:* ${formatValue(v)}`);
  }

  if (lines.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Contact ID: \`${contact.id}\` • <https://mission.srtagency.com/dashboard/pipeline|View in Mission Control>`,
      },
    ],
  });

  // vCard + contact card links — use Zoho ID when available, else Supabase UUID
  const vcardId = (contact.zoho_lead_id as string | null) ?? contact.id;
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `📱 *<https://mission.srtagency.com/api/vcard/${vcardId}|Save to iPhone Contacts>*` +
        ` · <https://mission.srtagency.com/contacts/${vcardId}|Open contact card>`,
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: "save_contact_vcard",
        text: { type: "plain_text", text: "💾 Save Contact", emoji: true },
        url: `https://mission.srtagency.com/api/vcard/${vcardId}`,
      },
      {
        type: "button",
        action_id: "sms_create_channel",
        text: { type: "plain_text", text: "📱 Start SMS Thread", emoji: true },
        value: String(contact.id),
      },
    ],
  });

  // Outcome row. Once one is picked the buttons are replaced by the result, so
  // the message always shows the current disposition and can't be clicked twice.
  const disposition = contact.disposition as LeadDisposition | null;
  if (disposition && LEAD_DISPOSITIONS[disposition]) {
    const at = contact.disposition_at
      ? new Date(String(contact.disposition_at)).toLocaleString("en-US", { timeZone: "America/New_York" })
      : null;
    const by = contact.disposition_by ? `<@${contact.disposition_by}>` : "someone";
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${LEAD_DISPOSITIONS[disposition].button} · marked *${LEAD_DISPOSITIONS[disposition].label}* by ${by}${at ? ` · ${at} ET` : ""}`,
        },
      ],
    });
  } else {
    blocks.push({
      type: "actions",
      elements: Object.entries(LEAD_DISPOSITIONS).map(([, meta]) => ({
        type: "button",
        action_id: meta.actionId,
        text: { type: "plain_text", text: meta.button, emoji: true },
        style: meta.style,
        value: String(contact.id),
      })),
    });
  }

  return blocks;
}

/**
 * Re-render the top-level lead message in place from current DB state. Used
 * after a disposition button is clicked so the message shows the outcome and
 * the buttons disappear. Never throws — a Slack hiccup must not undo the write
 * that already happened.
 */
export async function refreshLeadMessage(contactId: string): Promise<void> {
  try {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (!contact?.slack_thread_ts) return;
    const channel = contact.slack_channel || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (!channel) return;

    const fallbackText = `🔥 New Lead — ${contact.first_name || ""} ${contact.last_name || ""} (${contact.email || "no email"})`;
    await slack.updateMessage(
      channel,
      contact.slack_thread_ts,
      fallbackText,
      formatInitialBlocks(contact as ContactRow)
    );
  } catch (err) {
    console.error("[lead-thread] refreshLeadMessage failed:", err instanceof Error ? err.message : err);
  }
}

/** Format a thread reply for an update event. */
function formatUpdateBlocks(
  action: LeadThreadAction,
  diff: DiffEntry[],
  contact: ContactRow,
  note?: string
): { headline: string; blocks: SlackBlock[] } {
  let headline: string;
  let icon: string;
  switch (action) {
    case "phone":
      headline = "Phone captured — Speed to Lead firing";
      icon = "📞";
      break;
    case "login":
      headline = "Lead logged into portal app";
      icon = "🟢";
      break;
    case "statements":
      headline = "Bank statements uploaded";
      icon = "📎";
      break;
    case "milestone_50":
      headline = "Application 50% complete";
      icon = "🟡";
      break;
    case "milestone_75":
      headline = "Application 75% complete — income info in";
      icon = "🟠";
      break;
    case "milestone_80":
      headline = "Application 80% complete — almost done";
      icon = "🟠";
      break;
    case "plaid":
      headline = "Bank connected via Plaid — verifying income";
      icon = "🏦";
      break;
    case "complete":
      headline = "Application completed";
      icon = "✅";
      break;
    case "auto_dnq":
      headline = "Auto-DNQ — below revenue threshold";
      icon = "⛔";
      break;
    case "update":
    default:
      headline = "Lead updated";
      icon = "📝";
      break;
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${icon} *${headline}*` },
    },
  ];

  if (action === "login") {
    const loginCount = contact.portal_login_count ?? "?";
    const loginTime = contact.last_portal_login_at
      ? new Date(String(contact.last_portal_login_at)).toLocaleString("en-US", { timeZone: "America/New_York" })
      : "now";
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Login #${loginCount} • ${loginTime} ET` },
      ],
    });
  }

  if (diff.length > 0) {
    const lines = diff
      .map(
        (d) =>
          `• *${d.label}:* ${formatValue(d.from)} → *${formatValue(d.to)}*`
      )
      .join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: lines } });
  }

  // Optional free-text note (e.g. a name-change flag on a /capital login).
  if (note && note.trim()) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `⚠️ ${note.trim()}` } });
  }

  if (action === "complete") {
    const vcardId = (contact.zoho_lead_id as string | null) ?? contact.id;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `📱 *<https://mission.srtagency.com/api/vcard/${vcardId}|Save to iPhone Contacts>*` +
          ` · <https://mission.srtagency.com/contacts/${vcardId}|Open contact card>`,
      },
    });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "save_contact_vcard",
          text: { type: "plain_text", text: "💾 Save Contact", emoji: true },
          url: `https://mission.srtagency.com/api/vcard/${vcardId}`,
        },
        {
          type: "button",
          action_id: "sms_create_channel",
          text: { type: "plain_text", text: "📱 Start SMS Thread", emoji: true },
          value: String(contact.id),
        },
      ],
    });
  }

  return { headline: `${icon} ${headline}`, blocks };
}

/**
 * Post or thread-reply a Slack notification for a lead.
 * Idempotent and concurrency-safe via Postgres advisory lock + optimistic update.
 * Never throws — Slack failures must not break lead capture.
 */
export async function postOrThreadLeadUpdate(opts: {
  contactId: string;
  action: LeadThreadAction;
  note?: string;
}): Promise<void> {
  const { contactId, action, note } = opts;
  if (!contactId) return;

  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (!channel) {
    console.warn("[lead-thread] SLACK_HOT_LEADS_CHANNEL not set — skipping");
    return;
  }

  const lockKey = lockKeyForContactId(contactId);

  // Try to acquire advisory lock; tolerate failures (RPC may not exist)
  let locked = false;
  try {
    const { data } = await supabaseAdmin.rpc("pg_try_advisory_lock", { key: lockKey });
    locked = data === true || data === 1;
  } catch {
    // RPC unavailable — proceed without lock; the optimistic UPDATE guard
    // will still prevent duplicate top-level messages.
  }

  try {
    const { data: contact, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (error || !contact) {
      console.error("[lead-thread] contact not found:", contactId, error?.message);
      return;
    }

    const currentSnapshot = pickTrackedFields(contact);

    // First time — post a top-level message
    if (!contact.slack_thread_ts) {
      const blocks = formatInitialBlocks(contact as ContactRow);
      const fallbackText = `🔥 New Lead — ${contact.first_name || ""} ${contact.last_name || ""} (${contact.email || "no email"})`;

      let postedTs: string | null = null;
      try {
        const res = (await slack.postMessage(channel, fallbackText, blocks)) as {
          ok?: boolean;
          ts?: string;
          channel?: string;
        };
        if (res.ok && res.ts) postedTs = res.ts;
      } catch (err) {
        console.error("[lead-thread] postMessage failed:", err);
      }

      if (!postedTs) return;

      // Optimistic update — only set ts if no other concurrent call beat us.
      const { data: updated } = await supabaseAdmin
        .from("contacts")
        .update({
          slack_thread_ts: postedTs,
          slack_channel: channel,
          slack_last_snapshot: currentSnapshot,
        })
        .eq("id", contactId)
        .is("slack_thread_ts", null)
        .select("id");

      if (!updated || updated.length === 0) {
        // We lost the race — another call already wrote a thread_ts.
        // Best effort: don't try to delete our orphaned message (would
        // require SLACK_BOT_TOKEN scopes); accept the small duplicate.
        console.warn("[lead-thread] race lost; orphaned ts:", postedTs);
      }
      return;
    }

    // Subsequent — compute diff against last snapshot, post thread reply
    const diff = computeContactDiff(contact.slack_last_snapshot ?? null, currentSnapshot);

    // Skip pure "update" calls when nothing material changed.
    // Always post for action-specific events (phone/login/statements/complete)
    // even if no field diffs exist, since the action itself is the news.
    if (action === "update" && diff.length === 0) return;

    const { headline, blocks } = formatUpdateBlocks(action, diff, contact as ContactRow, note);

    try {
      await slack.postThreadReply(
        contact.slack_channel || channel,
        contact.slack_thread_ts,
        headline,
        blocks
      );
    } catch (err) {
      console.error("[lead-thread] postThreadReply failed:", err);
    }

    // Update snapshot regardless of Slack success — we don't want to
    // re-send the same diff next time even if Slack hiccupped.
    await supabaseAdmin
      .from("contacts")
      .update({ slack_last_snapshot: currentSnapshot })
      .eq("id", contactId);
  } catch (err) {
    console.error("[lead-thread] unexpected error:", err);
  } finally {
    if (locked) {
      try {
        await supabaseAdmin.rpc("pg_advisory_unlock", { key: lockKey });
      } catch {
        // ignore
      }
    }
  }
}
