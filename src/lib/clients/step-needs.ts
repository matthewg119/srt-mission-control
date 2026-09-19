// What each step of the board needs on file before it can honestly be called complete.
//
// Matthew, 2026-09-17: "it asks bulletpoint questions with the things we are missing in order to
// complete X onboarding step in the process."
//
// dataset-spec.ts declares 71 fields and what fills each one. It does NOT say which step each field
// belongs to: only three of the 71 carry `blocks`, and `blocks` deliberately means something narrower
// (the step's own gate already refuses without it). This file is the missing relation, and it is
// written from the STEP side because that is the question being asked.
//
// ‼️ A Record<StepKey, StepNeed>, NOT A SWITCH, AND THE TYPE IS THE COVERAGE PROOF. Adding a 42nd step
// to delivery-steps.ts fails the build here until somebody says what it needs. That is the same
// mechanism STEP_VERIFIERS and STEP_ACTIONS use, and step coverage has never drifted in either.
//
// ‼️ `needs` AND `wants` ARE A REAL SPLIT, THE SAME ONE THE PAGE GATE DRAWS. `needs` is what the step
// cannot be completed without and is what earns a 🚫; `wants` runs worse without and earns a ⚠️. The
// reason this is not just an extension of FieldSpec.blocks is that pushing ~60 wants into `blocks`
// would turn sixty warnings into refusals on the completeness card that ships today.
//
// ‼️ `{ kind: "nothing" }` CARRIES A REQUIRED SENTENCE. An empty `needs: []` would compile and be
// invisible, so a step that genuinely asks for no dataset field has to say why. _probe-gaps.ts prints
// every one of them, which makes the list of "nothing" steps the backlog rather than a blind spot.
//
// PURE. No DB, no network. It imports types and the field table, and nothing else.

import { DELIVERY_STEPS, type StepKey } from "@/config/delivery-steps";
import { DATASET_FIELDS, type DatasetKey, type FieldSpec } from "./dataset-spec";

/** A field, addressed the way a step names it: "offer.short_offer". */
export type FieldRef = `${DatasetKey}.${string}`;

