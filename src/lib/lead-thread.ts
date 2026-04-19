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
  | "milestone_80"
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

  return blocks;
}

/** Format a thread reply for an update event. */
function formatUpdateBlocks(
  action: LeadThreadAction,
  diff: DiffEntry[],
  contact: ContactRow
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
    case "milestone_80":
      headline = "Application 80% complete — almost done";
      icon = "🟠";
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
}): Promise<void> {
  const { contactId, action } = opts;
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

    const { headline, blocks } = formatUpdateBlocks(action, diff, contact as ContactRow);

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
