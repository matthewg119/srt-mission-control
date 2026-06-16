// LoopMessage transport — cloud iMessage send + inbound-webhook auth.
//
// LoopMessage (https://loopmessage.com) is a hosted iMessage API: it sends and
// receives real iMessages from a provisioned sender (our number, 336-833-2303)
// 24/7 with no Mac needed. It replaces the removed local LoopMessage transport
// and runs ALONGSIDE the Mac chat.db bridge (/api/imessage/inbound stays as a
// fallback). This module is the SEND side + a shared-secret check for inbound.
//
// All functions are defensive: sendImessage never throws — it returns
// { ok:false, error } on any failure and logs with a [loopmessage] prefix.
//
// ⚠️ VERIFY-AGAINST-DOCS: the endpoint, header names, and body field names below
// are implemented to LoopMessage's documented Conversation/Send API shape. If the
// account uses a different API tier confirm these three things before going live:
//   1) Send endpoint:  https://server.loopmessage.com/api/v1/message/send/
//   2) Auth headers:   Authorization: <LOOPMESSAGE_AUTH_KEY>
//                      Loop-Secret-Key: <LOOPMESSAGE_SECRET_KEY>
//   3) Send body:      { recipient, text, sender_name }  → response { message_id }
// Inbound webhook field names are documented in the route handler.

const LOOPMESSAGE_SEND_URL = "https://server.loopmessage.com/api/v1/message/send/";

export interface SendImessageArgs {
  to: string; // E.164 phone (+1XXXXXXXXXX) — LoopMessage `recipient`
  text: string;
}

export interface SendImessageResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an iMessage via LoopMessage. Never throws — returns { ok:false, error }
 * on any failure (missing config, network, non-2xx, unparseable body).
 */
export async function sendImessage(args: SendImessageArgs): Promise<SendImessageResult> {
  const { to, text } = args;

  const authKey = process.env.LOOPMESSAGE_AUTH_KEY;
  const secretKey = process.env.LOOPMESSAGE_SECRET_KEY;
  const senderName = process.env.LOOPMESSAGE_SENDER_NAME;

  if (!authKey || !secretKey || !senderName) {
    console.error("[loopmessage] missing LOOPMESSAGE_AUTH_KEY / LOOPMESSAGE_SECRET_KEY / LOOPMESSAGE_SENDER_NAME");
    return { ok: false, error: "loopmessage_not_configured" };
  }
  if (!to || !text?.trim()) {
    return { ok: false, error: "missing_recipient_or_text" };
  }

  try {
    const res = await fetch(LOOPMESSAGE_SEND_URL, {
      method: "POST",
      headers: {
        // LoopMessage auth: API key in Authorization (NOT a Bearer token) +
        // the secret in a custom Loop-Secret-Key header. ⚠️ VERIFY vs docs.
        Authorization: authKey,
        "Loop-Secret-Key": secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: to, // E.164 phone or Apple ID. ⚠️ VERIFY field name.
        text,
        sender_name: senderName, // the provisioned LoopMessage sender. ⚠️ VERIFY.
      }),
    });

    // LoopMessage returns the request id as `message_id` on success.
    const json = (await res.json().catch(() => ({}))) as {
      message_id?: string;
      error?: string;
      message?: string;
      success?: boolean;
    };

    if (!res.ok || json.success === false || json.error) {
      const error = json.error || json.message || `http_${res.status}`;
      console.error("[loopmessage] send failed:", error, JSON.stringify(json));
      return { ok: false, error };
    }

    return { ok: true, messageId: json.message_id };
  } catch (err) {
    const error = err instanceof Error ? err.message : "send_exception";
    console.error("[loopmessage] send exception:", error);
    return { ok: false, error };
  }
}

/**
 * Verify the inbound webhook shared secret. LoopMessage lets you set a webhook
 * Authorization value in the dashboard which it then sends back on every webhook
 * POST in the `Authorization` header. We also accept a `secret_key`/`webhook_key`
 * field in the JSON body as a fallback.
 *
 * ⚠️ VERIFY-AGAINST-DOCS: confirm whether your LoopMessage account sends the
 * configured value in the `Authorization` header (most common) or a body field.
 * Set LOOPMESSAGE_WEBHOOK_SECRET to that same value in the dashboard + env.
 */
export function verifyInboundSecret(
  headers: { get(name: string): string | null },
  body?: Record<string, unknown>
): boolean {
  const expected = process.env.LOOPMESSAGE_WEBHOOK_SECRET;
  // If no secret is configured, fail closed — never accept unauthenticated POSTs.
  if (!expected) {
    console.error("[loopmessage] LOOPMESSAGE_WEBHOOK_SECRET not set — rejecting inbound");
    return false;
  }

  // Header path: LoopMessage echoes the configured value in Authorization.
  const authHeader = headers.get("authorization");
  if (authHeader && (authHeader === expected || authHeader === `Bearer ${expected}`)) {
    return true;
  }

  // Body-field fallback (some configs deliver the secret in the payload).
  const fromBody =
    (body?.secret_key as string | undefined) ??
    (body?.webhook_key as string | undefined) ??
    (body?.secret as string | undefined);
  if (fromBody && fromBody === expected) return true;

  return false;
}
