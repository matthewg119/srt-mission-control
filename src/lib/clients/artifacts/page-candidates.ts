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
// The page studio's channel, named rather than linked: a Slack channel id is not a URL and a
// bare C0... in a card is worse than useless. pageStudioHint() reads the same env the lane
// itself reads, so a channel move cannot leave this pointing at the old one.
import { pageStudioHint } from "../page-studio";
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
  /**
   * ‼️ HARVESTED IS A PHRASE A BUYER TYPED. DERIVED IS A PAGE WE THOUGHT OF.
   *
   * Every row in this table until now was the first kind: real market wording, typos kept,
   * pulled off the pages the engines cited and substituted per tenant. The tools, guides and
   * comparison pages the second pass proposes are the other kind, assembled here out of
   * clusters in that corpus. They can be better pages than any single phrase. They are NOT
   * evidence that anybody asked for one, and a ranked list that mixes the two without saying
   * which is which is a list nobody can argue with. Printed on the PDF, stored on the row.
   */
  origin: "harvested" | "derived";
  /** For a derived idea, what it was built out of, in words. Null on a harvested phrase. */
  derivedFrom: string | null;
}

/** How many derived ideas may be proposed. ADDITIONAL to the harvested cap, never inside it. */
export const DERIVED_CAP = 12;

/** A cluster needs this many members before one page beats several. */
const MIN_CLUSTER = 3;

/**
 * Theme, not avatar.
 *
 * ‼️ `clients.primary_avatar` DOES NOT EXIST. `avatar_confirmed` is a manual step whose
 * instructions say to "map one to a1/a2/a3", and nothing stores the answer — so the column
 * `page_candidates.avatar` stays null and grouping happens by SHAPE instead. Writing a guessed
 * a1/a2/a3 here would be inventing the tag and then treating it as evidence, which is the exact
 * thing the question_bank migration's own comment forbids one table over.
 */
