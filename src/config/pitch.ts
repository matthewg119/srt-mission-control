// Tunables for the audit outreach pipeline, in one file rather than scattered through the
// drafters. Same precedent as src/config/pipeline.ts and src/config/vektor.ts.
//
// Everything here is a policy decision someone might reasonably want to change without reading
// email-assistant.ts. Anything that is a *mechanism* stays in its own module.

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
export const LOOM_PRICE_LABEL = "$299 / month";
export const LOOM_START_WINDOW = "60 to 90 days";

/** The number Matthew reads on camera. Same one as operator-rules.ts, NOT the NAP number. */
export const LOOM_TEXT_NUMBER = "336-833-2303";

/**
 * A volume promise ("50 to 100 new clients"), or null for no promise at all.
 *
 * Null by default and that is deliberate. Nothing in the audit pipeline records or predicts a
 * number of customers, so a figure said on camera would be invented, and the same honesty rule
 * that stops dream-lead.ts presenting the image as a real lead applies to a sentence read aloud
 * over it. Set this to a string only if the claim is one worth owning.
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
 */
export const DELIVERY_BANNED_PROMISES: Array<{ pattern: RegExp; detail: string }> = [
  { pattern: /\b(?:more|extra|additional|new)\s+(?:customers?|clients?|patients?|jobs?|leads?|calls?|bookings?|business)\b/i, detail: "promises more customers, jobs, leads or calls" },
  { pattern: /\b\d+\s*(?:to|-)?\s*\d*\s*(?:more\s+)?(?:customers?|clients?|patients?|jobs?|leads?|calls?)\b/i, detail: "names a number of customers, jobs or calls" },
  { pattern: /\b(?:grow|double|triple|increase|boost|scale)\s+(?:your|their)?\s*(?:business|revenue|sales|income|bookings?|customers?)\b/i, detail: "promises growth in revenue or sales" },
  { pattern: /\b(?:guarantee|guaranteed|promise)\b/i, detail: "uses the word guarantee or promise" },
  { pattern: /\b(?:you'?ll|you will|this will)\s+(?:get|win|land|close|make)\b/i, detail: "predicts what they will get, win or close" },
  { pattern: /\b(?:ROI|return on investment|pays? for itself)\b/i, detail: "claims a return on investment" },
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
