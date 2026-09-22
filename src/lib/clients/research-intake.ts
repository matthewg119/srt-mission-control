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
import {
  extractKeywords,
  extractPhrases,
  KEYWORD_SOURCE,
  mergePhrases,
  verticalFor,
  type HarvestedPhrase,
} from "./harvest";
import { filterPhrases, droppedLine, DEBRIS_FAULTS } from "./phrase-quality";

/** What a message has to start with to be treated as research. Case-insensitive. */
export const RESEARCH_PREFIX = /^\s*research\s*:/i;

/**
 * `research replace:` also makes this paste the SHARED research for the avatar, and replaces a stored one
 * that answered more sections. Without it, framework research stays on the client that pasted it.
 */
export const RESEARCH_REPLACE_PREFIX = /^\s*research\s+replace\s*:/i;

export function isResearchPaste(text: string): boolean {
  return RESEARCH_PREFIX.test(text) || RESEARCH_REPLACE_PREFIX.test(text);
}

export function isResearchReplace(text: string): boolean {
  return RESEARCH_REPLACE_PREFIX.test(text);
}

export function stripPrefix(text: string): string {
  return text.replace(RESEARCH_REPLACE_PREFIX, "").replace(RESEARCH_PREFIX, "").trim();
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

/**
 * The research answer as it should be KEPT, rather than as phrases are extracted from it.
 *
 * ‼️ NOT unwrapSlackMarkup, WHICH IS RIGHT FOR A PHRASE AND WRONG FOR A DOCUMENT. It deletes every
 * `*`, `_`, `~` and backtick, because a phrase should be the market's words and not their
 * formatting. Applied to the whole answer it breaks every source URL with an underscore in it and
 * turns a bold `**1. Who buys**` heading into a plain line, which parses as no section at all, so an
 * answer formatted that way would never be saved on the avatar. Slack link syntax and HTML entities
 * are still unwrapped: those are Slack's encoding, not the author's.
 */
export function cleanResearchForStorage(text: string): string {
  return stripPrefix(text)
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
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
  /** Rows written from the KEYWORDS block, which is section 9 and a different corpus. */
  keywords?: number;
  /**
   * The block was there and the write refused it.
   *
   * ‼️ A SEPARATE FIELD FROM `keywords: 0`, BECAUSE THE TWO USED TO BE INDISTINGUISHABLE AND THAT
   * SHIPPED A LIE. A failed upsert left keywordsStored at 0, and the reply then printed the
   * message for a MISSING block to somebody who had just pasted a hundred keywords.
   */
  keywordsError?: string;
  /**
   * How many of those keyword rows arrived with a source URL beside them.
   *
   * ‼️ THE ONLY NUMBER THAT SAYS WHETHER THE VOLUME COLUMN MEANS ANYTHING. `extractKeywords`
   * trusts a volume only when the row cites where it came from and otherwise pins it to 1, so a
   * block of 100 rows with no URLs ranks exactly like a block of 100 rows that all said
   * "unknown". Measured 2026-09-13 on SRT's vertical: 306 research phrases, 0 with a source URL,
   * and nothing in the thread ever said so. Reported now, every run.
   */
  keywordsWithUrl?: number;
  runId?: string;
  /**
   * What the quality filter refused at the door, so a short result explains itself.
   *
   * ‼️ PRINTED, NEVER SWALLOWED. Same rule keyword-set.ts holds: a paste that silently loses
   * two thirds of itself looks like a thin research run, and "the brief only came back with 56
   * phrases" sends somebody to run it again when the truth is that 250 of them were debris.
   */
  droppedPhrases?: number;
  droppedKeywords?: number;
  droppedNote?: string | null;
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

  const extracted: HarvestedPhrase[] = mergePhrases(extractPhrases(body, "deep_research"));

  // ‼️ FILTERED BEFORE IT IS STORED, NOT ONLY WHEN IT IS READ BACK.
  //
  // Measured on SRT's corpus 2026-09-08: 306 deep_research rows, 56 usable. Eighteen per cent.
  // The other 250 are URLs glued onto quotes, 【41†L65-L69】 citation markers, brief field names
  // and whole paragraphs of somebody's prose. phrase-quality.ts filtered them on READ, which
  // fixed every existing client at once and left this function writing more of them on every
  // paste, into a table with no client_id that every client in the vertical shares forever.
  //
  // The read filter stays. Both sides, same rules, same reason harvest.ts applies isPageChrome
  // on both: the read side repairs what is stored and the write side stops the pile growing.
  const phraseFilter = filterPhrases(extracted, (p) => p.phrase);
  const phrases = phraseFilter.kept;

  // ‼️ PARSED SEPARATELY AND STORED UNDER ITS OWN `source`. extractPhrases would drop all 100 of
  // these without saying so: a keyword is rarely question-shaped and often under four words.
  // Absent block returns [], which is every research document written before section 9 existed.
  const rawKeywords = extractKeywords(body);

  // ‼️ A NARROWER RULE SET, AND USING THE FULL ONE HERE WOULD BE A BUG.
  // A keyword is legitimately two words and legitimately not question-shaped: "botox cost" is
  // exactly what section 9 asks for and the full filter calls it too_short. DEBRIS_FAULTS is
  // only the six faults that mean OUR extraction broke, which apply whatever shape the phrase is.
  const keywordFilter = filterPhrases(rawKeywords, (k) => k.phrase, DEBRIS_FAULTS);
  const keywords = keywordFilter.kept;

  // ‼️ TWO DIFFERENT EMPTIES AND THEY MUST NOT READ THE SAME.
  //
  // "Nothing question-shaped came out of that" is true when the paste had no phrase list in it.
  // It is a lie when the extractor found forty and the quality filter refused all forty, which
  // is the case the write-side filter just made possible. One of those means paste the list;
  // the other means the research came back as prose with its citations glued on, and running it
  // again the same way produces the same forty.
  if (!phrases.length) {
    return {
      ok: false,
      error: extracted.length
        ? `${extracted.length} phrase${extracted.length === 1 ? "" : "s"} came out of that and ` +
          `none of them survived the quality filter (${Object.entries(phraseFilter.faults)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([fault, n]) => `${n} ${fault.replace(/_/g, " ")}`)
            .join(", ")}). ` +
          "That is a formatting problem in the research, not something you pasted wrong: the " +
          "phrases came back with their citations glued on, or as prose rather than as a list. " +
          "Nothing was written."
        : "nothing question-shaped or objection-shaped came out of that. The brief asks for a ranked list of the exact phrases buyers type; make sure that list is in what you pasted.",
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
      kind: p.kind,
      speaker: p.speaker,
    })),
    // Must match question_bank_phrase_avatar_key exactly. A target that matches no index is
    // 42P10 at PLAN time, so it fails on every run rather than on a collision.
    { onConflict: "vertical,avatar,normalized", ignoreDuplicates: false }
  );

  if (error) return { ok: false, error: error.message };

  // The keyword rows. Same run, same avatar, same conflict target, different `source`, so
  // anything reading buyer phrases keeps seeing exactly what it saw before section 9 existed.
  //
  // A failure here does NOT fail the intake: the eight sections are already filed at this point
  // and returning an error would tell the operator nothing landed when most of it did.
  let keywordsStored = 0;
  let keywordsWithUrl = 0;
  let keywordsFailed: string | undefined;
  if (keywords.length) {
    const { error: kwError } = await supabaseAdmin.from("question_bank").upsert(
      keywords.map((k) => ({
        vertical,
        phrase: k.phrase,
        normalized: k.normalized,
        source: KEYWORD_SOURCE,
        harvest_run_id: runId,
        source_url: k.sourceUrl || null,
        frequency_score: k.frequencyScore,
        commercial_intent_score: k.commercialIntentScore,
        avatar: avatar.slug,
        objection_phrase: false,
        kind: "question",
        speaker: "buyer",
      })),
      { onConflict: "vertical,avatar,normalized", ignoreDuplicates: false }
    );
    if (kwError) {
      console.error("[research-intake] keyword upsert failed:", kwError.message);
      keywordsFailed = kwError.message;
    } else {
      keywordsStored = keywords.length;
      keywordsWithUrl = keywords.filter((k) => Boolean(k.sourceUrl)).length;
    }
  }

  await supabaseAdmin
    .from("harvest_runs")
    .update({ results_count: phrases.length + keywordsStored })
    .eq("id", runId);

  return {
    ok: true,
    stored: fresh.length,
    seen: phrases.length - fresh.length,
    keywords: keywordsStored,
    keywordsWithUrl,
    keywordsError: keywordsFailed,
    runId,
    droppedPhrases: phraseFilter.dropped,
    droppedKeywords: keywordFilter.dropped,
    droppedNote: droppedLine(phraseFilter, extracted.length),
  };
}

