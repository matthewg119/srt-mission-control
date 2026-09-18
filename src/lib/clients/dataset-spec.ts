// What every dataset needs, declared once. The registry the completeness card is read from.
//
// Matthew, 2026-09-15: "everytime we add something or we get context about something or add something
// new I want to make sure our datasets/fields and everything are nudged down to the teeth until we
// know exactly each dataset each thing needs so help me systemize this".
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a field that matters is declared HERE, with what fills it and
// what needs it, or it does not exist as far as the system is concerned. Adding context means adding
// one entry; the completeness card, the research-paste reply and the probe all pick it up from here,
// so nothing has to be remembered in three places.
//
// THREE DATASETS, MATTHEW'S MODEL (2026-09-15):
//   AVATAR    who is being targeted, and the context about them: fears, desires, beliefs, the words
//             they use. Filled by the deep research and by nothing else ("THE DEEP RESEARCH MUST
//             PROVIDE"). Keyed on the avatar, so a second client aiming at the same buyer reads it.
//   AUDIENCE  a client targeting an avatar. A client can have several; one is primary.
//   OFFER     what is sold to that audience, with the outcome promised ("more appointments" for med
//             spas, "more jobs" for plumbers). Lives under the audience in client_offers since
//             2026-09-15; each audience has its own, one primary.
//
// ‼️ WARN, AND BLOCK ONLY WHERE A STEP CANNOT RUN (Matthew, 2026-09-15). `blocks` names the steps
// that genuinely cannot run without the field, and every one of those is ALREADY enforced by that
// step's own gate. This file declares them so the card can say 🚫 instead of ⚠️; it adds no gate.
// Same split the page gate draws: evidence blocks, everything else warns.
//
// PURE. No DB, no network. dataset-completeness.ts loads the snapshot this evaluates.

import { parseResearchSections, sectionAnswered, type ResearchSection } from "./avatar-profile";

export type DatasetKey = "avatar" | "audience" | "offer";

/** The framework documents a field can be read off. */
export type FrameworkDoc = "avatar_sheet" | "short_offer" | "necessary_beliefs" | "sales_letter";

export type Filler =
  /**
   * A numbered section of the deep research prompt. `asked: false` means no prompt asks yet.
   * `scriptOnly` means only the step 11 framework script asks (sections 10 to 16), not the compact prompt.
   */
  | { kind: "research"; sectionKey: string | null; asked: boolean; scriptOnly?: boolean }
  /**
   * A heading of a framework document pasted back at step 11 (or the approved letter at step 10).
   * `answer` is the parser's key: a section ("fears") or a labelled line inside one ("goals.long_term_aspirations").
   * Several alternatives mean any one of them fills the field.
   */
  | { kind: "document"; doc: FrameworkDoc; answer: readonly string[] }
  /** A board step, and the command or button on it that writes the field. `built: false` = owed. */
  | { kind: "step"; step: string; how: string; built: boolean }
  /** The AI visibility audit and its Loom wizard. */
  | { kind: "audit"; how: string }
  /** Written as a side effect of another field (a preset read when the audience is created). */
  | { kind: "derived"; how: string };

/** Everything the evaluator can see. dataset-completeness.ts fills it; a probe builds it by hand. */
export interface DatasetSnapshot {
  audience: {
    label: string;
    isPrimary: boolean;
    stance: "patient" | "owner";
    hasVocabulary: boolean;
    buyerMarket: string | null;
    hardLines: number;
    confirmedAt: string | null;
  } | null;
  avatar: {
    researchText: string | null;
    vocQuotes: number;
    approvedNumbers: number;
    keywordRows: number;
    keywordRowsWithUrl: number;
    /** Objection-shaped phrases filed against THIS vertical AND THIS avatar. */
    objectionRows: number;
  };
  offer: {
    /**
     * Whether the offer fields are judged for this audience: always for the primary one, and for an
     * option audience only once something has been offered to it (client_offers, since 2026-09-15).
     */
    applies: boolean;
    treatment: string | null;
    terms: number;
    positioning: string | null;
    magnetKey: string | null;
    lockedAt: string | null;
    outcomePromise: string | null;
    price: string | null;
  };
  /**
   * The framework documents on file for this audience, as the keys their parsers found answered.
   * Null for a document never pasted. Filled from audience_documents; empty before that table exists.
   */
  documents: {
    avatarSheet: string[] | null;
    shortOffer: string[] | null;
    beliefs: number;
    letterApproved: boolean;
  };
  audit: {
    linked: boolean;
    pickedAvatar: boolean;
    buyerMap: boolean;
  };
  reviews: number;
}

