// The 99 phrases this client's market actually uses, ranked, with a provenance on every one.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ IT IS NOT CALLED "THE 99 MOST SEARCHED", AND THE NAME IS THE DECISION.
//
// Matthew asked for "the 99 most searched terms, derived from the offer and the avatar". Two
// honest ways to do that, and the cost is NOT what decides between them:
//
//   DataForSEO's keywords_data/google_ads/search_volume is $0.075 per task for up to 1,000
//   keywords. Ninety-nine terms is ONE task. At thirty onboardings a day that is $2.25 a day,
//   about $68 a month. Cheap. "Too expensive" would have been a dishonest refusal.
//
// What decides it is that Google Ads volume is the wrong denominator for this product. It is
// keyword-planner demand, bucketed and rounded, and it returns zero or no-data for most
// conversational objection-shaped phrases, which are exactly what question_bank collects and
// exactly what an assistant is asked. Ranking ninety-nine terms by it would float "med spa near
// me" above "does lip filler hurt", and the second one is why the pages work.
//
// So: RANKED BY MARKET EVIDENCE, and volume is an optional column with its own provenance stamp,
// off by default. A term DataForSEO has no data for reads "no data", never 0. This repo's whole
// posture is that a claim carries how it was measured, and "most searched" is a claim.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHERE THE PHRASES COME FROM, ALL OF IT ALREADY IN THE DATABASE:
//
//   question_bank        the market's own wording, typos kept, per (vertical, avatar). It carries
//                        frequency_score, commercial_intent_score, objection_phrase and a
//                        source_url, which is most of the ranking already.
//   audit_runs.prompt    the twenty questions this client's audit actually ran, and whether an
//                        engine named them. NOT audit_reports.prompts: that column is regenerated
//                        by every run, so quoting it would let a later scan rewrite a list already
//                        read out to a client. call-questions.ts:29-31 states the hazard.
//   page_candidates      the per-client scored backlog, already substituted.
//   the locked offer     [treatment], which is what makes this client's list different from every
//                        other client's in the same vertical.
//
// ‼️ NO MODEL CALL. Every number here is either counted or read off a column, so the ranking can
// be argued with rather than believed. That is the same reason custom-question-set.ts and
// page-candidates.ts are deterministic: a model would re-rank on re-run and make a day-30 trend
// a lie.

import { supabaseAdmin } from "@/lib/db";
import { SCORE_TERMS, scoreCandidate, themeOf } from "./artifacts/page-candidates";
import { loadOffer, effectiveTreatment } from "./offers";
import { filterPhrases, tidyPhrase, type PhraseFilterResult } from "./phrase-quality";

/** Matthew's number. A ceiling, not a target: a client whose market says less gets less. */
export const KEYWORD_CAP = 99;

/** How a phrase got into the list. Printed beside it, never inferred. */
export type KeywordOrigin =
  /** question_bank, harvested from the pages the engines cited. The market's own wording. */
  | "harvest"
  /** question_bank, extracted from a pasted-back deep research brief. */
  | "deep_research"
  /** question_bank, typed into a KEYWORDS block by a person. */
  | "keywords"
  /** One of the twenty this client's audit actually ran. */
  | "audit"
  /** A per-client page candidate, already substituted. */
  | "candidate";

export interface KeywordRow {
  phrase: string;
  normalized: string;
  score: number;
  origin: KeywordOrigin;
  theme: string;
  /** ‼️ TRI-STATE, and null is not false. null means no engine was ever asked. */
  currentlyNamed: boolean | null;
  objection: boolean;
  intent: number;
  frequency: number;
  sourceUrl: string | null;
  /** The offer this list is aimed at, carried on every row so a stored list explains itself. */
  treatment: string | null;
}

export interface KeywordSet {
  clientId: string;
  /** The offer the list was built for, and whether anybody had locked it. */
  treatment: string | null;
  treatmentCertain: boolean;
  vertical: string | null;
  avatar: string | null;
  rows: KeywordRow[];
  /** What went in, so a short list can be explained rather than looking like a failure. */
  counts: { bank: number; audit: number; candidates: number; deduped: number };
  /**
   * What the quality filter removed, so a short list explains itself.
   *
   * ‼️ IT IS PRINTED, NOT SWALLOWED. A corpus that silently loses two thirds of itself looks
   * like a small corpus, and "the vertical only has 172 phrases" sends somebody to run another
   * harvest when the truth is that 279 rows of debris are already stored.
   */
  quality: { bankTotal: number; bankKept: number; faults: Record<string, number> };
}