export function themeOf(question: string): string {
  const q = question.toLowerCase();
  if (isObjection(question)) return "Objection";
  if (/\b(vs|versus|compare|better than|or)\b/.test(q)) return "Comparison";
  // ‼️ ORDER IS LOAD-BEARING FOR THE TWO NEW ARMS, AND THEY SIT WHERE THEY CANNOT EAT PRICE.
  // Tool is deliberately narrow: it matches a question a CALCULATOR answers, never one a
  // sentence answers. "How much does X cost" is a Price page and stays one. Getting that wrong
  // turns the whole Price theme into tools, and the call then picks from a list of things
  // nobody is going to build.
  if (/\b(calculator|estimator|estimate|quiz|checker|worth it)\b/.test(q)) return "Tool";
  if (/\bhow (many|long) (sessions|treatments|does|will)\b/.test(q)) return "Tool";
  // Guide is the multi-step answer: what happens, in what order, and what to do about it.
  // Spelled out as `how (do|to|can|should)` rather than \bhow\b precisely so it cannot match
  // "how much", which belongs to Price.
  if (/\bhow (do|to|can|should)\b/.test(q)) return "Guide";
  if (/\b(what to expect|step by step|before and after|aftercare|recovery|prepare|preparing|checklist|guide)\b/.test(q)) {
    return "Guide";
  }
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

/**
 * The terms a candidate was scored on, kept so a CLUSTER can be scored the same way a phrase is.
 *
 * Not folded into ScoredCandidate: that shape is what the PDF and the board read, and adding
 * the raw inputs to it would invite something downstream to re-score off them and disagree
 * with the number already printed.
 */
interface ScoringInput {
  frequency: number;
  intent: number;
  objection: boolean;
  inOwnReviews: boolean;
}

/**
 * Page ideas that are NOT one question, one page.
 *
 * ‼️ THE WHOLE POINT IS THAT THIS IS A DIFFERENT KIND OF THING AND SAYS SO.
 * The harvested list answers "what did buyers actually type". This answers "what would one
 * page cover several of those at once". A calculator beats six separate cost answers, a guide
 * beats five fragments of one process, and a comparison page is the only honest answer to a
 * rival the engines keep naming. None of them is evidence of demand for that page, which is
 * why every row it produces carries origin: "derived" and a derivedFrom naming its own basis.
 *
 * ‼️ currentlyNamed IS ALWAYS null HERE, AND THAT IS NOT LAZINESS. No engine has ever been
 * asked about a page that does not exist, so "does an engine name them for this" has no
 * answer. The tri-state already handles it: only an explicit false earns the visibility-gap
 * bonus, the largest term in the formula. So a derived idea cannot out-rank a measured gap by
 * being a guess, which is exactly the guard scoreCandidate's own comment describes.
 */
function deriveIdeas(
  scored: ScoredCandidate[],
  terms: Map<string, ScoringInput>,
  competitors: Array<{ name: string; timesNamed: number }>
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  const taken = new Set(scored.map((c) => c.question.toLowerCase()));

  // Aggregate a cluster into one set of scoring terms.
  //   frequency SUMS   — one page answering six questions inherits all six askings.
  //   intent MEANS     — a page is as commercial as its average member, not as its best one.
  //                      Taking the max would let one "where do I book" drag five definitions up.
  //   objection is ANY — a page that answers the objection answers it, whatever else it covers.
  const clusterScore = (members: ScoredCandidate[]): number => {
    const inputs = members
      .map((m) => terms.get(m.question.toLowerCase()))
      .filter((x): x is ScoringInput => Boolean(x));
    if (inputs.length === 0) return 0;
    return scoreCandidate({
      frequency: inputs.reduce((a, b) => a + b.frequency, 0),
      intent: inputs.reduce((a, b) => a + b.intent, 0) / inputs.length,
      objection: inputs.some((i) => i.objection),
      currentlyNamed: null,
      inOwnReviews: inputs.some((i) => i.inOwnReviews),
    });
  };

  const push = (question: string, theme: string, derivedFrom: string, members: ScoredCandidate[]) => {
    if (taken.has(question.toLowerCase())) return;
    taken.add(question.toLowerCase());
    out.push({
      questionBankId: null,
      question,
      score: clusterScore(members),
      currentlyNamed: null,
      inOwnReviews: members.some((m) => m.inOwnReviews),
      theme,
      origin: "derived",
      derivedFrom,
    });
  };

  const byTheme = (t: string) => scored.filter((c) => c.theme === t);

  // 1. A calculator or checker for the pricing cluster.
  const priced = [...byTheme("Price"), ...byTheme("Tool")].sort((a, b) => b.score - a.score);
  if (priced.length >= MIN_CLUSTER) {
    push(
      `A cost estimator that answers "${priced[0].question}" and ${priced.length - 1} other pricing questions on one page`,
      "Tool",
      `${priced.length} pricing questions in the harvest, top-scoring: "${priced[0].question}"`,
      priced
    );
  }

  // 2. A guide per cluster of questions sharing an opening stem.
  //    The stem is the first three words, which is where a question announces what it is about
  //    ("how do I", "what happens during"). Cheap, and it groups the things a reader would
  //    expect to find in one place without a model deciding what is related to what.
  const stems = new Map<string, ScoredCandidate[]>();
  for (const c of [...byTheme("Guide"), ...byTheme("General")]) {
    const stem = c.question.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    if (stem.split(" ").length < 3) continue;
    stems.set(stem, [...(stems.get(stem) ?? []), c]);
  }
  const guideClusters = [...stems.entries()]
    .filter(([, list]) => list.length >= MIN_CLUSTER)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);
  for (const [stem, list] of guideClusters) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    push(
      `A guide covering "${sorted[0].question}" and ${sorted.length - 1} related questions`,
      "Guide",
      `${sorted.length} harvested questions opening "${stem}"`,
      sorted
    );
  }

  // 3. A comparison page per rival the engines keep naming.
  //    Grounded in competitor_candidates, which step 7 fills from the audit runs, so the name
  //    is one an engine really returned rather than one anybody here thought of. The count is
  //    printed with it for the same reason the DM lane prints a count per rival: a number
  //    stretched over a name it does not belong to is a claim the reader can check and beat.
  const comparisonMembers = byTheme("Comparison").sort((a, b) => b.score - a.score);
  for (const rival of competitors.slice(0, 3)) {
    push(
      `${rival.name} compared: what each is better at`,
      "Comparison",
      `The engines named ${rival.name} ${rival.timesNamed} time${rival.timesNamed === 1 ? "" : "s"} across this client's audit`,
      comparisonMembers.length ? comparisonMembers : scored.slice(0, 5)
    );
  }

  return out.sort((a, b) => b.score - a.score).slice(0, DERIVED_CAP);
}

