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
    // guarantee added 2026-09-19: the column, the command and the reader all existed and no field
    // declared it, so nothing ever asked. A want, because an absent guarantee is a real answer.
    wants: ["offer.positioning", "offer.guarantee", "offer.sales_letter", "audience.dream_customer", "audience.buyer_map"],
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
// The mirror: what a step PRODUCES, and what reads it
//
// ‼️ THE HALF A COLUMN SCAN CANNOT FIND. `_probe-dead-wires.ts` asks whether any select list names a
// column. The curated-20 bug passes that check: `client_keywords.selected_at` WAS read, by the card
// that wrote it, and the gap was that the next step drew from a different pool. Nothing mechanical
// notices that, because both halves look correct in isolation.
//
// ‼️ IT DELIBERATELY DOES NOT DECLARE WHICH DATASET FIELDS A STEP FILLS. dataset-spec.ts already owns
// that relation, per field, as `filledBy: { kind: "step", step, how, built }`, and rerun-gaps.ts
// consumes it to offer the "re-run the earlier step" button. A second copy keyed from the step side
// would be two sources of truth for one fact, which is the failure this whole file is written against.
// So `produces` covers only what dataset-spec CANNOT describe: an artifact that is not a dataset
// field. A column, a pool, a set of rows a later step draws from. If the thing being recorded IS a
// dataset field, it belongs in dataset-spec and not here.
//
// ‼️ A Record<StepKey, StepProduces>, FOR THE SAME REASON `needs` IS ONE. The type is the coverage
// proof: a 42nd step fails the build until somebody says what it records. That is what would have
// caught the curated 20 the day `selected_at` was added, because step 12 would have had to declare it
// and there was no reader to name.
// ─────────────────────────────────────────────────────────────────────────────

/** One artifact a step records, and the thing downstream that reads it. */
export interface StepOutput {
  /** What is recorded, as `table.column`. Checked against the SQL scan, so it cannot name nothing. */
  readonly records: string;
  /** The file that writes it. The probe asserts it exists and names the column. */
  readonly writtenIn: string;
  /**
   * The exported symbol that hands it to later steps.
   *
   * ‼️ THIS IS THE CHECK. The probe demands a call site OUTSIDE `writtenIn`. A reader referenced only
   * by its own writer is precisely "the card that wrote it", which is the curated-20 bug, and it is
   * the one thing a column scan cannot see.
   */
  readonly reader: string;
  /** The steps whose work draws on it. Real keys, and LATER in board order. */
  readonly consumedBy: readonly StepKey[];
  /** What this output is, in one sentence. */
  readonly what: string;
  /** How it travels, in words, so the workflow reads without following the code. */
  readonly feeds: string;
}

export type StepProduces =
  | { kind: "outputs"; outputs: readonly StepOutput[] }
  /** Why this step records no non-field artifact. Required, and printed by the probe. */
  | { kind: "nothing"; why: string };

/** dataset-spec.ts owns "which step fills which FIELD". This is only the non-field artifacts. */
const FIELDS_ONLY = "everything it records is a dataset field, and dataset-spec.ts declares the step that fills each one";

const OBSERVED = "it observes or hands over something outside this system, and records no artifact a later step draws from";