/** Same normalisation question_bank uses, so a phrase from two sources dedupes to one row. */
export function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every phrase this client's market uses, ranked.
 *
 * ‼️ THE OFFER IS THE FILTER AND THE FALLBACK IS NOT SILENT. When an offer is locked, phrases
 * naming it sort above phrases that do not, which is what Matthew asked for: "start by selecting
 * the keywords of the selected offer to build every single link, question and lead magnet around
 * it". When nothing is locked the list still builds, and `treatmentCertain` is false so every
 * surface printing it can say the list is aimed at the whole menu.
 */
export async function buildKeywordSet(clientId: string): Promise<KeywordSet | { error: string }> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id, vertical_slug, primary_avatar_slug, contact_id, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) return { error: clientError.message };
  if (!client) return { error: "no client row" };

  const vertical = (client.vertical_slug as string | null) ?? null;
  const avatar = (client.primary_avatar_slug as string | null) ?? null;

  // ‼️ IT REFUSES RATHER THAN FALLING BACK TO med_spa. verticalFor() in harvest.ts was changed to
  // refuse for exactly this reason: forty correctly-extracted phrases about choosing an AEO
  // agency were filed under med_spa because four readers took a `?? "med_spa"` default, and
  // question_bank has no client_id to unpick them by. A wrong corpus is worse than no list.
  if (!vertical) {
    return {
      error:
        "no vertical on the client, so there is no corpus to read. adoptAuditClassification " +
        "sets it when the baseline scan completes; if that step was skipped, set it on the board.",
    };
  }

  const offer = await loadOffer(clientId);
  const effective = effectiveTreatment(offer);
  const treatment = effective.value;

  // ── question_bank, for this vertical and this avatar ──────────────────────
  //
  // ‼️ AVATAR-SCOPED ROWS PLUS THE UNTAGGED ONES, NOT ONE OR THE OTHER. question_bank.avatar is
  // NULL on everything harvested before an avatar was confirmed, and those rows are still the
  // market's own wording. Excluding them would throw away the corpus on every client whose
  // harvest predates their avatar, which is most of them.
  let bankQuery = supabaseAdmin
    .from("question_bank")
    .select("phrase, normalized, source, source_url, frequency_score, commercial_intent_score, objection_phrase, avatar")
    .eq("vertical", vertical)
    .order("commercial_intent_score", { ascending: false })
    .order("frequency_score", { ascending: false })
    .limit(600);

  if (avatar) bankQuery = bankQuery.or(`avatar.eq.${avatar},avatar.is.null`);

  const { data: bank, error: bankError } = await bankQuery;
  if (bankError) return { error: `question_bank: ${bankError.message}` };

  // ‼️ TWO THIRDS OF THIS CORPUS IS NOT A PHRASE ANYBODY SAID, MEASURED. On SRT's own vertical
  // it is 172 usable rows out of 451: URLs glued to quotes, citation markers, headline
  // fragments, whole paragraphs of somebody's prose. Ranking that produces a ranked list of
  // debris, which is exactly what Matthew was looking at when he said most of the PDF is not
  // usable. See src/lib/clients/phrase-quality.ts for the rules and the numbers.
  const bankFiltered = filterPhrases(bank ?? [], (r) => String(r.phrase ?? ""));

  // ── The twenty this client's audit really ran ─────────────────────────────
  const named = await namedByPrompt(client.contact_id as string | null, client.domain as string | null);

  // ── The per-client backlog ────────────────────────────────────────────────
  const { data: candidates } = await supabaseAdmin
    .from("page_candidates")
    .select("question, score, currently_named, in_own_reviews, origin")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .limit(200);

  // ── One row per distinct phrase, best evidence wins ───────────────────────
  const byNormal = new Map<string, KeywordRow>();
  let deduped = 0;

  const put = (row: KeywordRow) => {
    const existing = byNormal.get(row.normalized);
    if (!existing) {
      byNormal.set(row.normalized, row);
      return;
    }
    deduped += 1;
    // ‼️ THE HIGHER SCORE WINS, AND currentlyNamed MERGES RATHER THAN OVERWRITING. A phrase
    // that appears both in the bank and in the audit knows two different things about itself:
    // how often the market said it, and whether an engine named this client for it. Dropping
    // the duplicate outright would throw one of those away.
    const merged: KeywordRow = {
      ...(row.score > existing.score ? row : existing),
      currentlyNamed: existing.currentlyNamed ?? row.currentlyNamed,
      objection: existing.objection || row.objection,
      sourceUrl: existing.sourceUrl ?? row.sourceUrl,
      frequency: Math.max(existing.frequency, row.frequency),
      intent: Math.max(existing.intent, row.intent),
    };
    byNormal.set(row.normalized, merged);
  };

  for (const r of bankFiltered.kept) {
    const phrase = tidyPhrase(String(r.phrase ?? ""));
    if (!phrase) continue;
    // ‼️ RECOMPUTED, NOT READ OFF THE COLUMN. question_bank.normalized was written by more than
    // one code path over time, so two rows holding the SAME question can carry different
    // normalised forms and both survive the dedupe. Observed live: "How much does this cost?"
    // came back twice, adjacent, in the same ranked list. The stored column is still what the
    // table's unique index uses; this map needs one rule applied consistently at read time.
    const normalized = normalizePhrase(phrase);
    const source = String(r.source ?? "harvest");
    const origin: KeywordOrigin =
      source === "deep_research" ? "deep_research" : source === "keywords" ? "keywords" : "harvest";

    const frequency = Number(r.frequency_score ?? 1);
    const intent = Number(r.commercial_intent_score ?? 0);
    const objection = r.objection_phrase === true;
    const currentlyNamed = named.get(normalized) ?? null;

    put({
      phrase,
      normalized,
      origin,
      theme: themeOf(phrase),
      score: scoreCandidate({ frequency, intent, objection, currentlyNamed, inOwnReviews: false }),
      currentlyNamed,
      objection,
      intent,
      frequency,
      sourceUrl: (r.source_url as string | null) ?? null,
      treatment,
    });
  }

  // The audit's twenty, which carry the one term the bank cannot: whether an engine names them.
  for (const [normalized, wasNamed] of named) {
    const existing = byNormal.get(normalized);
    if (existing) {
      // Re-score with the measured answer rather than leaving it null.
      const rescored = scoreCandidate({
        frequency: existing.frequency,
        intent: existing.intent,
        objection: existing.objection,
        currentlyNamed: wasNamed,
        inOwnReviews: false,
      });
      byNormal.set(normalized, { ...existing, currentlyNamed: wasNamed, score: rescored });
    }
  }

  // Page candidates are substituted from the same corpus, so they inherit the same debris.
  const candidateFiltered = filterPhrases(candidates ?? [], (c) => String(c.question ?? ""));

  for (const c of candidateFiltered.kept) {
    const phrase = tidyPhrase(String(c.question ?? ""));
    if (!phrase) continue;
    const normalized = normalizePhrase(phrase);
    const currentlyNamed = (c.currently_named as boolean | null) ?? named.get(normalized) ?? null;
    put({
      phrase,
      normalized,
      origin: "candidate",
      theme: themeOf(phrase),
      // page_candidates already carries a score computed by the same function, so it is read
      // rather than recomputed: two numbers for one phrase is two rankings.
      score: Number(c.score ?? 0),
      currentlyNamed,
      objection: themeOf(phrase) === "Objection",
      intent: 0,
      frequency: 1,
      sourceUrl: null,
      treatment,
    });
  }

  // ── The offer decides the order, when there is one ────────────────────────
  //
  // ‼️ A BONUS, NOT A FILTER. Dropping every phrase that does not name the treatment would throw
  // away the objection-shaped questions that mention no service at all ("is it worth the money",
  // "does it hurt"), which are the ones this whole product is built on.
  const needle = treatment ? normalizePhrase(treatment) : null;
  const rows = [...byNormal.values()].map((row) =>
    needle && row.normalized.includes(needle)
      ? { ...row, score: Math.round((row.score + OFFER_BONUS) * 100) / 100 }
      : row
  );

  rows.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  return {
    clientId,
    treatment,
    treatmentCertain: effective.certain,
    vertical,
    avatar,
    rows: rows.slice(0, KEYWORD_CAP),
    counts: {
      bank: bankFiltered.kept.length,
      audit: named.size,
      candidates: candidateFiltered.kept.length,
      deduped,
    },
    quality: {
      bankTotal: (bank ?? []).length,
      bankKept: bankFiltered.kept.length,
      faults: bankFiltered.faults,
    },
  };
}

