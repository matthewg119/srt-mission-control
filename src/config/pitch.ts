// Tunables for the audit outreach pipeline, in one file rather than scattered through the
// drafters. Same precedent as src/config/pipeline.ts and src/config/vektor.ts.
//
// Everything here is a policy decision someone might reasonably want to change without reading
// email-assistant.ts. Anything that is a *mechanism* stays in its own module.

import type { CrawlBlock } from "@/lib/audit-engine/types";

// ── Belief selection ────────────────────────────────────────────────────────
// B4 ("different game, different winners") is the right opener when the prospect is proud of
// their Google presence: acknowledging that strength first is what stops the email reading as
// an insult. Below these thresholds the default B1 (behavior) lands better, because a business
// with a thin profile has nothing to be defensive about.
export const B4_GBP_RATING_MIN = 4.7;
export const B4_GBP_REVIEWS_MIN = 100;

/** Phrases in the intake answers that mean "they bragged about their ranking on the call". */
export const RANKING_BRAG_PATTERNS: RegExp[] = [
  /\b(?:#\s*1|number one|first page|top of google|ranks? (?:first|#\s*1|number one))\b/i,
  /\bgood (?:seo|rankings?)\b/i,
  /\b(?:primero|numero uno|#\s*1) en google\b/i,
  /\bbuen(?:a|as)? (?:posicion|posiciones|seo)\b/i,
];

// ── The permission-stage close ──────────────────────────────────────────────
/**
 * How long the Loom is, as it is said in the email.
 *
 * Stated rather than left vague on purpose: "a video" is an unknown commitment a stranger has to
 * weigh, "4 min" is a decision they can make in one second. Change it here if the recordings
 * stop landing near four minutes, because the email promising one length and the video being
 * another is the kind of small dishonesty that costs the reply.
 */
export const VIDEO_LENGTH_LABEL = "4 min";

// ── The Loom script ─────────────────────────────────────────────────────────
/**
 * The offer, as it is said out loud in the recording.
 *
 * Constants rather than prompt instructions for the same reason PERMISSION_CLOSE is: a model asked
 * to "mention the price" rewrites it every take, and a video that says a different number than the
 * invoice is the one mistake that cannot be walked back. Override per recording with `loom $499`.
 */
/**
 * The offer is FOUR PAID TIERS plus the free audit, all month to month (rebuilt 2026-08-21).
 *
 * It was two tiers until the guarantee-anchored VSL rebuild. It is still not one price with a
 * discount hiding behind it: "can you do better" is answered by moving DOWN a tier, which is a
 * smaller scope for a smaller number, not by cutting a price. That distinction is the whole reason
 * there is no lever any more, and adding tiers above Complete does not reintroduce one.
 *
 * ‼️ These figures are the ONLY price figures that exist anywhere. None may be turned into another
 * one by arithmetic, and no percentage, "half", or per-day breakdown may be derived. The single
 * exception is `ANNUAL_LINE`, which states the annual discount in fixed words and is never applied
 * to a number out loud.
 */
export const PRICE_CORE = "$349 / month";
export const PRICE_COMPLETE = "$499 / month";
export const PRICE_ADS = "$999 / month";
/** Enterprise is priced BY LOCATION COUNT. This is where it starts, never what it costs. */
export const PRICE_ENTERPRISE_FROM = "$4,999 / month";

export const OFFER_TIERS = [
  {
    name: "Core",
    price: PRICE_CORE,
    includes: [
      "8 pages on your site each month, 4 new and 4 updated, each answering a question buyers actually ask",
      "Your 20 question audit re-run every month across ChatGPT, Perplexity, Gemini and Google AI, measured against your baseline",
      "Automated review requests to your customers",
      "A one-page scorecard and a short video every month",
    ],
  },
  {
    name: "Complete",
    price: PRICE_COMPLETE,
    includes: [
      "Everything in Core, doubled: 8 new, 8 updated, 40 questions tracked",
      "Placements in the directories, listicles and local forums AI actually cites",
      "Your review replies written for you, including the bad ones",
      "Tracking which competitors the AI names instead of you",
    ],
  },
  {
    name: "Complete + ChatGPT Ads",
    price: PRICE_ADS,
    includes: [
      "Everything in Complete",
      "ChatGPT Ads built and run for you: the creative, the prompt patterns your buyers type, and the budget managed end to end",
      "A weekly performance report on what the ad spend returned",
      "The 30 day guarantee, which exists on this tier and no other",
    ],
  },
  {
    name: "Enterprise",
    price: PRICE_ENTERPRISE_FROM,
    includes: [
      "Everything in Complete, run per location",
      "Multi-location entity reconciliation, so the engines stop merging your locations into one",
      "A named contact",
      "Priced by how many locations you run. 10 locations is $4,999; fewer locations is less",
    ],
  },
] as const;

/** The tier the pitch recommends by default. Read by the Loom wizard and the closing script. */
export const RECOMMENDED_TIER = "Complete + ChatGPT Ads";

/** Every tier name, for validating a `loom core` style override against a closed list. */
export type OfferTierName = (typeof OFFER_TIERS)[number]["name"];

/** The price for a tier name, or null for a name that is not one of ours. */
export function priceForTier(tier: string | null): string | null {
  return OFFER_TIERS.find((t) => t.name === tier)?.price ?? null;
}

/**
 * The free first build, which is what Matthew now leads with (2026-08-17).
 *
 * One section of the prospect's OWN site, built by us, at no charge and with no card. It is a
 * real deliverable they keep whether or not anything paid follows, and that is the reason it
 * works: it is checkable. The paid tiers below are a SEPARATE, later conversation, and saying so
 * out loud is what stops it sounding like a bait.
 *
 * ‼️ It has no expiry and no scarcity attached. Inventing one ("only this month", "I have two
 * slots left") turns a true offer into a false one and is banned for the same reason a made-up
 * price is.
 */
export const FREE_FIRST_BUILD =
  "We build one section of your own site that AI can actually read and cite. It is free, there is no card, and you keep it either way. All you have to do is say yes.";

/** The same thing in Spanish, for the Spanish-language coach path. */
export const FREE_FIRST_BUILD_ES =
  "Crearemos una seccion de tu sitio web que la IA realmente pueda leer. Es completamente gratis y es tuya. Solo tienes que decir que si.";

/**
 * The risk framing, and it is TRUE as written.
 *
 * Not a guarantee, not a refund, not a performance promise. It says what happens to the work if
 * they stop paying, which is a fact about the arrangement. Anything that rewrites it into "no
 * risk" or "money back" is banned by HARD_LINES and must stay banned.
 */
export const OFFER_EXIT_LINE = "Leave anytime, keep everything: pages, profiles, data.";

/**
 * What separates the two tiers, in one sentence each, for saying out loud.
 *
 * `OFFER_TIERS[].includes` is the deliverable list and stays the contract; this is the FRAMING,
 * and the two are not interchangeable. Read aloud, a four-item bullet list is unlistenable and the
 * distinction that actually decides the tier gets lost inside it: Core changes what the business
 * says about itself, Complete changes what the rest of the internet says about it. That is the
 * whole choice, and it is the sentence a prospect repeats back when deciding.
 */
export const TIER_CONTRAST = {
  Core: {
    line: "Core fixes what you say.",
    detail: "We fix your website and manage your reviews.",
  },
  Complete: {
    line: "Complete changes what everyone else says about you.",
    detail:
      "Your website, plus outreach to the forums, plus we write the reviews for your customers for the engine to quote.",
  },
  "Complete + ChatGPT Ads": {
    line: "Complete plus ChatGPT Ads puts you in front of buyers this week instead of next quarter.",
    detail:
      "Everything in Complete, plus we build the ads, target the prompts your buyers are typing, and manage the budget.",
  },
  Enterprise: {
    line: "Enterprise is Complete run per location.",
    detail:
      "Plus the multi-location work that stops the engines merging your locations, and a named contact. Priced by how many locations you run.",
  },
  both: "Every tier includes the monthly report with your progress.",
} as const;

/** The recommended tier, as one line, for a script or a brief that needs the price in a sentence. */
export const LOOM_PRICE_LABEL = `${PRICE_ADS} (${RECOMMENDED_TIER}), ${PRICE_COMPLETE} (Complete) or ${PRICE_CORE} (Core)`;

/**
 * How long the ORGANIC work takes to compound.
 *
 * ‼️ Its job changed with the v3 script (2026-08-21) and the string did not. It used to be the
 * patience disclaimer under the price. It is now the ARGUMENT FOR THE ADS: organic takes this
 * long, your competitors are all waiting for that curve, which is the entire reason the paid layer
 * exists and the entire reason a 30 day guarantee is possible at all. Do not shorten it to make
 * the offer sound faster — the number is what makes Promise 2 make sense.
 */
export const LOOM_START_WINDOW = "60 to 90 days";

// ── The guarantee ───────────────────────────────────────────────────────────
/**
 * ‼️ THE GUARANTEE EXISTS ON EXACTLY ONE TIER, AND THE GATE BELOW IS HOW THAT IS ENFORCED.
 *
 * Organic visibility takes LOOM_START_WINDOW to compound. No honest agency can guarantee 30 day
 * results without paid traffic, so the guarantee rides on the tier that has the paid traffic in
 * it and on no other. Saying it over a $349 pitch is a promise that cannot be kept, made to
 * somebody who is not buying the thing that would keep it.
 *
 * The wording is a CONSTANT, same precedent as PERMISSION_CLOSE, NOT_SELLING_LINE and
 * CRAWL_BLOCK_LINE. A model merely ASKED to "mention the guarantee" rewrites it every take, and a
 * guarantee that is worded differently in the video, the email and the call is three different
 * commitments the prospect can hold us to.
 */
export const GUARANTEE_TIER = "Complete + ChatGPT Ads";

/** Said once, in full, when the promise is first made. */
export const GUARANTEE_LINE =
  "we will double your investment using ChatGPT Ads within 30 days, or you do not pay";

/** Said once more at the end of Promise 2, where the ads are what deliver it. */
export const GUARANTEE_RESTATE = "double your investment inside 30 days, or you do not pay";

/** What doubling means, in the buyer's own arithmetic, so it cannot be read as a refund policy. */
export const GUARANTEE_MATH =
  "For every dollar you put in with us, you get at least two back in new business inside your first month. If we do not hit that, you owe us nothing.";

/**
 * ‼️ THE GATE. A FUNCTION, NOT A PROMPT RULE.
 *
 * Same doctrine as crawlBlockAngle() below and call-coach-price-gate.ts: **absent beats
 * forbidden.** This codebase has learned that lesson three separate times — the COLD_STEM that
 * leaked into close-stage intros 1 run in 3, the $349 lever that leaked on the first price
 * objection in 2 of 3 live runs, and marketFactsFor's health stat shipping to a control panel
 * shop. In every case the fix was the same: stop handing the model the words.
 *
 * A caller that gets null here never receives the guarantee text at all, so there is nothing for
 * a helpful model to reach for when a prospect on the $349 tier asks "what if it doesn't work".
 */
export function guaranteeFor(tier: string | null | undefined): string | null {
  return tier === GUARANTEE_TIER ? GUARANTEE_LINE : null;
}

/** The ads window analogy, fixed. Doc §7 lists it as load-bearing copy. */
export const ADS_WINDOW_LINE =
  "same low CPMs, same untapped audience, same window that won't stay open";

/** The Promise 3 payoff, fixed. */
export const DEFAULT_ANSWER_LINE =
  "90 days from now, you are not wondering whether this worked. You are the default.";

/**
 * The annual terms.
 *
 * ‼️ This is the ONE place a percentage may be stated, and it is stated in words rather than
 * applied to a figure. "20% off $999" invites the listener to check the arithmetic on camera, and
 * the derived number would then be a fifth price that exists nowhere in OFFER_TIERS.
 */
export const ANNUAL_LINE =
  "Annual saves you 20%. And right now, annual on the $999 tier includes the ChatGPT Ads setup done for you, free.";

/**
 * Where they pay, or null.
 *
 * ‼️ NULL IS A REAL STATE AND BOTH CALLERS MUST HANDLE IT. The v2 close is "click the link I sent
 * over", so the script and the delivery email both depend on a link that exists. With none set,
 * they say so — the pre-flight prints NO PAYMENT LINK SET and the delivery email flags it — rather
 * than printing a placeholder that ships to a prospect. Same tri-state discipline as `site_signals`
 * and `robots_check`: never scanned and clean are different answers, and so are no link and a link.
 */
export const PAYMENT_LINK: string | null = process.env.SRT_PAYMENT_URL || null;

/** How long onboarding takes once they have paid. Said on camera and written in the hand-over. */
export const ONBOARDING_WINDOW = "around 30 minutes";

/** The number Matthew reads on camera. Same one as operator-rules.ts, NOT the NAP number. */
export const LOOM_TEXT_NUMBER = "336-833-2303";

/**
 * A volume promise ("50 to 100 new clients"), or null for no promise at all.
 *
 * Null by default and that is deliberate. Nothing in the audit pipeline records or predicts a
 * number of customers, so a figure said on camera would be invented, and the same honesty rule
 * that stops dream-lead.ts presenting the image as a real lead applies to a sentence read aloud
 * over it. Set this to a string only if the claim is one worth owning.
 *
 * ‼️ THE GUARANTEE DID NOT CHANGE THIS AND MUST NOT BE USED TO ARGUE FOR CHANGING IT. The
 * guarantee is a claim about MONEY, on one tier, with a stated remedy if it is missed: it is
 * falsifiable, and if it is wrong the prospect pays nothing. A client COUNT is a forecast this
 * pipeline has no way to make and no way to settle. They are different kinds of sentence and only
 * one of them has a gate.
 */
export const LOOM_CLIENT_COUNT_CLAIM: string | null = null;

// ── The Loom delivery email ─────────────────────────────────────────────────

/** Rule 2. The body is a hand-over, not a second pitch. */
export const DELIVERY_MAX_WORDS = 200;

/**
 * Rule 7. Both lines must survive into every delivery email, appended if the model drops them.
 *
 * Same precedent as PERMISSION_CLOSE: a model merely ASKED to include a line rewrites it every
 * time. The first is the whole reason a cold prospect keeps reading; the second is what turns the
 * report from a claim into something they can check in thirty seconds without talking to us, which
 * is worth more than any sentence we could write about it.
 */
export const DELIVERY_REQUIRED_LINES = [
  "yours to keep either way",
  "run any of those questions yourself in an incognito window",
];

/**
 * Rule 4. Anything here is a promise this business cannot make and does not measure.
 *
 * The audit reports VISIBILITY. It does not predict customers, calls, jobs or revenue, and nothing
 * in the pipeline could support such a number. These are checked against the TRANSCRIPT (where a
 * hit is flagged, because the video is already recorded and the email cannot unsay it) and against
 * the DRAFT (where a hit is rejected, because that one we can still fix).
 *
 * Deliberately broad. A false positive costs one glance at a flag; a false negative puts a promise
 * we cannot keep in writing.
 *
 * ‼️ THE GUARANTEE IS EXEMPTED BY EXACT MATCH, NEVER BY LOOSENING A PATTERN HERE (2026-08-21).
 * Every pattern below stays exactly as written, because the cold lanes — permission emails, the
 * `call` follow-up script, the no-website pitch — carry no guarantee and must keep rejecting all
 * of this. `spokenPromises(text, { allowedTier })` in delivery-guards.ts strips the literal
 * GUARANTEE_LINE / GUARANTEE_RESTATE / GUARANTEE_MATH from the text FIRST, on the one tier that
 * carries them, and then runs these patterns over what is left.
 *
 * That ordering is the whole design. A lookahead or a `(?<!...)` carve-out added below would
 * license every paraphrase of the guarantee too — "we guarantee you'll make your money back",
 * "this pays for itself in a month" — and those are exactly the sentences that turn a specific,
 * settleable commitment into an unfalsifiable one. Stripped-then-checked means the approved
 * wording passes and a rewrite of it still fails.
 */
export const DELIVERY_BANNED_PROMISES: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\b(?:more|extra|additional|new)\s+(?:customers?|clients?|patients?|jobs?|leads?|calls?|bookings?|business)\b/i, detail: "promises more customers, jobs, leads or calls" },
  { pattern: /\b\d+\s*(?:to|-)?\s*\d*\s*(?:more\s+)?(?:customers?|clients?|patients?|jobs?|leads?|calls?)\b/i, detail: "names a number of customers, jobs or calls" },
  { pattern: /\b(?:grow|double|triple|increase|boost|scale)\s+(?:your|their)?\s*(?:business|revenue|sales|income|bookings?|customers?)\b/i, detail: "promises growth in revenue or sales" },
  { pattern: /\b(?:guarantee|guaranteed|promise)\b/i, detail: "uses the word guarantee or promise" },
  { pattern: /\b(?:you'?ll|you will|this will)\s+(?:get|win|land|close|make)\b/i, detail: "predicts what they will get, win or close" },
  { pattern: /\b(?:ROI|return on investment|pays? for itself)\b/i, detail: "claims a return on investment" },
  // ‼️ ADDED 2026-08-21 WITH THE GUARANTEE, AND IT IS WHAT MAKES THE MASK MEAN ANYTHING.
  //
  // The old list caught "double your revenue" but not "double your investment", so the exact
  // sentence this whole offer now hangs on matched NO pattern at all. It was passing everywhere,
  // on every tier, guarantee or no guarantee, which meant the mask in spokenPromises() was
  // exempting something that was never being caught.
  //
  // Banned by default here; exempted by exact-match masking on the one tier that can deliver it.
  // That round trip is the entire mechanism, and this line is the half that was missing.
  {
    pattern: /\b(?:double|triple|2x|3x)\s+(?:your|their)\s+(?:investment|money|spend|budget)\b/i,
    detail: "promises a multiple of their money back",
  },
  { pattern: /\b(?:more|extra)\s+(?:revenue|money|sales|income)\b/i, detail: "promises more revenue or money" },
];

// ── Draft linter ────────────────────────────────────────────────────────────

/** Auto-retries before the failure reason is posted instead of the draft. */
export const LINTER_MAX_RETRIES = 2;

/**
 * Sentences the control skeleton spends on the body (SRT_Slack_Pipeline_v2.md ETAPA 1), plus the
 * 2 the belief module allows a seed to add. The greeting, the sign-off and the conditional
 * website-tease line are counted separately, so this is the ceiling for everything else.
 */
export const SKELETON_BODY_SENTENCES = 8;
export const SEED_SENTENCE_ALLOWANCE = 2;

/**
 * Jargon that must never reach a prospect, with what to say instead.
 *
 * Case-sensitive for the acronyms on purpose: a case-insensitive /\bgeo\b/ matches "Geo" in a
 * street name and "GEO" in Georgia, and a linter that cries wolf gets ignored. The lowercase
 * entries are ordinary words and are matched case-insensitively.
 */
export const BANNED_JARGON: Array<{ pattern: RegExp; term: string; sayInstead: string }> = [
  { pattern: /\bAEO\b/, term: "AEO", sayInstead: "the answers AI gives about you" },
  { pattern: /\bGEO\b/, term: "GEO", sayInstead: "AI search" },
  { pattern: /\bLLMs?\b/, term: "LLM", sayInstead: "ChatGPT, or the AI engines" },
  { pattern: /\bSERPs?\b/, term: "SERP", sayInstead: "the results page" },
  { pattern: /\bschemas?\b/i, term: "schema", sayInstead: "your site markup" },
  { pattern: /\bcitations?\b/i, term: "citations", sayInstead: "the sources it reads" },
  { pattern: /\bentit(?:y|ies)\b/i, term: "entities", sayInstead: "what the engines know about you" },
  { pattern: /\balgorithms?\b/i, term: "algorithm", sayInstead: "how the engines pick who to name" },
];

/**
 * Absolutes from the module's anti-pattern list. One of these takes the credibility of every
 * other sentence down with it, which is why this is a reject and not a warning.
 */
export const BANNED_ABSOLUTES: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\bnobody (?:uses|is using) google\b/i, detail: "nobody uses Google" },
  { pattern: /\bno one (?:uses|is using) google\b/i, detail: "no one uses Google" },
  { pattern: /\bya nadie usa google\b/i, detail: "ya nadie usa Google" },
  { pattern: /\bnadie (?:usa|busca en) google\b/i, detail: "nadie usa Google" },
  { pattern: /\bevery(?:one|body) (?:now )?(?:uses|asks) (?:ai|chatgpt)\b/i, detail: "everyone uses AI" },
  { pattern: /\btodo el mundo (?:usa|pregunta)\b/i, detail: "todo el mundo usa" },
  { pattern: /\bgoogle is dead\b/i, detail: "Google is dead" },
  { pattern: /\bgoogle (?:ya )?(?:esta )?murio\b/i, detail: "Google murio" },
];