export type StepNeed =
  | {
      kind: "fields";
      /** Cannot be completed without these. Rendered as a refusal. */
      needs: readonly FieldRef[];
      /** Completable without these, but worse. Rendered as a warning. */
      wants?: readonly FieldRef[];
    }
  | {
      kind: "nothing";
      /** Why this step asks for no dataset field. Required, and printed by the probe. */
      why: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Groups, so a step names a document rather than twenty headings
// ─────────────────────────────────────────────────────────────────────────────

/** The nine numbered research sections the compact prompt and `run` both ask for. */
const RESEARCH: readonly FieldRef[] = [
  "avatar.who_buys",
  "avatar.current_solutions",
  "avatar.what_they_like",
  "avatar.why_they_quit",
  "avatar.beliefs",
  "avatar.blame",
  "avatar.exact_words",
  "avatar.headline_ideas",
  "avatar.search_phrases",
  "avatar.sourced_numbers",
];

/** Sections 10 to 16, which only step 11's framework script asks for. */
const RESEARCH_SCRIPT_ONLY: readonly FieldRef[] = [
  "avatar.hopes_and_dreams",
  "avatar.victories_and_failures",
  "avatar.prejudices",
  "avatar.horror_stories",
  "avatar.curiosity_lost_solutions",
  "avatar.corruption_narrative",
  "avatar.awareness_stage",
];

/** The avatar sheet's headings, pasted back as `avatar sheet:`. */
const AVATAR_SHEET: readonly FieldRef[] = [
  "avatar.age_range",
  "avatar.gender_split",
  "avatar.location",
  "avatar.income",
  "avatar.professional_background",
  "avatar.identities",
  "avatar.pain_points",
  "avatar.desires",
  "avatar.long_term_aspirations",
  "avatar.fantasies",
  "avatar.emotional_drivers",
  "avatar.fears",
  "avatar.psychographic_insights",
  "avatar.general_quotes",
  "avatar.pain_quotes",
  "avatar.mindset_phrases",
  "avatar.emotional_state_quotes",
  "avatar.difficulty_response_quotes",
  "avatar.urgency_quotes",
  "avatar.emotional_journey",
];

/**
 * The five fields with a home and no question.
 *
 * ‼️ THEY ARE `wants`, NEVER `needs`. dataset-spec marks them `asked: false`, so nothing in the system
 * asks for them; making them block a step would refuse it for an answer nobody can give. They appear in
 * the gap list saying "nothing asks for this yet", which is what makes them a visible backlog.
 */
const NOT_ASKED_YET: readonly FieldRef[] = [
  "avatar.cost_of_inaction",
  "avatar.decision_influencers",
  "avatar.proof_they_need",
  "avatar.price_sensitivity",
  "avatar.booking_behaviour",
];

/** The short offer's headings, pasted back as `short offer:`. */
const SHORT_OFFER_SHEET: readonly FieldRef[] = [
  "offer.short_offer_sheet",
  "offer.big_idea",
  "offer.metaphor",
  "offer.ump",
  "offer.ums",
  "offer.authority_figure",
  "offer.discovery_story",
  "offer.objections",
  "offer.belief_chains",
  "offer.offer_headline_ideas",
  "offer.awareness_level",
  "offer.sophistication_stage",
  "offer.consciousness_level",
  "offer.funnel_architecture",
];

// ─────────────────────────────────────────────────────────────────────────────
// The relation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ "COMPLETE", NOT "START". A step's needs are what has to be ON FILE before the tick means
 * something, which for step 11 is the documents it collects rather than the ones it was handed. That
 * is the sense readinessFor() already had (four documents for avatar_harvest) and the sense Matthew's
 * sentence has: the things we are missing in order to COMPLETE the step.
 */
export const STEP_NEEDS: Record<StepKey, StepNeed> = {
  // ── Before the call ────────────────────────────────────────────────────────
  intake_received: {
    kind: "fields",
    needs: [],
    wants: ["audience.own_reviews"],
  },
  baseline_scan: {
    kind: "nothing",
    why: "the audit engine fires and scores it; no answer from a person fills a dataset field here",
  },
  site_dns_intel: {
    kind: "nothing",
    why: "hosting, DNS and the site are observed from the network, never answered",
  },
  nap_sweep: {
    kind: "nothing",
    why: "the automated tier reads directories; nothing in the datasets feeds or records it",
  },
  presence_sweep_manual: {
    kind: "nothing",
    // Checked 2026-09-22 and it genuinely owes nothing. The output is an IMAGE of a profile that
    // already exists, filed against client_docs as evidence. There is no sentence in it that any
    // later step reads, and a dataset field whose value is "a screenshot was taken" would be a
    // record of our own activity rather than a fact about the client.
    why: "screenshots of profiles that already exist, filed as evidence against client_docs. Nothing in them is a value a later step reads, and a field saying a screenshot was taken would record our activity rather than the client",
  },
  competitor_shortlist: {
    kind: "fields",
    // ‼️ IT USED TO DECLARE NOTHING, AND THAT WAS TRUE UNTIL A SHAPE DEPENDED ON IT (2026-09-22).
    // The shortlist itself is still read from who the engines named in the audit, so nothing is
    // NEEDED here. But post-formats.ts's `comparison` shape requires subjectA and subjectB, and
    // format-dataset.ts refuses to infer either, so a comparison page whose two subjects nobody
    // named records them as missing for ever. This is the step that would know them.
    needs: [],
    wants: ["audience.comparison_subjects"],
  },
  avatar_confirmed: {
    kind: "fields",
    // The step exists to produce exactly this, and audience.avatar already declares it blocks step 11.
    needs: ["audience.avatar"],
    wants: ["audience.market", "audience.compliance"],
  },
  review_audit: {
    kind: "fields",
    // ‼️ THE READ IS AUTOMATED AND THE TEXT IS NOT CAPTURED, WHICH ARE DIFFERENT FACTS.
    // Their reviews and three competitors' are read from live listings, so nothing is NEEDED
    // before this step runs. But emotionalLayer()'s tier one counts page_sources CUSTOMER_REVIEW
    // rows for this client, and measured on srt-agency-llc that count is ZERO while the vertical
    // carries 47 objections belonging to nobody in particular. This step is where a client's own
    // review TEXT would come from, so it wants the field rather than silently not filling it.
    needs: [],
    wants: ["audience.own_reviews"],
  },
  offer_proposed: {
    kind: "nothing",
    // ‼️ CHECKED 2026-09-22, AND WHAT IT LOSES IS REAL BUT IS NOT A DATASET FIELD.
    // The proposal carries its own reasoning, and offer_locked then overwrites the treatment with
    // no record of what was proposed or why it was changed on the call. That is a genuine loss and
    // it belongs in an append-only record of the offer's history, NOT in a dataset field: a field
    // holds what is true of the client now, and "what we proposed before the call" is a past
    // state. Declaring it here would put a permanent unfillable gap on every board.
    why: "the proposal is written from what intake already said, so nothing has to be collected for it. What it LOSES, the proposal's own reasoning before offer_locked overwrites it, is a missing history row rather than a missing field",
  },
  offer_locked: {
    kind: "fields",
    // What the prep call is FOR. Each of these has its own command, named in dataset-spec's filler.
    needs: ["offer.short_offer", "offer.customer_terms", "offer.outcome_promise", "offer.price"],
    wants: ["offer.positioning", "offer.sales_letter", "audience.dream_customer", "audience.buyer_map"],
  },
  avatar_harvest: {
    kind: "fields",
    // ‼️ THE STEP THE WHOLE SCANNER IS JUDGED ON. Four documents and the research behind them, and
    // measured 2026-09-17 not one of avatar_sheet, short_offer or necessary_beliefs has EVER been
    // written for anybody. The headline engine's own refusal names the third one.
    needs: ["audience.avatar", ...RESEARCH, ...AVATAR_SHEET, ...SHORT_OFFER_SHEET, "offer.necessary_beliefs"],
    wants: [...RESEARCH_SCRIPT_ONLY, ...NOT_ASKED_YET],
  },
  keyword_set: {
    kind: "fields",
    // offer.short_offer already declares that it blocks this step.
    needs: ["offer.short_offer"],
    wants: ["offer.customer_terms", "avatar.search_phrases", "avatar.exact_words"],
  },
  custom_question_set: {
    kind: "fields",
    needs: [],
    wants: ["avatar.exact_words", "offer.customer_terms", "audience.vocabulary"],
  },
  page_candidates: {
    kind: "fields",
    needs: [],
    wants: ["avatar.search_phrases", "avatar.headline_ideas"],
  },
  citation_cleanup_list: {
    kind: "nothing",
    why: "the list is built from the directories the sweep found, and is ranked by what it measured",
  },
  hub_preview: {
    kind: "nothing",
    why: "the hub is built from the client's own theme and pages; its look is picked, not answered",
  },
  referral_engine_preview: {
    kind: "nothing",
    why: "the AI Referral Engine mirrors listings that already exist and asks for no dataset field",
  },
  concierge_preview: {
    kind: "fields",
    // audience.vocabulary already declares that it blocks this step: the widget speaks in the buyer's
    // words, and a default here would have an agency's concierge talking about lip filler.
    needs: ["audience.vocabulary"],
    wants: ["offer.lead_magnet", "audience.compliance"],
  },
  site_replica: {
    kind: "nothing",
    why: "the replica is a crawl of their own site, filed as evidence rather than collected as fields",
  },
  review_card_pdf: {
    kind: "nothing",
    why: "the card is rendered from the review destination already on the client row",
  },
  pre_call_pages: {
    kind: "fields",
    // ‼️ THE BELIEFS ARE A NEED, NOT A WANT, AND PRODUCTION SAYS SO. The headline engine refuses here
    // in its own words: "47 objections on file and 0 necessary beliefs. The engine needs 20 to write
    // to a rung." A page is supposed to install a belief, and there is no belief on file to install.
    needs: ["offer.short_offer", "offer.necessary_beliefs", "offer.lead_magnet"],
    wants: [
      "offer.big_idea",
      "offer.objections",
      "offer.belief_chains",
      "offer.outcome_promise",
      "avatar.awareness_stage",
      "avatar.fears",
      "avatar.exact_words",
    ],
  },
  call_sheet: {
    kind: "fields",
    needs: [],
    wants: ["audience.dream_customer", "audience.buyer_map", "offer.outcome_promise", "offer.price", "offer.objections"],
  },

  // ── During the call ────────────────────────────────────────────────────────
  call_booked: { kind: "nothing", why: "a date in the calendar; nothing about the client is collected by it" },
  call_held: { kind: "nothing", why: "the call itself. What it captures is written by offer_locked, not here" },
  access_granted: { kind: "nothing", why: "GBP, Search Console and Analytics access is granted, never answered" },
  dns_records: { kind: "nothing", why: "three records the client adds, verified by observation" },
  agreement_signed: { kind: "nothing", why: "a signature on a contract, recorded against the signing row" },

  // ── After the call ─────────────────────────────────────────────────────────
  day_zero_archive: {
    kind: "nothing",
    why: "the before photograph. It archives what was already measured and asks for nothing",
  },
  gbp_buildout: { kind: "nothing", why: "categories, services and photos are entered in Google, not here" },
  citation_cleanup: { kind: "nothing", why: "the list built at step 15 is executed; no new field is owed" },
  subdomain_live: { kind: "nothing", why: "DNS and Search Console verification, both observed" },
  first_page: {
    kind: "nothing",
    why: "the pages were drafted and gated at step 21; publishing them collects nothing new",
  },
  cards_printed: { kind: "nothing", why: "a physical deliverable handed over in person" },
  review_request_configured: { kind: "nothing", why: "a setting in their booking system, or the printed cards" },
  referral_engine_handed: { kind: "nothing", why: "a named person is given the tool; the naming is not a dataset field" },
  concierge_live: {
    kind: "nothing",
    why: "the switch, the booking destination and the audience were all confirmed at concierge_preview",
  },
  tracking_installed: { kind: "nothing", why: "the pixel is live or it is not, and a real session proves it" },
  self_report_field: { kind: "nothing", why: "six options added to their own booking form" },
  time_log_entries: { kind: "nothing", why: "hours recorded as work happens" },
  weekly_report: {
    kind: "nothing",
    why: "the report is assembled from what was measured. ATTRIBUTION_NOT_WIRED says in writing what it cannot count",
  },
  day_30_date: { kind: "nothing", why: "a date for the day-30 retest" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────────────────

const BY_REF = new Map<string, FieldSpec>(DATASET_FIELDS.map((f) => [`${f.dataset}.${f.key}`, f]));

/** The spec behind a ref, or null when the ref names nothing. Never a fabricated placeholder. */
export function fieldFor(ref: FieldRef): FieldSpec | null {
  return BY_REF.get(ref) ?? null;
}

/** What a step needs and wants, resolved to specs. Unknown refs are dropped and reported by the probe. */
export function fieldsForStep(key: StepKey): { needs: FieldSpec[]; wants: FieldSpec[] } {
  const need = STEP_NEEDS[key];
  if (need.kind === "nothing") return { needs: [], wants: [] };
  const resolve = (refs: readonly FieldRef[]) => refs.map(fieldFor).filter((f): f is FieldSpec => f !== null);
  return { needs: resolve(need.needs), wants: resolve(need.wants ?? []) };
}

/** The steps a field would refuse. The inversion of `needs`, for the card's refusal marker. */
export function stepsBlockedBy(ref: FieldRef): StepKey[] {
  const out: StepKey[] = [];
  for (const [key, need] of Object.entries(STEP_NEEDS) as Array<[StepKey, StepNeed]>) {
    if (need.kind === "fields" && need.needs.includes(ref)) out.push(key);
  }
  return out;
}

/**
 * Refs that name no declared field.
 *
 * ‼️ THE CHECK THAT STOPS THE SLOWEST ROT. Renaming a key in dataset-spec.ts would silently delete a
 * step's requirement here, and the step would go on reporting that it needs nothing at all.
 */
export function unknownFieldRefs(): FieldRef[] {
  const out: FieldRef[] = [];
  for (const need of Object.values(STEP_NEEDS)) {
    if (need.kind !== "fields") continue;
    for (const ref of [...need.needs, ...(need.wants ?? [])]) if (!BY_REF.has(ref)) out.push(ref);
  }
  return [...new Set(out)];
}

/** Every step that declares it asks for no dataset field, with its sentence. The backlog, printed. */
export function stepsWithNothing(): Array<{ key: StepKey; why: string }> {
  return DELIVERY_STEPS.map((s) => s.key as StepKey)
    .map((key) => ({ key, need: STEP_NEEDS[key] }))
    .filter((x): x is { key: StepKey; need: Extract<StepNeed, { kind: "nothing" }> } => x.need.kind === "nothing")
    .map(({ key, need }) => ({ key, why: need.why }));
}
