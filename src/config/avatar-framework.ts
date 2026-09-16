// Matthew's avatar and offer framework, in English. The one source for the step 11 script AND its parsers.
//
// Translated from his "Creacion de Avatar" workflow, "Investigacion parte 1" and "parte 2", and his avatar
// sheet and short offer templates, per Desktop\SRT-Avatar-Offer-Framework-Prompt.md sections 5a to 5e.
//
// ‼️ ONE LIST, READ TWICE. The script renders each template from the section list below, and the parsers in
// src/lib/clients/avatar-framework.ts find sections by the same headings. A heading reworded in one place
// and not the other is a paste that parses as empty, so there is only one place.
//
// ‼️ NO EM DASHES ANYWHERE IN THIS FILE, including inside the text handed to an AI. The chat copies the
// house style of what it is given.
//
// Pure data. No imports.

export interface TemplateSection {
  /** Stable key the registry and the parsers use. Never reworded. */
  key: string;
  /** Printed before the heading in the template. Parsers ignore it (Slack may send it as a :shortcode:). */
  emoji: string;
  /** The heading text, matched exactly (case, punctuation and emoji ignored). */
  heading: string;
  /** Labelled lines inside the section ("Age range:"), each its own field. Empty when the section is a list. */
  subLabels: ReadonlyArray<{ key: string; label: string }>;
  /** The placeholder lines shown under the heading, in the template only. */
  placeholder: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5c. The avatar sheet
// ─────────────────────────────────────────────────────────────────────────────

export const AVATAR_SHEET: readonly TemplateSection[] = [
  {
    key: "demographics",
    emoji: "🔍",
    heading: "Demographics and General Information",
    subLabels: [
      { key: "age_range", label: "Age range" },
      { key: "gender", label: "Gender" },
      { key: "location", label: "Location" },
      { key: "income", label: "Monthly income" },
      { key: "professional_background", label: "Professional background" },
      { key: "identities", label: "Typical identities" },
    ],
    placeholder: [
      "Age range: [Specify the age range]",
      "Gender: [Specify the gender split]",
      "Location: [Specify the main regions or countries]",
      "Monthly income: [Specify the typical income range]",
      "Professional background: [List the typical professional backgrounds]",
      "Typical identities: [Describe common identities, lifestyles or roles]",
    ],
  },
  {
    key: "challenges",
    emoji: "🚩",
    heading: "Main Challenges and Pain Points",
    subLabels: [
      { key: "pain_point_1", label: "Pain point 1" },
      { key: "pain_point_2", label: "Pain point 2" },
      { key: "pain_point_3", label: "Pain point 3" },
    ],
    placeholder: [
      "Pain point 1:", "[Challenge 1]", "[Challenge 2]", "[Challenge 3]",
      "Pain point 2:", "[Challenge 1]", "[Challenge 2]", "[Challenge 3]",
      "Pain point 3:", "[Concern 1]", "[Concern 2]", "[Concern 3]",
    ],
  },
  {
    key: "goals",
    emoji: "🌟",
    heading: "Goals and Aspirations",
    subLabels: [
      { key: "short_term_goals", label: "Short-term goals" },
      { key: "long_term_aspirations", label: "Long-term aspirations" },
    ],
    placeholder: [
      "Short-term goals:", "[Short-term goal 1]", "[Short-term goal 2]", "[Short-term goal 3]",
      "Long-term aspirations:", "[Long-term aspiration 1]", "[Long-term aspiration 2]", "[Long-term aspiration 3]",
    ],
  },
  {
    key: "emotional_drivers",
    emoji: "🧠",
    heading: "Emotional Drivers and Psychological Insights",
    subLabels: [],
    placeholder: ["[Emotional driver / insight 1]", "[Emotional driver / insight 2]", "[Emotional driver / insight 3]"],
  },
  {
    key: "general_quotes",
    emoji: "💬",
    heading: "General Direct Customer Quotes",
    subLabels: [],
    placeholder: ['"[Customer quote 1]"', '"[Customer quote 2]"', '"[Customer quote 3]"'],
  },
  {
    key: "pain_quotes",
    emoji: "🚩",
    heading: "Pain Points and Frustrations",
    subLabels: [],
    placeholder: ['"[Pain / frustration quote 1]"', '"[Pain / frustration quote 2]"', '"[Pain / frustration quote 3]"'],
  },
  {
    key: "mindset_phrases",
    emoji: "🎯",
    heading: "Mindset Phrases",
    subLabels: [],
    placeholder: ['"[Mindset quote 1]"', '"[Mindset quote 2]"', '"[Mindset quote 3]"'],
  },
  {
    key: "emotional_state_quotes",
    emoji: "🗣",
    heading: "Quotes on Emotional State and Personal Motivations",
    subLabels: [],
    placeholder: [
      '"[Emotional state / personal motivation quote 1]"',
      '"[Emotional state / personal motivation quote 2]"',
      '"[Emotional state / personal motivation quote 3]"',
    ],
  },
  {
    key: "difficulty_quotes",
    emoji: "📢",
    heading: "Quotes on Emotional Responses to Difficulty",
    subLabels: [],
    placeholder: [
      '"[Emotional response to difficulty quote 1]"',
      '"[Emotional response to difficulty quote 2]"',
      '"[Emotional response to difficulty quote 3]"',
    ],
  },
  {
    key: "urgency_quotes",
    emoji: "🚀",
    heading: "Quotes on Motivation and Urgency Toward Success",
    subLabels: [],
    placeholder: ['"[Motivation / urgency quote 1]"', '"[Motivation / urgency quote 2]"', '"[Motivation / urgency quote 3]"'],
  },
  {
    key: "fears",
    emoji: "🚩",
    heading: "Main Emotional Fears and Deep Frustrations",
    subLabels: [],
    placeholder: ["[Fear / frustration 1]", "[Fear / frustration 2]", "[Fear / frustration 3]"],
  },
  {
    key: "psychographics",
    emoji: "🧠",
    heading: "Emotional and Psychographic Insights",
    subLabels: [],
    placeholder: ["[Psychographic insight 1]", "[Psychographic insight 2]", "[Psychographic insight 3]"],
  },
  {
    key: "emotional_journey",
    emoji: "📌",
    heading: "Typical Emotional Journey",
    subLabels: [
      { key: "journey_awareness", label: "Awareness" },
      { key: "journey_frustration", label: "Frustration" },
      { key: "journey_search", label: "Desperation and Search for Solutions" },
      { key: "journey_relief", label: "Relief and Commitment" },
    ],
    placeholder: [
      "Awareness: [Describe the initial awareness stage]",
      "Frustration: [Describe the frustration stage]",
      "Desperation and Search for Solutions: [Describe the solution-seeking stage]",
      "Relief and Commitment: [Describe the relief and commitment stage]",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5d. The short offer
// ─────────────────────────────────────────────────────────────────────────────

const plain = (key: string, emoji: string, heading: string, placeholder: string[]): TemplateSection => ({
  key,
  emoji,
  heading,
  subLabels: [],
  placeholder,
});

export const SHORT_OFFER: readonly TemplateSection[] = [
  plain("product_names", "💡", "Potential Product Name Ideas", ["[Write your ideas here]"]),
  plain("consciousness_level", "🔺", "Consciousness Level", ["Low / High"]),
  plain("awareness_level", "🧭", "Awareness Level", ["[Describe how aware the customer is of the problem and the solution]"]),
  plain("sophistication_stage", "⚙️", "Sophistication Stage", ["[Describe how sophisticated the market or the competition is]"]),
  plain("big_idea", "💥", "Big Idea", ["[Describe the big idea that sets this offer apart]"]),
  plain("metaphor", "🎭", "Metaphor", ["[A metaphor that captures the core message]"]),
  plain("ump", "⚠️", "Unique Mechanism of the Problem (UMP)", ["[The root cause or hidden mechanism behind the problem]"]),
  plain("ums", "🚀", "Unique Mechanism of the Solution (UMS)", ["[The unique or innovative mechanism that solves it]"]),
  plain("authority_figure", "🧙‍♂️", "Guru / Authority Figure", ["[Whether there is a creator, mentor or story behind the offer]"]),
  plain("discovery_story", "📜", "Discovery Story", ["[Briefly, how the solution or method came about]"]),
  plain("product", "💼", "Product", ["[Briefly describe the offer and what it delivers]"]),
  plain("headline_ideas", "📰", "Potential Headline / Subheadline Ideas", [
    "[Headline 1 / Subheadline 1]",
    "[Headline 2 / Subheadline 2]",
    "[Headline 3 / Subheadline 3]",
  ]),
  plain("objections", "🚫", "Potential Objections", ["[Objection 1]", "[Objection 2]", "[Objection 3]"]),
  plain("belief_chains", "🔗", "Belief Chains", [
    "[What must the prospect believe to decide to buy?]",
    "[Belief 1]",
    "[Belief 2]",
    "[Belief 3]",
  ]),
  plain("funnel_architecture", "🧩", "Funnel Architecture", ["[Describe the funnel stages: traffic, lead magnet, offer, close, follow-up]"]),
  plain("domains", "🌐", "Potential Domains", ["[Domain 1]", "[Domain 2]", "[Domain 3]"]),
  plain("swipes", "📚", "Reference Examples / Swipes", ["[Example 1]", "[Example 2]", "[Example 3]"]),
  plain("notes", "📝", "Other Notes", ["[Any extra observations, differentiators or complementary ideas]"]),
];

/** A template as the chat is shown it: emoji, heading, colon, placeholder lines, a blank line between. */
export function renderTemplate(sections: readonly TemplateSection[]): string {
  return sections.map((s) => [`${s.emoji} ${s.heading}:`, ...s.placeholder].join("\n")).join("\n\n");
}

/** Every necessary belief starts with this, and nothing else counts as one. */
export const BELIEF_OPENING = "I believe that";
export const MAX_NECESSARY_BELIEFS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// 5a. The research method (Investigacion parte 1 and parte 2, condensed faithfully)
// ─────────────────────────────────────────────────────────────────────────────

export const RESEARCH_METHOD = `Do this research before writing any copy. Copywriters who skip it guess what the market wants to hear. Research lets the market tell you, in its own words, which you can then use in the copy.

WHO THE CUSTOMER IS. Age, gender, income, where they live. Their attitudes: religious, political, social, economic (lower, middle or upper class; retired; spenders or savers), because the copy's voice must feel familiar and trustworthy to them. Their hopes and dreams, in life and not only about the product. Their victories and failures, especially around the main problem. The external forces they believe have kept them from living their best life ("the system is rigged", "my family doesn't support me"). Their prejudices: shared attitudes, stereotypes and judgements. Then sum up their core beliefs about life, love and family in one to three sentences.

EXISTING SOLUTIONS. What the market already uses, and their experience with each: did it work, did they quit, why. What they like about those solutions and what they dislike, so the offer can share what they love and differ from what they hate, and objections can be answered before they are raised. Horror stories about those solutions, which make powerful warnings. Whether the market believes the current solutions work: if yes, differentiate harder; if no, explain why they fail and why this one works.

CURIOSITY. Has anyone tried to solve this problem in a unique way before, an old or "lost" solution? People love the rediscovered.

CORRUPTION. The belief that things used to be better until some force ruined them. It appeals to a sense of injustice and a need for redemption.

WHERE TO LOOK. Forums first: active ones, threads sorted by replies (dense with beliefs, emotion, stories and real language) and by views (good headline and subject-line ideas). Reviews of the products they already buy, both 5-star and 1-star, for success stories and horror stories. Search engines for demographics, old or curious stories and corruption angles. Copy what people say word for word, spelling mistakes included: what matters is what THEY believe, not whether they are right. Write at a 6th to 7th grade reading level. Specific beats generic: "wants her husband to be proud of her" is worth more than "wants to lose weight".

ORGANISE EVERYTHING BY: who the customer is; attitudes; hopes and dreams; victories and failures; external forces they blame; prejudices; beliefs about existing solutions; what they like and hate about current solutions; horror stories; curiosity and corruption.`;

// ─────────────────────────────────────────────────────────────────────────────
// 5e. The beliefs transcript (message 6)
// ─────────────────────────────────────────────────────────────────────────────

export const BELIEFS_TRANSCRIPT = `There is a fundamental difference between the copywriting approach taught and used at Agora, which is what made me fall in love with it and became the foundation of the E5 method, and the most common copywriting method in digital marketing. That difference holds back most copywriters, and most people trying to learn copywriting through the "internet marketing" approach.

In internet marketing, everything revolved around choosing magnificent words: power words, exaggerated phrases, hyperbole, "the steroid traffic system that generates a tsunami of buyers". It was all about the words, which is why almost every copywriting training included a "power words list".

At Agora, everything rests on the magnificence of the argument. It is not about impactful words. It is about building an argument that is logically and emotionally irresistible. I do not try to convince people with words like "incredible" or "fantastic". My goal is to present an argument that cannot be refuted, one that leads them to a single conclusion.

Every marketing campaign takes the prospect on a journey toward one specific belief: the belief they must hold before the offer is presented. That belief is the north star that guides the whole message.

When you write without structure, with only pretty words, you lose your way. But when you build a solid argumentative structure, a logical and emotional sequence, you can guide the prospect step by step to that key belief.

That is why I say: stop "writing copy" and start building arguments. Words matter, but only when they sit on a solid foundation. Build the argument first, then adjust the verbs and power words. Be an argument builder, not just a writer.`;
