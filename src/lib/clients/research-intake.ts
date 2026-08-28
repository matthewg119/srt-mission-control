// The other end of the deep research brief — delivery step 10, the half that comes back.
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

  // ‼️ DYNAMIC IMPORT: avatars.ts reaches this module through reuseAvatarResearch, so a static
  // import here closes a cycle. Same reason harvest.ts does it.
  const { confirmedAvatarFor } = await import("./avatars");
  const avatar = await confirmedAvatarFor(args.clientId);

  // Refuses for the same reason the harvest refuses: question_bank has no client_id, so a phrase
  // filed under a null avatar cannot be attributed to a buyer afterwards, and this text is going
  // into a corpus every client in the vertical reads from.
  if (!avatar) {
    return {
      ok: false,
      error:
        "No avatar is confirmed on this client, so there is nothing to file this research under. " +
        "Confirm the avatar first: it is what the research was supposed to be about.",
    };
  }

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
    .eq("avatar", avatar.slug)
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
      // ‼️ TAGGED WITH THE CONFIRMED AVATAR'S SLUG. THIS COMMENT USED TO SAY THE OPPOSITE.
      //
      // It read "avatar stays NULL, the avatar is confirmed by a human at step 11", which was
      // true while the confirmation came after this step. It comes before it now, so the research
      // was commissioned FOR a named buyer and the tag records which. The slug rather than the
      // slot, because this table is shared across every client in the vertical.
      avatar: avatar.slug,
      objection_phrase: p.objectionPhrase,
    })),
    // Must match question_bank_phrase_avatar_key exactly. A target that matches no index is
    // 42P10 at PLAN time, so it fails on every run rather than on a collision.
    { onConflict: "vertical,avatar,normalized", ignoreDuplicates: false }
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

// ─────────────────────────────────────────────────────────────────────────────
// The other way it comes back: the PDF the research tool produced
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a PDF dropped into step 10's thread as the research answer.
 *
 * Matthew: "If I click done I should paste back the PDF that It gave me for the deep research."
 * Deep research tools hand back a document, and asking somebody to select all of it and paste it
 * into Slack with a prefix in front is asking them to do the export by hand.
 *
 * ‼️ NO MODEL RUNS IN THE EXTRACTION, AND THAT IS NOT AN OPTIMIZATION. src/lib/deck/extract.ts
 * says it in its own header: a model asked to transcribe a PDF tidies punctuation, drops a stray
 * line and fixes what it reads as a typo. Here that would destroy the exact thing this step
 * collects, which is the market's own wording with its typos intact. `unpdf`, and the same
 * extractor the automated harvest uses on the text that comes out.
 *
 * ‼️ A PDF UPLOAD IS AN EXPLICIT ACT, WHICH IS WHY IT QUALIFIES WHERE SNIFFING WOULD NOT. The
 * `research:` prefix exists because a message in a thread might be somebody thinking out loud
 * and a phrase that reaches question_bank can end up in a set frozen at Day 0. Dropping a file
 * into a step's thread is not something anybody does by accident, and it is scoped to THAT step.
 */
export async function ingestResearchPdf(args: {
  clientId: string;
  slackFileId: string;
}): Promise<ResearchIntakeResult & { filename?: string }> {
  const { data: doc } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename, content_type, storage_ref")
    .eq("slack_file_id", args.slackFileId)
    .maybeSingle();

  if (!doc?.storage_ref) {
    return { ok: false, error: "that file is not filed yet, so there is nothing to read" };
  }

  const filename = (doc.filename as string | null) ?? "that file";
  const contentType = (doc.content_type as string | null) ?? "";
  if (!/pdf/i.test(contentType) && !/\.pdf$/i.test(filename)) {
    return { ok: false, error: "that is not a PDF", filename };
  }

  const dl = await supabaseAdmin.storage.from("onboarding").download(doc.storage_ref as string);
  if (dl.error || !dl.data) {
    return { ok: false, error: dl.error?.message ?? "the stored file could not be read", filename };
  }

  const { extractPdfText } = await import("@/lib/deck/extract");
  let text: string;
  try {
    text = await extractPdfText(Buffer.from(await dl.data.arrayBuffer()));
  } catch (e) {
    return { ok: false, error: `that PDF could not be read: ${(e as Error).message}`, filename };
  }

  // The prefix is added HERE rather than relaxing the trigger, so ingestResearch keeps exactly
  // one rule about what counts as research and there is no second, looser door into it.
  const result = await ingestResearch({ clientId: args.clientId, text: `research: ${text}` });

  // ‼️ THE PDF BECOMES THE STEP'S output_ref, WHICH NOTHING ELSE WRITES ANY MORE. Until
  // 2026-08-28 the step generated its own PDF and deliverArtifact set this; the step posts a
  // prompt now and files nothing, so the document that comes BACK is the deliverable. Written
  // only on a successful intake: an output_ref pointing at a PDF that yielded no phrases would
  // satisfy step-verify's [Done] gate on a file nobody could use.
  //
  // The row already exists (captureOnboardingFile stored it), so this is a pointer, not a copy.
  if (result.ok && doc.id) {
    await supabaseAdmin
      .from("client_delivery_steps")
      .update({ output_ref: doc.id as string, updated_at: new Date().toISOString() })
      .eq("client_id", args.clientId)
      .eq("step_key", "avatar_harvest");
  }

  return { ...result, filename };
}
