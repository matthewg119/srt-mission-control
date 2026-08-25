// universal_v1 and materialization_v1. Amendment A2 D-P15.
//
// ‼️ THESE TWENTY ARE THE 20 QUESTIONS PDF, CHARACTER FOR CHARACTER, AND THAT IS THE POINT.
// A2 §4: "the tracked set must be the questions the public actually received, because Beat 11
// says so on camera — 'the twenty in the PDF are the ones everybody's patients ask'." If the
// shipped PDF's wording ever diverges from this, the SHIPPED wording wins and A2 gets a v2.
//
// ‼️ THE FALLBACK SET IN docs/specs/SRT-Question-Sets-v1.md IS RETIRED. It is keyword-shaped
// ("best med spa in {city}") where these are full natural-language questions, and it uses
// variables materialization_v1 does not define. It is kept in that file only as the diff A2
// anticipated. Nothing may seed universal_v1 from it.
//
// These live in code as the SOURCE, and are frozen into question_set_versions as a ROW at
// first use — A2 §6 is explicit that a code constant alone is not enough, because defending
// a case study in two years means showing the exact text that ran, and a constant in a file
// edited forty times since cannot do that.
//
// ‼️ AND THEY ARE THE MED SPA SET. THEY ARE NOT A DEFAULT FOR EVERY OTHER VERTICAL.
//
// They were materialized verbatim for every client whatever their vertical, so the live call
// sheet for an AI-visibility MARKETING AGENCY read "What's the best med spa near Greensboro, NC
// for Chatgpt ads?" and "Who does the best lip filler in Greensboro, NC?". `universalSetFor()`
// at the bottom of this file is the branch for everybody else: it derives twenty from that
// client's OWN audit and freezes them as `universal_v1@{vertical}`, once. The twenty above and
// `freezeUniversalV1()` below are untouched by it.

import { supabaseAdmin } from "@/lib/db";

export const UNIVERSAL_V1_MED_SPA: readonly string[] = [
  "What's the best med spa near me for [Botox / filler / laser]?",
  "Who does the best lip filler in [city]?",
  "Where should I go for laser hair removal in [city] if I have sensitive skin?",
  "What's a reputable med spa in [city] for a first-timer?",
  "Which med spas in [city] have the best reviews for [treatment]?",
  "Is [treatment] safe, and how do I find a qualified provider near me?",
  "How do I know if a med spa is legit / has licensed injectors?",
  "What should I look for in a med spa before booking?",
  "Has anyone had a bad experience with [treatment], and how do I avoid it?",
  "Which med spas in [city] are run by nurses or doctors?",
  "How much does [Botox / filler / etc.] cost in [city]?",
  "What's the average price for [treatment] near me?",
  "Which med spa in [city] has the best value for [treatment]?",
  "Are there any deals or membership plans for [treatment] in [city]?",
  "Compare [Clinic A] vs [Clinic B] in [city].",
  "Book me a consultation for [treatment] near me.",
  "What med spa in [city] specializes in [specific concern — e.g., melasma, acne scars]?",
  "Who's the best injector for natural-looking results in [city]?",
  "Which med spa near me offers [specific device / brand — e.g., Morpheus8, CoolSculpting]?",
  "I had a bad experience with laser before — who in [city] is gentle and experienced with nervous patients?",
];

/** Questions 7, 8 and 9 carry no location in the text, so materialization prefixes one. */
const NEEDS_LOCATION_PREFIX = new Set([7, 8, 9]);

export interface Substitutions {
  city: string;
  state: string;
  treatmentPrimary: string;
  clientName: string;
  competitorIntake1: string;
  concern: string;
  devicePrimary: string;
}

/** A2 §4's fallbacks, and the fidelity footer has to say when one was used. */
export const MATERIALIZATION_FALLBACKS = {
  concern: "melasma",
  devicePrimary: "Morpheus8",
} as const;

/**
 * materialization_v1: the ONLY things that change per tenant are the bracketed placeholders.
 *
 * Everything else runs verbatim, including "med spa", "injector" and "laser". A2 is explicit
 * about that: the question shapes are the public's, not ours, and rewording one to sound
 * better makes it a different question with its own baseline.
 */