/** The rivals the audit actually returned, most-named first. Empty is a normal answer. */
async function namedCompetitors(clientId: string): Promise<Array<{ name: string; timesNamed: number }>> {
  const { data } = await supabaseAdmin
    .from("competitor_candidates")
    .select("name, times_named")
    .eq("client_id", clientId)
    .order("times_named", { ascending: false })
    .limit(6);

  return (data ?? [])
    .map((r) => ({ name: ((r.name as string) ?? "").trim(), timesNamed: (r.times_named as number) ?? 0 }))
    .filter((r) => r.name.length > 1 && r.timesNamed > 0);
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
  // Kept so deriveIdeas can score a CLUSTER through the same scoreCandidate the phrases went
  // through, rather than inventing a second formula for the ideas the PDF prints beside them.
  const terms = new Map<string, ScoringInput>();

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

    const input: ScoringInput = {
      frequency: (row.frequency_score as number) ?? 1,
      intent: (row.commercial_intent_score as number) ?? commercialIntent(phrase),
      objection: (row.objection_phrase as boolean) ?? isObjection(phrase),
      inOwnReviews,
    };
    terms.set(key, input);

    scored.push({
      questionBankId: (row.id as string) ?? null,
      question,
      currentlyNamed,
      inOwnReviews,
      theme: themeOf(question),
      origin: "harvested",
      derivedFrom: null,
      score: scoreCandidate({ ...input, currentlyNamed }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, CANDIDATE_CAP);

  // Derived from the WHOLE scored set rather than the capped one: a cluster is an argument
  // about how many people asked around a subject, and throwing away the tail before counting
  // would make a six-question pricing cluster look like a three-question one.
  const derived = deriveIdeas(scored, terms, await namedCompetitors(clientId));

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
    [...top, ...derived].map((c) => ({
      client_id: clientId,
      question_bank_id: c.questionBankId,
      question: c.question,
      score: c.score,
      currently_named: c.currentlyNamed,
      in_own_reviews: c.inOwnReviews,
      // Written on every row, harvested included, so a derived idea that later turns up as a
      // real harvested phrase flips back to harvested rather than keeping a stale label.
      origin: c.origin,
      derived_from: c.derivedFrom,
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

  sectionHeading(state, `${top.length} candidates${derived.length ? ` and ${derived.length} derived ideas` : ""}, and why that number`);
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

  // ‼️ DERIVED IDEAS GET THEIR OWN SECTION, NOT A ROW IN THE THEME TABLES ABOVE.
  // Everything above is a phrase somebody typed. Everything here is a page this system thought
  // of. Interleaving them by score would make the second kind read as the first, which is the
  // one thing the origin column exists to prevent, and it would do it on the document the call
  // is run off.
  if (derived.length) {
    sectionHeading(state, `Derived ideas — ${derived.length}`);
    paragraph(
      state,
      "These are NOT harvested phrases. Nobody typed any of them. They are pages assembled here " +
        "out of clusters in the list above, on the argument that one page can answer several " +
        "questions better than several pages answer one each. Scored through the same formula, " +
        "with one difference stated out loud: none of them was ever put to an engine, so none " +
        "collects the visibility-gap bonus, which is the largest term. They rank on demand and " +
        "intent alone.",
      { color: AMBER, size: 9 }
    );
    keyValueTable(
      state,
      derived.map<TableRow>((c) => ({
        label: String(c.score),
        value: `[${c.theme}] ${c.question}\nBuilt from: ${c.derivedFrom ?? "unrecorded"}`,
      })),
      { labelWidth: 16, size: 8.5 }
    );
  }

  sectionHeading(state, "On the call");
  bulletList(state, [
    "Pick from the top of each theme rather than the top of the whole list, or every page ends up being the same kind of page.",
    "A question marked [already named] is a page that changes nothing. Skip it unless the client wants it for another reason.",
    "A question marked [not measured] is a guess about the gap. It can still be a good page, but it is not evidence of one.",
    "A derived idea is a page we proposed, not a question anybody asked. Judge it on whether it would be worth reading, not on its rank.",
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
      `${top.length} scored and written to \`page_candidates\`, grouped by theme` +
      `${derived.length ? `, plus ${derived.length} derived ideas (tools, guides and comparison pages we proposed, clearly labelled as ours)` : ""}. ` +
      `The weekly content digest reads this table, so from now on it picks the market's own ` +
      `phrasings instead of falling back to the audit's twenty.\n\n` +
      // The one line in steps 12 and 13 that reaches a person on the normal path. Both steps
      // are mode:"auto", so postReadySteps skips them and instructionsFor is never reached —
      // this note is the whole surface either of them has. It is where the ranked list stops
      // being a PDF and starts being pages.
      `*This is step 13, the PUBLISHING backlog: what is worth writing.* Step 12's question set ` +
      `is the MEASUREMENT set, frozen at Day 0, and nothing is ever published from it.\n` +
      `To turn any of these into a draft, post \`page ${name}\` in ${pageStudioHint()}. ` +
      `Pick a number, then type or send a voice note and your words go into the page verbatim.`,
  });

  if (!delivered.ok) return { ok: false, error: delivered.error };

  return {
    ok: true,
    docId: delivered.docId,
    note: `Page candidates scored: ${top.length} ranked${unmeasured ? `, ${unmeasured} of them unmeasured` : ""}.`,
  };
}
