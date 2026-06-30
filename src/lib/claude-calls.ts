const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ClaudeModel =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

export interface ClaudeImageInput {
  media_type: string; // e.g. "image/png"
  data: string; // base64, no data: prefix
}

export interface ClaudeDocumentInput {
  media_type: string; // currently only "application/pdf"
  data: string; // base64, no data: prefix
  title?: string;
}

export interface ClaudeJSONOptions<T> {
  model: ClaudeModel;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  schemaHint?: string;
  /** Optional images to send alongside the user text (vision). */
  images?: ClaudeImageInput[];
  /** Optional PDF document blocks read natively by Claude (e.g. uploaded kits). */
  documents?: ClaudeDocumentInput[];
  validate?: (parsed: unknown) => parsed is T;
  /**
   * Ordered list of models to try. The primary `model` is always tried first;
   * any models here are tried (with full retry) only after the primary is
   * exhausted on a transient error. Defaults to a Haiku fallback.
   */
  fallbackModels?: ClaudeModel[];
}

// --- Transient-error retry + model fallback ---------------------------------
// Anthropic returns 529 ("overloaded") and 429 ("rate limited") as transient
// "retry me shortly" signals. A single fetch with no retry turns those into hard
// user-facing failures (dropped reel variations, missing captions, etc.). Every
// Claude call in the app flows through the helpers below, so retrying here fixes
// all of them at once.

const DEFAULT_FALLBACK_MODEL: ClaudeModel = "claude-haiku-4-5-20251001";
const MAX_ATTEMPTS_PER_MODEL = 5;
const BASE_DELAY_MS = 600;
const MAX_DELAY_MS = 8000;

/** Statuses worth retrying — transient server/overload/rate-limit conditions. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status <= 504);
}

function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_DELAY_MS);
  }
  const exp = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exp + jitter, MAX_DELAY_MS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface AnthropicRequestBody {
  model: ClaudeModel;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: string; content: unknown }>;
}

/**
 * POST to Anthropic with exponential backoff on transient errors, then fall back
 * across `models` in order. Returns the parsed JSON body of the first success.
 * Throws with the existing `Anthropic API error (${status}): ${body}` shape on the
 * final failure so callers' catch/messaging keep working.
 */
async function fetchAnthropicWithRetry(
  apiKey: string,
  body: Omit<AnthropicRequestBody, "model">,
  models: ClaudeModel[]
): Promise<{ content: Array<{ type: string; text?: string }>; usage: { input_tokens: number; output_tokens: number } }> {
  let lastError: Error | null = null;

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    if (m > 0) console.warn(`[claude] falling back to model ${model} after ${models[m - 1]} stayed unavailable`);

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...body, model }),
        });
      } catch (e) {
        // Network/fetch error — transient, retry.
        lastError = e as Error;
        if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) {
          const delay = backoffDelay(attempt, null);
          console.warn(`[claude] network error retry ${attempt + 1}/${MAX_ATTEMPTS_PER_MODEL} in ${delay}ms: ${lastError.message}`);
          await sleep(delay);
          continue;
        }
        break; // exhausted this model, try fallback
      }

      if (res.ok) {
        return (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };
      }

      const errBody = await res.text();
      lastError = new Error(`Anthropic API error (${res.status}): ${errBody}`);

      if (!isTransientStatus(res.status)) {
        // Config/auth/bad-request — retries and fallbacks won't help.
        throw lastError;
      }

      if (attempt < MAX_ATTEMPTS_PER_MODEL - 1) {
        const delay = backoffDelay(attempt, res.headers.get("retry-after"));
        console.warn(`[claude] ${res.status} retry ${attempt + 1}/${MAX_ATTEMPTS_PER_MODEL} in ${delay}ms (model ${model})`);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("Anthropic API error: request failed");
}

/** Build the ordered model list: primary first, then de-duped fallbacks. */
function resolveModels(primary: ClaudeModel, fallbacks?: ClaudeModel[]): ClaudeModel[] {
  const list = fallbacks ?? [DEFAULT_FALLBACK_MODEL];
  return [primary, ...list.filter((m) => m !== primary)];
}

export interface ClaudeJSONResult<T> {
  data: T;
  raw: string;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  model: ClaudeModel;
}

export async function callClaudeJSON<T>(opts: ClaudeJSONOptions<T>): Promise<ClaudeJSONResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const systemWithHint = opts.schemaHint
    ? `${opts.system}\n\nYou must return ONLY valid JSON matching this shape:\n${opts.schemaHint}\nNo preamble. No markdown code fences.`
    : `${opts.system}\n\nYou must return ONLY valid JSON. No preamble. No markdown code fences.`;

  const start = Date.now();

  const hasDocs = Boolean(opts.documents && opts.documents.length > 0);
  const hasImages = Boolean(opts.images && opts.images.length > 0);
  const userContent = hasDocs || hasImages
    ? [
        // Document blocks first (Claude reads them as context), then the text, then images.
        ...(opts.documents ?? []).map((doc) => ({
          type: "document",
          source: { type: "base64", media_type: doc.media_type, data: doc.data },
          ...(doc.title ? { title: doc.title } : {}),
        })),
        { type: "text", text: opts.user },
        ...(opts.images ?? []).map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        })),
      ]
    : opts.user;

  const json = await fetchAnthropicWithRetry(
    apiKey,
    {
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      system: systemWithHint,
      messages: [{ role: "user", content: userContent }],
    },
    resolveModels(opts.model, opts.fallbackModels)
  );

  const raw = json.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude JSON parse error: ${(e as Error).message}\nRaw: ${cleaned.slice(0, 500)}`);
  }

  if (opts.validate && !opts.validate(parsed)) {
    throw new Error(`Claude response failed validation. Raw: ${cleaned.slice(0, 500)}`);
  }

  return {
    data: parsed as T,
    raw: cleaned,
    usage: json.usage,
    latencyMs: Date.now() - start,
    model: opts.model,
  };
}

export async function callClaudeText(opts: {
  model: ClaudeModel;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  fallbackModels?: ClaudeModel[];
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; latencyMs: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const start = Date.now();

  const json = await fetchAnthropicWithRetry(
    apiKey,
    {
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.3,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    },
    resolveModels(opts.model, opts.fallbackModels)
  );

  const text = json.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  return { text, usage: json.usage, latencyMs: Date.now() - start };
}