export function materialize(question: string, i: number, s: Substitutions): string {
  // The replace chain lives in applySubstitutions so the custom set and the page candidates
  // share it. What stays here is the part that is specific to the universal twenty: three of
  // them carry no location in their text, so materialization prefixes one.
  let out = applySubstitutions(question, s);

  if (NEEDS_LOCATION_PREFIX.has(i + 1)) {
    out = `I'm in ${s.city}, ${s.state}. ${out}`;
  }

  return out;
}

export function materializeAll(s: Substitutions): string[] {
  return UNIVERSAL_V1_MED_SPA.map((q, i) => materialize(q, i, s));
}

/**
 * ‼️ ONE TABLE, SO THE SUBSTITUTION AND THE "WHICH VALUE FILLED THIS" QUESTION CANNOT DRIFT.
 *
 * `applySubstitutions` used to be a hand-written replace chain. The chain is still exactly the
 * chain, in exactly the same order, but it is now READ off this table — because `materializeSet`
 * has to answer a second question about the same text ("was this filled from intake, or from a
 * fallback noun that is a fact about the med spa twenty?") and a second hand-written list of
 * which placeholder maps to which key is how the call sheet ends up labelling a question
 * `from intake` while a fallback is what actually filled it.
 *
 * ORDER IS LOAD-BEARING: longest patterns first, or `[treatment]` eats the inside of the
 * compound ones.
 */
const SUBSTITUTION_RULES: ReadonlyArray<{
  pattern: RegExp;
  /** Every substitution value this placeholder consumes. `[city]` consumes two. */
  keys: ReadonlyArray<keyof Substitutions>;
  replace: (s: Substitutions, where: string) => string;
}> = [
  { pattern: /\[Botox \/ filler \/ laser\]/g, keys: ["treatmentPrimary"], replace: (s) => s.treatmentPrimary },
  { pattern: /\[Botox \/ filler \/ etc\.\]/g, keys: ["treatmentPrimary"], replace: (s) => s.treatmentPrimary },
  { pattern: /\[specific concern — e\.g\., melasma, acne scars\]/g, keys: ["concern"], replace: (s) => s.concern },
  { pattern: /\[specific device \/ brand — e\.g\., Morpheus8, CoolSculpting\]/g, keys: ["devicePrimary"], replace: (s) => s.devicePrimary },
  { pattern: /\[Clinic A\]/g, keys: ["clientName"], replace: (s) => s.clientName },
  { pattern: /\[Clinic B\]/g, keys: ["competitorIntake1"], replace: (s) => s.competitorIntake1 },
  { pattern: /\[treatment\]/g, keys: ["treatmentPrimary"], replace: (s) => s.treatmentPrimary },
  { pattern: /\[city\]/g, keys: ["city", "state"], replace: (_s, where) => where },
  { pattern: /near me/g, keys: ["city", "state"], replace: (_s, where) => `near ${where}` },
];

/**
 * The bracket substitutions, without the universal-20 numbering.
 *
 * `materialize()` takes an index because three of the twenty need a location PREFIX, which is a
 * fact about those specific questions. A harvested phrase has no index and no such rule, so it
 * gets the replace chain and nothing else.
 *
 * Split out of materialize() rather than duplicated: the custom question set and the page
 * candidates both substitute market phrasings, and a second copy of this chain is how a
 * candidate ends up saying "near me" on a page while the tracked question says "near
 * Greensboro, NC".
 *
 * ‼️ THE SIGNATURE IS FIXED. Three files call it and two of them are not this lane's.
 */
export function applySubstitutions(text: string, s: Substitutions): string {
  const where = `${s.city}, ${s.state}`;
  let out = text;
  for (const rule of SUBSTITUTION_RULES) {
    out = out.replace(rule.pattern, rule.replace(s, where));
  }
  return out;
}

/**
 * Which substitution values a question actually consumes.
 *
 * `String.search` rather than `RegExp.test`: the patterns above carry /g, and `test` on a global
 * regex advances `lastIndex` on the shared module-level object, so the second question asked
 * about the same pattern would silently get a different answer. `search` ignores the flag.
 */
function keysUsedIn(text: string): Set<keyof Substitutions> {
  const used = new Set<keyof Substitutions>();
  for (const rule of SUBSTITUTION_RULES) {
    if (text.search(rule.pattern) === -1) continue;
    for (const k of rule.keys) used.add(k);
  }
  return used;
}

