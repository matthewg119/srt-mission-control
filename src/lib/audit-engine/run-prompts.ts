// Engine runner for the Audit Engine — OpenAI (Responses API + web_search).
// Plain `fetch`, no SDK, matching every other external-API call in this codebase
// (see claude-calls.ts). Perplexity was removed on 2026-08-05; see AuditEngine
// in types.ts for why.
//
// NO FABRICATED DATA RULE lives here: the only possible return shapes are
// {status:"ok", ...a real response} or {status:"no_data", raw:null, citations:[]}.
// There is no code path that can produce a guessed `mentioned` value — callers
// must treat `no_data` as "unknown", never coerce it to `mentioned:false`.
// finish-report.ts enforces the other half: a report that has no usable data for
// every prompt is failed, never published with the gaps scored as absences.

import { isMentioned } from "./mention-match";

export interface EngineOk {
  status: "ok";
  mentioned: boolean;
  raw: string;
  citations: string[];
  /** The searches the model actually ran to answer this prompt (the "fanout").
   *  Read off `web_search_call.action.query` — see the note above runOpenAI.
   *  Empty is normal and never an error: a prompt the model answered from
   *  memory has no fanout, and OpenAI documents the field as usually-but-not-
   *  always present. Callers must treat [] as "nothing observed", never as a
   *  claim that no search happened. */
  fanoutQueries: string[];
  latencyMs: number;
}

export interface EngineNoData {
  status: "no_data";
  raw: null;
  citations: [];
  fanoutQueries: [];
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

/** Runs `call` up to 1 retry; returns EngineNoData (never throws) on final failure.
 *
 *  An EMPTY body counts as a failure, not as an answer. A 200 whose text is blank tells us
 *  nothing about whether the business is named, but `status:"ok"` + `mentioned:false` reads
 *  downstream as a CONFIRMED absence and scores as a miss — fabricating the exact finding
 *  this file's header rule exists to prevent. Retrying is also the right move: a blank
 *  Responses payload is usually a truncated or tool-only turn. */
async function withOneRetry(
  call: () => Promise<{ raw: string; citations: string[]; fanoutQueries: string[] }>
): Promise<EngineResult> {
  const start = Date.now();
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= RETRIES_PER_ENGINE; attempt++) {
    try {
      const { raw, citations, fanoutQueries } = await call();
      if (!raw.trim()) throw new Error("empty response body");
      return { status: "ok", mentioned: false, raw, citations, fanoutQueries, latencyMs: Date.now() - start };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { status: "no_data", raw: null, citations: [], fanoutQueries: [], latencyMs: Date.now() - start, error: lastError };
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
//
// FANOUT: the response carries `web_search_call` items alongside the `message`
// item, and each one names the search the model actually ran. Until 2026-08-31
// this function filtered the output down to `type === "message"` and dropped
// them, so every audit ever run paid for that data and discarded it. It is the
// only observed (rather than guessed) record of what the market's questions
// translate into, and the whole colony lane is built on it.
//
// Deliberately NOT sending `include: ["web_search_call.action.sources"]`. The
// queries come back without it, the sources duplicate what url_citation already
// gives us, and an unsupported `include` value 400s the request — which would
// take down the live audit engine for a field we do not need.

interface OpenAIAnnotation {
  type?: string;
  url?: string;
}
interface OpenAIContentItem {
  type?: string;
  text?: string;
  annotations?: OpenAIAnnotation[];
}
/** The search the model ran. OpenAI documents `query` (singular) and, on some
 *  models, `queries` (plural). Both are read; neither is required. */
interface OpenAISearchAction {
  type?: string;
  query?: string;
  queries?: string[];
}
interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIContentItem[];
  action?: OpenAISearchAction;
}
interface OpenAIResponsesBody {
  output?: OpenAIOutputItem[];
  error?: { message?: string };
}

export async function runOpenAI(prompt: string, city: string | null): Promise<EngineResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: "no_data", raw: null, citations: [], fanoutQueries: [], latencyMs: 0, error: "OPENAI_API_KEY not set" };
  }

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

    const output = json.output ?? [];
    const textParts: string[] = [];
    const citations = new Set<string>();
    // Insertion-ordered: the order the model searched is signal, so a Set keeps
    // first-seen position while collapsing repeats within one answer.
    const fanout = new Set<string>();

    for (const item of output) {
      if (item.type === "web_search_call") {
        const action = item.action;
        if (action?.query) fanout.add(action.query);
        for (const q of action?.queries ?? []) if (q) fanout.add(q);
        continue;
      }
      if (item.type !== "message") continue;
      for (const content of item.content ?? []) {
        if (content.text) textParts.push(content.text);
        for (const ann of content.annotations ?? []) {
          if (ann.type === "url_citation" && ann.url) citations.add(ann.url);
        }
      }
    }

    return { raw: textParts.join("\n").trim(), citations: [...citations], fanoutQueries: [...fanout] };
  });
}