// ── Niche intel brief cache (Phase 3) ───────────────────────────────────────
export const NICHE_BRIEF_TTL_DAYS = 30;
export const NICHE_BRIEF_MAX_SEARCHES = 8;

/**
 * Domains the intel brief must not research from.
 *
 * The brief used to enforce its source quality the strong way, `allowed_domains: ["reddit.com"]`,
 * so the model physically could not cite an agency blog. Reddit now blocks Anthropic's crawler and
 * that allowlist is rejected with a 400 before any search runs, so the guarantee had to invert:
 * search broadly, block the worst.
 *
 * What is on this list and why: sites that rank for "<trade> worst customers" while being written
 * BY someone selling software or marketing TO that trade. They read authoritative and contain
 * nothing an owner actually said, which is the exact failure mode the allowlist existed to prevent.
 * A blocklist is weaker than an allowlist and the Slack card says so out loud.
 */
export const BRIEF_BLOCKED_DOMAINS = [
  "hubspot.com",
  "semrush.com",
  "ahrefs.com",
  "wix.com",
  "squarespace.com",
  "godaddy.com",
  "shopify.com",
  "indeed.com",
  "ziprecruiter.com",
  "housecallpro.com",
  "jobber.com",
  "servicetitan.com",
  "thumbtack.com",
  "angi.com",
  "homeadvisor.com",
  "yelp.com",
];

