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
   * Repair a near-miss BEFORE validation runs.
   *
   * For the class of failure where the model understood the task and got one field's convention
   * wrong: a 0-based index where the schema wanted 1-based, a number sent as a string. Throwing
   * away a correct answer over that costs a whole generation. Return the input untouched for
   * anything you are not sure how to repair, and let validate reject it.
   */
  coerce?: (parsed: unknown) => unknown;
  /**
   * Why this payload was rejected, in words. Fed back to the model verbatim on the correction
   * retry below, and used in the thrown error instead of 500 characters of raw JSON.
   *
   * Without it, a validation failure reports "failed validation" and an excerpt that usually looks
   * completely fine, because the broken field is rarely in the first 500 characters.
   */
  describeInvalid?: (parsed: unknown) => string;
  /**
   * Ordered list of models to try. The primary `model` is always tried first;
   * any models here are tried (with full retry) only after the primary is
   * exhausted on a transient error. Defaults to a Haiku fallback.
   */
  fallbackModels?: ClaudeModel[];
  /**
   * Server-side tools, passed straight through, e.g.
   * `[{ type: "web_search_20260209", name: "web_search", max_uses: 8 }]`.
   *
   * Anthropic runs these; there is no client-side execution loop. Supplying any tool disables
   * the automatic Haiku fallback (see resolveModels) because Haiku does not support the current
   * web_search tool version.
   */
  tools?: unknown[];
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
  /** Server-side tool definitions, e.g. web_search. Omitted entirely when unused. */
  tools?: unknown[];
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
): Promise<{ content: Array<{ type: string; text?: string }>; usage: { input_tokens: number; output_tokens: number }; stop_reason?: string }> {
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
          stop_reason?: string;
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
function resolveModels(primary: ClaudeModel, fallbacks?: ClaudeModel[], hasTools = false): ClaudeModel[] {
  // A tool-using call must not silently fall back to Haiku: it does not support the
  // web_search_20260209 tool version, so the "fallback" would 400 rather than degrade. Better to
  // fail on the primary model with a real error than to swap in one that cannot do the job.
  if (hasTools) return [primary, ...(fallbacks ?? []).filter((m) => m !== primary)];
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

/** Pull the JSON value out of a response that thought out loud before answering.
 *
 *  Even with "return ONLY valid JSON" in the system prompt, a model handed a genuinely awkward
 *  task (fitting 7 pasted lines into 8 labeled boxes) sometimes reasons in prose first and then
 *  emits the object. That used to be an unrecoverable parse error. Scan for the first `{` or `[`
 *  and walk to its matching close, respecting strings and escapes, so the preamble is dropped and
 *  the payload survives. Returns the input untouched when it already parses or nothing balances,
 *  so a real malformed response still reports as a parse error. */
function salvageJSON(text: string): string {
  try {
    JSON.parse(text);
    return text;
  } catch {
    // fall through to the scan
  }
  const start = text.search(/[{[]/);
  if (start === -1) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return text;
        }
      }
    }
  }
  return text;
}

