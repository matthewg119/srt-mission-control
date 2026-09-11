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
//
// ‼️ ONCE A PERSON HAS APPROVED A KEYWORD SET (the keyword_set delivery step, 2026-09-11), THAT
// SET IS WHAT THIS RETURNS. The addendum: "buildKeywordSet and the studio's keywords command show
// the approved set when one exists, with its provenance, rather than recomputing a different
// ranking." Two rankings of one client's keywords is two answers to one question, and the page
// plan would follow whichever it happened to read. The evidence reader below is shared with the
// keyword step, so both halves read the market the same way.

import { supabaseAdmin } from "@/lib/db";
import { SCORE_TERMS, scoreCandidate, themeOf, offerBonus } from "./artifacts/page-candidates";
import { loadOffer, effectiveTreatment } from "./offers";
import { filterPhrases, tidyPhrase, normalizePhrase } from "./phrase-quality";

// Re-exported so existing importers keep one name for it. The definition moved to
// phrase-quality.ts, which imports nothing, so page-candidates.ts can share it without a cycle.
export { normalizePhrase };

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
  | "candidate"
  // ── The four below only appear on an APPROVED set, read from client_keywords. ──
  /** The deep research brief or its KEYWORDS block, as the keyword step files it. */
  | "research"
  /** Proposed by a model in the keyword step. Not evidence that anybody searched it. */
  | "expansion"
  /** An expansion phrase put to an engine by `keywords check`. */
  | "measured"
  /** Typed by a person with `keywords add:`. */
  | "manual";

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
  /** True when these are the rows a person approved at the keyword step, not a computed ranking. */
  approved: boolean;
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

// ─────────────────────────────────────────────────────────────────────────────
// The market's evidence, read once, shared with the keyword step
// ─────────────────────────────────────────────────────────────────────────────

/** One distinct phrase the market used, with everything the database knows about it. */
export interface EvidenceKeyword {
  phrase: string;
  normalized: string;
  origin: "harvest" | "deep_research" | "keywords";
  frequency: number;
  intent: number;
  objection: boolean;
  /** ‼️ TRI-STATE: from this client's audit, and null when that question was never run. */
  currentlyNamed: boolean | null;
  sourceUrl: string | null;
}

export interface EvidenceRead {
  vertical: string;
  avatar: string | null;
  rows: EvidenceKeyword[];
  /** Normal form to named, for every audit question that answered. */
  named: Map<string, boolean>;
  deduped: number;
  quality: { bankTotal: number; bankKept: number; faults: Record<string, number> };
}

/**
 * question_bank for this client's vertical and avatar, filtered and deduped, joined to whether
 * their audit's engines named them for each phrase.
 *
 * ‼️ IT REFUSES RATHER THAN FALLING BACK TO med_spa. verticalFor() in harvest.ts was changed to
 * refuse for exactly this reason: forty correctly-extracted phrases about choosing an AEO agency
 * were filed under med_spa because four readers took a `?? "med_spa"` default, and question_bank
 * has no client_id to unpick them by. A wrong corpus is worse than no list.
 */