/**
 * ‼️ WHETHER A BLOCKED CRAWL MAY BE MENTIONED TO A PROSPECT AT ALL.
 *
 * This is a code gate, not a prompt instruction, for the same reason the price lever is
 * (call-coach-price-gate.ts): a model handed a hedged sentence about a block will upgrade it
 * into a finding, because a finding is more useful to it. Absent beats forbidden — when this
 * returns null the drafter is never given the words.
 *
 * Two live cases are why the gate is this narrow:
 *   nailsplaceyulee.com  a real bot challenge. Worth raising, carefully.
 *   renatawellspa.com    a healthy Elementor site our own 6s timeout gave up on. Pitching that
 *                        one "your site blocks AI crawlers" would have been disproved in ten
 *                        seconds, on the first line, by the prospect.
 *
 * So: only reason "blocked" counts (a timeout or a network error is OUR failure), and only when
 * the engines did not cite their domain during the run. A citation means their crawler got
 * through and the block was ours alone.
 *
 * `engines_cited_site: null` means the run has not finished, so nothing is known yet — and
 * "not known yet" must read the same as "not allowed", never as "no objection found".
 */
export function crawlBlockAngle(block: CrawlBlock | null): string | null {
  if (!block) return null;
  if (block.reason !== "blocked") return null;
  if (block.engines_cited_site !== false) return null;
  return CRAWL_BLOCK_LINE;
}

