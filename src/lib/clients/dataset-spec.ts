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
//             spas, "more jobs" for plumbers). Today there is ONE offer per client (clients.offer);
//             moving it under the audience is owed, and the entries below say so rather than pretend.
//
// ‼️ WARN, AND BLOCK ONLY WHERE A STEP CANNOT RUN (Matthew, 2026-09-15). `blocks` names the steps
// that genuinely cannot run without the field, and every one of those is ALREADY enforced by that
// step's own gate. This file declares them so the card can say 🚫 instead of ⚠️; it adds no gate.
// Same split the page gate draws: evidence blocks, everything else warns.
//
// PURE. No DB, no network. dataset-completeness.ts loads the snapshot this evaluates.

import { parseResearchSections, sectionAnswered, type ResearchSection } from "./avatar-profile";

export type DatasetKey = "avatar" | "audience" | "offer";

export type Filler =
  /** A numbered section of the deep research prompt. `asked: false` means the prompt does not ask yet. */
  | { kind: "research"; sectionKey: string | null; asked: boolean }
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
  };
  offer: {
    /** False for a non-primary audience: offers are not per audience yet. */
    applies: boolean;
    treatment: string | null;
    terms: number;
    positioning: string | null;
    magnetKey: string | null;
    lockedAt: string | null;
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
  // Not asked by the prompt yet. Matthew, 2026-09-15: "Leave empty and flagged for now".
  { dataset: "avatar", key: "fears", label: "fears",
    usedFor: "fear pages and the Loom", filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED },
  { dataset: "avatar", key: "desires", label: "desires",
    usedFor: "the outcome a page promises to move toward", filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED },
  { dataset: "avatar", key: "fantasies", label: "fantasies",
    usedFor: "the identity copy speaks to", filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED },
  { dataset: "avatar", key: "objections", label: "objections to buying",
    usedFor: "the objection pages and the close", filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED },
  { dataset: "avatar", key: "awareness_stage", label: "awareness stage (1 to 5, with evidence)",
    usedFor: "where a page starts the reader and where it leaves them", filledBy: { kind: "research", sectionKey: null, asked: false }, present: NOT_ASKED },

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
    filledBy: { kind: "step", step: "offer_locked", how: "not captured anywhere yet", built: false },
    present: NOT_ASKED },
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
    filledBy: { kind: "step", step: "offer_locked", how: "not captured anywhere yet", built: false },
    present: NOT_ASKED },
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
      if (!f.asked) return "the research prompt does not ask for this yet";
      if (!snap.avatar.researchText) return "no research is stored for this avatar";
      if (field.key === "search_phrases") return "no KEYWORDS rows were parsed from the research";
      if (field.key === "sourced_numbers") return "no sourced figures are on the avatar";
      return "the research did not answer that section";
    case "step":
      return f.built ? `${f.how}, on ${f.step}` : f.how;
    case "audit":
      return snap.audit.linked ? f.how : "no audit is linked to this client";
    case "derived":
      return snap.audience ? f.how : "no audience yet";
  }
}

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
      lines.push(`  • *Offer:* offers are not per audience yet, so this audience has none of its own.`);
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