export async function evidenceRows(clientId: string): Promise<EvidenceRead | { error: string }> {
  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id, vertical_slug, primary_avatar_slug, contact_id, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (clientError) return { error: clientError.message };
  if (!client) return { error: "no client row" };

  const vertical = (client.vertical_slug as string | null) ?? null;
  const avatar = (client.primary_avatar_slug as string | null) ?? null;

  if (!vertical) {
    return {
      error:
        "no vertical on the client, so there is no corpus to read. adoptAuditClassification " +
        "sets it when the baseline scan completes; if that step was skipped, set it on the board.",
    };
  }

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
  // fragments, whole paragraphs of somebody's prose. See phrase-quality.ts for the rules.
  const bankFiltered = filterPhrases(bank ?? [], (r) => String(r.phrase ?? ""));

  const named = await namedByPrompt(client.contact_id as string | null, client.domain as string | null);

  const byNormal = new Map<string, EvidenceKeyword>();
  let deduped = 0;

  for (const r of bankFiltered.kept) {
    const phrase = tidyPhrase(String(r.phrase ?? ""));
    if (!phrase) continue;
    // ‼️ RECOMPUTED, NOT READ OFF THE COLUMN. question_bank.normalized was written by more than
    // one code path over time, so two rows holding the SAME question can carry different
    // normalised forms and both survive the dedupe. Observed live: "How much does this cost?"
    // came back twice, adjacent, in the same ranked list.
    const normalized = normalizePhrase(phrase);
    const source = String(r.source ?? "harvest");
    const row: EvidenceKeyword = {
      phrase,
      normalized,
      origin: source === "deep_research" ? "deep_research" : source === "keywords" ? "keywords" : "harvest",
      frequency: Number(r.frequency_score ?? 1),
      intent: Number(r.commercial_intent_score ?? 0),
      objection: r.objection_phrase === true,
      currentlyNamed: named.get(normalized) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
    };

    const existing = byNormal.get(normalized);
    if (!existing) {
      byNormal.set(normalized, row);
      continue;
    }
    deduped += 1;
    // The same phrase twice knows more than either copy: keep the strongest reading of each term.
    byNormal.set(normalized, {
      ...existing,
      frequency: Math.max(existing.frequency, row.frequency),
      intent: Math.max(existing.intent, row.intent),
      objection: existing.objection || row.objection,
      sourceUrl: existing.sourceUrl ?? row.sourceUrl,
    });
  }

  return {
    vertical,
    avatar,
    rows: [...byNormal.values()],
    named,
    deduped,
    quality: {
      bankTotal: (bank ?? []).length,
      bankKept: bankFiltered.kept.length,
      faults: bankFiltered.faults,
    },
  };
}

/**
 * Every phrase this client's market uses, ranked, or the set a person approved.
 *
 * ‼️ THE OFFER IS A BONUS AND THE FALLBACK IS NOT SILENT. When an offer is locked, phrases
 * naming it sort above phrases that do not, which is what Matthew asked for: "start by selecting
 * the keywords of the selected offer to build every single link, question and lead magnet around
 * it". When nothing is locked the list still builds, and `treatmentCertain` is false so every
 * surface printing it can say the list is aimed at the whole menu.
 */
