// Emails and texts, mirrored onto the lead timeline.
//
// THE HOLE THIS FILLS. lead_activities.activity_type has documented `email` and
// `sms` since crm-core.sql, and lead-timeline.tsx has always shipped a Mail icon,
// a MessageSquare icon and filter chips for both. Nothing in the codebase ever
// wrote one. So a lead you had emailed twice and texted six times rendered
// "No activity yet.", and the page whose job is to make Zoho unnecessary was
// missing the entire conversation.
//
// THREE SOURCES, ONE STREAM:
//   email_messages  — what the ingest pipeline already captured
//   Outlook/Graph   — everything else, including mail typed by hand in Outlook
//   sms_messages    — the iMessage bridge
//
// WHY MIRRORING IS SAFE, given the BULK LOAD WARNING in crm-core.sql:
//   - Every message is keyed by (source, external_id), which carries a unique
//     index, and this module reads the already-mirrored keys FIRST and skips
//     them. So a second page load performs zero writes and fires the touch
//     trigger zero times.
//   - Both email paths key on the Graph message id, so a message the ingest
//     pipeline stored AND Graph returns is logged once, not twice.
//   - The trigger is greatest(coalesce(last_activity_at,'epoch'), occurred_at)
//     fed the message's REAL timestamp. Monotonic: last_activity_at gets more
//     accurate and can never jump to "now" because somebody opened a lead.
//
// The skip list is also why the return value is trustworthy. logActivity returns
// an id for a duplicate as readily as for an insert (it re-reads the existing
// row), so counting its non-null returns would report every message as new on
// every load, and the caller would refresh the page forever.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { logActivity } from "@/lib/crm";

/** The sources this module owns. Nothing else writes them. */
const MIRROR_SOURCES = ["graph", "email_messages", "imessage"] as const;

export interface SyncLeadCommsResult {
  inserted: number;
  /**
   * Set when Outlook could not be reached. Never thrown: a stale delegated
   * token must degrade the email history, not break the lead page.
   */
  graphError?: string;
}

interface ContactRow {
  id: string;
  email: string | null;
  phone_last10: string | null;
  mobile_last10: string | null;
}