// ─────────────────────────────────────────────────────────────────────────────
// Where each substituted value came from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ NOTHING USED TO DISTINGUISH A REAL INTAKE VALUE FROM A FALLBACK, AND THAT WAS THE BUG.
 *
 * The live call sheet asked an AI-visibility marketing agency "Who does the best lip filler in
 * Greensboro, NC?" and "What med spa in Greensboro, NC specializes in melasma?". Every one of
 * those rendered identically to a question genuinely built out of what the client told us,
 * because substitutionsFor returned seven strings and no account of where any of them came from.
 *
 *   intake              the client said it: services.primary_service, ideal_patient.highest_margin,
 *                       clients.city / .state, the name on the row
 *   selected_competitor a competitor CONFIRMED on the board at step 7, which outranks intake
 *   fallback            MATERIALIZATION_FALLBACKS. A fact about the med spa twenty, nothing else
 *   missing             nothing on the record fills it
 */
export type SubSource = "intake" | "selected_competitor" | "fallback" | "missing";

export type SubProvenance = Record<keyof Substitutions, SubSource>;

export interface SubstitutionsResolved {
  values: Substitutions;
  provenance: SubProvenance;
}

/**
 * Is this string a competitor we would put to an engine?
 *
 * ‼️ MECHANICAL, BECAUSE THE LIVE FAILURE WAS THE STRING "a".
 * That is literally what the client typed into the competitor box at intake, and it went
 * straight into "Compare SRT Agency LLC vs a in Greensboro, NC". A prose rule ("use a sensible
 * value") is not a rule. Three characters, containing a two-letter run, is.
 *
 * It does NOT remove the name from the shortlist: a client naming businesses no engine has ever
 * heard of is itself a finding and step 7's card still shows it. It only stops the string being
 * put to an engine as if it were a business.
 */
export function usableCompetitorName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s.length < 3) return null;
  if (!/[A-Za-z]{2,}/.test(s)) return null;
  return s;
}

/** The first line of a textarea answer. Intake collects services as free text, several lines. */
function firstLine(raw: unknown): string {
  return String(raw ?? "").split(/[\n;]/)[0]?.trim() ?? "";
}

/**
 * One client's substitution values AND where each one came from.
 *
 * ‼️ ONE MAPPING, THREE CONSUMERS. This was inline in call-sheet.ts, and the custom question set
 * and the page candidates both needed the same values. Three copies of "which field is
 * treatmentPrimary" is how the call sheet ends up printing a substituted question that differs
 * from the one actually being tracked — and the call sheet's whole job is to be the thing read
 * out loud while the client corrects it.
 */
export async function substitutionsWithProvenance(
  clientId: string
): Promise<SubstitutionsResolved | null> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("city, state, services, ideal_patient, dba_name, legal_name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return null;

  const services = (client.services ?? {}) as Record<string, unknown>;
  const ideal = (client.ideal_patient ?? {}) as Record<string, string>;

  const city = ((client.city as string | null) ?? "").trim();
  const state = ((client.state as string | null) ?? "").trim();
  // ‼️ `services.primary_service` HAS NEVER EXISTED, AND THIS WAS READING IT.
  // The intake key is `services_list` (config/client-intake.ts step 2, required, "Everything you
  // offer, in your own words"). So for every client without `ideal_patient.highest_margin` this
  // resolved to the empty string and `[treatment]` was substituted with nothing. Another reader
  // with no writer, the class this repo keeps finding. `primary_service` is kept at the end of
  // the chain in case a row somewhere really does carry it; it costs nothing and removing a key
  // is how a row nobody knew about goes blank.
  //
  // `highest_margin` still wins, and it should: the intake question is "which service is your
  // highest margin", which is exactly what a tracked buying question should be about.
  const treatmentPrimary = (
    ideal.highest_margin ||
    firstLine(services.services_list) ||
    String(services.primary_service ?? "")
  ).trim();
  const clientName = (((client.dba_name || client.legal_name) as string | null) ?? "").trim();

  // ‼️ THE CONFIRMED COMPETITOR OUTRANKS THE TYPED ONE. Step 7 is where somebody looked at who
  // the engines actually named and picked three; intake is a guess made before any of that ran.
  // loadCandidates already orders by times_named desc, so the first selected row is the top one.
  const { selectedCompetitors } = await import("./competitors");
  const picked = (await selectedCompetitors(clientId)).find(
    (c) => usableCompetitorName(c.name) !== null
  );
  const typed = usableCompetitorName(String(services.competitors ?? "").split(/[\n,;]/)[0]);

  return {
    values: {
      city,
      state,
      treatmentPrimary,
      clientName,
      competitorIntake1: picked?.name ?? typed ?? "",
      concern: MATERIALIZATION_FALLBACKS.concern,
      devicePrimary: MATERIALIZATION_FALLBACKS.devicePrimary,
    },
    provenance: {
      city: city ? "intake" : "missing",
      state: state ? "intake" : "missing",
      treatmentPrimary: treatmentPrimary ? "intake" : "missing",
      clientName: clientName ? "intake" : "missing",
      competitorIntake1: picked ? "selected_competitor" : typed ? "intake" : "missing",
      concern: "fallback",
      devicePrimary: "fallback",
    },
  };
}

