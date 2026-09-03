// The visitor's session: minting one, loading one, and the two ledgers it carries.
//
// SERVER ONLY. Imports node:crypto and supabaseAdmin.
//
// ‼️ THE SESSION IS THE CREDENTIAL AND IT IS NOT THE ROW ID. Same call onboarding2/session.ts made:
// the id goes into cards and logs, so if it were also the bearer, pasting a card into a channel
// would hand the reader somebody else's conversation.
//
// ‼️ THE AMMO LEDGER IS SEEDED FROM THE EMAIL LANE, AND THAT IS THE WHOLE NO-REPEAT GUARANTEE.
// Without the seed the widget and the follow-up operator are two mouths with separate memories, and
// the first thing a visitor who was already emailed would hear is the argument they were already
// sent. spentAmmo() reads the session column and the prospect column with the same parser because
// the shapes are deliberately identical.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { spentAmmo, ammoKey } from "@/lib/ammo/spend";
import type { AmmoCandidate } from "@/lib/ammo/supply";
import type { AmmoSpent } from "@/lib/followup-operator/types";

/** 32 bytes of CSPRNG, base64url so it survives a query string without escaping. */
export function mintSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface ConciergeSession {
  id: string;
  clientId: string;
  sessionToken: string;
  pageCategory: string | null;
  entryPageId: string | null;
  entryPath: string | null;
  contactId: string | null;
  firstName: string | null;
  email: string | null;
  phone: string | null;
  ammoUsed: AmmoSpent[];
  magnetsDelivered: string[];
  turns: number;
  outcome: string;
  bookingClickedAt: string | null;
}

const SESSION_COLUMNS =
  "id, client_id, session_token, page_category, entry_page_id, entry_path, contact_id, " +
  "first_name, email, phone, ammo_used, magnets_delivered, turns, outcome, booking_clicked_at";

function toSession(row: Record<string, unknown>): ConciergeSession {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    sessionToken: String(row.session_token),
    pageCategory: str(row.page_category),
    entryPageId: str(row.entry_page_id),
    entryPath: str(row.entry_path),
    contactId: str(row.contact_id),
    firstName: str(row.first_name),
    email: str(row.email),
    phone: str(row.phone),
    ammoUsed: spentAmmo(row as { ammo_used?: unknown }),
    magnetsDelivered: Array.isArray(row.magnets_delivered)
      ? (row.magnets_delivered as unknown[]).filter((k): k is string => typeof k === "string" && !!k)
      : [],
    turns: typeof row.turns === "number" ? row.turns : 0,
    outcome: typeof row.outcome === "string" ? row.outcome : "open",
    bookingClickedAt: str(row.booking_clicked_at),
  };
}

/**
 * Everything the email lane has already said to this person.
 *
 * Best effort by design. A visitor with no contact, no prospect row or a malformed ledger simply
 * starts empty: the cost of failing open here is one repeated line, and the cost of throwing is a
 * widget that will not open.
 */
export async function seedAmmoFromProspect(contactId: string | null): Promise<AmmoSpent[]> {
  if (!contactId) return [];
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select("ammo_used")
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return spentAmmo(data as { ammo_used?: unknown } | null);
}

export interface StartSessionArgs {
  clientId: string;
  entryHost: string | null;
  entryPath: string | null;
  entryPageId: string | null;
  pageCategory: string | null;
  embedOrigin: string | null;
  ipHash: string | null;
  userAgent: string | null;
  contactId?: string | null;
}

export async function startConciergeSession(args: StartSessionArgs): Promise<ConciergeSession | null> {
  const token = mintSessionToken();
  const seeded = await seedAmmoFromProspect(args.contactId ?? null);

  const { data, error } = await supabaseAdmin
    .from("concierge_sessions")
    .insert({
      client_id: args.clientId,
      session_token: token,
      entry_host: args.entryHost,
      entry_path: args.entryPath,
      entry_page_id: args.entryPageId,
      page_category: args.pageCategory,
      embed_origin: args.embedOrigin,
      ip_hash: args.ipHash,
      user_agent: args.userAgent,
      contact_id: args.contactId ?? null,
      ammo_used: seeded,
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`[concierge] startSession: ${error?.message ?? "insert returned nothing"}`);
    return null;
  }
  return toSession(data as unknown as Record<string, unknown>);
}

export async function loadConciergeSession(token: string | null | undefined): Promise<ConciergeSession | null> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length > 128) return null;

  const { data } = await supabaseAdmin
    .from("concierge_sessions")
    .select(SESSION_COLUMNS)
    .eq("session_token", t)
    .maybeSingle();

  return data ? toSession(data as unknown as Record<string, unknown>) : null;
}

/**
 * Append to the session's ammo ledger.
 *
 * Idempotent on ammoKey, exactly as recordAmmoSpent is on the prospect row: spending the same line
 * twice is a caller bug, not a reason to grow the ledger and make a fresh argument look used.
 */