export const STEP_PRODUCES: Record<StepKey, StepProduces> = {
  // ── Before the call ────────────────────────────────────────────────────────
  intake_received: { kind: "nothing", why: FIELDS_ONLY },
  baseline_scan: {
    kind: "outputs",
    outputs: [
      {
        records: "audit_reports.client_id",
        writtenIn: "src/lib/clients/baseline-scan.ts",
        reader: "adoptAuditClassification",
        consumedBy: ["avatar_harvest", "keyword_set", "custom_question_set"],
        what: "the link from a finished audit to this client, and the vertical it classified.",
        feeds:
          "everything keyed on a vertical. Until it existed, harvest.ts, research-intake.ts, " +
          "custom-question-set.ts and page-candidates.ts all took their `?? \"med_spa\"` fallback, and a " +
          "shared corpus was poisoned for every client that ever existed.",
      },
    ],
  },
  site_dns_intel: { kind: "nothing", why: OBSERVED },
  nap_sweep: { kind: "nothing", why: "it seeds nap_discrepancies rows the manual tier and step 14 then read by status, not by a column a later step names" },
  presence_sweep_manual: {
    kind: "nothing",
    why: "the artifact is an IMAGE filed against client_docs, and its own STEP_NEEDS entry records why: nothing in it is a value a later step reads",
  },
  competitor_shortlist: {
    kind: "outputs",
    outputs: [
      {
        records: "competitor_candidates.selected",
        writtenIn: "src/app/api/clients/[id]/competitors/route.ts",
        reader: "selectedCompetitors",
        consumedBy: ["review_audit", "call_sheet"],
        what: "which three competitors a person confirmed off the shortlist.",
        feeds:
          "the review-count grid at step 8, the findings document, the call sheet and the closing " +
          "questions. It had a reader and no writer until 2026-08-24, which is the same class of bug " +
          "one direction over.",
      },
    ],
  },
  avatar_confirmed: {
    kind: "outputs",
    outputs: [
      {
        records: "clients.primary_avatar",
        writtenIn: "src/lib/clients/avatars.ts",
        reader: "confirmedAvatarFor",
        consumedBy: ["avatar_harvest", "keyword_set", "custom_question_set", "page_candidates", "pre_call_pages"],
        what: "which customer the whole build is aimed at.",
        feeds:
          "the deep research, the keyword categories, the question set and the pages. It had a column, " +
          "a CHECK and a verifier and NO WRITER, so on the first real client the step came out skipped " +
          "because no human being could tick it.",
      },
    ],
  },
  review_audit: { kind: "nothing", why: "the counts are read from live listings into review_audit_rows, which step 22's findings document reads by row rather than by a column a later step names" },
  offer_proposed: { kind: "nothing", why: "the proposal is superseded by offer_locked, and its own STEP_NEEDS entry records that what it loses is a missing history row rather than a field" },
  offer_locked: { kind: "nothing", why: FIELDS_ONLY },
  avatar_harvest: { kind: "nothing", why: FIELDS_ONLY },
  keyword_set: {
    kind: "outputs",
    outputs: [
      {
        records: "client_keywords.selected_at",
        writtenIn: "src/lib/clients/keyword-decisions.ts",
        reader: "selectedKeywords",
        consumedBy: ["pre_call_pages"],
        what: "the keywords that survived their screenshot, kept by a reaction on the keyword's own card.",
        feeds:
          "the seven pages, the headlines and the anchor ladder. ‼️ THIS IS THE CURATED-20 BUG ITSELF: " +
          "the column was written and read back by the card that wrote it, while step 21 went on " +
          "drawing from the approved set, so twenty deliberate decisions reached nothing.",
      },
      {
        records: "keyword_serp_reads.keyword_id",
        writtenIn: "src/lib/clients/keyword-strategy.ts",
        reader: "picturedIds",
        consumedBy: ["pre_call_pages"],
        what: "which keywords have a screenshot on file, filed against the keyword the picture was of.",
        feeds:
          "the cluster gate, which refuses to plan a page off a keyword nobody has looked at. " +
          "`picturedIds` re-reads these rows fresh on every call rather than trusting a summary, which " +
          "is exactly why keyword_clusters.missing_pictures was dropped rather than wired: a cache must " +
          "never be what a refusal is decided on.",
      },
      // ‼️ `query_on_screen` IS DELIBERATELY NOT LISTED, and the reason is the rule for this whole map.
      // It is written and read inside step 12 only: serp-read.ts reads the search box back, and
      // resolveFromScreen matches it to the shortlist so a screenshot can find its own keyword without
      // anybody typing a number. No later step draws on it, so declaring it here would claim a
      // cross-step wire that does not exist, and the probe would then demand a consumer for it.
    ],
  },
  custom_question_set: {
    kind: "nothing",
    why:
      "the tracked set is frozen at Day 0 and is MEASUREMENT. ‼️ It deliberately stays on planKeywords " +
      "rather than the kept set, a probe asserts it stays broad, so it must never appear as a consumer " +
      "of keyword_set's selection either",
  },
  page_candidates: { kind: "nothing", why: "the candidates are frozen onto the page-studio session row, which the digit picker reads within one thread rather than a later step" },
  citation_cleanup_list: { kind: "nothing", why: "the ranked list is nap_discrepancies read by status, which step 24 executes and step 25 reports on" },
  hub_preview: {
    kind: "outputs",
    outputs: [
      {
        records: "client_hosts.host",
        writtenIn: "src/lib/hub/vercel-domains.ts",
        reader: "resolveHost",
        consumedBy: ["dns_records", "subdomain_live", "first_page"],
        what: "the hostnames attached to Vercel, which is what was ATTACHED rather than what was intended.",
        feeds:
          "middleware's host classification and every hub page. It is also the Vercel ledger, so the " +
          "routing map and the attachment state cannot disagree.",
      },
    ],
  },
  referral_engine_preview: { kind: "nothing", why: OBSERVED },
  concierge_preview: { kind: "nothing", why: FIELDS_ONLY },
  site_replica: { kind: "nothing", why: "the replica is a crawl filed as client_replica_pages rows, rendered on request and read by no later step" },
  review_card_pdf: { kind: "nothing", why: "the card is rendered from the review destination already on the client row" },
  pre_call_pages: { kind: "nothing", why: "the drafts are client_pages rows, and the gate reads them by body hash within the publishing step rather than through a column a later step names" },
  call_sheet: { kind: "nothing", why: "the call pack is documents stored against output_ref, which the step cards link rather than read" },

  // ── During the call ────────────────────────────────────────────────────────
  call_booked: { kind: "nothing", why: OBSERVED },
  call_held: { kind: "nothing", why: "what the call captures is written by offer_locked, not here" },
  access_granted: { kind: "nothing", why: OBSERVED },
  dns_records: { kind: "nothing", why: "the records are client_dns_records rows whose `verified` status only checkRecord may write, and subdomain_live re-observes rather than reading it" },
  agreement_signed: { kind: "nothing", why: OBSERVED },

  // ── After the call ─────────────────────────────────────────────────────────
  day_zero_archive: {
    kind: "outputs",
    outputs: [
      {
        records: "clients.day_0_archived_at",
        writtenIn: "src/lib/clients/day-zero.ts",
        reader: "assertDay0Archived",
        consumedBy: ["first_page"],
        what: "the before photograph, and the one hard rail on the board.",
        feeds:
          "page_publish, which refuses while it is NULL. ‼️ `day_0_source` is the honest half: " +
          "`manual_step` is a person asserting the archive happened, never evidence of it.",
      },
    ],
  },
  gbp_buildout: { kind: "nothing", why: OBSERVED },
  citation_cleanup: { kind: "nothing", why: "the confirmed_status it writes is read by the same step's verifier and by step 25's PDF, both of which re-read the rows rather than a summary column" },
  subdomain_live: { kind: "nothing", why: OBSERVED },
  first_page: { kind: "nothing", why: "publishing flips client_pages.status, which the hub renders from; nothing later on the board draws from it" },
  cards_printed: { kind: "nothing", why: OBSERVED },
  review_request_configured: { kind: "nothing", why: FIELDS_ONLY },
  referral_engine_handed: { kind: "nothing", why: OBSERVED },
  concierge_live: { kind: "nothing", why: "the switch is concierge_configs.enabled, read by the widget at request time rather than by a later step" },
  tracking_installed: { kind: "nothing", why: "a real session in hub_hits proves it, and the weekly report counts sessions rather than reading a flag this step set" },
  self_report_field: { kind: "nothing", why: OBSERVED },
  time_log_entries: { kind: "nothing", why: "hours are time_log rows the weekly report counts, not a column a later step names" },
  weekly_report: { kind: "nothing", why: "the report is assembled from what was measured; ATTRIBUTION_NOT_WIRED says in writing what it cannot count" },
  day_30_date: { kind: "nothing", why: OBSERVED },
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

/** Every declared output, flattened, with the step that records it. */
export function allOutputs(): Array<{ step: StepKey; output: StepOutput }> {
  const out: Array<{ step: StepKey; output: StepOutput }> = [];
  for (const s of DELIVERY_STEPS) {
    const p = STEP_PRODUCES[s.key as StepKey];
    if (p.kind === "outputs") for (const output of p.outputs) out.push({ step: s.key as StepKey, output });
  }
  return out;
}

/** Every step that records no non-field artifact, with its sentence. The backlog, printed. */
export function stepsProducingNothing(): Array<{ key: StepKey; why: string }> {
  return DELIVERY_STEPS.map((s) => s.key as StepKey)
    .map((key) => ({ key, produces: STEP_PRODUCES[key] }))
    .filter((x): x is { key: StepKey; produces: Extract<StepProduces, { kind: "nothing" }> } => x.produces.kind === "nothing")
    .map(({ key, produces }) => ({ key, why: produces.why }));
}

/**
 * Outputs whose `consumedBy` names a step that is NOT later in board order.
 *
 * ‼️ AN EARLIER STEP CANNOT CONSUME A LATER STEP'S OUTPUT, and a declaration that says otherwise is
 * describing a cycle rather than a workflow. delivery-steps.ts renumbers on every insertion, so this
 * is derived from array position and never from a literal.
 */
export function outputsConsumedTooEarly(): Array<{ step: StepKey; records: string; consumer: StepKey }> {
  const order = new Map(DELIVERY_STEPS.map((s, i) => [s.key as StepKey, i]));
  const bad: Array<{ step: StepKey; records: string; consumer: StepKey }> = [];
  for (const { step, output } of allOutputs()) {
    const at = order.get(step) ?? -1;
    for (const consumer of output.consumedBy) {
      const to = order.get(consumer);
      if (to === undefined || to <= at) bad.push({ step, records: output.records, consumer });
    }
  }
  return bad;
}

/**
 * Dataset fields that no step is declared to fill, and that no prompt or document supplies either.
 *
 * ‼️ IT READS dataset-spec's OWN `filledBy`, AND DECLARES NOTHING NEW. That relation already exists
 * per field and rerun-gaps.ts already consumes it; asking the question from the step side would be a
 * second source of truth for one fact. A field filled by `research`, `document`, `audit` or `derived`
 * legitimately comes from outside the board, so only a `step` filler that is `built: false`, or no
 * usable filler at all, is a hole in the interconnection.
 */
export function fieldsNoStepFills(): Array<{ ref: string; why: string }> {
  const out: Array<{ ref: string; why: string }> = [];
  for (const f of DATASET_FIELDS) {
    const ref = `${f.dataset}.${f.key}`;
    const by = f.filledBy;
    if (by.kind === "step") {
      if (!by.built) out.push({ ref, why: `step ${by.step} is declared to fill it and the writer is not built: ${by.how}` });
      continue;
    }
    if (by.kind === "research" && !by.asked) out.push({ ref, why: "a research section that no prompt asks for yet" });
  }
  return out;
}

/** Every step that declares it asks for no dataset field, with its sentence. The backlog, printed. */
export function stepsWithNothing(): Array<{ key: StepKey; why: string }> {
  return DELIVERY_STEPS.map((s) => s.key as StepKey)
    .map((key) => ({ key, need: STEP_NEEDS[key] }))
    .filter((x): x is { key: StepKey; need: Extract<StepNeed, { kind: "nothing" }> } => x.need.kind === "nothing")
    .map(({ key, need }) => ({ key, why: need.why }));
}