/**
 * After a person pastes research: keep the WHOLE answer on the avatar, then say what the avatar is
 * still missing.
 *
 * ‼️ A PASTE USED TO KEEP ONLY ITS PHRASES. ingestResearch files question_bank rows and nothing else;
 * the only writer of avatar_briefs.research_text was the automatic Haiku run. So a claude.com deep
 * research answer, the one Matthew actually runs (D1: research stays a manual paste-back), lost its
 * demographics, beliefs, blame and quotes the moment it was filed, and the avatar kept whatever the
 * cheaper automatic run had said. Matthew, 2026-09-15: "THE DEEP RESEARCH MUST PROVIDE" the avatar's
 * context, so the research that provides it has to be the research that is kept.
 *
 * ‼️ ONLY A FULL ANSWER REPLACES THE STORED ONE. The intake reply tells a person whose paste had no
 * KEYWORDS block to "paste just this block", and a keywords-only paste must never overwrite forty
 * thousand characters of research with fifty lines of pipes. A paste counts as full when at least
 * FULL_RESEARCH_MIN_SECTIONS numbered sections are answered; anything shorter keeps its phrases and
 * leaves the avatar alone, and the reply says which happened.
 *
 * ‼️ THE SAVE IS READ BACK. storeAvatarResearch logs a failed write and returns nothing, so this
 * re-reads the row and only says "saved" when the stored text is the text that was pasted.
 *
 * Never throws: the phrases have already landed by the time this runs.
 */
