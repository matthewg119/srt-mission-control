// Row access for the Follow-Up Operator. Every write that represents something
// that actually happened goes through logTouch, which is append-only: unlike
// audit_reports.pending_drafts, nothing here is ever overwritten.

import { supabaseAdmin } from "@/lib/db";
import {
  PROSPECT_COLUMNS,
  type OutreachProspectRow,
  type OutreachTouchRow,
  type TouchChannel,
  type TouchDirection,
} from "./types";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function getProspectByEmail(email: string): Promise<OutreachProspectRow | null> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("email", normalizeEmail(email))
    .maybeSingle();
  return (data as OutreachProspectRow | null) ?? null;
}

export async function getProspectByConversation(conversationId: string): Promise<OutreachProspectRow | null> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  return (data as OutreachProspectRow | null) ?? null;
}

export async function getProspectByThread(threadTs: string): Promise<OutreachProspectRow | null> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("slack_thread_ts", threadTs)
    .maybeSingle();
  return (data as OutreachProspectRow | null) ?? null;
}

export async function getProspectById(id: string): Promise<OutreachProspectRow | null> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as OutreachProspectRow | null) ?? null;
}

export interface CreateProspectInput {
  email: string;
  name?: string | null;
  company?: string | null;
  website?: string | null;
  city?: string | null;
  phone?: string | null;
  audit_report_id?: string | null;
  contact_id?: string | null;
  source?: "audit" | "outlook_sweep" | "manual";
  confirmed?: boolean;
}

/**
 * Create a prospect, or return the existing row for that address.
 *
 * The lower(email) unique index is what makes the sent-mail sweep safe to run
 * on an overlapping window: a second sighting of the same recipient resolves to
 * the same row instead of a duplicate pipeline.
 */
export async function upsertProspect(input: CreateProspectInput): Promise<OutreachProspectRow | null> {
  const email = normalizeEmail(input.email);
  const existing = await getProspectByEmail(email);
  if (existing) {
    // Fill blanks only. A sweep must never overwrite what the audit knows.
    const patch: Record<string, unknown> = {};
    if (!existing.name && input.name) patch.name = input.name;
    if (!existing.company && input.company) patch.company = input.company;
    if (!existing.website && input.website) patch.website = input.website;
    if (!existing.city && input.city) patch.city = input.city;
    if (!existing.phone && input.phone) patch.phone = input.phone;
    if (!existing.audit_report_id && input.audit_report_id) patch.audit_report_id = input.audit_report_id;
    if (!existing.contact_id && input.contact_id) patch.contact_id = input.contact_id;
    if (!existing.confirmed && input.confirmed) patch.confirmed = true;
    if (!Object.keys(patch).length) return existing;
    return updateProspect(existing.id, patch);
  }

  const { data, error } = await supabaseAdmin
    .from("outreach_prospects")
    .insert({
      email,
      name: input.name ?? null,
      company: input.company ?? null,
      website: input.website ?? null,
      city: input.city ?? null,
      phone: input.phone ?? null,
      audit_report_id: input.audit_report_id ?? null,
      contact_id: input.contact_id ?? null,
      source: input.source ?? "outlook_sweep",
      confirmed: input.confirmed ?? false,
    })
    .select(PROSPECT_COLUMNS)
    .maybeSingle();

  if (error) {
    // A concurrent insert lost the race against the unique index. Read it back.
    console.error("[followup] upsertProspect:", error.message);
    return getProspectByEmail(email);
  }
  return (data as OutreachProspectRow | null) ?? null;
}

export async function updateProspect(
  id: string,
  patch: Record<string, unknown>
): Promise<OutreachProspectRow | null> {
  const { data, error } = await supabaseAdmin
    .from("outreach_prospects")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(PROSPECT_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("[followup] updateProspect:", error.message);
    return null;
  }
  return (data as OutreachProspectRow | null) ?? null;
}

export interface LogTouchInput {
  prospect_id: string;
  direction: TouchDirection;
  channel: TouchChannel;
  step?: number | null;
  subject?: string | null;
  body?: string | null;
  outcome?: string | null;
  graph_message_id?: string | null;
  conversation_id?: string | null;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append one touch. Returns false when this exact Graph message was already
 * recorded, which is the sweep's signal to leave the clock alone: the unique
 * partial index on graph_message_id turns a re-read window into a no-op.
 */
export async function logTouch(input: LogTouchInput): Promise<boolean> {
  const body = input.body ? input.body.slice(0, 8000) : null;
  const { data, error } = await supabaseAdmin
    .from("outreach_touches")
    .upsert(
      {
        prospect_id: input.prospect_id,
        direction: input.direction,
        channel: input.channel,
        step: input.step ?? null,
        subject: input.subject ?? null,
        body,
        outcome: input.outcome ?? null,
        graph_message_id: input.graph_message_id ?? null,
        conversation_id: input.conversation_id ?? null,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        metadata: input.metadata ?? {},
      },
      { onConflict: "graph_message_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error("[followup] logTouch:", error.message);
    return false;
  }
  // ignoreDuplicates returns zero rows when the message was already logged.
  return (data ?? []).length > 0;
}

export async function listTouches(prospectId: string, limit = 40): Promise<OutreachTouchRow[]> {
  const { data } = await supabaseAdmin
    .from("outreach_touches")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data as OutreachTouchRow[] | null) ?? [];
}

/** Everything due on or before `at`, oldest first. Unconfirmed and paused rows
 *  are excluded by the query, never by the caller. */
export async function listDueProspects(at = new Date()): Promise<OutreachProspectRow[]> {
  const { data, error } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("confirmed", true)
    .eq("paused", false)
    .neq("state", "CLOSED")
    .not("next_touch_at", "is", null)
    .lte("next_touch_at", at.toISOString())
    .order("next_touch_at", { ascending: true });
  if (error) {
    console.error("[followup] listDueProspects:", error.message);
    return [];
  }
  return (data as unknown as OutreachProspectRow[] | null) ?? [];
}

/** Scheduled, but not yet. Powers the WAITING section. */
export async function listWaitingProspects(at = new Date(), limit = 100): Promise<OutreachProspectRow[]> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("confirmed", true)
    .eq("paused", false)
    .neq("state", "CLOSED")
    .gt("next_touch_at", at.toISOString())
    .order("next_touch_at", { ascending: true })
    .limit(limit);
  return (data as unknown as OutreachProspectRow[] | null) ?? [];
}

/** Addresses the sweep picked up that nobody has vouched for yet. */
export async function listUnconfirmedProspects(limit = 25): Promise<OutreachProspectRow[]> {
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("confirmed", false)
    .eq("paused", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as unknown as OutreachProspectRow[] | null) ?? [];
}