export async function recordSessionAmmo(
  session: ConciergeSession,
  ammo: AmmoCandidate,
  step: number
): Promise<AmmoSpent[]> {
  const key = ammoKey(ammo);
  if (session.ammoUsed.some((a) => ammoKey(a) === key)) return session.ammoUsed;

  const next: AmmoSpent[] = [...session.ammoUsed, { kind: ammo.kind, detail: ammo.detail, step }];
  const { error } = await supabaseAdmin
    .from("concierge_sessions")
    .update({ ammo_used: next, updated_at: new Date().toISOString() })
    .eq("id", session.id);

  if (error) {
    console.error(`[concierge] recordSessionAmmo: ${error.message}`);
    return session.ammoUsed;
  }
  session.ammoUsed = next;
  return next;
}

/** Mark a magnet as handed over. The chaining gate counts this array and nothing else. */
export async function recordDelivered(
  session: ConciergeSession,
  magnetKey: string,
  magnetId: string
): Promise<string[]> {
  if (session.magnetsDelivered.includes(magnetKey)) return session.magnetsDelivered;

  const next = [...session.magnetsDelivered, magnetKey];
  const { error } = await supabaseAdmin
    .from("concierge_sessions")
    .update({
      magnets_delivered: next,
      // magnet_id records the ONE magnet attributed to the outcome, so the FIRST one delivered
      // wins: it is the thing that actually pulled them in.
      ...(session.magnetsDelivered.length === 0 ? { magnet_id: magnetId, magnet_sent_at: new Date().toISOString() } : {}),
      outcome: session.outcome === "open" ? "magnet" : session.outcome,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  if (error) {
    console.error(`[concierge] recordDelivered: ${error.message}`);
    return session.magnetsDelivered;
  }
  session.magnetsDelivered = next;
  return next;
}

export async function markBookingClicked(session: ConciergeSession): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("concierge_sessions")
    .update({ booking_clicked_at: now, outcome: "booked", updated_at: now })
    .eq("id", session.id);
  session.bookingClickedAt = now;
  session.outcome = "booked";
}

export async function captureLead(
  session: ConciergeSession,
  fields: { firstName?: string | null; email?: string | null; phone?: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.firstName) patch.first_name = fields.firstName;
  if (fields.email) patch.email = fields.email;
  if (fields.phone) patch.phone = fields.phone;
  if (session.outcome === "open") patch.outcome = "captured";

  await supabaseAdmin.from("concierge_sessions").update(patch).eq("id", session.id);
  if (fields.firstName) session.firstName = fields.firstName;
  if (fields.email) session.email = fields.email;
  if (fields.phone) session.phone = fields.phone;
}

export interface ConciergeMessage {
  role: "user" | "assistant";
  content: string;
  ordinal: number;
}

/**
 * The conversation so far, rebuilt SERVER SIDE from the message table.
 *
 * ‼️ ANYTHING THE CLIENT SENDS AS A MESSAGE LIST IS IGNORED, including any system role it tries to
 * smuggle in. Same rule onboarding2's chat route states outright. The browser holds a token, not a
 * transcript.
 */
export async function loadMessages(sessionId: string): Promise<ConciergeMessage[]> {
  const { data } = await supabaseAdmin
    .from("concierge_messages")
    .select("role, content, ordinal")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("ordinal", { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof r.content === "string" ? r.content : "",
      ordinal: typeof r.ordinal === "number" ? r.ordinal : 0,
    }))
    .filter((m) => m.content.length > 0);
}

/**
 * Append one message.
 *
 * ‼️ THE (session_id, ordinal) UNIQUE CONSTRAINT IS FREE IDEMPOTENCY AND IT IS LOAD BEARING. A
 * double-submitted turn collides on the ordinal and the second insert is refused by the database
 * rather than producing a duplicate the model then reads back as the visitor saying it twice.
 * Returns false when the ordinal was already taken, which the caller reads as "already handled".
 */
export async function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  ordinal: number
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("concierge_messages")
    .insert({ session_id: sessionId, role, content, ordinal });

  if (!error) return true;
  // 23505 is unique_violation: the turn is already recorded.
  if (error.code === "23505") return false;
  console.error(`[concierge] appendMessage: ${error.message}`);
  return false;
}

/**
 * Count the turn and add this turn's spend to the running totals.
 *
 * ‼️ ACCUMULATES, NEVER OVERWRITES. llm_input_tokens is the session's whole cost, and assigning
 * this turn's figure would make every session report the price of its last message. The read is
 * fresh rather than taken from the in-memory row so a concurrent turn cannot roll the total back.
 */
export async function bumpTurns(
  session: ConciergeSession,
  inputTokens = 0,
  outputTokens = 0
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("concierge_sessions")
    .select("turns, llm_input_tokens, llm_output_tokens")
    .eq("id", session.id)
    .maybeSingle();

  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from("concierge_sessions")
    .update({
      turns: num(data?.turns) + 1,
      llm_input_tokens: num(data?.llm_input_tokens) + inputTokens,
      llm_output_tokens: num(data?.llm_output_tokens) + outputTokens,
      last_seen_at: now,
      updated_at: now,
    })
    .eq("id", session.id);

  session.turns = num(data?.turns) + 1;
}