/** The wording, fixed. Same precedent as PERMISSION_CLOSE and NOT_SELLING_LINE: every time a
 *  model was merely ASKED to hedge this, it wrote "your site is invisible to AI" instead.
 *  What we observed is a request being refused. What that implies is a question, not a fact. */
export const CRAWL_BLOCK_LINE =
  "your site turned away an automated request that had no javascript, and across this whole scan " +
  "the engines never once cited your own domain as a source";

/**
 * ‼️ THE NO-WEBSITE ANGLE. Sibling of crawlBlockAngle above, and the distinction between them
 * is the entire reason `research_source` has a fourth value.
 *
 * "search" means a site exists and our fetcher could not read it, which is a hedged claim about
 * their crawler setup. "declared" means there is no site at all. Telling a business with no
 * website that its website is turning crawlers away is the kind of error a prospect spots
 * instantly, and it takes the rest of the audit down with it.
 *
 * Unlike the crawl block, this one needs no evidence gate. It is not an inference from a failed
 * request, it is the premise of the run: Matthew looked at their Google listing, saw no site,
 * and typed the name. There is nothing to be wrong about.
 */
export function noWebsiteAngle(researchSource: string | null): string | null {
  return researchSource === "declared" ? NO_WEBSITE_LINE : null;
}

/** Fixed for the same reason CRAWL_BLOCK_LINE is. Asked to phrase this itself, a model reaches
 *  for "you are invisible to AI", which is both unfalsifiable and untrue: they are not invisible,
 *  they are described entirely by other people. That difference is the pitch. */