export async function buildKeywordSet(clientId: string): Promise<KeywordSet | { error: string }> {
  const offer = await loadOffer(clientId);
  const effective = effectiveTreatment(offer);
  const treatment = effective.value;

  // ── The approved set, when there is one ─────────────────────────────────────
  //
  // Dynamic, because client-keywords.ts imports evidenceRows from here.
  const { approvedKeywordSet } = await import("./client-keywords");
  const approved = await approvedKeywordSet(clientId);
  if (approved && approved.rows.length > 0) {
    return {
      clientId,
      treatment,
      treatmentCertain: effective.certain,
      vertical: approved.vertical,
      avatar: approved.avatar,
      approved: true,
      rows: approved.rows.map((r) => ({
        phrase: r.phrase,
        normalized: r.normalized,
        score: Math.round(r.score * 100) / 100,
        origin: r.origin,
        theme: r.categoryLabel,
        currentlyNamed: r.currentlyNamed,
        objection: false,
        intent: 0,
        frequency: 0,
        sourceUrl: r.sourceUrl,
        treatment,
      })),
      counts: { bank: 0, audit: 0, candidates: 0, deduped: 0 },
      quality: { bankTotal: 0, bankKept: 0, faults: {} },
    };
  }

  const evidence = await evidenceRows(clientId);
  if ("error" in evidence) return { error: evidence.error };

  // ── The per-client backlog ────────────────────────────────────────────────
  const { data: candidates } = await supabaseAdmin
    .from("page_candidates")
    .select("question, score, currently_named, in_own_reviews, origin")
    .eq("client_id", clientId)
    .order("score", { ascending: false })
    .limit(200);

  // ── One row per distinct phrase, best evidence wins ───────────────────────
  const byNormal = new Map<string, KeywordRow>();
  let deduped = evidence.deduped;

  const put = (row: KeywordRow) => {
    const existing = byNormal.get(row.normalized);
    if (!existing) {
      byNormal.set(row.normalized, row);
      return;
    }
    deduped += 1;
    // ‼️ THE HIGHER SCORE WINS, AND currentlyNamed MERGES RATHER THAN OVERWRITING. A phrase
    // that appears both in the bank and in the backlog knows two different things about itself:
    // how often the market said it, and whether an engine named this client for it.
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

  for (const e of evidence.rows) {
    put({
      phrase: e.phrase,
      normalized: e.normalized,
      origin: e.origin,
      theme: themeOf(e.phrase),
      // ‼️ THE OFFER BONUS IS ADDED HERE, AT ROW CREATION, AND NOT OVER THE MERGED LIST. Page
      // candidates already carry it in their stored score (page-candidates.ts applies the same
      // offerBonus), so adding it after the merge would count it twice on every candidate row.
      score:
        scoreCandidate({
          frequency: e.frequency,
          intent: e.intent,
          objection: e.objection,
          currentlyNamed: e.currentlyNamed,
          inOwnReviews: false,
        }) + offerBonus(e.phrase, treatment),
      currentlyNamed: e.currentlyNamed,
      objection: e.objection,
      intent: e.intent,
      frequency: e.frequency,
      sourceUrl: e.sourceUrl,
      treatment,
    });
  }

  // Page candidates are substituted from the same corpus, so they inherit the same debris.
  const candidateFiltered = filterPhrases(candidates ?? [], (c) => String(c.question ?? ""));

  for (const c of candidateFiltered.kept) {
    const phrase = tidyPhrase(String(c.question ?? ""));
    if (!phrase) continue;
    const normalized = normalizePhrase(phrase);
    const currentlyNamed = (c.currently_named as boolean | null) ?? evidence.named.get(normalized) ?? null;
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

  const rows = [...byNormal.values()].map((row) => ({
    ...row,
    score: Math.round(row.score * 100) / 100,
  }));

  rows.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  return {
    clientId,
    treatment,
    treatmentCertain: effective.certain,
    vertical: evidence.vertical,
    avatar: evidence.avatar,
    approved: false,
    rows: rows.slice(0, KEYWORD_CAP),
    counts: {
      bank: evidence.quality.bankKept,
      audit: evidence.named.size,
      candidates: candidateFiltered.kept.length,
      deduped,
    },
    quality: evidence.quality,
  };
}

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
  const lines: string[] = set.approved
    ? [
        `*${set.rows.length} approved keywords*, chosen at the keyword step and ranked evidence first. ` +
          "The page plan draws only from these.",
      ]
    : [`*${set.rows.length} phrases your market uses*, ranked by evidence and not by search volume.`];

  if (set.treatment) {
    lines.push(
      set.treatmentCertain
        ? `Aimed at *${set.treatment}*, locked on the prep call.`
        : `Aimed at *${set.treatment}*, which is only PROPOSED. Lock the offer and this re-ranks.`
    );
  } else {
    lines.push("No offer proposed or locked, so this is aimed at their whole menu.");
  }

  lines.push(
    "",
    "*The number is a score, not a volume.* It is commercial intent, how often the market said " +
      "it, whether it is an objection, whether any engine names them for it, and whether it " +
      "names the offer. Every term is a fact already in the database" +
      (set.approved ? ", except on an `expansion` row, which a model proposed and which ranks below evidence." : "."),
    ""
  );

  for (const [i, row] of set.rows.slice(0, limit).entries()) {
    const gap = row.currentlyNamed === false ? " :dart:" : row.currentlyNamed === null ? "" : " :white_check_mark:";
    const origin = set.approved ? `, ${row.origin}` : "";
    lines.push(`${String(i + 1).padStart(2, " ")}. ${row.phrase} _(${row.theme}${origin}, ${row.score})_${gap}`);
  }

  if (set.rows.length > limit) {
    lines.push("", `_and ${set.rows.length - limit} more._`);
  }

  lines.push(
    "",
    ":dart: means no engine named them for it, which is the largest term in the score. A tick " +
      "means one already does, so a page for it changes nothing."
  );

  if (!set.approved) {
    lines.push(
      `_Read ${set.counts.bank} from the market corpus, ${set.counts.audit} measured questions and ` +
        `${set.counts.candidates} page candidates; ${set.counts.deduped} were the same phrase twice._`
    );
  }

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