/**
 * The values alone.
 *
 * ‼️ THE SIGNATURE AND RETURN TYPE ARE FIXED, and that is why this is a two-line delegate rather
 * than the whole body. custom-question-set.ts and page-candidates.ts both call it and neither
 * belongs to this lane; widening the return would have meant editing both.
 */
export async function substitutionsFor(clientId: string): Promise<Substitutions | null> {
  return (await substitutionsWithProvenance(clientId))?.values ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materializing a set, and dropping what cannot be filled honestly
// ─────────────────────────────────────────────────────────────────────────────

/** Which half of the set a question's values came from. Printed beside it on the call sheet. */
export type QuestionOrigin = "intake" | "universal";

export const ORIGIN_LABEL: Record<QuestionOrigin, string> = {
  intake: "from intake",
  universal: "from the universal set",
};

export interface MaterializedQuestion {
  /** 1-based position in the SOURCE set, so a drop is visible as a gap rather than hidden. */
  index: number;
  text: string;
  origin: QuestionOrigin;
}

export interface DroppedQuestion {
  index: number;
  /** The question as it stood before substitution. */
  source: string;
  reason: string;
}

export interface MaterializedSet {
  questions: MaterializedQuestion[];
  dropped: DroppedQuestion[];
  /** Substitution keys filled from MATERIALIZATION_FALLBACKS. Named in the fidelity note. */
  fallbacksUsed: string[];
}

/** Anything still in brackets after the chain has run. A placeholder nobody filled. */
const RESIDUAL_PLACEHOLDER = /\[[^\]]+\]/;

/**
 * Materialize a whole set, and say what happened to each question.
 *
 * ‼️ THE med_spa PATH IS WHAT IT WAS AND NOTHING IS EVER DROPPED FROM IT.
 * That set is the 20 Questions PDF character for character (A2 D-P15) and the fallbacks are a
 * fact about it: melasma and Morpheus8 are real answers to "which concern" and "which device"
 * for a med spa. The location prefix on questions 7, 8 and 9 still applies.
 *
 * ‼️ OUTSIDE med_spa A QUESTION THAT CANNOT BE FILLED IS DROPPED, NOT GUESSED AT.
 * melasma and Morpheus8 are not facts about a marketing agency, a law firm or a roofer, and
 * neither is [treatment] filled from an empty services.primary_service. That is how the live
 * call sheet came to ask "What's the best med spa near Greensboro, NC for Chatgpt ads?". A
 * dropped question is honest and the fidelity note names it; a question materialized with the
 * wrong noun is read out loud to a client who then stops believing the rest of the document.
 */