function key(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/** Graph and Postgres both hand back strings; anything unusable is skipped. */
function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Everything this module has already mirrored for one lead. */
async function loadSeen(contactId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("lead_activities")
    .select("source, external_id")
    .eq("contact_id", contactId)
    .in("source", MIRROR_SOURCES as unknown as string[])
    .not("external_id", "is", null)
    .limit(2000);

  const seen = new Set<string>();
  for (const r of data ?? []) {
    seen.add(key(r.source as string, r.external_id as string));
  }
  return seen;
}

// ─────────────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────────────

/**
 * Live Outlook history for an address.
 *
 * Uses the helper the TextWin extension's email-thread route already uses
 * (microsoft.searchMessagesWithAddress), which scans from/to/cc across ALL
 * folders including Sent Items — so mail typed by hand in Outlook is captured,
 * not only mail this app generated.
 */
async function mirrorGraphEmail(
  contact: ContactRow,
  seen: Set<string>
): Promise<{ inserted: number; error?: string }> {
  const address = (contact.email ?? "").trim();
  if (!address) return { inserted: 0 };

  let messages;
  try {
    messages = await microsoft.searchMessagesWithAddress(address);
  } catch (e) {
    return { inserted: 0, error: (e as Error).message };
  }

  const lower = address.toLowerCase();
  let inserted = 0;

  for (const m of messages) {
    if (!m.id || seen.has(key("graph", m.id))) continue;

    const occurredAt = isoOrNull(m.sentDateTime) ?? isoOrNull(m.receivedDateTime);
    if (!occurredAt) continue;

    // Inbound = the lead sent it. Anything else came from us.
    const fromAddr = (m.from?.emailAddress?.address ?? "").toLowerCase();
    const direction = fromAddr === lower ? "inbound" : "outbound";

    const id = await logActivity({
      contactId: contact.id,
      activityType: "email",
      direction,
      channel: "email",
      subject: m.subject || "(no subject)",
      body: m.bodyPreview || undefined,
      occurredAt,
      actor:
        direction === "inbound"
          ? m.from?.emailAddress?.name || address
          : undefined,
      source: "graph",
      externalId: m.id,
      externalModule: "Messages",
      metadata: { graph_conversation_id: m.conversationId ?? null },
    });

    if (id) {
      seen.add(key("graph", m.id));
      inserted += 1;
    }
  }

  return { inserted };
}

/**
 * Whatever the ingest pipeline already stored.
 *
 * Keyed on graph_message_id under source "graph", identical to the live read
 * above, so a message present in both places is logged once. A row with no
 * graph_message_id falls back to its own uuid under source "email_messages" —
 * that cannot collide with a Graph id, and the message is still better on the
 * timeline than absent.
 */
async function mirrorStoredEmail(
  contact: ContactRow,
  seen: Set<string>
): Promise<number> {
  const { data: convos } = await supabaseAdmin
    .from("email_conversations")
    .select("id")
    .eq("contact_id", contact.id);

  const convoIds = (convos ?? []).map((c) => c.id as string);
  if (convoIds.length === 0) return 0;

  const { data: rows } = await supabaseAdmin
    .from("email_messages")
    .select(
      "id, graph_message_id, direction, subject, text_preview, from_address, received_at, sent_at, created_at"
    )
    .in("conversation_id", convoIds)
    .order("created_at", { ascending: false })
    .limit(200);

  let inserted = 0;
  for (const r of rows ?? []) {
    const graphId = (r.graph_message_id as string | null) ?? null;
    const source = graphId ? "graph" : "email_messages";
    const externalId = graphId ?? (r.id as string);
    if (seen.has(key(source, externalId))) continue;

    const occurredAt =
      isoOrNull(r.sent_at as string | null) ??
      isoOrNull(r.received_at as string | null) ??
      isoOrNull(r.created_at as string | null);
    if (!occurredAt) continue;

    const id = await logActivity({
      contactId: contact.id,
      activityType: "email",
      direction: (r.direction as "inbound" | "outbound" | null) ?? undefined,
      channel: "email",
      subject: (r.subject as string | null) || "(no subject)",
      body: (r.text_preview as string | null) || undefined,
      occurredAt,
      actor: (r.from_address as string | null) || undefined,
      source,
      externalId,
      externalModule: "Messages",
    });

    if (id) {
      seen.add(key(source, externalId));
      inserted += 1;
    }
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────
// Texts
// ─────────────────────────────────────────────────────────────────────

/**
 * sms_conversations.contact_id is NULLABLE — a text from a number nobody has
 * matched yet stores under the bare phone. So conversations are found by
 * contact_id AND by phone last-10, and phone_last10 / mobile_last10 are checked
 * separately because they are not coalesced.
 *
 * Run as separate queries rather than one .or(): a LIKE pattern inside PostgREST's
 * or= grammar is exactly the kind of thing that silently matches nothing.
 */
async function findTextConversationIds(contact: ContactRow): Promise<string[]> {
  const ids = new Set<string>();

  const { data: byContact } = await supabaseAdmin
    .from("sms_conversations")
    .select("id")
    .eq("contact_id", contact.id);
  for (const c of byContact ?? []) ids.add(c.id as string);

  for (const last10 of [contact.phone_last10, contact.mobile_last10]) {
    if (!last10) continue;
    const { data: byPhone } = await supabaseAdmin
      .from("sms_conversations")
      .select("id")
      .ilike("phone", `%${last10}`);
    for (const c of byPhone ?? []) ids.add(c.id as string);
  }

  return [...ids];
}

async function mirrorTexts(contact: ContactRow, seen: Set<string>): Promise<number> {
  const convoIds = await findTextConversationIds(contact);
  if (convoIds.length === 0) return 0;

  const { data: rows } = await supabaseAdmin
    .from("sms_messages")
    .select("id, direction, body, sent_at, created_at")
    .in("conversation_id", convoIds)
    .order("created_at", { ascending: false })
    .limit(300);

  let inserted = 0;
  for (const r of rows ?? []) {
    const externalId = r.id as string;
    if (seen.has(key("imessage", externalId))) continue;

    const occurredAt =
      isoOrNull(r.sent_at as string | null) ?? isoOrNull(r.created_at as string | null);
    if (!occurredAt) continue;

    const id = await logActivity({
      contactId: contact.id,
      activityType: "sms",
      direction: (r.direction as "inbound" | "outbound" | null) ?? undefined,
      channel: "imessage",
      body: (r.body as string | null) || undefined,
      occurredAt,
      source: "imessage",
      externalId,
      externalModule: "Messages",
    });

    if (id) {
      seen.add(key("imessage", externalId));
      inserted += 1;
    }
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Pull this lead's emails and texts onto its timeline. Idempotent.
 *
 * Best-effort throughout: a failure in one channel must not cost the other two,
 * because a timeline missing its texts beats a lead page that renders nothing.
 */
export async function syncLeadComms(contactId: string): Promise<SyncLeadCommsResult> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, email, phone_last10, mobile_last10")
    .eq("id", contactId)
    .maybeSingle();

  if (!data) return { inserted: 0 };
  const contact = data as unknown as ContactRow;

  const seen = await loadSeen(contactId);
  let inserted = 0;
  let graphError: string | undefined;

  inserted += await mirrorStoredEmail(contact, seen).catch((e) => {
    console.error("[lead-comms] stored email failed:", (e as Error).message);
    return 0;
  });

  const live = await mirrorGraphEmail(contact, seen).catch((e) => ({
    inserted: 0,
    error: (e as Error).message,
  }));
  inserted += live.inserted;
  if (live.error) graphError = live.error;

  inserted += await mirrorTexts(contact, seen).catch((e) => {
    console.error("[lead-comms] texts failed:", (e as Error).message);
    return 0;
  });

  return graphError ? { inserted, graphError } : { inserted };
}
