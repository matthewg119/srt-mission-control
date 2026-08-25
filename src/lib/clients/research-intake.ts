// The other end of the deep research brief — delivery step 9, the half that comes back.
//
// The brief goes out, a person runs it in a deep-research tool, and the answer arrives as a
// wall of text pasted into the client's ops thread. Without this file that answer has nowhere
// to go: `avatar_harvest` is `auto_then_manual` and it would sit open forever, because the
// manual half could never actually complete.
//
// ‼️ THE TRIGGER IS EXPLICIT, AND THAT IS DELIBERATE.
// A thread message only counts as research when it starts with `research:`. Sniffing for
// "looks like a research dump" would eventually swallow somebody thinking out loud in the
// thread and file their notes as market evidence — and once a phrase is in question_bank it can
// end up in the custom tracked set, which is frozen at Day 0 and defines what the case study
// measures. Requiring six characters is a very cheap way to make that impossible.
//
// ‼️ THE SAME EXTRACTOR AS THE AUTOMATED HALF, ON PURPOSE.
// extractPhrases/mergePhrases from harvest.ts do the work. Writing a second parser here would
// give two different definitions of "question-shaped" and two different commercial-intent
// ladders, so the same sentence would score differently depending on which door it came
// through — and the harvest and the research halves are meant to be comparable.
//
// ‼️ NOTHING HERE TOUCHES question_set_versions. A1 §5: the harvest feeds the custom tracked set
// and page candidates through two different tables, and if a path exists where it could edit a
// frozen set, that is a build stop. freezeUniversalV1() remains the only writer.

import { supabaseAdmin } from "@/lib/db";
import { extractPhrases, mergePhrases, verticalFor, type HarvestedPhrase } from "./harvest";

/** What a message has to start with to be treated as research. Case-insensitive. */
export const RESEARCH_PREFIX = /^\s*research\s*:/i;

export function isResearchPaste(text: string): boolean {
  return RESEARCH_PREFIX.test(text);
}

export function stripPrefix(text: string): string {
  return text.replace(RESEARCH_PREFIX, "").trim();
}

/**
 * Slack sends mrkdwn, not the plain text that was typed.
 *
 * Link syntax is the one that matters: `<https://example.com|example.com>` would otherwise be
 * carried into a phrase verbatim and stored as if a person had said it. Bold and italic markers
 * are stripped too, because a phrase is supposed to be the market's words, not their formatting.
 */
export function unwrapSlackMarkup(text: string): string {
  return text
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export interface ResearchIntakeResult {
  ok: boolean;
  error?: string;
  /** Phrases written or refreshed. */
  stored?: number;
  /** Phrases found but already in the bank from a previous run. */
  seen?: number;
  runId?: string;
}

/**
 * Read a pasted research dump into question_bank.
 *
 * Rows land with `source = 'deep_research'`, sharing the client's most recent `harvest_run_id`
 * so the automated and human halves of one step stay joined and still distinguishable. If no
 * harvest has run, a run row is opened for this paste alone rather than leaving the link null —
 * a phrase with no provenance cannot be defended on a call two months later.
 */
export async function ingestResearch(args: {
  clientId: string;
  text: string;
}): Promise<ResearchIntakeResult> {
  const body = unwrapSlackMarkup(stripPrefix(args.text));

  if (body.length < 200) {
    return {
      ok: false,
      error:
        "that is too short to be a research dump. Paste the whole thing, including the ranked list at the end.",
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("vertical_slug, business_type")
    .eq("id", args.clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  // Refuses rather than guessing. See verticalFor() in harvest.ts: this WRITES into the shared
  // question_bank, which has no client_id, so a wrong vertical here cannot be unpicked later.
  const resolved = await verticalFor(args.clientId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const vertical = resolved.vertical;

  const phrases: HarvestedPhrase[] = mergePhrases(extractPhrases(body, "deep_research"));

  if (!phrases.length) {
    return {
      ok: false,
      error:
        "nothing question-shaped or objection-shaped came out of that. The brief asks for a ranked list of the exact phrases buyers type; make sure that list is in what you pasted.",
    };
  }

  // Reuse the most recent harvest run for this client so both halves of step 9 hang off one row.
  const { data: existingRun } = await supabaseAdmin
    .from("harvest_runs")
    .select("id, sources")
    .eq("client_id", args.clientId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let runId = existingRun?.id as string | undefined;

  if (runId) {
    const sources = (existingRun?.sources ?? {}) as Record<string, unknown>;
    await supabaseAdmin
      .from("harvest_runs")
      .update({ sources: { ...sources, deep_research: true } })
      .eq("id", runId);
  } else {
    const { data: newRun, error } = await supabaseAdmin
      .from("harvest_runs")
      .insert({
        client_id: args.clientId,
        vertical,
        sources: { citations: 0, reddit: false, deep_research: true },
        seed_terms: [],
      })
      .select("id")
      .single();
    if (error || !newRun) return { ok: false, error: error?.message ?? "could not open a harvest run" };
    runId = newRun.id as string;
  }

  // Which of these are already known, so the reply can say what is genuinely new.
  const { data: known } = await supabaseAdmin
    .from("question_bank")
    .select("normalized")
    .eq("vertical", vertical)
    .in("normalized", phrases.map((p) => p.normalized));

  const knownSet = new Set((known ?? []).map((k) => k.normalized as string));
  const fresh = phrases.filter((p) => !knownSet.has(p.normalized));

  const { error } = await supabaseAdmin.from("question_bank").upsert(
    phrases.map((p) => ({
      vertical,
      phrase: p.phrase,
      normalized: p.normalized,
      source: "deep_research" as const,
      harvest_run_id: runId,
      source_url: null,
      frequency_score: p.frequencyScore,
      commercial_intent_score: p.commercialIntentScore,
      // ‼️ avatar stays NULL. The avatar is confirmed by a human at step 11; tagging a1/a2/a3
      // here would be inventing the tag two steps early and then treating it as evidence.
      objection_phrase: p.objectionPhrase,
    })),
    { onConflict: "vertical,normalized", ignoreDuplicates: false }
  );

  if (error) return { ok: false, error: error.message };

  await supabaseAdmin
    .from("harvest_runs")
    .update({ results_count: phrases.length })
    .eq("id", runId);

  return { ok: true, stored: fresh.length, seen: phrases.length - fresh.length, runId };
}

/** The thread reply. Says what landed and what it did NOT do. */
export function formatIntakeReply(r: ResearchIntakeResult, topPhrases: HarvestedPhrase[]): string {
  if (!r.ok) return `:warning: Nothing was filed: ${r.error}`;

  const lines = [
    `:books: Research filed. *${r.stored} new phrases*, ${r.seen} already in the bank.`,
    "Tagged `deep_research`, so they stay distinguishable from the cited-source harvest.",
  ];

  if (topPhrases.length) {
    lines.push("", "Highest commercial intent:");
    for (const p of topPhrases.slice(0, 6)) {
      lines.push(`· "${p.phrase}"${p.objectionPhrase ? "  _(objection)_" : ""}`);
    }
  }

  lines.push(
    "",
    "These are candidates, not a tracked set. The custom set is approved on the call and frozen then.",
    "The step is still open — press Done when you are satisfied with what came back."
  );

  return lines.join("\n");
}