/**
 * May a cold email name a business the ENGINE returned instead of the prospect?
 *
 * ‼️ This is a different question from the standing rule that we never name a competitor who
 * FAILED the prospect, and the distinction is the whole reason it is allowed. Saying "the engine
 * came back with three names and yours was not one of them, one of them was X" is a fact about
 * what an engine answered, which the prospect can reproduce himself in thirty seconds. Saying "X
 * let you down" is a judgement about X that we have no standing to make and no way to support.
 *
 * It is a constant rather than a prompt line because it decides whether a whole ANGLE is offered
 * (see pickAngle in no-website-pitch.ts), and because flipping it must be one edit rather than a
 * hunt through prompt text. Set to false and the competitor-naming angles are simply never
 * chosen; the drafter falls through to the ones that rest on research alone. Nothing else in the
 * pipeline needs to change.
 */
export const NAME_COMPETITORS_IN_COLD_EMAIL = true;

export const NO_WEBSITE_LINE =
  "you do not have a site of your own, so when someone asks an engine for a business like yours " +
  "there is nothing of yours for it to cite. It can only repeat what a directory, a review site " +
  "or a competitor's page says about you, and none of those are written by you";

/**
 * ‼️ THE NOTHING-TO-FIND LINE. Third sibling of CRAWL_BLOCK_LINE and NO_WEBSITE_LINE, and a
 * constant for the reason stated above both of them: asked to phrase this itself, a model writes
 * "you are invisible to AI", which is unfalsifiable, reads as a scare line, and is not what was
 * observed.
 *
 * What WAS observed is narrow and reproducible: a web search could not assemble a description of
 * this business out of anything public. That is all this line may say.
 *
 * ‼️ IT MUST NOT CLAIM THERE IS NO GOOGLE LISTING, no directory entry and no reviews. The premise
 * of this whole lane is a business with a Google profile and no site, so "you have no listing" is
 * a sentence the prospect disproves from his own phone in ten seconds — fatal for a pitch whose
 * entire basis is "you can verify this yourself". Same discipline as CRAWL_BLOCK_LINE, which
 * reports a refused request rather than concluding a site is invisible.
 */