export function materializeSet(
  questions: readonly string[],
  s: Substitutions,
  provenance: SubProvenance,
  opts: { vertical: string }
): MaterializedSet {
  const isMedSpa = opts.vertical === "med_spa";
  const out: MaterializedQuestion[] = [];
  const dropped: DroppedQuestion[] = [];
  const fallbacksUsed = new Set<string>();

  questions.forEach((q, i) => {
    const index = i + 1;
    const used = keysUsedIn(q);

    // The location prefix consumes city and state whether or not the question text does.
    if (isMedSpa && NEEDS_LOCATION_PREFIX.has(index)) {
      used.add("city");
      used.add("state");
    }

    for (const k of used) {
      if (provenance[k] === "fallback") fallbacksUsed.add(k);
    }

    let text = applySubstitutions(q, s);
    if (isMedSpa && NEEDS_LOCATION_PREFIX.has(index)) {
      text = `I'm in ${s.city}, ${s.state}. ${text}`;
    }

    if (!isMedSpa) {
      const bad = [...used].filter(
        (k) => provenance[k] === "fallback" || provenance[k] === "missing"
      );
      if (bad.length) {
        dropped.push({
          index,
          source: q,
          reason:
            `nothing on the record fills ${bad.join(", ")}` +
            (bad.some((k) => provenance[k] === "fallback")
              ? ", and the med spa fallback nouns are not a fact about this business"
              : ""),
        });
        return;
      }
      const residual = RESIDUAL_PLACEHOLDER.exec(text);
      if (residual) {
        dropped.push({
          index,
          source: q,
          reason: `it still carries an unfilled placeholder: ${residual[0]}`,
        });
        return;
      }
    }

    // ‼️ "from intake" MEANS THE CLIENT SUPPLIED WHAT FILLED IT, and a question filled from a
    // fallback or from nothing may never carry that label. Questions 1 and 2 of the universal
    // twenty are the primary service and the city, which is why they are normally the ones that
    // read `from intake` — printed so the client corrects the right ones on the call.
    const sources = [...used].map((k) => provenance[k]);
    const origin: QuestionOrigin =
      sources.length > 0 && sources.every((x) => x === "intake" || x === "selected_competitor")
        ? "intake"
        : "universal";

    out.push({ index, text, origin });
  });

  return { questions: out, dropped, fallbacksUsed: [...fallbacksUsed] };
}

// ────────────────────────────────────────────────────────────────────────────
// Questions 1 and 2, which are the client's own
// ────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ THE SHAPES ARE LIFTED FROM THE FROZEN TWENTY. NOTHING HERE IS A NEW QUESTION SHAPE.
 *
 * Matthew: "question 1 and 2 are custom (unless they grabbed it from intake form) which i dont
 * believe they did." They did not: the universal twenty were materialized for every vertical, so
 * a marketing agency's questions 1 and 2 were a med spa's questions 1 and 2 with a noun swapped.
 *
 * The two shapes below are UNIVERSAL_V1_MED_SPA[1] and [7] with the category taken out. That is
 * deliberate and it is the whole safety argument: a question shape invented here would be a shape
 * nobody has ever measured against, and A2 is explicit that rewording a question makes it a
 * different question with its own baseline. What varies is the noun, and the noun is the client's
 * own intake words.
 *
 * ‼️ THEY ARE NOT PART OF THE FROZEN SET AND MUST NOT BE.
 * question_set_versions is keyed per VERTICAL and carries no client_id, because a universal set
 * exists so two businesses in one vertical can be compared. These two carry this client's city
 * and this client's service, so freezing them would file one client's answers under everybody's
 * version. They are composed on top, per client, every time.
 *
 * They are labelled `from intake` on the call sheet precisely BECAUSE they may be wrong: the
 * label is what tells the client which questions are theirs to correct while it is read out.
 */
const INTAKE_QUESTION_SHAPES: ReadonlyArray<(service: string, where: string) => string> = [
  (service, where) => `Who does the best ${service} in ${where}?`,
  (service, where) => `What should I look for when choosing ${service} in ${where}?`,
];

/**
 * The two questions built from what the client typed at intake, or none at all.
 *
 * ‼️ BOTH VALUES HAVE TO BE REAL INTAKE VALUES OR NEITHER QUESTION IS BUILT.
 * A fallback noun or a missing city produces "Who does the best  in ?" and, worse, produces it
 * under a label that says the client supplied it. Nothing is emitted rather than something
 * labelled dishonestly, which is the same rule the drop path follows one function up.
 */
export function intakeQuestions(s: Substitutions, provenance: SubProvenance): string[] {
  const serviceIsTheirs = provenance.treatmentPrimary === "intake";
  const placeIsTheirs = provenance.city === "intake" && provenance.state === "intake";
  const service = s.treatmentPrimary.trim();
  const where = `${s.city}, ${s.state}`;

  if (!serviceIsTheirs || !placeIsTheirs || !service) return [];
  return INTAKE_QUESTION_SHAPES.map((shape) => shape(service, where));
}