/**
 * How much naming the locked offer is worth.
 *
 * Deliberately smaller than the visibility gap (15) and larger than an objection (12) is not:
 * it sits between "their own reviews say it" (8) and "it is an objection" (12), so a phrase that
 * names the offer sorts above an equivalent one that does not, and an objection about something
 * else still beats a bland phrase that happens to contain the treatment name. A filter would
 * have thrown the objections away entirely.
 */
const OFFER_BONUS = 10;

/**
 * Which of this client's audit questions an engine actually named them for, keyed by normalised
 * phrase so it joins to question_bank.
 *
 * ‼️ audit_runs.prompt, NEVER audit_reports.prompts. That column is regenerated by every audit
 * run, so quoting it would let a later scan rewrite the questions in a list already read out to
 * a client. Same reason client_pages.question is stored verbatim.
 *
 * ‼️ A FAILED RUN SAYS NOTHING. status !== "ok" is skipped entirely rather than recorded as
 * false, because "we did not manage to ask" and "they were not named" are different facts and
 * only one of them earns the largest term in the score.
 */
async function namedByPrompt(
  contactId: string | null,
  domain: string | null
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();

  let q = supabaseAdmin
    .from("audit_reports")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (contactId) q = q.eq("contact_id", contactId);
  else if (domain) q = q.ilike("website", `%${domain}%`);
  else return map;

  const { data: reports } = await q;
  const reportId = reports?.[0]?.id as string | undefined;
  if (!reportId) return map;

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("prompt, mentioned, status")
    .eq("report_id", reportId);

  for (const r of runs ?? []) {
    if (r.status !== "ok") continue;
    const prompt = String(r.prompt ?? "").trim();
    if (!prompt) continue;
    const key = normalizePhrase(prompt);
    map.set(key, (map.get(key) ?? false) || r.mentioned === true);
  }

  return map;
}