export const NOTHING_TO_FIND_LINE =
  "I went looking for you the way an engine does, and I could not put together a description of " +
  "what you do out of anything public. Nothing to read means nothing to cite";

/**
 * ‼️ THE PRETEXT LINE. Why we were running that search in the first place.
 *
 * Fourth sibling of CRAWL_BLOCK_LINE / NO_WEBSITE_LINE / NOTHING_TO_FIND_LINE, and a constant for
 * the same reason all three are: asked to phrase this itself, a model turns "I was already looking
 * at this category for somebody else" into a claim about a named client, a case study, or a result
 * we never promised. None of that is ours to say.
 *
 * ‼️ IT IS THE ONE SENTENCE IN THE HOOK EMAIL THE PROSPECT CANNOT VERIFY, which is exactly why it
 * is pinned here rather than generated. Everything else in that email is a number or a name the
 * reader can reproduce in thirty seconds; this is context for how they came to our attention, and
 * it must stay that narrow. It may NOT name the other client, name their industry, imply a result,
 * or suggest we are working the prospect's competitor.
 *
 * ‼️ IT IS THE OPENING SENTENCE AND IT CARRIES NO ASTERISKS (2026-08-22). It used to order
 * `**(for another client)**` bolded onto the end of the quoted search line, which put it in direct
 * contradiction with PARAGRAPH_RULES ("no asterisks, no markdown of any kind") in the same system
 * prompt, and forced the hook lane to be the only pre-pitch lane calling polishBody with
 * allowEmphasis: true. Matthew rewrote it by hand as the plain first line, which is where a reason
 * for calling belongs anyway: the reader learns why this landed in their inbox before they are
 * asked to care about the finding.
 */
