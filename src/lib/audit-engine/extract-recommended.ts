// Cheap batch entity-extraction: pulls the 0-5 businesses/providers each engine
// response actually names (numbered lists, bolded names, plain mentions) so the
// report can show "who got named" per prompt, not just a mentioned/not bool.
// One Claude call per process-route batch (not per response) to keep cost down.
// Best-effort only — a failure here degrades to an empty list, it never blocks
// or fabricates a run's core mentioned/no_data result.

import { callClaudeJSON } from "@/lib/claude-calls";

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

export async function extractRecommendedBatch(items: RecommendedExtractionItem[]): Promise<ExtractionResult> {
  const withText = items.filter((i) => i.text.trim().length > 0);
  if (withText.length === 0) return {};

  const user = withText.map((i) => `--- id: ${i.id} ---\n${i.text.slice(0, 3000)}`).join("\n\n");

  try {
    const { data } = await callClaudeJSON<ExtractionResult>({
      model: "claude-haiku-4-5-20251001",
      system:
        "You extract business/provider names that were explicitly named in AI search-engine responses. " +
        "For each labeled text block below, list the 0-5 distinct business/provider names it actually names " +
        "(from numbered lists, bolded names, or plain mentions). Never invent a name that isn't in the text. " +
        "Return exactly one array per id, using the exact same ids given, even if the array is empty.",
      user,
      schemaHint: SCHEMA_HINT,
      maxTokens: 1500,
      temperature: 0,
      validate: isExtractionResult,
    });
    return data;
  } catch (e) {
    console.error("[audit-engine] recommended-entity extraction failed:", (e as Error).message);
    return {};
  }
}