interface EvalContext {
  snap: DatasetSnapshot;
  /** Section number -> parsed section, from the avatar's research text. */
  sections: Map<number, ResearchSection>;
  sectionKeys: readonly string[];
}

export interface FieldSpec {
  dataset: DatasetKey;
  key: string;
  label: string;
  /** What reads it. One line, for the card and for the next person adding a consumer. */
  usedFor: string;
  filledBy: Filler;
  /** Step keys that cannot run without this field. Already gated there; declared here for the card. */
  blocks?: readonly string[];
  present: (ctx: EvalContext) => boolean;
}

/** A research field is present when its numbered section is answered. */
function section(key: string): (ctx: EvalContext) => boolean {
  return (ctx) => {
    const n = ctx.sectionKeys.indexOf(key) + 1;
    return n > 0 && sectionAnswered(ctx.sections.get(n));
  };
}

const NOT_ASKED = () => false;

/** A document field is present when any of its answer keys was answered in that pasted document. */
function answeredIn(doc: FrameworkDoc, answer: readonly string[]): (ctx: EvalContext) => boolean {
  return (ctx) => {
    const d = ctx.snap.documents;
    if (doc === "sales_letter") return d.letterApproved;
    if (doc === "necessary_beliefs") return d.beliefs > 0;
    const got = doc === "avatar_sheet" ? d.avatarSheet : d.shortOffer;
    return Boolean(got && answer.some((a) => got.includes(a)));
  };
}

/** Declare a document field in one line, so the map below reads as a map. */
function docField(
  dataset: DatasetKey,
  key: string,
  label: string,
  usedFor: string,
  doc: FrameworkDoc,
  answer: readonly string[]
): FieldSpec {
  return { dataset, key, label, usedFor, filledBy: { kind: "document", doc, answer }, present: answeredIn(doc, answer) };
}

/** A section only the step 11 framework script asks for (research sections 10 to 16). */
function scriptSection(key: string, label: string, usedFor: string, sectionKey: string): FieldSpec {
  return {
    dataset: "avatar",
    key,
    label,
    usedFor,
    filledBy: { kind: "research", sectionKey, asked: true, scriptOnly: true },
    present: section(sectionKey),
  };
}

/**
 * The fewest objection-shaped phrases this buyer needs before headlines may be written for them.
 *
 * ‼️ THE FLOOR LIVES HERE, AND IT USED TO LIVE IN THE HEADLINE ENGINE. Two floors is how a gate and
 * the card that explains the gate start disagreeing about what "enough" is, so precall-headlines.ts
 * imports this rather than declaring its own. This is the FIRST count-with-a-threshold in the dataset
 * layer: every other present() is a boolean, and the only count-based ones are `> 0`. That is the
 * reason it is stated as a named constant with this comment rather than inlined as a numeral.
 */
export const EMOTIONAL_FLOOR = 20;

/** Worth knowing, and nothing asks for it yet. Declared so the card shows the gap instead of it not existing. */
function notAsked(dataset: DatasetKey, key: string, label: string, usedFor: string): FieldSpec {
  return { dataset, key, label, usedFor, filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED };
}

