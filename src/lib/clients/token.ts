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

/**
 * What a token is FOR.
 *
 * ‼️ ADDED 2026-08-25 AND THE ONBOARDING PAYLOAD IS BYTE-IDENTICAL TO WHAT IT ALWAYS WAS.
 * Every link already emailed keeps working, because the "onboarding" scope encodes exactly the
 * string it used to encode and nothing else. Only a NEW scope changes the payload shape.
 *
 * ‼️ IT FAILS CLOSED IN BOTH DIRECTIONS, which is the whole reason it exists rather than being
 * a second token scheme. An onboarding link cannot open a preview, and a preview link cannot
 * open the onboarding funnel and its business data. Verification takes the scope it EXPECTS and
 * refuses anything else with its own reason, so the two surfaces cannot be crossed by pasting.
 */
export type TokenScope = "onboarding" | "preview";

/**
 * The signed body for a scope.
 *
 * `onboarding` is `<clientId>.<expiresMs>`, unchanged. Anything else is
 * `<scope>:<clientId>.<expiresMs>`. A uuid contains no colon, so reading the scope back is
 * unambiguous, and a token minted before this existed decodes as onboarding by construction.
 */
function encodeBody(scope: TokenScope, clientId: string, expiresMs: number): string {
  const id = scope === "onboarding" ? clientId : `${scope}:${clientId}`;
  return Buffer.from(`${id}.${expiresMs}`).toString("base64url");
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
  ttlDays: number = ONBOARDING_TOKEN_TTL_DAYS,
  scope: TokenScope = "onboarding"
): SignedOnboardingToken {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const body = encodeBody(scope, clientId, expiresAt.getTime());
  return { token: `${body}.${mac(body)}`, expiresAt };
}

export type VerifyResult =
  | { ok: true; clientId: string; expiresAt: Date; scope: TokenScope }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "wrong_scope" };

/**
 * Signature first, expiry second. Checking expiry before the MAC would let an
 * unsigned token with a future timestamp reach the "valid but expired" branch, and
 * anything that distinguishes those two states for an attacker is worth avoiding.
 *
 * Scope is checked LAST, after the signature and the expiry, for the same reason: a caller
 * holding a valid token for the wrong surface has already proved they hold a valid token, so
 * the only new thing `wrong_scope` tells them is that they are on the wrong page.
 */
export function verifyOnboardingToken(
  token: string | null | undefined,
  expectedScope: TokenScope = "onboarding"
): VerifyResult {
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

  const idPart = decoded.slice(0, sep);
  const expiresMs = Number(decoded.slice(sep + 1));
  if (!idPart || !Number.isFinite(expiresMs)) return { ok: false, reason: "malformed" };

  const colon = idPart.indexOf(":");
  const scope = (colon < 0 ? "onboarding" : idPart.slice(0, colon)) as TokenScope;
  const clientId = colon < 0 ? idPart : idPart.slice(colon + 1);
  if (!clientId) return { ok: false, reason: "malformed" };

  if (Date.now() > expiresMs) {
    return { ok: false, reason: "expired" };
  }

  if (scope !== expectedScope) return { ok: false, reason: "wrong_scope" };

  return { ok: true, clientId, expiresAt: new Date(expiresMs), scope };
}
