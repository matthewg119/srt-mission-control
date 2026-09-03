// The transcript, and the three things that keep a public chat endpoint from being a faucet.
//
// ‼️ THE (signing_id, ordinal) UNIQUE CONSTRAINT IS THE IDEMPOTENCY GUARD AND IT COSTS NOTHING.
// The browser sends the ordinal it believes it is at; the INSERT is the claim. A double-tap on a
// flaky phone collides on the index and never reaches the model, so a retry is free rather than
// billed twice. concierge_messages makes the same move.

import { supabaseAdmin } from "@/lib/db";
import { maxTurnsPost, maxTurnsPre } from "./constants";
import type { Onboarding2SigningRow } from "./types";

export type ChatMode = "grounded" | "qualifying";

export interface ChatTurnRow {
  id: string;
  signing_id: string;
  created_at: string;
  role: "user" | "assistant";
  content: string;
  mode: ChatMode;
  ordinal: number;
  ip_hash: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

/**
 * The mode, decided by the row and never by the request.
 *
 * A client-sent mode would hand anybody the post-signature toolset, and there is no reason to
 * accept one. It is also STAMPED on each stored turn rather than derived at read time, because
 * it flips exactly once per session: re-deriving it later from the row's current signed_at would
 * relabel every pre-signature question as a qualifying answer the moment somebody signs.
 */
export function modeFor(row: Onboarding2SigningRow): ChatMode {
  return row.signed_at ? "qualifying" : "grounded";
}

export async function loadTurns(signingId: string): Promise<ChatTurnRow[]> {
  const { data } = await supabaseAdmin
    .from("onboarding2_chat_turns")
    .select("*")
    .eq("signing_id", signingId)
    .order("ordinal", { ascending: true });
  return (data as ChatTurnRow[]) ?? [];
}

/** The next free ordinal. Read from the rows, so it cannot drift from what is stored. */
export function nextOrdinal(turns: ChatTurnRow[]): number {
  return turns.length ? Math.max(...turns.map((t) => t.ordinal)) + 1 : 0;
}

/**
 * Append one turn.
 *
 * A 23505 means this ordinal is already taken, which is a replay. The caller stops rather than
 * calling the model, and the browser re-reads the transcript.
 */
export async function appendTurn(args: {
  signingId: string;
  role: "user" | "assistant";
  content: string;
  mode: ChatMode;
  ordinal: number;
  ipHash: string | null;
}): Promise<{ ok: boolean; duplicate: boolean }> {
  const { error } = await supabaseAdmin.from("onboarding2_chat_turns").insert({
    signing_id: args.signingId,
    role: args.role,
    content: args.content,
    mode: args.mode,
    ordinal: args.ordinal,
    ip_hash: args.ipHash,
  });
  if (!error) return { ok: true, duplicate: false };
  if (error.code === "23505") return { ok: true, duplicate: true };
  console.error("[onboarding2/chat-store] insert failed:", error.message);
  return { ok: false, duplicate: false };
}

/**
 * Per-signing turn budget, counted per mode.
 *
 * ‼️ THIS IS THE CAP THAT BOUNDS SPEND IF A SESSION TOKEN LEAKS. Every other guard on the chat
 * endpoint keys on IP, and somebody holding a stolen token arrives from wherever they like.
 * Counted per mode so a session that signs cannot re-spend the budget it used reading.
 */
export function overTurnCap(row: Onboarding2SigningRow, mode: ChatMode): boolean {
  return mode === "grounded"
    ? row.chat_turns_pre >= maxTurnsPre()
    : row.chat_turns_post >= maxTurnsPost();
}

/**
 * Bump the spend counter.
 *
 * ‼️ chat_turns_pre IS WRITTEN BY A RAW UPDATE AND NOT THROUGH patchOpenSigning. It has to be
 * writable before AND after signature: the pre counter belongs to an unsigned row and the post
 * counter to a signed one. That is why chat_turns_post is on patchDelivery's allowlist and this
 * function handles the pre side directly, on a row it has already checked is unsigned.
 */
export async function bumpTurnCount(row: Onboarding2SigningRow, mode: ChatMode): Promise<void> {
  const column = mode === "grounded" ? "chat_turns_pre" : "chat_turns_post";
  const current = mode === "grounded" ? row.chat_turns_pre : row.chat_turns_post;
  const { error } = await supabaseAdmin
    .from("onboarding2_signings")
    .update({ [column]: current + 1, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) console.error("[onboarding2/chat-store] turn count bump failed:", error.message);
}

/** Record a question the grounded assistant would not answer. The best copy feedback we get. */
export async function flagQuestion(row: Onboarding2SigningRow, question: string): Promise<void> {
  const next = [...(row.flagged_questions ?? []), question].slice(-50);
  const { error } = await supabaseAdmin
    .from("onboarding2_signings")
    .update({ flagged_questions: next, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) console.error("[onboarding2/chat-store] flag failed:", error.message);
}