export const DATASET_FIELDS: readonly FieldSpec[] = [
  // ── AVATAR: the deep research, and only the deep research ─────────────────
  { dataset: "avatar", key: "who_buys", label: "who buys (age, income, work, the week before they look)",
    usedFor: "every prompt that is aimed at a buyer", filledBy: { kind: "research", sectionKey: "demographics", asked: true },
    present: section("demographics") },
  { dataset: "avatar", key: "current_solutions", label: "what they use now",
    usedFor: "comparison pages and the reposition angle", filledBy: { kind: "research", sectionKey: "current_solutions", asked: true },
    present: section("current_solutions") },
  { dataset: "avatar", key: "what_they_like", label: "what they like about it",
    usedFor: "what a page must not take away from them", filledBy: { kind: "research", sectionKey: "what_they_like", asked: true },
    present: section("what_they_like") },
  { dataset: "avatar", key: "why_they_quit", label: "what goes wrong and why they quit",
    usedFor: "fear and objection pages, the Loom's pain beat", filledBy: { kind: "research", sectionKey: "what_they_hate", asked: true },
    present: section("what_they_hate") },
  { dataset: "avatar", key: "beliefs", label: "what they believe, true or false",
    usedFor: "the belief a page has to move", filledBy: { kind: "research", sectionKey: "beliefs", asked: true },
    present: section("beliefs") },
  { dataset: "avatar", key: "blame", label: "who or what they blame",
    usedFor: "the villain in copy, never the reader", filledBy: { kind: "research", sectionKey: "external_forces", asked: true },
    present: section("external_forces") },
  { dataset: "avatar", key: "exact_words", label: "their exact words, quoted with links",
    usedFor: "headlines, H2s, and what backs a number in a headline", filledBy: { kind: "research", sectionKey: "verbatim_language", asked: true },
    present: (ctx) => section("verbatim_language")(ctx) || ctx.snap.avatar.vocQuotes > 0 },
  { dataset: "avatar", key: "headline_ideas", label: "headline and subject line ideas",
    usedFor: "the headline bank's starting point", filledBy: { kind: "research", sectionKey: "headline_ideas", asked: true },
    present: section("headline_ideas") },
  { dataset: "avatar", key: "search_phrases", label: "the search phrases, as KEYWORDS rows",
    usedFor: "the keyword set at step 12, ranked above anything a model proposes", filledBy: { kind: "research", sectionKey: "keywords", asked: true },
    present: (ctx) => ctx.snap.avatar.keywordRows > 0 },
  { dataset: "avatar", key: "sourced_numbers", label: "sourced numbers (a figure with its source)",
    usedFor: "the only figures a headline may state", filledBy: { kind: "research", sectionKey: null, asked: true },
    present: (ctx) => ctx.snap.avatar.approvedNumbers > 0 },
  // ── AVATAR, the framework's research sections 10 to 16 (step 11 script only) ──
  //
  // ‼️ MATTHEW, 2026-09-15: "map out everything we could potentially need to map regarding the avatar or
  // certain behaviors to tune our stories". Everything below is that map (plan: the avatar field map),
  // each field with what fills it. What nothing asks for yet is still declared, so the card shows the gap.
  scriptSection("hopes_and_dreams", "hopes and dreams, beyond the product", "the emotional reward a story ends on", "hopes_and_dreams"),
  scriptSection("victories_and_failures", "victories and failures around the problem", "the earlier attempts in a story", "victories_and_failures"),
  scriptSection("prejudices", "prejudices", "what the hero assumes about others, and what copy must not trip over", "prejudices"),
  scriptSection("horror_stories", "horror stories about existing solutions", "the ordeal in a story, and warning pages", "horror_stories"),
  scriptSection("curiosity_lost_solutions", "old or lost solutions", "the rediscovered-secret hook", "curiosity"),
  scriptSection("corruption_narrative", "what they believe ruined things", "the \"it used to be better until\" angle", "corruption"),
  scriptSection("awareness_stage", "awareness stage (5 to 1, with quotes)", "where a page starts the reader and where it leaves them", "awareness"),
  // ‼️ THE ONLY FIELD IN THIS REGISTRY WHOSE present() IS A THRESHOLD RATHER THAN A BOOLEAN, and the
  // headline engine is why: it refuses to write until this buyer's objections are on file, so "the
  // section was answered" is not the same question as "is there enough to write from". A research
  // report that comes back with three quotes answers the section and does not clear the floor.
  //
  // It counts the AVATAR's rows, not the client's own reviews. Those are tier one in emotionalLayer()
  // and are counted there; filing a client's own customers under an avatar key every other client in
  // the vertical reads is the poisoned-corpus failure question_bank has no client_id to prevent.
  {
    dataset: "avatar",
    key: "emotional_language",
    label: `objections in this buyer's own words (at least ${EMOTIONAL_FLOOR})`,
    usedFor: "the headline engine refuses to write to a rung without them, and vocBlock renders empty",
    filledBy: { kind: "research", sectionKey: "emotional_language", asked: true, scriptOnly: true },
    present: (ctx) => ctx.snap.avatar.objectionRows >= EMOTIONAL_FLOOR || ctx.snap.avatar.vocQuotes >= EMOTIONAL_FLOOR,
  },

  // ── AVATAR, the avatar sheet (step 11, `avatar sheet:`) ────────────────────
  docField("avatar", "age_range", "age range", "the story's protagonist and setting", "avatar_sheet", ["demographics.age_range"]),
  docField("avatar", "gender_split", "gender split", "who the hero is", "avatar_sheet", ["demographics.gender"]),
  docField("avatar", "location", "where they live", "the setting", "avatar_sheet", ["demographics.location"]),
  docField("avatar", "income", "income", "how price is framed", "avatar_sheet", ["demographics.income"]),
  docField("avatar", "professional_background", "professional background", "the protagonist's world", "avatar_sheet", ["demographics.professional_background"]),
  docField("avatar", "identities", "typical identities and roles", "who the hero is, and what they call themselves", "avatar_sheet", ["demographics.identities"]),
  docField("avatar", "pain_points", "main challenges and pain points", "the ordinary world a story opens in", "avatar_sheet", ["challenges"]),
  docField("avatar", "desires", "desires (short-term goals)", "the outcome a page moves toward", "avatar_sheet", ["goals.short_term_goals", "goals"]),
  docField("avatar", "long_term_aspirations", "long-term aspirations", "the return and the new life", "avatar_sheet", ["goals.long_term_aspirations"]),
  // ‼️ FANTASIES: long-term aspirations OR the relief stage (Matthew, 2026-09-15). Either one fills it.
  docField("avatar", "fantasies", "fantasies (aspirations or the relief stage)", "the ideal ending a story reaches", "avatar_sheet", ["goals.long_term_aspirations", "emotional_journey.journey_relief"]),
  docField("avatar", "emotional_drivers", "emotional drivers", "why the hero acts", "avatar_sheet", ["emotional_drivers"]),
  docField("avatar", "fears", "fears and deep frustrations", "the ordeal and the stakes, fear pages, the Loom", "avatar_sheet", ["fears"]),
  docField("avatar", "psychographic_insights", "psychographic insights", "tone", "avatar_sheet", ["psychographics"]),
  docField("avatar", "general_quotes", "direct customer quotes", "proof lines inside a story", "avatar_sheet", ["general_quotes"]),
  docField("avatar", "pain_quotes", "pain and frustration quotes", "the ordinary world in their voice", "avatar_sheet", ["pain_quotes"]),
  docField("avatar", "mindset_phrases", "mindset phrases", "the hero's inner monologue", "avatar_sheet", ["mindset_phrases"]),
  docField("avatar", "emotional_state_quotes", "emotional state quotes", "the low point", "avatar_sheet", ["emotional_state_quotes"]),
  docField("avatar", "difficulty_response_quotes", "how they respond to difficulty", "how the hero copes", "avatar_sheet", ["difficulty_quotes"]),
  docField("avatar", "urgency_quotes", "motivation and urgency quotes", "the call to adventure", "avatar_sheet", ["urgency_quotes"]),
  docField("avatar", "emotional_journey", "the emotional journey (awareness, frustration, search, relief)", "a story's beats", "avatar_sheet", ["emotional_journey"]),

  // ── AVATAR, worth knowing and asked by nothing yet ──────────────────────────
  notAsked("avatar", "cost_of_inaction", "the cost of doing nothing", "the stakes if the hero refuses the call"),
  notAsked("avatar", "decision_influencers", "who else weighs in on the decision", "a story's secondary characters"),
  notAsked("avatar", "proof_they_need", "the proof they need before buying", "which evidence sits beside a story"),
  notAsked("avatar", "price_sensitivity", "how price-sensitive they are", "how the price is framed"),
  notAsked("avatar", "booking_behaviour", "how they book (call, form, walk in, when)", "the call to action inside a story"),
  // ‼️ DECLARED BECAUSE A SHAPE NOW DEPENDS ON IT AND NOTHING COLLECTS IT (2026-09-22).
  // post-formats.ts's `comparison` shape requires subjectA and subjectB, and format-dataset.ts
  // refuses to infer either: "nothing here may default or infer a field". So a comparison page
  // whose two subjects nobody named records them as MISSING for ever, and the step that would
  // know them, competitor_shortlist, declared {kind:"nothing"}. This is the notAsked mechanism
  // doing its job: the card shows the gap instead of the field not existing.
  notAsked(
    "audience",
    "comparison_subjects",
    "the two things a comparison page may weigh against each other",
    "a comparison page's subjectA and subjectB, which the shape refuses to invent"
  ),

  // ── AUDIENCE: this client aiming at that avatar ───────────────────────────
  { dataset: "audience", key: "avatar", label: "the avatar it targets",
    usedFor: "what gets researched, and the key research is shared on",
    filledBy: { kind: "step", step: "avatar_confirmed", how: "the avatar picker, or `avatar: <who>`", built: true },
    blocks: ["avatar_harvest"], present: (ctx) => ctx.snap.audience !== null },
  { dataset: "audience", key: "vocabulary", label: "what to call the buyer, the offer and the visit",
    usedFor: "every sentence the concierge and the pages write",
    filledBy: { kind: "derived", how: "the vertical's preset, when the avatar is confirmed" },
    blocks: ["concierge_preview"], present: (ctx) => ctx.snap.audience?.hasVocabulary === true },
  { dataset: "audience", key: "market", label: "the market it is about",
    usedFor: "competitor data and where content accumulates",
    filledBy: { kind: "derived", how: "the vertical's preset, when the avatar is confirmed" },
    present: (ctx) => Boolean(ctx.snap.audience?.buyerMarket) },
  { dataset: "audience", key: "compliance", label: "compliance lines",
    usedFor: "what the concierge must never say to a patient",
    filledBy: { kind: "derived", how: "the vertical's preset" },
    // An owner audience legitimately has none; only a patient-facing one needs them.
    present: (ctx) => ctx.snap.audience?.stance === "owner" || (ctx.snap.audience?.hardLines ?? 0) > 0 },
  { dataset: "audience", key: "buyer_map", label: "best and worst customer map",
    usedFor: "the Loom, and which customer the pages chase",
    filledBy: { kind: "audit", how: "`loom` on the linked audit, then pick a customer" },
    present: (ctx) => ctx.snap.audit.buyerMap },
  { dataset: "audience", key: "dream_customer", label: "the customer picked for the Loom",
    usedFor: "the preferred customer, and its AI question as a hook",
    filledBy: { kind: "audit", how: "`loom` on the linked audit, then pick a customer" },
    present: (ctx) => ctx.snap.audit.pickedAvatar },
  { dataset: "audience", key: "own_reviews", label: "the client's own customer reviews",
    usedFor: "quotes that outrank the shared bank, because they are this business's customers",
    filledBy: { kind: "step", step: "intake_received", how: "reviews filed as CUSTOMER_REVIEW evidence", built: true },
    present: (ctx) => ctx.snap.reviews > 0 },

  // ── OFFER: what is sold to the audience ───────────────────────────────────
  { dataset: "offer", key: "short_offer", label: "the offer, named",
    usedFor: "keywords, pages, the research prompt",
    filledBy: { kind: "step", step: "offer_locked", how: "`offer: <what they sell>`", built: true },
    blocks: ["keyword_set"], present: (ctx) => Boolean(ctx.snap.offer.treatment && ctx.snap.offer.lockedAt) },
  { dataset: "offer", key: "customer_terms", label: "the customers' words for it",
    usedFor: "whether a keyword is about the offer at all",
    filledBy: { kind: "step", step: "offer_locked", how: "`terms: a, b, c` (its own message)", built: true },
    present: (ctx) => ctx.snap.offer.terms > 0 },
  { dataset: "offer", key: "outcome_promise", label: "the outcome promised (\"more appointments\", \"more jobs\")",
    usedFor: "every headline and CTA for this audience",
    filledBy: { kind: "step", step: "offer_locked", how: "`outcome: more appointments` (its own message)", built: true },
    present: (ctx) => Boolean(ctx.snap.offer.outcomePromise) },
  { dataset: "offer", key: "positioning", label: "how they want it positioned",
    usedFor: "the pillar page's angle",
    filledBy: { kind: "step", step: "offer_locked", how: "`offer: <name> | <positioning>`", built: true },
    present: (ctx) => Boolean(ctx.snap.offer.positioning) },
  { dataset: "offer", key: "lead_magnet", label: "the lead magnet",
    usedFor: "what each page gives away",
    filledBy: { kind: "step", step: "pre_call_pages", how: "minted after each page body", built: true },
    present: (ctx) => Boolean(ctx.snap.offer.magnetKey) },
  { dataset: "offer", key: "price", label: "the price or ticket",
    usedFor: "price pages, and whether a buyer is worth chasing",
    filledBy: { kind: "step", step: "offer_locked", how: "`price: $399 per session` (its own message)", built: true },
    present: (ctx) => Boolean(ctx.snap.offer.price) },

  // ── OFFER, the framework (step 10's letter, step 11's short offer and beliefs) ──
  // ‼️ `short_offer` ABOVE MEANS "THE OFFER, NAMED". The framework document is `short_offer_sheet`.
  docField("offer", "sales_letter", "the approved sales letter", "message 1 of step 11's framework script", "sales_letter", []),
  docField("offer", "short_offer_sheet", "the short offer", "the offer's strategy, in Matthew's template", "short_offer", ["big_idea", "ums", "product"]),
  docField("offer", "big_idea", "the big idea", "the pillar page", "short_offer", ["big_idea"]),
  docField("offer", "metaphor", "the metaphor", "the image that recurs across stories", "short_offer", ["metaphor"]),
  docField("offer", "ump", "the unique mechanism of the problem", "why every earlier attempt failed", "short_offer", ["ump"]),
  docField("offer", "ums", "the unique mechanism of the solution", "the mentor's gift in a story", "short_offer", ["ums"]),
  docField("offer", "authority_figure", "the authority figure (real, or \"none yet\")", "the mentor", "short_offer", ["authority_figure"]),
  docField("offer", "discovery_story", "the discovery story (real, or \"none yet\")", "an origin story, only when it is true", "short_offer", ["discovery_story"]),
  docField("offer", "objections", "objections to buying", "the refusal beats, objection pages and the close", "short_offer", ["objections"]),
  docField("offer", "belief_chains", "the belief chains", "the order the beliefs are installed in", "short_offer", ["belief_chains"]),
  docField("offer", "necessary_beliefs", "the necessary beliefs (up to 6, \"I believe that\")", "what every story installs", "necessary_beliefs", []),
  docField("offer", "offer_headline_ideas", "headline ideas from the short offer", "headline candidates", "short_offer", ["headline_ideas"]),
  docField("offer", "awareness_level", "the short offer's awareness level", "how much the letter can assume they know", "short_offer", ["awareness_level"]),
  docField("offer", "sophistication_stage", "the market's sophistication stage", "how new the mechanism has to sound", "short_offer", ["sophistication_stage"]),
  docField("offer", "consciousness_level", "consciousness level (low or high)", "how direct a story can be", "short_offer", ["consciousness_level"]),
  docField("offer", "funnel_architecture", "the funnel architecture", "internal", "short_offer", ["funnel_architecture"]),
];