export async function afterResearchPaste(
  clientId: string,
  rawText: string,
  /**
   * Where to post the proposal card, if there is one.
   *
   * ‼️ THE CARD IS POSTED HERE RATHER THAN RETURNED WITH THE OTHER LINES, and that is the whole
   * reason this parameter exists. The caller joins everything it gets back into ONE Slack message,
   * and a body over 3,000 characters fails the whole message. Twenty proposed fields with their
   * values will exceed that on their own, so the card goes out as its own message or messages,
   * split on line boundaries. Absent means "no Slack here", used by probes and by any caller that
   * only wants the report lines.
   */
  slackCtx?: { channel: string; threadTs: string }
): Promise<string[]> {
  try {
    const body = cleanResearchForStorage(rawText);
    const [{ audienceFor }, { avatarBriefFor, storeAvatarResearch }, profile] = await Promise.all([
      import("./audiences"),
      import("./avatars"),
      import("./avatar-profile"),
    ]);

    const aud = await audienceFor(clientId);
    if (!aud.ok) return [`:warning: Not saved on an avatar: ${aud.error}`];
    const audience = aud.audience;
    if (!audience.researchAvatarSlug) {
      return [`:warning: Not saved on an avatar: the audience *${audience.label}* has no avatar key to file research under.`];
    }

    const lines: string[] = [];
    const answered = profile.parseResearchSections(body).filter(profile.sectionAnswered).length;

    const replace = isResearchReplace(rawText);
    const countAnswered = (text: string | null | undefined) =>
      text ? profile.parseResearchSections(text).filter(profile.sectionAnswered).length : 0;

    // ‼️ THE CLIENT'S OWN COPY FIRST (audience_documents), BECAUSE FRAMEWORK RESEARCH WAS WRITTEN WITH THIS
    // CLIENT'S SALES LETTER IN THE PROMPT. Storing it straight into the SHARED avatar_briefs would hand one
    // client's letter-derived material to every other client targeting the same avatar. Below, the shared
    // row is written only when it is empty or on `research replace:`.
    let ownNote: string | null = null;
    if (answered >= profile.FULL_RESEARCH_MIN_SECTIONS) {
      const { currentDocument, storeDocument } = await import("./audience-documents");
      const own = await currentDocument({ audienceId: audience.id, offerId: null, kind: "deep_research" });
      const ownAnswered = own.ok ? countAnswered(own.doc?.content) : 0;
      if (own.ok && ownAnswered > answered && !replace) {
        ownNote =
          `:paperclip: This client's stored research answers ${ownAnswered} sections and this paste answers ${answered}, ` +
          "so the stored one was kept. Send it as `research replace:` to replace it anyway.";
      } else if (own.ok) {
        const saved = await storeDocument({
          clientId,
          audienceId: audience.id,
          offerId: null,
          kind: "deep_research",
          content: body,
          parsed: { answered },
          source: "pasted",
          by: "research paste",
        });
        ownNote = saved.ok
          ? `:floppy_disk: Kept on this client as *${audience.label}*'s research, ${answered} sections answered.`
          : `:warning: The research could not be kept on this client: ${saved.error}`;
      }
      // own.ok false: audience_documents is not there yet. The shared path below still runs as before.
    }
    if (ownNote) lines.push(ownNote);

    if (answered < profile.FULL_RESEARCH_MIN_SECTIONS) {
      lines.push(
        `:paperclip: Not saved as *${audience.label}*'s research: this paste answers ${answered} numbered ` +
          `section${answered === 1 ? "" : "s"}, and a full answer answers at least ${profile.FULL_RESEARCH_MIN_SECTIONS}. ` +
          "What was already stored is untouched. That is expected for a KEYWORDS block pasted on its own."
      );
    } else if (
      !replace &&
      (await avatarBriefFor(audience.researchVertical, audience.researchAvatarSlug))?.researchText
    ) {
      lines.push(
        `:lock: The shared research every client targeting *${audience.label}* reads was left as it was. ` +
          "`research replace:` (or `share research`) makes this paste the shared one."
      );
    } else {
      const before = await avatarBriefFor(audience.researchVertical, audience.researchAvatarSlug);
      await storeAvatarResearch({
        vertical: audience.researchVertical,
        avatarSlug: audience.researchAvatarSlug,
        avatarLabel: audience.label,
        researchText: body,
        clientId,
      });
      const after = await avatarBriefFor(audience.researchVertical, audience.researchAvatarSlug);
      if (after?.researchText !== body) {
        lines.push(
          `:x: *The research was NOT saved on ${audience.label}.* The phrases landed, but the avatar still ` +
            "holds what it held before. Paste it again; if this repeats, avatar_briefs is refusing the write."
        );
      } else {
        const prior = before?.researchText?.length ?? 0;
        lines.push(
          `:floppy_disk: Saved as *${audience.label}*'s research, ${answered} sections answered. ` +
            (prior
              ? `It replaces the ${prior.toLocaleString("en-US")} characters stored before. `
              : "") +
            "Every client targeting this avatar reads it."
        );
      }
    }

    const { completenessFor } = await import("./dataset-completeness");
    const { formatDatasetReport } = await import("./dataset-spec");
    const primary = (await completenessFor(clientId)).find((c) => c.audience?.isPrimary);
    if (primary?.audience) {
      lines.push(
        "",
        ...formatDatasetReport(primary.audience.label, true, primary.reports, primary.snapshot.offer.applies)
      );
    }

    // ── W0: read the report and PROPOSE values for what is still missing. ───────────────────
    //
    // ‼️ THIS IS THE WHOLE POINT OF THE PASTE AND IT RUNS LAST, AFTER EVERYTHING DURABLE. The
    // phrases, the client's own copy and the shared bank are already written by here. If the
    // extraction throws or the model times out, the paste still landed and the card above still
    // prints; the operator loses the proposal, not the research. Reversing that order would make
    // one model call the thing standing between a pasted report and it being stored at all.
    //
    // ‼️ MISSING FIELDS ONLY, taken from the report just computed. step-gaps.ts's "if we already
    // hold it, do not ask for it" applies to filling as much as to asking, and a field that already
    // has a confirmed value must not be re-proposed: that would put a model's reading up against a
    // person's decision with no good way to choose.
    if (answered >= profile.FULL_RESEARCH_MIN_SECTIONS && primary?.audience) {
      try {
        const missing = primary.reports.flatMap((r) => r.gaps.map((g) => g.field.key));
        {
          const { extractFieldValues } = await import("./field-extraction");
          const { openProposal, openProposalFor, formatProposalCard } = await import("./field-proposal");

          // ‼️ NO MISSING FIELDS IS NOT A REASON TO SKIP THE PASTE. This used to return early on
          // `missing.length === 0`, and that re-introduced the exact bug W2b exists to fix, for the
          // best-case client: somebody runs the research precisely to back the pages they are about
          // to publish, pastes it, every dataset is already full, and NOTHING is filed as evidence.
          // The gate then blocks those pages on `unsupported` while the report that answers them
          // sits in audience_documents where the gate cannot see it. With no gaps the extraction
          // still runs, `wanted` is empty so proposed/questions/unanswered come back empty by
          // construction, and only the citations are populated. One model call either way.
          const found = await extractFieldValues({
            sections: profile.parseResearchSections(body),
            missingKeys: missing,
          });

          // A proposal worth opening is one with anything on it: values to confirm, questions to
          // answer, OR cited claims to file. The third is what makes the complete-datasets case work.
          if (found.proposed.length || found.questions.length || found.citations.length) {
            const { currentDocument } = await import("./audience-documents");
            const doc = await currentDocument({
              audienceId: primary.audience.id,
              offerId: null,
              kind: "deep_research",
            });

            const opened = await openProposal({
              clientId,
              audienceId: primary.audience.id,
              sourceDocumentId: doc.ok ? (doc.doc?.id ?? null) : null,
              proposed: found.proposed,
              questions: found.questions,
              unanswered: found.unanswered,
              citations: found.citations,
            });

            if (!opened.ok) {
              lines.push("", `:warning: The values were read but not offered: ${opened.error}`);
            } else if (!slackCtx) {
              lines.push(
                "",
                `:card_index_dividers: ${found.proposed.length} values are ready to confirm.`
              );
            } else {
              const p = await openProposalFor(clientId);
              if (p) {
                if (opened.replaced) {
                  lines.push(
                    "",
                    ":arrows_counterclockwise: An earlier unconfirmed proposal for this client was discarded. " +
                      "Only the one below can be confirmed."
                  );
                }
                const { slack } = await import("@/lib/slack-bot");
                let firstTs: string | null = null;
                for (const chunk of formatProposalCard(p)) {
                  const res = await slack.postThreadReply(slackCtx.channel, slackCtx.threadTs, chunk);
                  // ‼️ THE FIRST CHUNK'S TS IS THE ONE THE REACTION IS KEYED ON. A long card is
                  // several messages and only one of them may carry the button, or a second
                  // check mark on the second chunk would look like a second confirmation.
                  const ts = (res as { ts?: string } | null)?.ts ?? null;
                  if (!firstTs && ts) firstTs = ts;
                }
                if (firstTs) {
                  await supabaseAdmin
                    .from("client_field_proposals")
                    .update({ slack_channel: slackCtx.channel, slack_ts: firstTs })
                    .eq("id", p.id);
                }

                // ‼️ FILED AS AN ARGUMENT, NOT ADDED TO THE REGISTRY. dataset_suggestions is the
                // door the 2026-09-22 migration built for exactly this, and its own comment says
                // a row there "is an argument, never a declaration". The unique index on an open
                // proposed_key means a second paste suggesting the same field is ignored rather
                // than filed twice, so this can run on every paste without the card becoming a
                // list of duplicates.
                //
                // ‼️ THROUGH recordProposals, NOT A DIRECT INSERT. That function owns the one
                // thing a direct insert here got wrong: a 23505 is the EXPECTED outcome of a key
                // somebody already argued for, and everything else is a real failure worth
                // logging. Inserting inline swallowed both alike, so a broken column read as
                // "nothing to suggest". clientId is set because this argument is about THIS
                // client's report, unlike the Thursday corpus scan which is about a vertical.
                if (found.suggestions.length) {
                  const { recordProposals } = await import("./dataset-suggestions");
                  const { filed, already } = await recordProposals(
                    found.suggestions.map((g) => ({
                      proposedKey: g.proposedKey,
                      label: g.label,
                      dataset: g.dataset,
                      basis: g.basis,
                      clientId,
                      observedCount: null,
                      verticalSlug: null,
                      postFormat: "",
                    }))
                  );
                  for (const g of found.suggestions.slice(0, filed)) {
                    lines.push(
                      `:bulb: Suggested a new field, *${g.label}* (\`${g.proposedKey}\`, ${g.dataset}): ${g.basis}`
                    );
                  }
                  // Said out loud rather than silently dropped: an open suggestion for that key
                  // already exists, so the card would otherwise just print fewer bulbs than the
                  // research produced and nobody would know why.
                  if (already) {
                    lines.push(
                      `:heavy_minus_sign: ${already} other field suggestion${already === 1 ? " was" : "s were"} already open from an earlier argument.`
                    );
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        lines.push(
          "",
          `:warning: The research is saved, but reading values out of it failed: ${(e as Error).message}`
        );
      }
    }

    return lines;
  } catch (e) {
    return [`:warning: The phrases landed, but saving the research on the avatar failed: ${(e as Error).message}`];
  }
}

/** The thread reply. Says what landed and what it did NOT do. */
export function formatIntakeReply(r: ResearchIntakeResult, topPhrases: HarvestedPhrase[]): string {
  if (!r.ok) return `:warning: Nothing was filed: ${r.error}`;

  const lines = [
    `:books: Research filed. *${r.stored} new phrases*, ${r.seen} already in the bank.`,
    "Tagged `deep_research`, so they stay distinguishable from the cited-source harvest.",
    // Named either way. A keyword block that silently did not arrive looks identical to one
    // that did, and section 9 is the half the page candidates rank on.
    r.keywords
      ? `:mag: *${r.keywords} keywords* from the KEYWORDS block, tagged \`keywords\` and scored by intent.` +
        (r.droppedKeywords ? ` ${r.droppedKeywords} were dropped as extraction debris.` : "") +
        // ‼️ THE URL COUNT IS THE HONEST HALF OF THIS LINE. A row without one has its volume pinned
        // to 1, so "97 keywords" and "97 keywords, none of them sourced" are the same set as far as
        // ranking is concerned, and only the second one is true.
        (r.keywordsWithUrl === r.keywords
          ? " Every row cites a source URL, so the volumes are used as given."
          : r.keywordsWithUrl
            ? ` ${r.keywordsWithUrl} of them cite a source URL; the rest rank by intent alone, because ` +
              "an unsourced volume is an estimate and an estimate in a ranking column is " +
              "indistinguishable from a measurement."
            : " *None of them cite a source URL*, so every volume was pinned to 1 and these rank by " +
              "intent alone. That is the rule working rather than a fault, but it means the block is " +
              "worth less than its size suggests.")
      : r.keywordsError
        ? `:x: *The KEYWORDS block was there and the database refused it:* ${r.keywordsError}\n` +
          "The phrases above still landed. This is a schema problem, not something you pasted wrong."
        : // ‼️ THIS IS THE MESSAGE THAT WOULD HAVE CAUGHT THE LIVE BUG, SO IT SHOWS THE SHAPE.
          // SRT's vertical, measured 2026-09-13: 306 research phrases and ZERO keyword rows, ever.
          // The block had never once arrived in the pipe-delimited form. The old line said "No
          // KEYWORDS block found" in prose and read as a shrug, which is the same mistake the ask
          // itself was making: a format described in prose comes back as prose.
          ":rotating_light: *No KEYWORDS block found, and that is the half that matters.*\n" +
          "Section 9 asks for the 100 phrases this buyer actually searches, and it is the only path " +
          "into the corpus that carries real commercial intent. Everything else in the paste landed.\n\n" +
          "It has to be literal rows, not prose. Ask again for just this block:\n" +
          "```\nKEYWORDS\n" +
          "lip filler near me | unknown | ready | https://example.com/where-you-saw-it\n" +
          "lip filler cost | 1900 | price | https://example.com/the-page-with-the-number\n```\n" +
          "Four pipes on every row, `unknown` where there is no number, no link where there is no " +
          "source. Re-paste it with `research:` and this reply will count them.",
  ];

  // ‼️ WHAT THE FILTER REFUSED IS PRINTED, NEVER SWALLOWED. A paste that quietly loses two
  // thirds of itself looks like a thin research run, and "it only came back with 56 phrases"
  // sends somebody to run the brief again when the truth is that 250 of them were never a
  // phrase anybody said. Same rule the step 12 PDF and the keyword set already follow.
  if (r.droppedNote) {
    lines.push(
      "",
      `:broom: ${r.droppedNote}`,
      "Nothing was rewritten. Debris is refused at the door now as well as filtered on read, so " +
        "the shared corpus stops growing it."
    );
  }

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
/**
 * ‼️ ANY READABLE DOCUMENT, NOT ONLY A PDF (2026-09-15). SRT's deep research came back from ChatGPT as a
 * .txt file dropped into step 11 with no words typed, and this read PDFs only, so it was filed and nothing
 * answered. A research tool exports whatever it exports: PDF, Word, text and Markdown all read here.
 */
/** PDF, Word, text or Markdown: what extractFileText reads. */
export function isResearchDocument(filename: string, contentType: string): boolean {
  return (
    /pdf|wordprocessingml|^text\//i.test(contentType) || /\.(pdf|docx|txt|md|markdown)$/i.test(filename)
  );
}

export async function ingestResearchFile(args: {
  clientId: string;
  slackFileId: string;
}): Promise<ResearchIntakeResult & { filename?: string; extraLines?: string[] }> {
  return ingestResearchPdf(args);
}

export async function ingestResearchPdf(args: {
  clientId: string;
  slackFileId: string;
}): Promise<ResearchIntakeResult & { filename?: string; extraLines?: string[] }> {
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
  if (!isResearchDocument(filename, contentType)) {
    return { ok: false, error: "that is not a document I can read. Drop the research as a PDF, Word, .txt or .md file", filename };
  }

  const dl = await supabaseAdmin.storage.from("onboarding").download(doc.storage_ref as string);
  if (dl.error || !dl.data) {
    return { ok: false, error: dl.error?.message ?? "the stored file could not be read", filename };
  }

  const { extractFileText } = await import("@/lib/deck/extract");
  let text: string;
  try {
    text = (await extractFileText(Buffer.from(await dl.data.arrayBuffer()), filename, contentType)) ?? "";
  } catch (e) {
    return { ok: false, error: `that file could not be read: ${(e as Error).message}`, filename };
  }
  if (!text.trim()) return { ok: false, error: "that file has no text in it", filename };

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

  const extraLines = result.ok ? await afterResearchPaste(args.clientId, `research: ${text}`) : [];
  return { ...result, filename, extraLines };
}