/**
 * The whole tracked set for one client: their two, then the vertical's.
 *
 * med_spa is untouched and gets exactly the twenty. Its questions 1 and 2 already ARE the primary
 * service and the city, through the `[Botox / filler / laser]` and `[city]` placeholders, so they
 * pick up the `from intake` label on their own and prepending anything would make the set
 * twenty-two and stop it being the shipped PDF.
 */
export function composeTrackedSet(
  universal: readonly string[],
  s: Substitutions,
  provenance: SubProvenance,
  opts: { vertical: string; size?: number }
): MaterializedSet {
  const size = opts.size ?? 20;

  if (opts.vertical === "med_spa") {
    return materializeSet(universal, s, provenance, opts);
  }

  const theirs = intakeQuestions(s, provenance);
  const rest = materializeSet(universal, s, provenance, opts);

  const questions: MaterializedQuestion[] = [
    ...theirs.map((text, i) => ({ index: i + 1, text, origin: "intake" as QuestionOrigin })),
    ...rest.questions
      .slice(0, Math.max(0, size - theirs.length))
      .map((q, i) => ({ ...q, index: theirs.length + i + 1 })),
  ];

  return { questions, dropped: rest.dropped, fallbacksUsed: rest.fallbacksUsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// The frozen set, per vertical
// ─────────────────────────────────────────────────────────────────────────────

export type UniversalSetResult =
  | {
      ok: true;
      questions: string[];
      /** e.g. "universal_v1@med_spa". Goes in the fidelity footer. */
      version: string;
      vertical: string;
      /** True when a question_set_versions row backs this list. */
      frozen: boolean;
      /** One line for the artifact when the set is short, or could not be frozen. */
      note?: string;
    }
  | { ok: false; error: string };

/** Prompt rows come back as a bare string or as { prompt | text, block }. Both are live shapes. */
function promptText(p: unknown): string | null {
  if (typeof p === "string") return p.trim() || null;
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    const t = (o.prompt ?? o.text) as string | undefined;
    return (t ?? "").trim() || null;
  }
  return null;
}

/**
 * The tracked questions for one client, frozen.
 *
 * ‼️ THE med_spa BRANCH IS THE SHIPPED TWENTY AND IS NOT DERIVED FROM ANYTHING.
 * A2 §4: "the tracked set must be the questions the public actually received, because Beat 11
 * says so on camera." Deriving them per client would make the PDF a lie.
 *
 * ‼️ EVERY OTHER VERTICAL DERIVES ITS TWENTY FROM THAT CLIENT'S OWN AUDIT, AND FREEZES THEM ONCE.
 * audit_reports.prompts is REGENERATED by every audit run — findings.ts spells out the hazard and
 * refuses to quote that column for the same reason. Reading it live would let a later scan
 * silently rewrite the questions in a report already sent to a client, and the Day-0 tracked set
 * is exactly what day 30/60/90 is measured against.
 *
 * ‼️ IT IS FROZEN PER VERTICAL, NOT PER CLIENT, AND THE ROW THAT WON IS THE ANSWER.
 * question_set_versions is keyed on `version` alone and carries no client_id — deliberately,
 * because a universal set exists so two businesses in one vertical can be compared. So the FIRST
 * client in a vertical freezes it and everybody after reads it back. That is also why the write
 * is followed by a read: two clients onboarding the same afternoon must both end up with the row
 * that landed, not each with its own draft.
 *
 * The upsert follows freezeUniversalV1's shape exactly — ignoreDuplicates on the primary key —
 * so "never edited in place" is inherited rather than re-argued.
 */
export async function universalSetFor(clientId: string): Promise<UniversalSetResult> {
  const { verticalFor } = await import("./harvest");
  const resolved = await verticalFor(clientId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const vertical = resolved.vertical;
  const version = `universal_v1@${vertical}`;

  if (vertical === "med_spa") {
    // ‼️ THIS IS freezeUniversalV1's FIRST CALLER. It has existed since the measurement migration
    // and nothing has ever invoked it, so question_set_versions is empty and every fidelity
    // footer has printed "question set not frozen". A2 §6 is explicit that a code constant alone
    // is not enough. It is idempotent, so this is a no-op after the first med spa client.
    let frozen = true;
    try {
      await freezeUniversalV1();
    } catch (e) {
      // A freeze failure must not sink the call sheet: the questions are still right, they are
      // just not yet defensible from a row. Said out loud rather than swallowed.
      console.error("[question-sets] freezing universal_v1@med_spa failed:", (e as Error).message);
      frozen = false;
    }
    return {
      ok: true,
      questions: [...UNIVERSAL_V1_MED_SPA],
      version,
      vertical,
      frozen,
      note: frozen ? undefined : "the frozen row could not be written, so the footer cannot cite one",
    };
  }

  const existing = await supabaseAdmin
    .from("question_set_versions")
    .select("questions")
    .eq("version", version)
    .maybeSingle();

  if (existing.error) {
    return { ok: false, error: `reading ${version} failed: ${existing.error.message}` };
  }

  const stored = (existing.data?.questions as unknown[] | null) ?? null;
  if (stored && stored.length) {
    return {
      ok: true,
      questions: stored.map((q) => promptText(q)).filter((q): q is string => Boolean(q)),
      version,
      vertical,
      frozen: true,
    };
  }

  // Nothing frozen for this vertical yet. Derive it from THIS client's own audit.
  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("id, prompts")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return {
      ok: false,
      error:
        `No frozen set exists for "${vertical}" and this client has no audit to derive one from. ` +
        `The twenty in code are the med spa set, and materializing those here is what asked an ` +
        `AI-visibility agency about lip filler. Confirm the baseline scan first.`,
    };
  }

  const seen = new Set<string>();
  const derived: string[] = [];
  for (const p of (report.prompts as unknown[] | null) ?? []) {
    const text = promptText(p);
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push(text);
    if (derived.length === 20) break;
  }

  if (!derived.length) {
    return {
      ok: false,
      error:
        `Audit ${report.id as string} carries no usable prompts, so there is nothing to freeze as ` +
        `${version}. Re-run the baseline scan.`,
    };
  }

  const { error: writeError } = await supabaseAdmin.from("question_set_versions").upsert(
    {
      version,
      vertical,
      questions: derived,
      materialization: "materialization_v1",
      note:
        `Derived from audit ${report.id as string}, the first ${vertical} client onboarded. ` +
        `Frozen once: audit_reports.prompts is regenerated by every run, so the tracked set ` +
        `cannot be a live read of it.`,
    },
    { onConflict: "version", ignoreDuplicates: true }
  );

  if (writeError) {
    // The questions are still the right questions; they are just not defensible from a row yet.
    console.error(`[question-sets] freezing ${version} failed:`, writeError.message);
    return {
      ok: true,
      questions: derived,
      version,
      vertical,
      frozen: false,
      note: `the frozen row could not be written (${writeError.message}), so the footer cannot cite one`,
    };
  }

  // ‼️ READ BACK, NEVER RETURN THE DRAFT. ignoreDuplicates means a concurrent onboarding may have
  // won the row, and the whole point of a universal set is that two clients in one vertical are
  // measured against the SAME questions.
  const { data: after } = await supabaseAdmin
    .from("question_set_versions")
    .select("questions")
    .eq("version", version)
    .maybeSingle();

  const questions = (((after?.questions as unknown[] | null) ?? derived) as unknown[])
    .map((q) => promptText(q))
    .filter((q): q is string => Boolean(q));

  return {
    ok: true,
    questions,
    version,
    vertical,
    frozen: true,
    note:
      questions.length < 20
        ? `${questions.length} questions, not twenty: that is what the audit produced and nothing was padded`
        : undefined,
  };
}

/**
 * Freeze the med spa set as a row, once.
 *
 * Idempotent on the primary key: a version that exists is never rewritten, because "never
 * edited in place" is the entire contract of a frozen set. A change is a new version.
 */
export async function freezeUniversalV1(): Promise<void> {
  const { error } = await supabaseAdmin.from("question_set_versions").upsert(
    {
      version: "universal_v1@med_spa",
      vertical: "med_spa",
      questions: UNIVERSAL_V1_MED_SPA,
      materialization: "materialization_v1",
      note:
        "The 20 Questions PDF verbatim (A2 D-P15). The fallback set in " +
        "docs/specs/SRT-Question-Sets-v1.md is retired and must not seed this.",
    },
    { onConflict: "version", ignoreDuplicates: true }
  );

  if (error) throw new Error(`freezing universal_v1 failed: ${error.message}`);
}