export const HOOK_PRETEXT_LINE =
  "OPEN WITH THE PRETEXT, as the first sentence of the email and on its own line: the questions " +
  "were being run for another client in the area, and this prospect was not the subject of them. " +
  "Plain text, no asterisks, no bold, no parentheses. Do NOT say who the other client is, what " +
  "they do, or anything about how they are doing. Do NOT suggest you are working with one of this " +
  "prospect's competitors.";

/**
 * ‼️ THE POSITIONING LINE. What we would actually do for them, in one clause.
 *
 * Fifth sibling of NO_WEBSITE_LINE / NOTHING_TO_FIND_LINE / HOOK_PRETEXT_LINE, pinned for the same
 * reason: it is the one line in the email that describes the SERVICE, and a model asked to phrase
 * that itself reaches for a guarantee, a mechanism lecture, or a second CTA. This says what we do
 * and stops.
 *
 * ‼️ IT ENDS ON A COMMA ON PURPOSE. It is a conditional clause that hands off into the appended
 * close ("If you want to be the business AI recommends for X in Y," / "I recorded a 4 min video
 * with the breakdown"), so the give arrives as the answer to the condition. A full stop here turns
 * it into a standalone claim and the close back into a cold ask.
 *
 * Position is BEFORE the site-signal paragraph. It is prompt-pinned and code-VERIFIED rather than
 * code-appended, unlike PERMISSION_CLOSE: it sits before a conditional, model-written paragraph, so
 * appending it would mean splicing mid-body, and this codebase refuses that on the grounds that a
 * bad splice is worse than a flagged one. See positioningWarningFor in hook-pitch.ts.
 */
