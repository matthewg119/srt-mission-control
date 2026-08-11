// The one-time-offer token.
//
// SERVER ONLY (node:crypto).
//
// The token is a bearer credential that, on ONE CLICK, charges a saved card $299 a
// month and consumes one of five founding seats that cannot be re-created without
// breaking a public promise. So it is not slug obscurity like /r/[slug]: it is
// HMAC-signed, single use, and short lived.
//
// DETERMINISTIC, not random, and that is load-bearing. An order is provisioned by two
// independent paths that race: the client confirm endpoint and the Stripe webhook.
// With randomBytes, whichever loses would either mint a SECOND live token or have to
// read back a plaintext that was never stored (only its hash is). An HMAC over
// immutable order fields makes both paths derive byte-identical strings, so the
// insert is `on conflict do nothing` and double-issue is impossible by construction.
//
// issuedAt is pinned to the order's created_at, NEVER Date.now(), because that is
// what makes the two paths agree.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";

const DEFAULT_TTL_MINUTES = 30;

export function otoTtlMinutes(): number {
  const raw = Number(process.env.OTO_TOKEN_TTL_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MINUTES;
}

function secret(): string {
  const s = process.env.MEDSPA_LINK_SECRET;
  if (!s) throw new Error("MEDSPA_LINK_SECRET is not set.");
  return s;
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** What is stored. The plaintext lives only in the URL and the receipt email. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** `<b64url(orderId)>.<b64url(issuedAtMs)>.<mac>` */
export function signOtoToken(orderId: string, orderCreatedAt: string): string {
  const issuedAt = new Date(orderCreatedAt).getTime();
  const body = `${b64url(orderId)}.${b64url(String(issuedAt))}`;
  return `${body}.${mac(body)}`;
}

export type OtoVerdict =
  | { ok: true; orderId: string; issuedAt: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify signature and expiry WITHOUT touching the database.
 *
 * Expiry is derived from the signed issuedAt, so an expired or forged token costs
 * zero round trips. expires_at is also stored on the row, for sweeping and for
 * humans reading the table.
 */
export function verifyOtoToken(token: string | null | undefined): OtoVerdict {
  if (!token) return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [idPart, issuedPart, sig] = parts;
  if (!idPart || !issuedPart || !sig) return { ok: false, reason: "malformed" };

  let expected: string;
  try {
    expected = mac(`${idPart}.${issuedPart}`);
  } catch {
    return { ok: false, reason: "bad_signature" }; // secret missing: fail closed
  }

  // Length-check first: timingSafeEqual THROWS on a length mismatch rather than
  // returning false.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "bad_signature" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  let orderId: string;
  let issuedAt: number;
  try {
    orderId = Buffer.from(idPart, "base64url").toString("utf8");
    issuedAt = Number(Buffer.from(issuedPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!orderId || !Number.isFinite(issuedAt)) return { ok: false, reason: "malformed" };

  const ttl = otoTtlMinutes();
  if (Date.now() > issuedAt + ttl * 60_000) return { ok: false, reason: "expired" };

  return { ok: true, orderId, issuedAt };
}

/**
 * Record the token. Runs on BOTH the provisioning winner and the loser, so the loser
 * can still hand the token back to its caller.
 */
export async function persistOtoToken(params: {
  token: string;
  orderId: string;
  email: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + otoTtlMinutes() * 60_000).toISOString();
  const { error } = await supabaseAdmin.from("medspa_oto_tokens").upsert(
    {
      token_hash: hashToken(params.token),
      order_id: params.orderId,
      email: params.email,
      expires_at: expiresAt,
    },
    { onConflict: "token_hash", ignoreDuplicates: true }
  );
  if (error) {
    console.error("[medspa/oto] persist failed:", error.message);
  }
}

/**
 * Spend the token. `used_at` null -> now() is the claim: exactly one winner, no
 * advisory lock, and a double-clicked button cannot create two subscriptions.
 */
export async function claimOtoToken(token: string): Promise<{ ok: true; orderId: string } | { ok: false }> {
  const { data } = await supabaseAdmin
    .from("medspa_oto_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .select("order_id")
    .maybeSingle();

  if (!data) return { ok: false };
  return { ok: true, orderId: data.order_id as string };
}

/** Undo a claim when the thing it was claimed for never happened. */
export async function releaseOtoToken(token: string): Promise<void> {
  await supabaseAdmin
    .from("medspa_oto_tokens")
    .update({ used_at: null })
    .eq("token_hash", hashToken(token));
}

/** How many founding seats are genuinely still available. */
export async function foundingSeatsLeft(): Promise<number> {
  const { count } = await supabaseAdmin
    .from("medspa_founding_slots")
    .select("slot_no", { count: "exact", head: true })
    .is("claimed_by", null);
  return count ?? 0;
}
