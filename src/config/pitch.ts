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
