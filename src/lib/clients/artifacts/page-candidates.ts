// Page candidates — delivery step 13, Runner v3 section 12.
//
// The questions worth building a page for, scored and ranked, so the call can pick from a list
// instead of brainstorming. Writes `page_candidates` and prints the ranked set as a PDF.
//
// ‼️ THIS IS THE MISSING WRITER FOR A TABLE THAT IS ALREADY BEING READ.
// `page_candidates` was created by docs/2026-08-19-harvest.sql and `content-digest.ts`
// (pickQuestions) already prefers it over the audit's twenty, with a comment explaining why:
// these are the market's own phrasings, the audit's twenty are a model's classification. Until
// now nothing ever inserted a row, so the weekly rhythm silently fell through to the audit
// questions every time. That is the whole reason this step is worth building first.
//
// ‼️ "100 FOR THE CALL" IS A CAP, NOT A PROMISE, AND THE LABEL SAYS SO NOW.
// CLAUDE.md: "prompt_library does not exist. The 100-prompt library from build prompt v4 §1 is
// unbuilt; classify.ts generates 20 questions per audit and those are what run." So the corpus
// is `question_bank` for this vertical plus this client's own twenty. That is usually well
// under a hundred, and a document promising a hundred while printing forty is the same species
// of lie as an `auto` tag with no runner behind it. The artifact prints the true N and why.
//
// ‼️ THE SCORE IS DEFINED HERE AND ITS DEFINITION IS PRINTED ON THE PDF.
// The v4 §7 formula is not in this repo. `findings.ts` already set the precedent for exactly
// this situation — "if it does not define it, define it, and say you had to define it". A
// ranking nobody can reconstruct is a ranking nobody can argue with, which is worse than a
// crude one that shows its working.
//
// ‼️ NO MODEL. Same argument `harvest.ts` makes about its own scores, one degree stronger:
// these rankings decide which pages get built and therefore which questions get measured. A
// number that moves on its own makes the day-30 comparison meaningless.

import { supabaseAdmin } from "@/lib/db";
import { commercialIntent, isObjection, verticalFor } from "../harvest";
import { applySubstitutions, substitutionsFor } from "../question-sets";
import {
  startDoc,
  finishDoc,
  coverHeading,
  sectionHeading,
  paragraph,
  keyValueTable,
  bulletList,
  ensureSpace,
  plainFooter,
  MUTED,
  AMBER,
  type PageState,
  type TableRow,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";
import type { AutoResult } from "./registry";

/** Runner v3 asks for 100 for the call. It is the ceiling on what gets printed, not a target. */
export const CANDIDATE_CAP = 100;

/**
 * The score, stated so it can be argued with.
 *
 * Every term is a fact already in the database. Nothing here is tuned against an outcome,
 * because there is no outcome data yet — the first cohort of pages has not been measured.
 * When there is, this is the function to revisit, and the printed definition is what makes
 * that revision legible rather than a silent re-ranking.
 */
export const SCORE_TERMS: Array<{ label: string; weight: number; why: string }> = [
  {
    label: "Commercial intent",
    weight: 10,
    why: "Someone asking where to book is closer to a customer than someone asking what a treatment is.",
  },
  {
    label: "How often it was asked",
    weight: 4,
    why: "Damped with a log, so one very common phrase cannot flatten everything else.",
  },
  {
    label: "It is an objection",
    weight: 12,
    why: "An objection page answers the thing that stops a booking, and almost nobody writes one.",
  },
  {
    label: "No engine names them for it",
    weight: 15,
    why: "The largest term, on purpose. A question they already win is a page that changes nothing.",
  },
  {
    label: "Their own reviews use the phrase",
    weight: 8,
    why: "A phrase their customers already say beats one we think they might.",
  },
];

export interface ScoredCandidate {
  questionBankId: string | null;
  question: string;
  score: number;
  /** ‼️ TRI-STATE. null means the question was never run, which is not the same as "not named". */
  currentlyNamed: boolean | null;
  inOwnReviews: boolean;
  theme: string;
}

/**
 * Theme, not avatar.
 *
 * ‼️ `clients.primary_avatar` DOES NOT EXIST. `avatar_confirmed` is a manual step whose
 * instructions say to "map one to a1/a2/a3", and nothing stores the answer — so the column
 * `page_candidates.avatar` stays null and grouping happens by SHAPE instead. Writing a guessed
 * a1/a2/a3 here would be inventing the tag and then treating it as evidence, which is the exact
 * thing the question_bank migration's own comment forbids one table over.
 */
function themeOf(question: string): string {
  const q = question.toLowerCase();
  if (isObjection(question)) return "Objection";
  if (/\b(vs|versus|compare|better than|or)\b/.test(q)) return "Comparison";
  if (/\b(cost|price|how much|cheap|afford|deal|financing|membership)\b/.test(q)) return "Price";
  if (/\b(near me|in |close to|local|around)\b/.test(q)) return "Neighbourhood";
  if (/\b(book|appointment|consult|schedule)\b/.test(q)) return "Booking";
  return "General";
}

export function scoreCandidate(args: {
  frequency: number;
  intent: number;
  objection: boolean;
  currentlyNamed: boolean | null;
  inOwnReviews: boolean;
}): number {
  const w = (label: string) => SCORE_TERMS.find((t) => t.label === label)?.weight ?? 0;

  let score = args.intent * w("Commercial intent");
  score += Math.log1p(Math.max(0, args.frequency)) * w("How often it was asked");
  if (args.objection) score += w("It is an objection");
  // ‼️ Only an explicit false earns the bonus. null means nobody asked that question of the
  // engines, and treating "we did not ask" as "they were not named" would rank an unmeasured
  // question above a measured one for no reason but our own ignorance.
  if (args.currentlyNamed === false) score += w("No engine names them for it");
  if (args.inOwnReviews) score += w("Their own reviews use the phrase");

  return Math.round(score * 100) / 100;
}

/** Which of this client's audit questions did an engine actually name them for. */
async function namedByQuestion(clientId: string): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("contact_id, domain")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return map;

  // Same two-rung join the rest of the client code uses. audit_reports.client_id is the better
  // key and is deliberately not used: docs/2026-08-19-artifact-plumbing.sql adds it, and
  // PostgREST fails the WHOLE query on one unknown column rather than ignoring it.
  let q = supabaseAdmin.from("audit_reports").select("id").order("created_at", { ascending: false }).limit(1);
  if (client.contact_id) q = q.eq("contact_id", client.contact_id as string);
  else if (client.domain) q = q.ilike("website", `%${client.domain as string}%`);
  else return map;

  const { data: reports } = await q;
  const reportId = reports?.[0]?.id as string | undefined;
  if (!reportId) return map;

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("prompt, mentioned, status")
    .eq("report_id", reportId);

  for (const r of runs ?? []) {
    // A failed or missing run says nothing. run-prompts.ts refuses to turn one into a guessed
    // false and so does this: the key is simply absent, and the caller reads that as null.
    if (r.status !== "ok") continue;
    const prompt = ((r.prompt as string) ?? "").trim();
    if (!prompt) continue;
    const named = r.mentioned === true;
    // Any engine naming them counts as named.
    map.set(prompt.toLowerCase(), (map.get(prompt.toLowerCase()) ?? false) || named);
  }

  return map;
}

