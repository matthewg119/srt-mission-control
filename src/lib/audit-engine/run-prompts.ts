// Engine runners for the Audit Engine — OpenAI (Responses API + web_search) and
// Perplexity (sonar). Plain `fetch`, no SDK, matching every other external-API
// call in this codebase (see claude-calls.ts).
//
// NO FABRICATED DATA RULE lives here: the only possible return shapes are
// {status:"ok", ...a real response} or {status:"no_data", raw:null, citations:[]}.
// There is no code path that can produce a guessed `mentioned` value — callers
// must treat `no_data` as "unknown", never coerce it to `mentioned:false`.

import { isMentioned } from "./mention-match";

export interface EngineOk {
  status: "ok";
  mentioned: boolean;
  raw: string;
  citations: string[];
  latencyMs: number;
}

export interface EngineNoData {
  status: "no_data";
  raw: null;
  citations: [];
  latencyMs: number;
  error: string;
}

export type EngineResult = EngineOk | EngineNoData;

const REQUEST_TIMEOUT_MS = 45000;
const RETRIES_PER_ENGINE = 1; // one retry per prompt/engine, per spec

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Runs `call` up to 1 retry; returns EngineNoData (never throws) on final failure. */
async function withOneRetry(call: () => Promise<{ raw: string; citations: string[] }>): Promise<EngineResult> {
  const start = Date.now();
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= RETRIES_PER_ENGINE; attempt++) {
    try {
      const { raw, citations } = await call();
      return { status: "ok", mentioned: false, raw, citations, latencyMs: Date.now() - start };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { status: "no_data", raw: null, citations: [], latencyMs: Date.now() - start, error: lastError };
}

/** Fill in `mentioned` now that the caller knows the business's aliases. */
export function withMention(result: EngineResult, aliases: string[]): EngineResult {
  if (result.status !== "ok") return result;
  return { ...result, mentioned: isMentioned(result.raw, aliases) };
}

function model(envVar: string, fallback: string): string {
  return process.env[envVar] || fallback;
}

// --- OpenAI Responses API + web_search --------------------------------------

interface OpenAIAnnotation {
  type?: string;
  url?: string;
}
interface OpenAIContentItem {
  type?: string;
  text?: string;
  annotations?: OpenAIAnnotation[];
}
interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIContentItem[];
}
interface OpenAIResponsesBody {
  output?: OpenAIOutputItem[];
  error?: { message?: string };
}

export async function runOpenAI(prompt: string, city: string | null): Promise<EngineResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: "no_data", raw: null, citations: [], latencyMs: 0, error: "OPENAI_API_KEY not set" };

  return withOneRetry(async () => {
    const input = city ? `I'm in ${city}. ${prompt}` : prompt;
    const res = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model("OPENAI_AUDIT_MODEL", "gpt-4.1-mini"),
        input,
        tools: [{ type: "web_search" }],
      }),
    });

    const json = (await res.json()) as OpenAIResponsesBody;
    if (!res.ok) throw new Error(json.error?.message || `OpenAI API error (${res.status})`);

    const messageItems = (json.output ?? []).filter((o) => o.type === "message");
    const textParts: string[] = [];
    const citations = new Set<string>();

    for (const item of messageItems) {
      for (const content of item.content ?? []) {
        if (content.text) textParts.push(content.text);
        for (const ann of content.annotations ?? []) {
          if (ann.type === "url_citation" && ann.url) citations.add(ann.url);
        }
      }
    }

    return { raw: textParts.join("\n").trim(), citations: [...citations] };
  });
}

// --- Perplexity sonar ---------------------------------------------------------

interface PerplexityBody {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: string[];
  error?: { message?: string };
}

export async function runPerplexity(prompt: string, city: string | null): Promise<EngineResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { status: "no_data", raw: null, citations: [], latencyMs: 0, error: "PERPLEXITY_API_KEY not set" };

  return withOneRetry(async () => {
    const content = city ? `I'm in ${city}. ${prompt}` : prompt;
    const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model("PERPLEXITY_AUDIT_MODEL", "sonar"),
        messages: [{ role: "user", content }],
      }),
    });

    const json = (await res.json()) as PerplexityBody;
    if (!res.ok) throw new Error(json.error?.message || `Perplexity API error (${res.status})`);

    const raw = json.choices?.[0]?.message?.content ?? "";
    return { raw: raw.trim(), citations: json.citations ?? [] };
  });
}