/**
 * The list as a Slack block, and the one sentence that has to be on it.
 *
 * ‼️ IT SAYS WHAT THE RANKING IS AND WHAT IT IS NOT. A list of ninety-nine phrases with a number
 * beside each one reads as search volume to anybody who has used a keyword tool, and that is a
 * claim this list cannot make. The header is not decoration.
 */
export function formatKeywordSet(set: KeywordSet, limit = 25): string[] {
  const lines: string[] = [
    `*${set.rows.length} phrases your market uses*, ranked by evidence and not by search volume.`,
  ];

  if (set.treatment) {
    lines.push(
      set.treatmentCertain
        ? `Aimed at *${set.treatment}*, locked on the call.`
        : `Aimed at *${set.treatment}*, which is only PROPOSED. Lock the offer and this re-ranks.`
    );
  } else {
    lines.push("No offer proposed or locked, so this is aimed at their whole menu.");
  }

  lines.push(
    "",
    "*The number is a score, not a volume.* It is commercial intent, how often the market said " +
      "it, whether it is an objection, whether any engine names them for it, and whether it " +
      "names the offer. Every term is a fact already in the database.",
    ""
  );

  for (const [i, row] of set.rows.slice(0, limit).entries()) {
    const gap = row.currentlyNamed === false ? " :dart:" : row.currentlyNamed === null ? "" : " :white_check_mark:";
    lines.push(`${String(i + 1).padStart(2, " ")}. ${row.phrase} _(${row.theme}, ${row.score})_${gap}`);
  }

  if (set.rows.length > limit) {
    lines.push("", `_and ${set.rows.length - limit} more._`);
  }

  lines.push(
    "",
    ":dart: means no engine named them for it, which is the largest term in the score. A tick " +
      "means one already does, so a page for it changes nothing.",
    `_Read ${set.counts.bank} from the market corpus, ${set.counts.audit} measured questions and ` +
      `${set.counts.candidates} page candidates; ${set.counts.deduped} were the same phrase twice._`
  );

  // ‼️ THE DROPPED COUNT GOES ON THE CARD. It is the difference between "your market only says
  // 172 things" and "279 stored rows are extraction debris", and those send somebody to two
  // completely different places.
  const dropped = set.quality.bankTotal - set.quality.bankKept;
  if (dropped > 0) {
    const top = Object.entries(set.quality.faults)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([fault, n]) => `${n} ${fault.replace(/_/g, " ")}`)
      .join(", ");
    lines.push(
      `_${dropped} of ${set.quality.bankTotal} corpus rows were skipped as extraction debris ` +
        `rather than anything anybody said (${top}). Nothing was deleted; they are filtered on ` +
        `read._`
    );
  }

  return lines;
}

/** The scoring definition, printed so the ranking can be argued with rather than believed. */
export function keywordScoreTerms(): typeof SCORE_TERMS {
  return SCORE_TERMS;
}