/**
 * Recursively rewrite snake_case object keys to camelCase. Ready-made `coerce` for any generator
 * whose schema is camelCase.
 *
 * Models drift into snake_case for no reason and with no warning: the intel brief returned
 * `why_it_hurts` and `horror_stories` on a run whose content was perfectly good, and the whole
 * generation was discarded over it. Keys that are already camelCase pass through untouched, so
 * this is safe to apply to any camelCase schema.
 *
 * It matters most for TOOL-USING calls, which cannot take the correction retry below and so have
 * no second chance at all.
 */
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camelizeKeys(v);
  }
  return out;
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

  const hasTools = Boolean(opts.tools && opts.tools.length > 0);
  const models = resolveModels(opts.model, opts.fallbackModels, hasTools);

  // One request attempt at a given token budget: fetch, extract text, strip fences.
  // `followUp` appends the model's own rejected answer plus a correction instruction, turning the
  // single-turn call into a three-turn one. Empty for every normal attempt.
  const attempt = async (maxTokens: number, followUp: Array<{ role: string; content: unknown }> = []) => {
    const json = await fetchAnthropicWithRetry(
      apiKey,
      {
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.2,
        system: systemWithHint,
        messages: [{ role: "user", content: userContent }, ...followUp],
        ...(hasTools ? { tools: opts.tools } : {}),
      },
      models
    );
    const raw = json.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    const cleaned = salvageJSON(raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim());
    return { json, raw, cleaned };
  };

  // Parse, repair, validate. Returns an error string instead of throwing so the caller can decide
  // whether the failure is worth a retry (truncation, a repairable field) or terminal.
  // `reason` is set only for a VALIDATION failure, which is the one a correction retry can fix —
  // a parse error usually means truncation, and re-asking would not help.
  const parseAndValidate = (
    cleaned: string
  ): { ok: true; parsed: T } | { ok: false; error: string; reason: string | null } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { ok: false, error: `Claude JSON parse error: ${(e as Error).message}\nRaw: ${cleaned.slice(0, 500)}`, reason: null };
    }
    if (opts.coerce) parsed = opts.coerce(parsed);
    if (opts.validate && !opts.validate(parsed)) {
      const reason = opts.describeInvalid?.(parsed) ?? "";
      return {
        ok: false,
        error: reason
          ? `Claude response failed validation: ${reason}`
          : `Claude response failed validation. Raw: ${cleaned.slice(0, 500)}`,
        reason: reason || "it did not match the required shape",
      };
    }
    return { ok: true, parsed: parsed as T };
  };

  const MAX_RETRY_TOKENS = 8000;
  let requestedTokens = opts.maxTokens ?? 2048;
  let { json, raw, cleaned } = await attempt(requestedTokens);
  let result = parseAndValidate(cleaned);

  // Anthropic returns stop_reason:"max_tokens" when the model was cut off mid-output. That
  // truncates the JSON (unterminated string) and fails parse/validation. Retry ONCE with a
  // bigger budget rather than surfacing an opaque parse error — protects every generator.
  if (!result.ok && json.stop_reason === "max_tokens" && requestedTokens < MAX_RETRY_TOKENS) {
    const bigger = Math.min(requestedTokens * 2, MAX_RETRY_TOKENS);
    console.warn(`[claude] response truncated at max_tokens=${requestedTokens}; retrying once at ${bigger}`);
    requestedTokens = bigger;
    ({ json, raw, cleaned } = await attempt(bigger));
    result = parseAndValidate(cleaned);
  }

  // A CORRECTION retry: the model produced parseable JSON of the wrong shape. Hand its own answer
  // back with the reason and ask for a fix. This is the same move draft-linter.ts makes for drafts,
  // and it exists because throwing away an otherwise-correct generation over one wrong field is
  // the most expensive failure mode this helper has.
  //
  // NOT done when tools are in play. The assistant turn would have to replay the server_tool_use
  // and web_search_tool_result blocks verbatim and we only keep the text ones, so the reconstructed
  // conversation would be malformed — and it would re-run every search. Tool calls keep failing
  // with a real reason instead.
  // `raw` must be non-empty: the API rejects an assistant turn with empty content, so a blank
  // response has to fall through to the throw rather than becoming a 400.
  if (!result.ok && result.reason && raw && !hasTools && json.stop_reason !== "max_tokens") {
    console.warn(`[claude] validation failed (${result.reason}); asking once for a correction`);
    ({ json, raw, cleaned } = await attempt(requestedTokens, [
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `That JSON was rejected: ${result.reason}. Fix only what is wrong and return the corrected JSON. No preamble, no code fences.`,
      },
    ]));
    result = parseAndValidate(cleaned);
  }

  if (!result.ok) {
    if (json.stop_reason === "max_tokens") {
      throw new Error(`Claude response truncated (hit max_tokens=${requestedTokens}); raise maxTokens. ${result.error}`);
    }
    throw new Error(result.error);
  }

  return {
    data: result.parsed,
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

export interface ClaudeChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Multi-turn sibling of callClaudeText: same retry/fallback path, full message history. */
export async function callClaudeChat(opts: {
  model: ClaudeModel;
  system: string;
  messages: ClaudeChatMessage[];
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
      temperature: opts.temperature ?? 0.7,
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
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
