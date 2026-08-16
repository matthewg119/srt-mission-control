// Onboarding links for /onboarding.
//
// SERVER ONLY. This imports node:crypto, so importing it from a client component fails
// the browser bundle with "Module not found" and tsc will not warn you. The funnel's
// client components receive an already-verified clientId from the server.
//
// Built on the same construction as src/lib/medspa/links.ts (base64url payload, HMAC,
// length-check then timingSafeEqual, fail closed on a missing secret) with ONE
// difference: this token expires. links.ts is deliberately expiry-free because a
// training seat someone paid for should not evaporate. An onboarding link is the
// opposite: it carries a clinic's business data behind it, it is emailed once, and
// PILOT §5 puts a 30-day life on it.
//
// The expiry is INSIDE the signed payload, not alongside it, so it cannot be edited in
// the address bar. The stored hash on clients.onboarding_token_hash is what lets a
// token be revoked early (clear the column) without rotating the secret for everyone.

import crypto from "crypto";

/** PILOT §5: "onboarding token, 30-day expiry". */
export const ONBOARDING_TOKEN_TTL_DAYS = 30;

function secret(): string {
  const s = process.env.CLIENT_LINK_SECRET;
  if (!s) {
    throw new Error(
      "CLIENT_LINK_SECRET is not set. Generate 32+ random bytes and set it on the Vercel project."
    );
  }
  return s;
}

export function isClientLinkSecretConfigured(): boolean {
  return Boolean(process.env.CLIENT_LINK_SECRET);
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** SHA-256 of the token. This, not the token, is what the database holds. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface SignedOnboardingToken {
  token: string;
  expiresAt: Date;
}

/**
 * `<b64url(clientId.expiresAtMs)>.<mac>`
 *
 * Throws when the secret is unset, because a caller that silently got no link would
 * send a welcome email with no way in.
 */
export function signOnboardingToken(
  clientId: string,
  ttlDays: number = ONBOARDING_TOKEN_TTL_DAYS
): SignedOnboardingToken {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const body = Buffer.from(`${clientId}.${expiresAt.getTime()}`).toString("base64url");
  return { token: `${body}.${mac(body)}`, expiresAt };
}

export type VerifyResult =
  | { ok: true; clientId: string; expiresAt: Date }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

/**
 * Signature first, expiry second. Checking expiry before the MAC would let an
 * unsigned token with a future timestamp reach the "valid but expired" branch, and
 * anything that distinguishes those two states for an attacker is worth avoiding.
 */
export function verifyOnboardingToken(token: string | null | undefined): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  const [body, sig] = parts;
  if (!body || !sig) return { ok: false, reason: "malformed" };

  let expected: string;
  try {
    expected = mac(body);
  } catch {
    // Secret missing. Fail closed rather than letting an unsigned link through.
    return { ok: false, reason: "bad_signature" };
  }

  // Constant time, length-checked first because timingSafeEqual THROWS on a length
  // mismatch rather than returning false.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "bad_signature" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  let decoded: string;
  try {
    decoded = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const sep = decoded.lastIndexOf(".");
  if (sep < 1) return { ok: false, reason: "malformed" };

  const clientId = decoded.slice(0, sep);
  const expiresMs = Number(decoded.slice(sep + 1));
  if (!clientId || !Number.isFinite(expiresMs)) return { ok: false, reason: "malformed" };

  if (Date.now() > expiresMs) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, clientId, expiresAt: new Date(expiresMs) };
}
