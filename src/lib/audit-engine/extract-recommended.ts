// Cheap batch entity-extraction: pulls the 0-5 businesses/providers each engine
// response actually names (numbered lists, bolded names, plain mentions) so the
// report can show "who got named" per prompt, not just a mentioned/not bool.
// One Claude call per process-route batch (not per response) to keep cost down.
// Best-effort only — a failure here degrades to an empty list, it never blocks
// or fabricates a run's core mentioned/no_data result.

import { callClaudeJSON } from "@/lib/claude-calls";
import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";
import { tokensOnly } from "@/lib/data/model-costs";

export interface RecommendedExtractionItem {
  id: string;
  text: string;
}

type ExtractionResult = Record<string, string[]>;

function isExtractionResult(v: unknown): v is ExtractionResult {
  if (typeof v !== "object" || v === null) return false;
  return Object.values(v as Record<string, unknown>).every(
    (arr) => Array.isArray(arr) && arr.every((x) => typeof x === "string")
  );
}

const SCHEMA_HINT =
  '{ "<id>": [string, ...] }  // for each input id, 0-5 business/provider names explicitly named in that text. Real names only — never invent one, never include generic terms like "a local clinic".';

const EXTRACT_MODEL = "claude-haiku-4-5-20251001" as const;
const TEXT_BUDGET = 3000;

const SYSTEM =
  "You extract business/provider names that were explicitly named in AI search-engine responses. " +
  "For each labeled text block below, list the 0-5 distinct business/provider names it actually names " +
  "(from numbered lists, bolded names, or plain mentions). Never invent a name that isn't in the text. " +
  "Return exactly one array per id, using the exact same ids given, even if the array is empty.";

export async function extractRecommendedBatch(items: RecommendedExtractionItem[]): Promise<ExtractionResult> {
  const withText = items.filter((i) => i.text.trim().length > 0);
  if (withText.length === 0) return {};

  const texts = withText.map((i) => i.text.slice(0, TEXT_BUDGET));

  try {
    const { payload } = await getOrFetch<string[][]>({
      // A fact about a block of TEXT. Who was auditing when the text arrived changes nothing about
      // which businesses it names.
      clientId: null,
      kind: "anthropic.extract_recommended",
      // ‼️ THE TEXTS, NEVER THE CALLER'S IDS, AND WITHOUT THIS THE LANE WOULD NEVER HIT ONCE. The
      // ids are audit_runs row ids minted fresh on every batch, because run-batch.ts is
      // delete-then-insert per run. Keying on the prompt as it used to be rendered would put a new
      // id in front of identical text every single time and guarantee a miss for ever.
      cacheKey: cacheKeyOf({ texts, model: EXTRACT_MODEL, system: SYSTEM }),
      // ‼️ NEVER EXPIRES, because the question is closed. The key IS the text, so the only thing
      // that could change the answer is different text, which is a different key. Same reasoning
      // the cache header gives for a recorded fanout observation.
      ttlDays: null,
      provider: "anthropic",
      params: { model: EXTRACT_MODEL, blocks: texts.length },
      fetch: async () => {
        // Positional ids, so the prompt is a function of the texts alone. The caller's ids are
        // mapped back on below; handing them to the model would make the request unstable for the
        // same reason it would make the key unstable.
        const user = texts.map((text, i) => `--- id: ${i} ---\n${text}`).join("\n\n");
        const { data, usage } = await callClaudeJSON<ExtractionResult>({
          model: EXTRACT_MODEL,
          system: SYSTEM,
          user,
          schemaHint: SCHEMA_HINT,
          maxTokens: 1500,
          temperature: 0,
          validate: isExtractionResult,
        });
        // An id the model skipped is an empty list, which is what this function already promised
        // its callers. Stored positionally so the answer outlives the ids it was asked under.
        const byIndex = texts.map((_, i) => data[String(i)] ?? []);
        // No web_search on this call, so the token cost is the whole cost.
        return { payload: byIndex, costUsd: tokensOnly(EXTRACT_MODEL, usage) };
      },
    });

    const out: ExtractionResult = {};
    withText.forEach((item, i) => {
      out[item.id] = payload[i] ?? [];
    });
    return out;
  } catch (e) {
    // Best-effort, exactly as before: a failure degrades to an empty list and never blocks a run.
    // The throw also means nothing was cached, so the next batch asks again rather than inheriting
    // this failure as an answer.
    console.error("[audit-engine] recommended-entity extraction failed:", (e as Error).message);
    return {};
  }
}