export interface FieldGap {
  field: FieldSpec;
  /** Why it is empty, in words for the card. */
  reason: string;
  blocking: boolean;
}

export interface DatasetReport {
  dataset: DatasetKey;
  total: number;
  present: number;
  gaps: FieldGap[];
}

function reasonFor(field: FieldSpec, snap: DatasetSnapshot): string {
  const f = field.filledBy;
  switch (f.kind) {
    case "research":
      if (!f.asked) return "nothing asks for this yet";
      if (!snap.avatar.researchText) return "no research is stored for this avatar";
      // ‼️ SECTIONS 10 TO 16 ARE ASKED ONLY BY THE STEP 11 SCRIPT. Research from the compact prompt has no
      // such section, and "the research did not answer that section" would blame it for a question it
      // was never asked.
      if (f.scriptOnly) return "only step 11's framework script asks for this";
      if (field.key === "search_phrases") return "no KEYWORDS rows were parsed from the research";
      if (field.key === "sourced_numbers") return "no sourced figures are on the avatar";
      return "the research did not answer that section";
    case "step":
      return f.built ? `${f.how}, on ${f.step}` : f.how;
    case "audit":
      return snap.audit.linked ? f.how : "no audit is linked to this client";
    case "derived":
      return snap.audience ? f.how : "no audience yet";
    case "document": {
      const d = snap.documents;
      switch (f.doc) {
        case "sales_letter":
          return "`letter use`, `letter draft` or `letter replace:`, then `letter approve`, on offer_locked";
        case "necessary_beliefs":
          return "`beliefs:` in step 11's thread (message 7 of the framework script)";
        case "avatar_sheet":
          return d.avatarSheet ? "the avatar sheet on file leaves this heading empty" : "`avatar sheet:` in step 11's thread (message 4)";
        case "short_offer":
          return d.shortOffer ? "the short offer on file leaves this heading empty" : "`short offer:` in step 11's thread (message 5)";
      }
    }
  }
}