/** Phrases the client's own customers used, via the review tool. Empty before the tool is live. */
async function ownReviewText(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("review_tool_submissions")
    .select("answers")
    .eq("client_id", clientId)
    .limit(200);

  return (data ?? [])
    .map((r) => JSON.stringify(r.answers ?? {}))
    .join(" ")
    .toLowerCase();
}

export async function generatePageCandidates(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, vertical_slug, business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  // Refuses rather than guessing. Same read-side reasoning as custom-question-set.ts: page
  // candidates scored against another vertical's phrases are a ranked list of the wrong questions.
  const resolvedVertical = await verticalFor(clientId);
  if (!resolvedVertical.ok) return { ok: false, error: resolvedVertical.error };
  const vertical = resolvedVertical.vertical;
  const subs = await substitutionsFor(clientId);
  if (!subs) return { ok: false, error: "Client not found while reading substitutions." };

  const { data: bank } = await supabaseAdmin
    .from("question_bank")
    .select("id, phrase, frequency_score, commercial_intent_score, objection_phrase")
    .eq("vertical", vertical)
    .order("commercial_intent_score", { ascending: false })
    .order("frequency_score", { ascending: false })
    .limit(400);

  const named = await namedByQuestion(clientId);
  const reviewText = await ownReviewText(clientId);

  const seen = new Set<string>();
  const scored: ScoredCandidate[] = [];

  for (const row of bank ?? []) {
    const phrase = ((row.phrase as string) ?? "").trim();
    if (!phrase) continue;

    // Substituted per tenant, through the SAME chain the tracked twenty use, so a candidate
    // and a tracked question never disagree about what city this client is in.
    const question = applySubstitutions(phrase, subs);
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const currentlyNamed = named.has(key) ? (named.get(key) as boolean) : null;
    const inOwnReviews = reviewText.length > 0 && reviewText.includes(phrase.toLowerCase());

    scored.push({
      questionBankId: (row.id as string) ?? null,
      question,
      currentlyNamed,
      inOwnReviews,
      theme: themeOf(question),
      score: scoreCandidate({
        frequency: (row.frequency_score as number) ?? 1,
        intent: (row.commercial_intent_score as number) ?? commercialIntent(phrase),
        objection: (row.objection_phrase as boolean) ?? isObjection(phrase),
        currentlyNamed,
        inOwnReviews,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, CANDIDATE_CAP);

  if (top.length === 0) {
    return {
      ok: false,
      error:
        `No harvested phrases for vertical "${vertical}", so there is nothing to score. ` +
        `The avatar phrase harvest (step 9) fills question_bank, and it either has not run ` +
        `or came back empty. Nothing was written.`,
    };
  }

  // Idempotent on (client_id, question) — the unique index in docs/2026-08-22-prepare-steps.sql.
  // Runner v3 §2 names this table for exactly this reason: re-running a step must never
  // duplicate rows. `selected_for_month` is NOT in the update set, so a page somebody already
  // picked keeps its selection when the scores are recomputed.
  const { error: writeError } = await supabaseAdmin.from("page_candidates").upsert(
    top.map((c) => ({
      client_id: clientId,
      question_bank_id: c.questionBankId,
      question: c.question,
      score: c.score,
      currently_named: c.currentlyNamed,
      in_own_reviews: c.inOwnReviews,
    })),
    { onConflict: "client_id,question" }
  );

  if (writeError) return { ok: false, error: `Writing page_candidates failed: ${writeError.message}` };

  // ── The document ──────────────────────────────────────────────────────────
  const name = (client.dba_name || client.legal_name || "Client") as string;
  const state: PageState = startDoc({
    title: `${name} — page candidates`,
    footer: plainFooter(`${name} — page candidates · internal`),
  });

  coverHeading(state, {
    eyebrow: "Page candidates",
    title: name,
    subtitle: "The questions worth answering with a page, ranked, so the call picks from a list.",
  });

  sectionHeading(state, `${top.length} candidates, and why that number`);
  paragraph(
    state,
    `Scored from ${scored.length} harvested phrase${scored.length === 1 ? "" : "s"} for ${vertical}, ` +
      `substituted for this client. Runner v3 asks for a hundred for the call and a hundred is the ` +
      `CEILING here, not a target: the corpus is what the harvest actually found plus this client's ` +
      `own audit questions. There is no separate hundred-prompt library, so a shorter list means a ` +
      `shorter harvest, not a shortcut.`,
    { size: 9.5 }
  );

  const unmeasured = top.filter((c) => c.currentlyNamed === null).length;
  if (unmeasured > 0) {
    paragraph(
      state,
      `${unmeasured} of these were never put to an engine, so whether this business is already ` +
        `named for them is unknown. They are scored WITHOUT the visibility-gap bonus rather than ` +
        `being assumed to be gaps, so they rank below questions we have actually measured.`,
      { color: AMBER, size: 9.5 }
    );
  }

  sectionHeading(state, "How the score is built");
  paragraph(
    state,
    "There is no inherited formula for this, so it is defined here and printed so it can be " +
      "argued with. Nothing is tuned against results, because the first pages have not been " +
      "measured yet.",
    { color: MUTED, size: 9 }
  );
  keyValueTable(
    state,
    SCORE_TERMS.map<TableRow>((t) => ({ label: `${t.label} (x${t.weight})`, value: t.why })),
    { labelWidth: 58, size: 8.5 }
  );

  // ‼️ Grouped by theme rather than by avatar, and the document says why out loud.
  sectionHeading(state, "Grouped by theme");
  paragraph(
    state,
    "Not grouped by avatar: nothing in the system records which avatar was confirmed, so an " +
      "a1/a2/a3 tag here would be invented rather than read. Theme is derived from the shape of " +
      "the question itself.",
    { color: MUTED, size: 9 }
  );

  const byTheme = new Map<string, ScoredCandidate[]>();
  for (const c of top) {
    const list = byTheme.get(c.theme) ?? [];
    list.push(c);
    byTheme.set(c.theme, list);
  }

  for (const [theme, list] of [...byTheme.entries()].sort((a, b) => b[1].length - a[1].length)) {
    ensureSpace(state, 26);
    sectionHeading(state, `${theme} — ${list.length}`);
    keyValueTable(
      state,
      list.slice(0, 25).map<TableRow>((c) => ({
        label: String(c.score),
        value:
          c.question +
          (c.currentlyNamed === true
            ? "  [already named]"
            : c.currentlyNamed === null
              ? "  [not measured]"
              : ""),
        tone: c.currentlyNamed === false ? "good" : "normal",
      })),
      { labelWidth: 16, size: 8.5 }
    );
    if (list.length > 25) {
      paragraph(state, `${list.length - 25} more in this theme, in the filed data.`, {
        color: MUTED,
        size: 8.5,
      });
    }
  }

  sectionHeading(state, "On the call");
  bulletList(state, [
    "Pick from the top of each theme rather than the top of the whole list, or every page ends up being the same kind of page.",
    "A question marked [already named] is a page that changes nothing. Skip it unless the client wants it for another reason.",
    "A question marked [not measured] is a guess about the gap. It can still be a good page, but it is not evidence of one.",
    "Nothing is published until the Day-0 archive exists.",
  ]);

  const buffer = finishDoc(state);

  const delivered = await deliverArtifact({
    clientId,
    stepKey: "page_candidates",
    filename: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-page-candidates.pdf`,
    buffer,
    message:
      `*Page candidates — ${name}*\n` +
      `${top.length} scored and written to \`page_candidates\`, grouped by theme. ` +
      `The weekly content digest reads this table, so from now on it picks the market's own ` +
      `phrasings instead of falling back to the audit's twenty.`,
  });

  if (!delivered.ok) return { ok: false, error: delivered.error };

  return {
    ok: true,
    docId: delivered.docId,
    note: `Page candidates scored: ${top.length} ranked${unmeasured ? `, ${unmeasured} of them unmeasured` : ""}.`,
  };
}
