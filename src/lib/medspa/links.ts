// Signed access links for /webflow-Aivisibility.
//
// SERVER ONLY. This imports node:crypto, so importing it from a client component
// fails the browser bundle with "Module not found" and tsc will not warn you. The
// client never needs it: pages receive an already-verified result from the server.
//
// The training page is not public. Its URL carries an HMAC over the opt-in id, so a
// link forwarded to a colleague converts that colleague through the opt-in form
// rather than leaking the training. Stateless by design: no DB read to render the
// page, and no expiry, because a training seat someone earned should not evaporate.
//
// The same secret signs the Phase 2 OTO token. Rotating MEDSPA_LINK_SECRET therefore
// invalidates every outstanding training link AND every unspent OTO link at once, so
// rotate it only deliberately.

import crypto from "crypto";

function secret(): string {
  const s = process.env.MEDSPA_LINK_SECRET;
  if (!s) {
    throw new Error(
      "MEDSPA_LINK_SECRET is not set. Generate 32+ random bytes and set it on the Vercel project."
    );
  }
  return s;
}

export function isLinkSecretConfigured(): boolean {
  return Boolean(process.env.MEDSPA_LINK_SECRET);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `<b64url(optinId)>.<mac>`. Opaque to the reader, cheap to verify. */
export function signAccess(optinId: string): string {
  const body = b64url(optinId);
  return `${body}.${mac(body)}`;
}

export function verifyAccess(token: string | null | undefined): { ok: true; optinId: string } | { ok: false } {
  if (!token) return { ok: false };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };

  const [body, sig] = parts;
  if (!body || !sig) return { ok: false };

  let expected: string;
  try {
    expected = mac(body);
  } catch {
    // Secret missing. Fail closed rather than letting an unsigned link through.
    return { ok: false };
  }

  // Constant time, and length-checked first because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false };

  let optinId: string;
  try {
    optinId = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return { ok: false };
  }
  if (!optinId) return { ok: false };

  return { ok: true, optinId };
}
