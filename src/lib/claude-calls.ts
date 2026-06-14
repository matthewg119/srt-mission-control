const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ClaudeModel =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001";

export interface ClaudeImageInput {
  media_type: string; // e.g. "image/png"
  data: string; // base64, no data: prefix
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
  validate?: (parsed: unknown) => parsed is T;
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

  const userContent = opts.images && opts.images.length > 0
    ? [
        { type: "text", text: opts.user },
        ...opts.images.map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        })),
      ]
    : opts.user;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      system: systemWithHint,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

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
}): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; latencyMs: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const start = Date.now();

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.3,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = json.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  return { text, usage: json.usage, latencyMs: Date.now() - start };
}