/**
 * An audience who has answered nothing, for anything that has to render what WOULD be asked.
 *
 * ‼️ THE VALUES ARE NOT ARBITRARY AND TWO OF THEM ARE DELIBERATELY NON-EMPTY. `audience` is a real
 * object and `audit.linked` is true so that derived and audit-backed fields render the sentence
 * that FILLS them rather than "there is no audience yet" or "no audit is linked", which are
 * upstream refusals and say nothing about the field. Everything a person answers is empty.
 *
 * ‼️ IT LIVES HERE, BESIDE THE FIELDS, BECAUSE TWO COPIES WOULD DRIFT. _probe-gaps.ts declared
 * this privately and the onboarding-map generator needs the identical one; a second copy is the
 * same "third declaration to keep in step" that the generator exists to avoid.
 */
export const NOTHING_ON_FILE: DatasetSnapshot = {
  audience: { label: "this audience", isPrimary: true, stance: "patient", hasVocabulary: false, buyerMarket: null, hardLines: 0, confirmedAt: null },
  avatar: { researchText: null, vocQuotes: 0, approvedNumbers: 0, keywordRows: 0, keywordRowsWithUrl: 0, objectionRows: 0 },
  offer: { applies: true, treatment: null, terms: 0, positioning: null, magnetKey: null, lockedAt: null, outcomePromise: null, price: null },
  documents: { avatarSheet: null, shortOffer: null, beliefs: 0, letterApproved: false },
  audit: { linked: true, pickedAvatar: false, buyerMap: false },
  reviews: 0,
};

