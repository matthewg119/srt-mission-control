// LoopMessage iMessage API client
// Docs: https://docs-legacy.loopmessage.com/imessage-conversation-api/send-message
// Auth: dual-header — Authorization + Loop-Secret-Key
// Send endpoint: POST https://server.loopmessage.com/api/v1/message/send/

const LOOP_API_BASE = "https://server.loopmessage.com/api/v1";

export interface LoopSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const SENDERS = [
  process.env.LOOP_SENDER_1,
  process.env.LOOP_SENDER_2,
  process.env.LOOP_SENDER_3,
].filter(Boolean) as string[];

// Round-robin sender selection by a numeric index (conversation row count, etc.)
export function getNextSender(index: number): string {
  if (SENDERS.length === 0) throw new Error("[LoopMessage] No LOOP_SENDER_* env vars configured");
  return SENDERS[index % SENDERS.length];
}

export function getSenderCount(): number {
  return SENDERS.length;
}

export async function loopSendMessage(
  to: string,
  body: string,
  senderName: string
): Promise<LoopSendResult> {
  const authKey = process.env.LOOP_AUTH_KEY;
  const secretKey = process.env.LOOP_SECRET_KEY;

  if (!authKey || !secretKey) {
    console.error("[LoopMessage] LOOP_AUTH_KEY or LOOP_SECRET_KEY not set");
    return { ok: false, error: "no_api_key" };
  }

  const toNorm = normalizePhone(to);
  if (!toNorm) {
    return { ok: false, error: `invalid_phone: ${to}` };
  }

  try {
    const res = await fetch(`${LOOP_API_BASE}/message/send/`, {
      method: "POST",
      headers: {
        Authorization: authKey,
        "Loop-Secret-Key": secretKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient: toNorm,
        text: body,
        sender_name: senderName,
      }),
    });

    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      console.error("[LoopMessage] send failed:", res.status, JSON.stringify(json));
      return { ok: false, error: `loop_${res.status}: ${JSON.stringify(json)}` };
    }

    const messageId = (json.message_id ?? json.id) as string | undefined;
    return { ok: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[LoopMessage] fetch error:", msg);
    return { ok: false, error: msg };
  }
}

// Normalize phone to E.164 (+1XXXXXXXXXX for US)
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}
