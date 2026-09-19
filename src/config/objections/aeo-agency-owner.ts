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
//
// ‼️ `defaultBelief` HAS NO READER. Measured 2026-09-19: a grep across src/ finds it declared here and
// consumed nowhere. The three importers take BELIEF_THEMES for its KEYS and its `label` only. So the
// med-spa wording in those seven sentences is currently inert, and rewording it per vertical would be
// churn with no output change. Left as it is, and named here, because the fix is to wire the fallback
// that was intended rather than to maintain seven strings nothing prints. The file is also no longer
// only about one vertical despite its name: SEED_OBJECTIONS is the registry, keyed per research
// vertical, and renaming the file would touch three import paths for no behaviour change.

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

/**
 * The same seven beliefs, in a dentist owner's words.
 *
 * ‼️ THE BELIEF LADDER IS NOT VERTICAL SPECIFIC AND IS NOT DUPLICATED. Every objection below maps
 * to one of the seven themes above, because what a buyer has to believe before paying for AI
 * visibility does not change with their trade. Only the WORDS change, and only because a seed that
 * says "med spa" to a dentist reads as a form letter, which is the one thing an objection list
 * cannot afford.
 *
 * ‼️ FIVE OF THESE HAVE NO MED SPA EQUIVALENT, and they are the reason this is a second list rather
 * than a find-and-replace: insurance write-offs against fee-for-service work, the DSO down the road,
 * the practice-management vendor already selling them a website, the dental board, and an owner
 * three years from selling the practice. A med spa owner raises none of those. A find-and-replace
 * would have produced twenty-five lines that all read as almost right, which is worse than a short
 * list that reads as written for them.
 *
 * This is a seed and it is explicitly outranked by objection-mining.ts the moment real dental sales
 * calls have a count. Nothing here is a measurement.
 */
export const DENTIST_OWNER_OBJECTIONS: readonly SeedObjection[] = [
  { text: "Do patients actually use ChatGPT to find a dentist?", belief: "ai_search_is_real", stage: 4 },
  { text: "Is AI search real or just hype right now?", belief: "ai_search_is_real", stage: 4 },
  { text: "We already pay an SEO company, why would I need this too?", belief: "different_from_seo", stage: 3 },
  { text: "Isn't this just SEO with a new name?", belief: "different_from_seo", stage: 3 },
  { text: "Will this hurt my Google ranking?", belief: "different_from_seo", stage: 2 },
  { text: "We already pay our practice management company for the website, isn't this the same thing?", belief: "different_from_seo", stage: 3 },
  { text: "I tried a dental marketing agency before and it didn't work, why would this be different?", belief: "this_team_can_deliver", stage: 3 },
  { text: "How do I know you can actually get my practice named by ChatGPT?", belief: "this_team_can_deliver", stage: 2 },
  { text: "Have you done this for a dental practice like mine?", belief: "this_team_can_deliver", stage: 2 },
  { text: "How do I know this isn't a scam?", belief: "this_team_can_deliver", stage: 2 },
  { text: "Why can't we just do this in-house, my front desk has downtime?", belief: "this_team_can_deliver", stage: 3 },
  { text: "Is it too expensive for what I would get back?", belief: "worth_the_money", stage: 1 },
  { text: "Is it worth it for a single location practice?", belief: "worth_the_money", stage: 2 },
  { text: "How many new patients would I actually get from this?", belief: "worth_the_money", stage: 2 },
  { text: "Is it worth it when most of what walks in is insurance patients at a write-off?", belief: "worth_the_money", stage: 2 },
  { text: "My chairs are full, why would I pay for more visibility?", belief: "problem_is_real", stage: 5 },
  { text: "I get most of my patients from referrals and word of mouth, does AI search even matter for me?", belief: "problem_is_real", stage: 5 },
  { text: "The DSO down the road outspends me on everything, can I even compete on this?", belief: "problem_is_real", stage: 4 },
  { text: "Can you guarantee results?", belief: "low_risk", stage: 1 },
  { text: "Am I locked into a contract?", belief: "low_risk", stage: 1 },
  { text: "What if it doesn't work?", belief: "low_risk", stage: 1 },
  { text: "What's the catch with a free build?", belief: "low_risk", stage: 1 },
  { text: "How long until I see new patient calls?", belief: "low_risk", stage: 1 },
  { text: "Is it safe with the dental board, you publishing things under my name?", belief: "low_risk", stage: 2 },
  { text: "I'm chairside all day and I don't have the time for another project.", belief: "now_not_later", stage: 2 },
  { text: "I'm three years from selling the practice, is it worth it to start now?", belief: "now_not_later", stage: 3 },
  { text: "Can't I just wait and see if AI search takes off?", belief: "now_not_later", stage: 3 },
];

/**
 * Seeds per research vertical. A vertical with none gets no seed, and mining still runs.
 *
 * ‼️ THE KEY IS THE RESEARCH VERTICAL OF THE AUDIENCE WE ARE SELLING TO, not the buyer's own trade.
 * `aeo-agency-med-spa` means "SRT selling AEO to med spa owners", so the dentist equivalent is
 * `aeo-agency-dentist` and NOT `dentist`. A key of `dentist` would name the vertical a dentist's
 * PATIENTS shop in, which is a different audience with different objections entirely.
 */
export const SEED_OBJECTIONS: Record<string, readonly SeedObjection[]> = {
  "aeo-agency-med-spa": AEO_OWNER_OBJECTIONS,
  "aeo-agency-dentist": DENTIST_OWNER_OBJECTIONS,
};
