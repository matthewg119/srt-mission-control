// The sales objections a med spa owner raises before buying AI visibility work, in the owner's words.
//
// Matthew, 2026-09-15: "We need to focus in better objections mostly for building trust ... I want real
// sale objections." This is the seed half; the other half is mined from our own sales calls and texts
// (src/lib/clients/objection-mining.ts), which outranks it the moment it has a count.
//
// ‼️ WORDED AS THE OWNER SAYS IT, NOT AS WE WOULD ANSWER IT. Each one is a question or a hesitation in
// the first person, so phrase-kind.ts reads it as an objection by the same rule it reads the market by,
// and _probe-phrase-kind.ts proves every line here does.
//
// `belief` names the belief theme that has to be installed for the objection to fall away. A client's own
// necessary beliefs (audience_documents, kind necessary_beliefs) are per offer and free text, so this is
// the theme a story is matched to, with `defaultBelief` as the sentence used when a client has none yet.
// `stage` is the awareness stage the objection is usually raised at: 5 unaware to 1 most aware.

export type BeliefTheme =
  | "problem_is_real"
  | "ai_search_is_real"
  | "different_from_seo"
  | "this_team_can_deliver"
  | "worth_the_money"
  | "low_risk"
  | "now_not_later";

export const BELIEF_THEMES: Record<BeliefTheme, { label: string; defaultBelief: string }> = {
  problem_is_real: {
    label: "The problem is real and it is costing me",
    defaultBelief: "I believe that patients are choosing other clinics before they ever see mine.",
  },
  ai_search_is_real: {
    label: "People really do ask AI where to go",
    defaultBelief: "I believe that my future patients ask ChatGPT and Google's AI which med spa to trust.",
  },
  different_from_seo: {
    label: "This is not the SEO I already pay for",
    defaultBelief: "I believe that being named in AI answers is a different job from ranking a website.",
  },
  this_team_can_deliver: {
    label: "These people can actually do it",
    defaultBelief: "I believe that this team measures what AI says about me and can change it.",
  },
  worth_the_money: {
    label: "It pays for itself",
    defaultBelief: "I believe that a handful of booked patients a month is worth more than what this costs.",
  },
  low_risk: {
    label: "I am not taking a gamble",
    defaultBelief: "I believe that I can see it working before I am committed to anything.",
  },
  now_not_later: {
    label: "Waiting costs me more",
    defaultBelief: "I believe that whoever gets named first becomes the answer, and it is harder to take that spot later.",
  },
};

export interface SeedObjection {
  text: string;
  belief: BeliefTheme;
  stage: 1 | 2 | 3 | 4 | 5;
}

export const AEO_OWNER_OBJECTIONS: readonly SeedObjection[] = [
  { text: "Do patients actually use ChatGPT to find a med spa?", belief: "ai_search_is_real", stage: 4 },
  { text: "Is AI search real or just hype right now?", belief: "ai_search_is_real", stage: 4 },
  { text: "We already pay an SEO agency, why would I need this too?", belief: "different_from_seo", stage: 3 },
  { text: "Isn't this just SEO with a new name?", belief: "different_from_seo", stage: 3 },
  { text: "Will this hurt my Google ranking?", belief: "different_from_seo", stage: 2 },
  { text: "I tried marketing agencies before and it didn't work, why would this be different?", belief: "this_team_can_deliver", stage: 3 },
  { text: "How do I know you can actually get my clinic named by ChatGPT?", belief: "this_team_can_deliver", stage: 2 },
  { text: "How do I know this isn't a scam?", belief: "this_team_can_deliver", stage: 2 },
  { text: "Have you done this for a med spa like mine?", belief: "this_team_can_deliver", stage: 2 },
  { text: "Is it too expensive for what I would get back?", belief: "worth_the_money", stage: 1 },
  { text: "Is it worth it for a small med spa?", belief: "worth_the_money", stage: 2 },
  { text: "I can't afford another monthly marketing bill right now.", belief: "worth_the_money", stage: 2 },
  { text: "How many new patients would I actually get from this?", belief: "worth_the_money", stage: 2 },
  { text: "Can you guarantee results?", belief: "low_risk", stage: 1 },
  { text: "Am I locked into a contract?", belief: "low_risk", stage: 1 },
  { text: "What if it doesn't work?", belief: "low_risk", stage: 1 },
  { text: "What's the catch with a free build?", belief: "low_risk", stage: 1 },
  { text: "How long until I see inquiries?", belief: "low_risk", stage: 1 },
  { text: "I don't have time for another project, how much of my time does this take?", belief: "now_not_later", stage: 2 },
  { text: "Why can't I just do this myself?", belief: "this_team_can_deliver", stage: 3 },
  { text: "Can't I just wait and see if AI search takes off?", belief: "now_not_later", stage: 3 },
  { text: "My clinic is already busy, why would I need more visibility?", belief: "problem_is_real", stage: 5 },
  { text: "I get most of my patients from referrals, does AI search even matter for me?", belief: "problem_is_real", stage: 5 },
  { text: "Will this make my med spa look spammy or fake?", belief: "low_risk", stage: 2 },
  { text: "Is it legal for AI to recommend my clinic, will it cause compliance problems?", belief: "low_risk", stage: 2 },
];

/** Seeds per research vertical. A vertical with none gets no seed, and mining still runs. */
export const SEED_OBJECTIONS: Record<string, readonly SeedObjection[]> = {
  "aeo-agency-med-spa": AEO_OWNER_OBJECTIONS,
};
