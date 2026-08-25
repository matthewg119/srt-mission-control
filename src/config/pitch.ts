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
 * ‼️ THE OFFER IS ONE PRICE WITH A FREE PERIOD IN FRONT OF IT (rebuilt 2026-08-25).
 *
 * It was four tiers until this rebuild — Core $349, Complete $499, Complete + ChatGPT Ads $999,
 * Enterprise from $4,999 — with a money guarantee ("double your investment in 30 days or you do not
 * pay") gated to the ads tier by a function called guaranteeFor(). All of it is gone, replaced by
 * the offer in Matthew's med-spa Loom script:
 *
 *   They start FREE. The retainer starts only once we have delivered the inquiries. One price
 *   after that, PRICE_RETAINER. Five founding seats, in exchange for a case study.
 *
 * ‼️ THE STEP-DOWN LADDER DIED WITH THE TIERS AND NOTHING REPLACED IT AS A PRICE LEVER. "Can you do
 * better" used to be answered by moving DOWN a tier: a smaller scope for a smaller number, never a
 * discount. There is no tier below this one, so the answer is now THE FREE PERIOD — they do not pay
 * anything until the inquiries land, which is a stronger answer than any discount was. A number
 * below PRICE_RETAINER does not exist and may never be invented to close somebody.
 *
 * ‼️ PRICE_RETAINER IS THE ONLY PRICE FIGURE THAT EXISTS ANYWHERE. It may not be halved, prorated,
 * broken down per day or per week, or turned into any other figure by arithmetic. The value figures
 * in OFFER_INCLUDES are a SEPARATE closed list and the two may never be mixed or netted against
 * each other — see the note over it.
 */
export const PRICE_RETAINER = "$499 / month";

/**
 * The same figure with no period attached, for sentences that already say one.
 *
 * ‼️ NOT A SECOND PRICE, AND IT MUST NEVER BECOME ONE. It is PRICE_RETAINER with the
 * "/ month" removed, because "the monthly retainer of $499 / month" is what you get when
 * a label built for a pricing card is read out loud in a sentence. Derived from the same
 * literal so the two cannot drift apart.
 */
export const PRICE_RETAINER_AMOUNT = PRICE_RETAINER.split("/")[0].trim();

/**
 * What they get every month, and what each piece is worth.
 *
 * ‼️ THESE ARE VALUES, NOT PRICES, AND THE DISTINCTION IS THE WHOLE REASON EACH ENTRY CARRIES THE
 * WORD "value". PRICE_RETAINER is what they pay. These are what the work would cost bought
 * separately. A prospect hears "$2,400" and "$499 / month" inside the same minute, so the two have
 * to be unmistakably different kinds of sentence or the stack reads as a bill.
 *
 * ‼️ NEVER SUBTRACT ONE FROM THE OTHER OUT LOUD. "$3,299 of value for $499" is the stack doing its
 * own work; "so you are saving $2,800" is a fifth figure that exists nowhere and invites the
 * listener to check arithmetic on camera. Same rule the tiers had, applied to values.
 */
export const OFFER_INCLUDES = [
  { work: "We re-write your current pages", value: "$2,400 value" },
  { work: "We turn your happy customers into the evidence", value: "$499 / month value" },
  { work: "We fix any NAP mismatches online", value: "$800 value, one-time build" },
  { work: "Your monthly AI Visibility Report", value: "$400 / month value" },
] as const;

/**
 * The stacked value of OFFER_INCLUDES, recurring.
 *
 * $2,400 + $499 + $400 = $3,299, which is the figure in Matthew's script and it checks out. It is
 * written as a literal rather than summed at runtime on purpose: these are copy, not data, and a
 * total that silently changes when somebody edits a line item is exactly the drift the price rules
 * exist to stop. If OFFER_INCLUDES changes, change this by hand and say the new number out loud.
 */
export const VALUE_RECURRING = "$3,299";

/**
 * ‼️ NULL, AND DELIBERATELY, UNTIL MATTHEW PICKS THE FIGURE (2026-08-25).
 *
 * The script says "$4,000 in month one". The line items do not add to that: $2,400 + $499 + $800 +
 * $400 is $4,099, and the founding GBP rebuild on top of it is unpriced, so month one is worth more
 * than either number. Rather than round a value figure on camera — the one place a listener is most
 * likely to do the arithmetic along with you — the script omits the month-one sentence entirely
 * while this is null and speaks only VALUE_RECURRING.
 *
 * Set it to a string and the month-one line comes back.
 */
export const VALUE_MONTH_ONE: string | null = null;

/**
 * The founding-cohort bonus, delivered inside the first two weeks.
 *
 * Scarcity is legitimate HERE and banned on FREE_FIRST_BUILD, and the two are not in conflict. A
 * founding cohort is a real, countable thing: there are FOUNDING_SPOTS seats, they are given in
 * exchange for FOUNDING_EXCHANGE, and when they are gone the bonus stops. The free first build has
 * no such limit, which is why inventing one there is a lie and stating this one is not.
 *
 * ‼️ THE COUNT HAS TO BE TRUE. The moment "only five" survives past the fifth client it becomes the
 * false urgency the ban over FREE_FIRST_BUILD exists to prevent, and it takes the credibility of
 * the guarantee down with it.
 */
export const FOUNDING_BONUS = {
  headline: "a full Google Business Profile rebuild in the first two weeks",
  items: [
    "Category optimization",
    "A keyword-rich description",
    "10 geo-tagged photos",
    "4 GBP posts scheduled",
  ],
} as const;

/** How many founding seats exist. Said out loud, twice, so it had better be the real number. */
export const FOUNDING_SPOTS = 5;

/** What a founding seat is traded for. Not a discount: a deliverable they owe us back. */
export const FOUNDING_EXCHANGE = "a case study and a testimonial when we hit the results";

// ── The free period, the guarantee and the windows ──────────────────────────
/**
 * ‼️ THE COMMERCIAL TERMS, AND THE REASON THERE IS NO CHECKOUT ANY MORE.
 *
 * Nothing is charged at signup and no card is collected. The retainer starts by hand, once the
 * inquiries have landed. That is why the close is BOOKING_LINK and not a payment page, and why
 * every buy-button on the public pricing page became "book the onboarding call".
 *
 * ‼️ THIS SENTENCE NAMES A NUMBER OF INQUIRIES, WHICH DELIVERY_BANNED_PROMISES CATCHES BY DESIGN.
 * It is exempted the same way the old money guarantee was: spokenPromises() strips this literal
 * FIRST and then runs the patterns over what is left. Exact-match masking, never a loosened
 * pattern — the reasoning is spelled out over DELIVERY_BANNED_PROMISES and has not changed.
 */
export const FREE_UNTIL_LINE =
  "you start free, and the monthly retainer only starts once we have brought you 5 qualified AI-sourced inquiries inside the first 30 days";

/**
 * ‼️ NULL UNTIL SOMEBODY WRITES IT DOWN, AND THAT IS A REAL BLOCKER (2026-08-25).
 *
 * FREE_UNTIL_LINE makes "5 qualified AI-sourced inquiries" the trigger that starts billing, so both
 * words in it are now contractual. Nothing in this pipeline can currently measure whether an
 * inquiry was AI-sourced — there is no attribution for it — which means the count settles by hand,
 * between us and the client, out of whatever they tell us.
 *
 * A promise whose trigger has no agreed definition is a promise the client and we will read
 * differently on day 31. When this is a string it gets said on camera right after FREE_UNTIL_LINE
 * and written into the delivery email; while it is null the pre-flight says so before recording.
 */
export const QUALIFIED_INQUIRY_DEF: string | null = null;

/**
 * ‼️ THE GUARANTEE. ONE OFFER NOW, SO NO GATE — BUT THE WORDING IS STILL A CONSTANT.
 *
 * There used to be a guaranteeFor(tier) function here whose whole job was withholding the words
 * from every tier that could not deliver them. That gate is gone because the tiers are gone: there
 * is one offer, it carries one guarantee, and it applies to everybody.
 *
 * What did NOT change is why this is pinned. A model merely ASKED to "mention the guarantee"
 * rewrites it every take, and a guarantee worded differently in the video, the email and the call
 * is three different commitments the prospect can hold us to. Same precedent as PERMISSION_CLOSE.
 *
 * ‼️ IT IS A VISIBILITY COMMITMENT, NOT A MONEY ONE. The old guarantee promised a return on spend.
 * This one promises placement in AI answers, which is the thing this pipeline actually measures and
 * re-measures every month. Never restate it as money, a refund, or "risk free".
 */
export const GUARANTEE_LINE =
  "we will make your name show up in AI answers for at least 5 target queries by day 30";

/** Said once more at the close. Shorter, same commitment, still fixed wording. */
export const GUARANTEE_RESTATE = "your name in AI answers for at least 5 target queries by day 30";

/** What happens if the early movement does not arrive. A fact about the arrangement, not a refund. */
export const KEEP_WORKING_FREE_LINE =
  "if you do not see better visibility in two to three weeks, we keep working for free";

/**
 * How long the ORGANIC work takes to compound, in general.
 *
 * ‼️ Its job has changed twice and the string has not. It was the patience disclaimer under the
 * price, then the argument for the ads. It is now the SETUP for FAST_WINDOW: organic takes this
 * long in general, and the reason we can say less for this prospect is stated separately rather
 * than derived. Do not shorten it to make the offer sound faster.
 */
export const LOOM_START_WINDOW = "60 to 90 days";

/**
 * ‼️ WRITTEN OUT, NEVER COMPUTED FROM LOOM_START_WINDOW.
 *
 * The script says "half of that time", and half of "60 to 90 days" is an arithmetic problem the
 * listener solves in their head while you are still talking — landing on a different answer
 * depending on which end they halved. Same rule as the price figures: the number is said, not
 * derived. Change this and LOOM_START_WINDOW together or they will start contradicting each other.
 */
export const FAST_WINDOW = "30 to 45 days";

/** When the first movement should show. The window KEEP_WORKING_FREE_LINE is measured against. */
export const EARLY_MOVEMENT_WINDOW = "two to three weeks";

/**
 * ‼️ UNSOURCED AS OF 2026-08-25, SO IT IS NULL AND THE LINE IS NOT SAID.
 *
 * The source script carries "87% of AI citations are less than 30 days old". It may well be true.
 * Nothing in this repo measures it, no citation for it exists here, and every other number this
 * pipeline says out loud is either measured on the prospect's own run or is a price. A statistic
 * invented on camera is the same failure as an invented client story, and it is the easier one to
 * get caught on, because a number is checkable.
 *
 * Set this to the sentence WITH its source once there is one and the freshness pillar will speak
 * it. While it is null the pillar makes the same point without a figure ("recent beats old"), which
 * is the part we can actually stand behind. The script header says so before recording.
 */
export const FRESHNESS_STAT: string | null = null;

/**
 * The free first build, which is what Matthew leads with on a cold call (2026-08-17).
 *
 * One section of the prospect's OWN site, built by us, at no charge and with no card. It is a real
 * deliverable they keep whether or not anything paid follows, and that is the reason it works: it
 * is checkable.
 *
 * ‼️ It has no expiry and no scarcity attached. Inventing one ("only this month", "I have two slots
 * left") turns a true offer into a false one and is banned for the same reason a made-up price is.
 * FOUNDING_SPOTS is NOT a counter-example: a founding cohort is a countable thing with a real
 * limit, and this is not. The ban here survived the 2026-08-25 offer rebuild intact.
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

/** The offer in one line, for a script or a brief that needs the terms in a sentence. */
export const OFFER_LABEL = `free until the first 5 qualified AI-sourced inquiries, then ${PRICE_RETAINER}`;

// ── ChatGPT Ads, the accelerator ────────────────────────────────────────────
/**
 * ‼️ ADS ARE AN ACCELERATOR NOW, NOT A TIER, AND THEY CARRY NO PRICE (2026-08-25).
 *
 * They used to be the $999 tier and the only place the guarantee lived. In the new script they are
 * the last beat before the close: organic compounds on its own schedule, and this is what you do if
 * you do not want to wait for it. Quoted case by case, off camera.
 *
 * ‼️ NO FIGURE MAY BE ATTACHED TO THIS ANYWHERE. PRICE_ADS is deleted, not moved. If a prospect
 * asks what ads cost, that is a conversation with a budget in it, not a number said into a
 * recording that a hundred prospects will hear.
 */
export const ADS_WINDOW_LINE =
  "same low CPMs, same untapped audience, same window that won't stay open";

export const ADS_ACCELERATOR = [
  "ChatGPT just opened its ad platform, and almost nobody in your industry knows how to run it yet.",
  // ‼️ ADS_WINDOW_LINE is a lowercase mid-sentence fragment. Pasted straight after a full
  // stop it renders as "all over again. same low CPMs", which is what shipped in the first
  // v4 render. Capitalized here rather than rewritten there, so the constant stays usable
  // in both positions.
  `This is 2016 Facebook ads all over again. ${ADS_WINDOW_LINE.charAt(0).toUpperCase()}${ADS_WINDOW_LINE.slice(1)}.`,
  "We build the creative, we build the funnels, and we target the exact prompt patterns your buyers are typing.",
] as const;

/** The payoff line, fixed. */
export const DEFAULT_ANSWER_LINE =
  "90 days from now, you are not wondering whether this worked. You are the default.";

/**
 * Where they book the onboarding call, or null.
 *
 * ‼️ NULL IS A REAL STATE AND EVERY CALLER MUST HANDLE IT. This replaced PAYMENT_LINK
 * (SRT_PAYMENT_URL) when the offer stopped taking money up front: the close is now "the link to
 * book the onboarding call is X", so a link that does not exist is a close promising something that
 * is not there. With none set the script prints a correction instead of the close, the PRE-FLIGHT
 * prints NO BOOKING LINK SET, and the delivery email flags it — never a placeholder that ships to a
 * prospect. Same tri-state discipline as `site_signals` and `robots_check`.
 */
export const BOOKING_LINK: string | null = process.env.SRT_ONBOARDING_CALL_URL || null;

/** How long onboarding takes. Said on camera and written in the hand-over. */
export const ONBOARDING_WINDOW = "around 30 minutes";

/** The number Matthew reads on camera. Same one as operator-rules.ts, NOT the NAP number. */
export const LOOM_TEXT_NUMBER = "336-833-2303";

/**
 * A volume promise ("50 to 100 new clients"), or null for no promise at all.
 *
 * Null by default and that is deliberate. Nothing in the audit pipeline records or predicts a
 * number of customers, so a figure said on camera would be invented, and the same honesty rule that
 * stops dream-lead.ts presenting the image as a real lead applies to a sentence read aloud over it.
 * Set this to a string only if the claim is one worth owning.
 *
 * ‼️ FREE_UNTIL_LINE IS NOT A COUNTER-EXAMPLE AND MUST NOT BE USED TO ARGUE FOR FILLING THIS IN.
 * That line names 5 inquiries as the TRIGGER THAT STARTS BILLING: if they do not arrive the client
 * pays nothing, so the claim settles itself and costs them nothing when it is wrong. A client COUNT
 * is a forecast with no trigger and no remedy attached. They are different kinds of sentence and
 * only one of them is self-enforcing.
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
 * ‼️ THE OFFER'S OWN TERMS ARE EXEMPTED BY EXACT MATCH, NEVER BY LOOSENING A PATTERN HERE.
 * Every pattern below stays exactly as written, because the cold lanes — permission emails, the
 * `call` follow-up script, the no-website pitch — make no commitment at all and must keep
 * rejecting all of this. `spokenPromises(text)` in delivery-guards.ts strips the literal
 * GUARANTEE_LINE / GUARANTEE_RESTATE / FREE_UNTIL_LINE from the text FIRST, and then runs these
 * patterns over what is left.
 *
 * ‼️ FREE_UNTIL_LINE JOINED THE MASK ON 2026-08-25 AND IT IS THE HARDER OF THE TWO. The guarantee
 * only ever tripped the `guarantee` pattern. The free period names A NUMBER OF INQUIRIES, which is
 * pattern 2, the single pattern this file exists to enforce — and the offer now hangs on saying it
 * out loud. Masked by exact string, so the approved sentence passes and "we'll get you 10 or 15
 * inquiries" still fails, which is exactly the line that had to stay uncrossable.
 *
 * That ordering is the whole design. A lookahead or a `(?<!...)` carve-out added below would
 * license every paraphrase of the commitment too — "we guarantee you'll make your money back",
 * "this pays for itself in a month" — and those are exactly the sentences that turn a specific,
 * settleable commitment into an unfalsifiable one. Stripped-then-checked means the approved
 * wording passes and a rewrite of it still fails.
 *
 * ‼️ THE TIER PARAMETER IS GONE (2026-08-25). `spokenPromises` used to take `{ allowedTier }` and
 * only unmask on the one tier that carried the guarantee. There is one offer now, so the mask is
 * unconditional. Do not reintroduce a caller-supplied flag here: the point of exact-match masking
 * is that the approved wording is the ONLY thing that passes, and a boolean is one more thing a
 * caller can get wrong.
 */
export const DELIVERY_BANNED_PROMISES: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\b(?:more|extra|additional|new)\s+(?:customers?|clients?|patients?|jobs?|leads?|calls?|bookings?|business)\b/i, detail: "promises more customers, jobs, leads or calls" },
  { pattern: /\b\d+\s*(?:to|-)?\s*\d*\s*(?:more\s+)?(?:customers?|clients?|patients?|jobs?|leads?|calls?)\b/i, detail: "names a number of customers, jobs or calls" },
  { pattern: /\b(?:grow|double|triple|increase|boost|scale)\s+(?:your|their)?\s*(?:business|revenue|sales|income|bookings?|customers?)\b/i, detail: "promises growth in revenue or sales" },
  { pattern: /\b(?:guarantee|guaranteed|promise)\b/i, detail: "uses the word guarantee or promise" },
  { pattern: /\b(?:you'?ll|you will|this will)\s+(?:get|win|land|close|make)\b/i, detail: "predicts what they will get, win or close" },
  { pattern: /\b(?:ROI|return on investment|pays? for itself)\b/i, detail: "claims a return on investment" },
  // ‼️ ADDED 2026-08-21 FOR THE OLD MONEY GUARANTEE, AND IT STAYS NOW THAT THE GUARANTEE IS GONE.
  //
  // It was written to catch "double your investment", which was the old offer's own headline and
  // therefore had to be banned-then-masked. That sentence is no longer ours to say at all: the
  // guarantee is a VISIBILITY commitment now and nothing in the offer promises a multiple of
  // anybody's money.
  //
  // So this pattern lost its exemption and kept its teeth, which is the strongest state it has
  // been in. Do not delete it because "we don't say that any more" — that is precisely when a
  // model reaching for a familiar-sounding close will write it.
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

// ─────────────────────────────────────────────────────────────────────────────
// The Instagram DM lane
// ─────────────────────────────────────────────────────────────────────────────
//
// Sixth sibling of NO_WEBSITE_LINE / NOTHING_TO_FIND_LINE / HOOK_PRETEXT_LINE /
// hookPositioningLine / hookResultLine, pinned here for the reason stated above all of them: these
// are the lines that CARRY THE CLAIM, and a model asked to phrase a claim itself reaches for an
// adjective. Changing the wording must be one edit here rather than a hunt through prompt text.
//
// ‼️ hookResultLine IS DELIBERATELY NOT REUSED HERE. It prints a percentage ("You came back in 33%
// of those searches"), which is right in an email and wrong in a chat bubble: a stranger's first
// DM containing a statistic reads as a mail merge, and Matthew's reference DM carries no number at
// all. The DM states the same measured fact qualitatively. The percentage stays the email's.

/**
 * How many sentences a DM may run. Enforced by draft-linter.ts under `stage: "dm"`.
 *
 * Five, against draft-1's skeleton, and the difference is the surface: an email is read in a
 * reading pane and a DM is read in a bubble about forty characters wide. The reference DM is four
 * sentences; five leaves room for the pretext opener without licensing a paragraph.
 */
export const DM_MAX_SENTENCES = 5;

/**
 * The absence, with the rivals that took the slot. THE REFERENCE LINE, from Matthew's own message.
 *
 * ‼️ ONLY EVER CALLED BEHIND THE `rival-substitute` GATE, which requires both a measured miss and at
 * least one rival that extractRecommendedBatch actually pulled out of an answer we received. The
 * names in this sentence are a checkable claim: the prospect can reproduce them from his phone in
 * thirty seconds, which is exactly why it lands, and exactly why they can never be a guess. See
 * pickDmAngle.
 */
export interface DmCounts {
  /** Answers THIS business was named in. The numerator Matthew asks for. */
  appeared: number;
  /** Answers that came back at all. THE DENOMINATOR, never the number asked. */
  measured: number;
}

/** One rival and the number of ANSWERS it was named in. Never a number of mentions. */
export interface DmRival {
  name: string;
  count: number;
}

/**
 * ‼️ HOW MANY RIVALS EACH LANE MAY NAME, and the two numbers differ on purpose.
 *
 * Matthew asked for two names on the no-website lane, where the copy was being rewritten. The hook
 * lane's one-rival sentence is copy he has already read and signed off, so it stays at one rather
 * than being widened by a change that was never about it. Flipping either lane is this one number.
 */
export const DM_MAX_RIVALS_NOWEBSITE = 2;
export const DM_MAX_RIVALS_HOOK = 1;

/**
 * ‼️ EACH RIVAL PRINTS ITS OWN COUNT, ALWAYS, and this is not a formatting preference.
 *
 * Matthew's draft read "Competitor 1 and 2 shows up in 3 out of 4 searches". That sentence is only
 * true if BOTH names appeared in the same three answers, and they usually will not have. One count
 * stretched over two names is a false claim about at least one of them, and it is exactly the kind
 * a prospect checks, in the same thread he is reading it in. So the counts are never merged: two
 * names means two numbers, one name means one, and zero names means this line is never reached.
 */
export function dmRivalLine(
  service: string,
  city: string | null,
  rivals: DmRival[],
  business: string,
  counts: DmCounts
): string {
  // City is split on the first comma for the same reason hookPositioningLine does it: classify.ts
  // stores "Hallandale Beach, FL" and a person writing this sentence would not say the state. A
  // null city drops the clause entirely rather than reaching for "in your area", which would be a
  // claim about a local search that a cityless run never made. See the dm-cityless lint rule.
  const where = city?.split(",")[0]?.trim();
  // ‼️ ONE SENTENCE, and it used to be two. The budget is five: the reason line, the ask and the
  // close now take three of them, so a two-sentence finding leaves no room for an opener and every
  // pretext variant fails dm-length. Matthew's own draft joins them with "and", which is also how
  // a person says it out loud.
  const named = rivals
    .map((r, i) =>
      i === 0
        ? `${r.name} shows up in ${r.count} of the ${counts.measured} searches I ran`
        : `${r.name} in ${r.count}`
    )
    .join(" and ");
  const tail =
    counts.appeared === 0
      ? `${business} doesn't come back in any of them`
      : `${business} in ${counts.appeared}`;
  return (
    `I ran a quick check and when someone asks ChatGPT for ${service}${where ? ` in ${where}` : ""}, ` +
    `${named}, and ${tail}.`
  );
}

/**
 * ‼️ WHY THE ENGINE HAD NOTHING OF THEIRS. One sentence, three versions, and WHICH ONE IS TRUE IS A
 * FACT ABOUT THE PROSPECT rather than a stylistic choice.
 *
 * Matthew's draft said "because your website is not visible". For a prospect with no site at all
 * that is not true in the way it reads: there is nothing of theirs to be invisible, so the sentence
 * describes a situation they do not have and can correct on the first line. Same failure class as
 * NOTHING_TO_FIND_LINE claiming a business has no Google listing.
 *
 * The honest split is by what the engine can actually reach:
 *
 *   none           there is no site of theirs anywhere
 *   booking_only   there is a page, it ranks, and it belongs to the booking software vendor
 *   not_surfacing  they have a site and it did not come back. The ONLY case where Matthew's
 *                  original wording is correct, which is why it is the only one that says it.
 *
 * ‼️ NEVER PICKED BY THE MODEL. dmSubjectOf derives it from which scan ran, the same way the angle
 * itself is derived from what was measured.
 */
export type DmSiteState = "none" | "booking_only" | "not_surfacing";

export function dmReasonLine(state: DmSiteState): string {
  switch (state) {
    case "none":
      return (
        "When someone asks an engine for a business like yours there is nothing of yours for it to " +
        "cite, because you do not have a site of your own."
      );
    case "booking_only":
      // Produced by the "Only a booking link" button on the Instagram panel, which reaches this
      // through MiniCheck.bookingHost and dmSubjectOf. It stays pinned here rather than in that
      // lane so the email can reach the same sentence when it grows the same button.
      //
      // What the sentence asserts is that the page belongs to booking SOFTWARE, so the flag is
      // gated on isBookingHost and not on isNeverTheirSite. A Facebook or Yelp link is also not
      // their site, and telling someone their Facebook page is their booking software is a
      // correction they make on the first line.
      return (
        "When someone asks an engine for a business like yours the only page of yours it can find " +
        "belongs to your booking software, so what it repeats was written to sell appointments " +
        "rather than written by you."
      );
    case "not_surfacing":
      return (
        "When someone asks an engine for a business like yours your site is not showing up in what " +
        "it pulls back, so it repeats what a directory, a review site or a competitor's page says " +
        "about you instead."
      );
  }
}

/**
 * The absence with no rival named.
 *
 * Used when the scan found a miss but the extractor returned no name we can stand behind. It says
 * strictly less than dmRivalLine and nothing that is not measured. It does NOT reach for "you are
 * invisible" to compensate: that is the unfalsifiable scare line NOTHING_TO_FIND_LINE exists to
 * prevent, and a weaker true sentence beats a stronger one we cannot support.
 *
 * ONE sentence, folded for the same budget reason dmRivalLine was: the reason line that follows it
 * costs a sentence, and the ask and the close take two more.
 */
export function dmAbsenceLine(
  service: string,
  city: string | null,
  business: string,
  counts: DmCounts
): string {
  const where = city?.split(",")[0]?.trim();
  const tail =
    counts.appeared === 0
      ? `${business} isn't on any of the ${counts.measured} I ran`
      : `${business} is on ${counts.appeared} of the ${counts.measured} I ran`;
  return (
    `I ran a quick check and when someone asks ChatGPT for ${service}${where ? ` in ${where}` : ""}, ` +
    `it answers with a list of businesses, and ${tail}.`
  );
}

/**
 * The clean-sweep line. They DID come back, so the DM must not imply otherwise.
 *
 * Mirror of the `present-but-thin` angle in hook-pitch.ts and bound by the same rule: nothing in a
 * message built on this line may read as bad news about their visibility. What is true, and what
 * this says, is that the description belongs to whoever wrote it.
 *
 * ‼️ IT TAKES NO REASON LINE and it is the only finding line that does not. All three dmReasonLine
 * versions explain why an engine had nothing of theirs to cite. This angle fires when the engine
 * DID come back with them, so there is no absence to explain and attaching one would contradict the
 * finding in the sentence underneath it. Its own second sentence already carries the point.
 */
export function dmPresentLine(
  service: string,
  city: string | null,
  business: string,
  counts: DmCounts,
  rival: DmRival | null
): string {
  const where = city?.split(",")[0]?.trim();
  // The rival is named here too when we have one, because "you came back and so did they" is the
  // whole point: being on the list is not the same as being the answer. It stays OPTIONAL, since
  // this angle does not gate on a rival and must still read correctly without one.
  const alongside = rival ? `, and so does ${rival.name}` : "";
  return (
    `I ran a quick check on what ChatGPT says when someone asks for ${service}${where ? ` in ${where}` : ""}, ` +
    `and ${business} comes back in ${counts.appeared} of the ${counts.measured} searches I ran${alongside}. ` +
    `Every word it used to describe you was written by somebody else.`
  );
}

/** The ask. One question mark per DM, and this is it. */
export const DM_ASK_LINE = "Want me to send you the actual queries and results?";

/**
 * The close. Matthew's wording, kept verbatim.
 *
 * It does two jobs a shorter close does not: "takes me 20 seconds to send" removes the cost of
 * saying yes, and "might change how you think about the next 6 months" is the only claim in the
 * message that is about them rather than about the scan. It is a hedge on purpose ("might"), which
 * is what keeps it clear of the guarantee ban in COMPLIANCE_RULES.
 */
export const DM_CLOSE_LINE =
  "Takes me 20 seconds to send, might change how you think about the next 6 months.";

/**
 * The three opening moves, and the ONLY axis the variants are allowed to differ on.
 *
 * ‼️ VARIATION IS A WORDING PROBLEM, NEVER A CLAIM PROBLEM. Matthew asked for variations because
 * three identical DMs in a row read as a bot, which is true. What he did not ask for, and what
 * would quietly undo the whole lane, is three different findings: the angle is picked once from
 * what the scan measured, and all three variants state THAT finding. A variant that reached for a
 * different claim to sound fresh would be inventing one, since only one was measured.
 */
export const DM_OPENERS = [
  {
    id: "result",
    // The reference DM. Straight into what came back.
    instruction:
      "Open on the finding itself, in the fixed line, with nothing before it. No pretext, no " +
      "greeting beyond the first name, no throat-clearing. This is the reference message.",
  },
  {
    id: "pretext",
    // The email hook's move, compressed. Explains why this landed in their inbox first.
    //
    // ‼️ IT USED TO SAY "AND THIS BUSINESS CAME UP IN THEM", WHICH IS THE FINDING'S OPPOSITE.
    // Three live runs on leahskinmethod opened with "The Plump Room kept coming up in the searches"
    // and then stated, one sentence later, that it does not come back in any of them. The model was
    // reading the pretext exactly as written; the wording was wrong, not the drafter. A message
    // whose whole value is that a stranger can reproduce it cannot contradict itself in two
    // sentences, and this is the ONE opener with room to do it, because it is the only one that
    // says anything before the fixed line. What is true, and what it says now, is why this profile
    // was looked at. Nothing about what the answers contained: that is the finding's job.
    instruction:
      "Open with ONE short sentence of pretext before the finding: you were already running these " +
      "questions for another client in the same area, which is why you looked at this business " +
      "too. You must NOT say or imply that this business appeared, came up, showed up, came back " +
      "or was mentioned in those searches. The fixed line underneath may state the exact opposite, " +
      "and a message that contradicts itself one sentence later is worse than no message. Do not " +
      "say who the other client is, what they do, or how they are doing, and do not suggest you " +
      "work with one of this prospect's competitors. Then the fixed finding line.",
  },
  {
    id: "question",
    // The lightest open. Note it does NOT add a question mark: it is phrased as a statement.
    instruction:
      "Open by naming the thing you checked as a statement rather than a question, for example " +
      "'Was checking what ChatGPT recommends for X in Y this morning'. It must NOT contain a " +
      "question mark: the message is allowed exactly one, and that one is the ask at the end. " +
      "Then the fixed finding line.",
  },
] as const;

export type DmOpenerId = (typeof DM_OPENERS)[number]["id"];
