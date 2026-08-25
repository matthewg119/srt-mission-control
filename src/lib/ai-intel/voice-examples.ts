import { microsoft, type GraphMessage } from "@/lib/microsoft";
import { MATTHEW } from "@/config/rep-profile";

// ── Voice learning ─────────────────────────────────────────────────────────
// Pulls Matt's recent merchant-facing sent emails from MS Graph so Claude can
// learn his tone. We cache in-memory with a 30-minute TTL so a burst of drafts
// shares one Graph fetch without going stale. (This used to be justified by the
// 4-hourly ai-guardian cron, which no longer exists; the callers now are
// email-director and followup-director.)

interface CachedExamples {
  examples: VoiceExample[];
  fetchedAt: number;
}

export interface VoiceExample {
  subject: string;
  body: string;
  to_domain: string;
  sent_at: string;
}

const TTL_MS = 30 * 60 * 1000;
const FUNDER_KEYWORDS = [
  "funding", "capital", "lender", "legend", "vox", "newco",
  "kalamata", "bhb", "kapitus", "idea", "loan", "submissions",
  "broker", "isodata", "upfront",
];

let _cache: CachedExamples | null = null;

function isMerchantDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (d === "srtagency.com") return false;
  if (FUNDER_KEYWORDS.some((k) => d.includes(k))) return false;
  return true;
}

function stripSignatureAndQuotes(body: string): string {
  // Truncate at common reply/signature markers so we learn voice, not boilerplate.
  const markers = [
    /\n-- ?\n/, // standard sig marker
    /\nSent from /i,
    /\n-----Original Message-----/,
    /\nFrom: .+\nSent: /,
    /\nOn .+wrote:/,
    /\nMatthew Gabriel\n/,
  ];
  let trimmed = body;
  for (const m of markers) {
    const idx = trimmed.search(m);
    if (idx > 0 && idx < trimmed.length) trimmed = trimmed.slice(0, idx);
  }
  return trimmed.trim();
}

/**
 * Fetch Matt's recent sent emails to merchants (non-funder domains) as
 * few-shot examples for Claude. Cached for 30 minutes.
 */
export async function getMattVoiceExamples(maxExamples = 8): Promise<VoiceExample[]> {
  if (_cache && Date.now() - _cache.fetchedAt < TTL_MS) {
    return _cache.examples.slice(0, maxExamples);
  }

  const matthewEmail = MATTHEW.email;
  if (!matthewEmail) return [];

  const out: VoiceExample[] = [];
  const seen = new Set<string>();

  try {
    const sinceISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const filter = `sentDateTime ge ${sinceISO}`;

    let scanned = 0;
    for await (const msg of microsoft.listMessages({
      mailbox: matthewEmail,
      folder: "sentitems",
      filter,
      top: 50,
      select: ["id", "conversationId", "subject", "toRecipients", "sentDateTime", "bodyPreview"],
    }) as AsyncIterable<GraphMessage & { sentDateTime?: string }>) {
      scanned++;
      if (scanned > 100) break; // hard cap
      if (out.length >= maxExamples) break;

      const recip = msg.toRecipients?.[0]?.emailAddress?.address ?? "";
      const domain = recip.split("@")[1]?.toLowerCase() ?? "";
      if (!isMerchantDomain(domain)) continue;
      if (seen.has(msg.conversationId)) continue;
      seen.add(msg.conversationId);

      // bodyPreview is ~255 chars plaintext — usually enough for tone.
      const cleaned = stripSignatureAndQuotes(msg.bodyPreview || "");
      if (cleaned.length < 40) continue; // skip too-short replies like "thanks"

      out.push({
        subject: msg.subject || "(no subject)",
        body: cleaned.slice(0, 700),
        to_domain: domain,
        sent_at: (msg as { sentDateTime?: string }).sentDateTime ?? "",
      });
    }
  } catch (e) {
    console.error("[voice-examples] MS Graph fetch failed:", (e as Error).message);
  }

  _cache = { examples: out, fetchedAt: Date.now() };
  return out.slice(0, maxExamples);
}

/**
 * Render the few-shot examples as a compact system-prompt fragment.
 */
export function renderVoiceExamplesForPrompt(examples: VoiceExample[]): string {
  if (examples.length === 0) {
    return "No prior examples available — write in a direct, warm, first-person tone signed 'Matt'.";
  }
  const rendered = examples
    .map(
      (ex, i) =>
        `--- Example ${i + 1} (sent to ${ex.to_domain}) ---\nSubject: ${ex.subject}\n${ex.body}`
    )
    .join("\n\n");
  return `Below are real emails Matt has sent to merchants recently. Mirror the tone, sentence length, and vocabulary. Do NOT copy specific content — match the voice.\n\n${rendered}`;
}
