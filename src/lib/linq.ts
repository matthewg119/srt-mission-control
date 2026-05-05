// Linq SMS API client (sandbox: +1-404-384-8588)
// API docs: https://api.linqapp.com/api/partner/v3
// Auth: Authorization: Bearer {LINQ_API_KEY}

const LINQ_API_BASE = process.env.LINQ_API_BASE || "https://api.linqapp.com/api/partner/v3";
const LINQ_FROM = process.env.LINQ_FROM_NUMBER || "+14043848588";

export interface LinqSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function linqSendSMS(to: string, body: string): Promise<LinqSendResult> {
  const apiKey = process.env.LINQ_API_KEY;
  if (!apiKey) {
    console.error("[Linq] LINQ_API_KEY not set");
    return { ok: false, error: "no_api_key" };
  }

  const toNorm = normalizePhone(to);
  if (!toNorm) {
    return { ok: false, error: `invalid_phone: ${to}` };
  }

  try {
    const res = await fetch(`${LINQ_API_BASE}/chats`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: LINQ_FROM,
        to: [toNorm],
        message: body,
      }),
    });

    const json = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      console.error("[Linq] send failed:", res.status, JSON.stringify(json));
      return { ok: false, error: `linq_${res.status}: ${JSON.stringify(json)}` };
    }

    const messageId = (json.id ?? json.message_id ?? json.chat_id) as string | undefined;
    return { ok: true, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[Linq] fetch error:", msg);
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