export function hookPositioningLine(service: string, city: string | null): string {
  // ‼️ THE STATE IS DROPPED HERE AND ONLY HERE. classify.ts stores "Bakersfield, CA", which is
  // right everywhere else and wrong in this one sentence: the clause already ends on a comma, so
  // the state produces "in Bakersfield, CA," and the reader meets two commas in four words. A
  // local business being told where it is does not need the state, and Matthew's reference email
  // does not carry one. Split on the first comma rather than matching a state list, so a city
  // written any other way passes through untouched.
  const where = city?.split(",")[0]?.trim();
  return `If you want to be the business AI recommends for ${service}${where ? ` in ${where}` : ""},`;
}

/**
 * ‼️ THE HOOK'S RESULT LINE. The one number the hook email prints, in fixed wording.
 *
 * Same rule as PERMISSION_CLOSE and NO_WEBSITE_LINE, and it is here for the same reason: asked to
 * phrase this itself, a model rewrites it every take. Across a week of sending that means the
 * finding lands differently for every prospect, and there is no way to tell whether a line that
 * did not get a reply was the wrong line or just the wrong day. One wording, so the hook is
 * actually measurable.
 *
 * ‼️ IT IS A PERCENTAGE AS OF 2026-08-22, AND THAT REVERSED A DELIBERATE RULE. This function used
 * to be hookFractionLine and its comment argued, at length, that a fraction must never become a
 * percentage: four questions is a small sample, "less than 25%" implies a far bigger one, and a
 * fraction is the number a prospect can reproduce himself in a minute. That reasoning is still
 * true and it is the cost of this change. Matthew's call, made with it stated. Do not flip it back
 * without asking him.
 *
 * It was RENAMED with the change rather than left as hookFractionLine, because a function called
 * `fraction` that returns a percentage is exactly the drift these comments exist to prevent.
 *
 * `measured` is the count of questions that actually came back, NEVER HOOK_PROMPT_COUNT. A call
 * that returned nothing proves nothing and must not sit in the denominator.
 *
 * The two ends are worded, not computed: "0%" reads as a rounding artifact and "100%" as a typo,
 * and neither is the sentence a person would write.
 */
export function hookResultLine(appeared: number, measured: number): string {
  if (measured <= 0 || appeared <= 0) return "You did not come back in a single one of those searches";
  if (appeared >= measured) return "You came back in every one of those searches";
  return `You came back in ${Math.round((appeared / measured) * 100)}% of those searches`;
}