/** Evaluate every declared field against one audience's snapshot. */
export function evaluateDatasets(snap: DatasetSnapshot, sectionKeys: readonly string[]): DatasetReport[] {
  const parsed = parseResearchSections(snap.avatar.researchText ?? "");
  const ctx: EvalContext = { snap, sections: new Map(parsed.map((s) => [s.number, s])), sectionKeys };

  return (["avatar", "audience", "offer"] as const).map((dataset) => {
    const fields = DATASET_FIELDS.filter((f) => f.dataset === dataset && (dataset !== "offer" || snap.offer.applies));
    const gaps: FieldGap[] = [];
    for (const field of fields) {
      if (field.present(ctx)) continue;
      gaps.push({ field, reason: reasonFor(field, snap), blocking: Boolean(field.blocks?.length) });
    }
    return { dataset, total: fields.length, present: fields.length - gaps.length, gaps };
  });
}

const DATASET_LABEL: Record<DatasetKey, string> = { avatar: "Avatar", audience: "Audience", offer: "Offer" };

/**
 * The card lines for one audience. Gaps are grouped by reason, so "the research prompt does not ask
 * for this yet" is said once for five fields instead of five times.
 */
export function formatDatasetReport(label: string, isPrimary: boolean, reports: DatasetReport[], offerApplies: boolean): string[] {
  const lines = [`*${label}*${isPrimary ? " (primary)" : " (option)"}`];
  for (const r of reports) {
    if (r.dataset === "offer" && !offerApplies) {
      lines.push(`  • *Offer:* nothing has been offered to this audience yet. Its offer is set when it becomes the primary one.`);
      continue;
    }
    if (!r.gaps.length) {
      lines.push(`  • *${DATASET_LABEL[r.dataset]}* ${r.present}/${r.total} :white_check_mark:`);
      continue;
    }
    const byReason = new Map<string, FieldGap[]>();
    for (const g of r.gaps) byReason.set(g.reason, [...(byReason.get(g.reason) ?? []), g]);
    const parts = [...byReason.entries()].map(([reason, gaps]) => {
      const names = gaps.map((g) => (g.blocking ? `:no_entry: ${g.field.label}` : g.field.label)).join(", ");
      return `${names} _(${reason})_`;
    });
    lines.push(`  • *${DATASET_LABEL[r.dataset]}* ${r.present}/${r.total}, missing: ${parts.join("; ")}`);
  }
  return lines;
}
