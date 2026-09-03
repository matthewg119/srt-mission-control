// The signing session: minting one, loading one, and the three per-IP ledgers.
//
// SERVER ONLY. It imports node:crypto and supabaseAdmin, so it must never be reached from a
// client component. src/lib/onboarding2/canonical.ts is the isomorphic half and holds everything
// the browser needs.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { safeEqual } from "./canonical";
import { chatIpLimit, RATE_WINDOW_HOURS, signLimit, startLimit } from "./constants";
import type { Onboarding2SigningRow } from "./types";

/**
 * The bearer the browser holds for the whole session.
 *
 * ‼️ SEPARATE FROM THE ROW ID, ON PURPOSE. The id goes in a Slack card and into our own logs.
 * If the id were also the credential, pasting that card into a channel would hand anybody who
 * reads it write access to a half-signed contract. 32 bytes of CSPRNG, base64url so it survives
 * a query string without escaping.
 */
export function mintSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Load a signing by its token.
 *
 * The lookup is an indexed equality on a unique column, so it is the database that finds the
 * row. The constant-time compare afterwards is what stops the RESPONSE from varying with how
 * much of a guessed token was right; against a 256-bit random it is belt and braces, and it
 * costs one string walk.
 */
export async function loadByToken(token: string | null | undefined): Promise<Onboarding2SigningRow | null> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t || t.length > 128) return null;

  const { data } = await supabaseAdmin
    .from("onboarding2_signings")
    .select("*")
    .eq("session_token", t)
    .maybeSingle();

  if (!data) return null;
  const row = data as Onboarding2SigningRow;
  return safeEqual(row.session_token, t) ? row : null;
}

// ── The ledgers ─────────────────────────────────────────────────────────────
//
// All three count rows this funnel already writes rather than inserting a ledger row of their
// own. One less table, and a count that cannot drift from the thing it is counting.
//
// ‼️ EVERY CALLER MUST SET fetchCache = "force-no-store". `dynamic = "force-dynamic"` governs
// the route cache and does NOT cover supabase-js, which calls the global fetch that Next patches.
// A stale read here is the gate not existing.

function cutoff(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** New sessions from this IP in 24h. */
export async function overStartLimit(ipHash: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("onboarding2_signings")
    .select("id", { count: "exact", head: true })
    .eq("started_ip_hash", ipHash)
    .gte("created_at", cutoff(RATE_WINDOW_HOURS));
  return (count ?? 0) >= startLimit();
}

/** Completed signatures from this IP in 24h. */
export async function overSignLimit(ipHash: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("onboarding2_signings")
    .select("id", { count: "exact", head: true })
    .eq("signed_ip_hash", ipHash)
    .not("signed_at", "is", null)
    .gte("signed_at", cutoff(RATE_WINDOW_HOURS));
  return (count ?? 0) >= signLimit();
}

/**
 * User chat turns from this IP in the last hour.
 *
 * Counted off the turns table and not off the signing row, because the signing's own
 * started_ip_hash is where the session BEGAN. Somebody holding a leaked token arrives from
 * wherever they like, so the per-turn ip_hash is the only honest number here.
 */
export async function overChatIpLimit(ipHash: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("onboarding2_chat_turns")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("role", "user")
    .gte("created_at", cutoff(1));
  return (count ?? 0) >= chatIpLimit();
}

/**
 * Patch a signing, but only while it is still open.
 *
 * ‼️ THE .is("signed_at", null) IS THE LOCK AND IT IS NOT OPTIONAL. It is the same conditional
 * claim clients.provisioned_at uses, and it is what makes "mutable until signed, immutable
 * after" true rather than merely intended. There is no trigger enforcing it because this
 * database has no triggers anywhere, and one lone trigger is a rule nobody would think to look
 * for. `grep -rn 'is("signed_at", null)' src/lib/onboarding2/` must match every writer here.
 *
 * Returns null when the row was already signed, which every caller treats as "too late", never
 * as an error.
 */
export async function patchOpenSigning(
  id: string,
  patch: Record<string, unknown>
): Promise<Onboarding2SigningRow | null> {
  const { data, error } = await supabaseAdmin
    .from("onboarding2_signings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("signed_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[onboarding2/session] patch failed:", error.message);
    return null;
  }
  return (data as Onboarding2SigningRow) ?? null;
}

/**
 * Patch the delivery bookkeeping AFTER a signature.
 *
 * ‼️ THE ONLY WRITE PATH THAT MAY TOUCH A SIGNED ROW, AND IT HAS AN ALLOWLIST. These columns
 * record what happened TO the record, not what it says: which client it provisioned, where the
 * PDF landed, whether the emails went. Nothing here can reach the snapshot, the initials or a
 * typed field. The allowlist is checked at runtime rather than only in the type, because the
 * type is gone by the time this runs.
 */
const DELIVERY_COLUMNS = new Set([
  "client_id",
  "contact_id",
  "lead_id",
  "pdf_path",
  "pdf_sha256",
  "pdf_generated_at",
  "emailed_signer_at",
  "emailed_srt_at",
  "slack_channel",
  "slack_thread_ts",
  "chat_turns_post",
  "flagged_questions",
  "status",
]);

export async function patchDelivery(id: string, patch: Record<string, unknown>): Promise<void> {
  const bad = Object.keys(patch).filter((k) => !DELIVERY_COLUMNS.has(k));
  if (bad.length) {
    throw new Error(
      `[onboarding2] patchDelivery refused to write ${bad.join(", ")}. Those are part of the ` +
        `signed record, not delivery bookkeeping, and a signed row is immutable.`
    );
  }
  const { error } = await supabaseAdmin
    .from("onboarding2_signings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[onboarding2/session] delivery patch failed:", error.message);
}
