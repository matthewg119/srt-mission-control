// Where a visit came from, decided mechanically, with no model and no network.
//
// ‼️ PURE AND ISOMORPHIC. It imports nothing, for the same reason src/lib/hub/host-classify.ts
// and src/lib/scraper/rules.ts import nothing: this is the one function standing between a
// referrer string typed by somebody else's browser and a row that feeds a monthly report, so it
// has to be testable without a database, a key or a deployment.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ NOTHING IN THIS FILE MAY EVER DECIDE WHETHER AN APPOINTMENT IS QUALIFIED, AND THAT IS THE
// WHOLE REASON IT IS SEPARATE FROM THE BOOKING CODE.
//
// Matthew, 2026-09-03, and it is not up for argument: somebody reads a ChatGPT answer, then
// types the clinic name into Google and books. No referrer, no UTM, no AI domain. That is the
// MAJORITY path and no pixel catches it. The agreement does not get paid until 5 qualified
// appointments land, so a pixel-defined count silently DELETES appointments that were earned.
//
// The count comes from the Assistant plus "how did you hear about us", which is what the
// guarantee clause already says. The pixel corroborates and feeds the monthly report.
//
// That ranking is enforced in the SCHEMA, not here and not in a comment:
// attribution_bookings.qualified is a STORED GENERATED column that excludes count_basis
// 'pixel_only' by construction, so no query and no future route can count a pixel row into the
// number that starts billing. See docs/2026-09-03-attribution.sql.
// ─────────────────────────────────────────────────────────────────────────────

/** The engines. Matched on the REGISTRABLE host, never on a substring of the URL. */
const AI_HOSTS: Record<string, string> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "openai.com": "chatgpt",
  "claude.ai": "claude",
  "perplexity.ai": "perplexity",
  "gemini.google.com": "gemini",
  "copilot.microsoft.com": "copilot",
};

/**
 * Which engine sent them, or null.
 *
 * ‼️ SUFFIX MATCHING IS ON A DOT BOUNDARY, NEVER A BARE endsWith. `notchatgpt.com` ends with
 * "chatgpt.com" and is not ChatGPT; `www.chatgpt.com` is. A bare endsWith gets the first one
 * wrong in the direction that manufactures evidence, which is the expensive direction.
 *
 * `gemini.google.com` is deliberately a full host and not `google.com`: an ordinary Google
 * search referrer is the single most common non-AI referrer there is, and folding it in here
 * would classify every organic visit as AI-sourced.
 */
export function aiEngineForHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return null;
  for (const [domain, engine] of Object.entries(AI_HOSTS)) {
    if (h === domain || h.endsWith(`.${domain}`)) return engine;
  }
  return null;
}

/**
 * ‼️ THREE STATES, AND `absent` IS A REAL ANSWER RATHER THAN A FAILURE.
 *
 * A missing referrer is the normal state of a direct visit, a bookmarked one, a link out of an
 * app, and any browser whose privacy settings strip it. Collapsing `absent` into `non_ai` would
 * record "we know they did not come from AI" about a visit we know nothing about, which is the
 * same conflation MxVerdict in src/lib/scraper/mx.ts and site_signals in the audit engine both
 * exist to prevent. It is also the state the majority path above lands in.
 */
export type ReferrerKind = "absent" | "ai" | "non_ai";

export interface ReferrerVerdict {
  kind: ReferrerKind;
  /** Set only when kind is "ai". One of the values in AI_HOSTS. */
  engine: string | null;
  /** Host only. Never a full URL, see stripQuery below. */
  host: string | null;
  /** Path only, no query and no fragment. */
  path: string | null;
}

const ABSENT: ReferrerVerdict = { kind: "absent", engine: null, host: null, path: null };

/**
 * Read document.referrer.
 *
 * ‼️ THE QUERY STRING IS DROPPED HERE AND NOWHERE ELSE. A referrer URL routinely carries a
 * search query, a session token, and on plenty of real sites an email address in a parameter.
 * None of that is attribution data and all of it would be stored forever on a row nobody thinks
 * of as personal. Host and path are enough to answer every question this table is for.
 */
export function classifyReferrer(referrer: string | null | undefined): ReferrerVerdict {
  const raw = (referrer ?? "").trim();
  if (!raw) return ABSENT;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Unparseable is not "not AI". It is a referrer we could not read.
    return ABSENT;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return ABSENT;

  const host = url.hostname.toLowerCase();
  const engine = aiEngineForHost(host);
  return {
    kind: engine ? "ai" : "non_ai",
    engine,
    host,
    path: url.pathname || "/",
  };
}

/** The five UTM parameters, and nothing else is read off a URL. */
export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

/** Longer than this is not a campaign name, it is somebody stuffing a column. */
const MAX_UTM_CHARS = 200;

export function readUtm(search: string | null | undefined): Utm {
  const out: Utm = {};
  if (!search) return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return out;
  }
  for (const k of UTM_KEYS) {
    const v = (params.get(`utm_${k}`) ?? "").trim();
    if (v) out[k] = v.slice(0, MAX_UTM_CHARS);
  }
  return out;
}

/**
 * The page they landed on, split into host and path with the query thrown away.
 *
 * ‼️ THE QUERY IS DROPPED AFTER readUtm HAS RUN, NEVER BEFORE. The UTM parameters live in it
 * and they are the one part of a query string this system has a reason to keep. Everything
 * else on a clinic's URL is theirs.
 */
export function splitLanding(href: string | null | undefined): { host: string | null; path: string | null } {
  const raw = (href ?? "").trim();
  if (!raw) return { host: null, path: null };
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { host: null, path: null };
    return { host: url.hostname.toLowerCase(), path: url.pathname || "/" };
  } catch {
    return { host: null, path: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// "How did you hear about us?"  LAYER 2.
//
// ‼️ THE SAME SIX OPTIONS ON EVERY FORM, THE ASSISTANT'S AND THE CLINIC'S OWN. They are stored
// as SLUGS rather than as the words on screen, because the labels get reworded and the answer
// has to stay comparable across a year of monthly reports. src/config/onboarding-free.ts
// records the same lesson the other way round: a label matched as a literal is a verdict that
// silently stops firing.
// ─────────────────────────────────────────────────────────────────────────────

export const SELF_REPORT_OPTIONS = [
  { slug: "google", label: "Google" },
  { slug: "friend_family", label: "Friend or family" },
  { slug: "instagram_facebook", label: "Instagram or Facebook" },
  { slug: "ai", label: "ChatGPT or another AI" },
  { slug: "sign", label: "Saw your sign" },
  { slug: "other", label: "Other" },
] as const;

export type SelfReportSlug = (typeof SELF_REPORT_OPTIONS)[number]["slug"];

const SELF_REPORT_SLUGS = new Set<string>(SELF_REPORT_OPTIONS.map((o) => o.slug));

/** Null rather than "other" for anything unrecognised: a wrong answer is worse than none. */
export function readSelfReport(value: string | null | undefined): SelfReportSlug | null {
  const v = (value ?? "").trim().toLowerCase();
  return SELF_REPORT_SLUGS.has(v) ? (v as SelfReportSlug) : null;
}

/**
 * ‼️ THE ONLY DEFINITION OF "THEY SAID IT WAS AI", AND IT READS THE ANSWER, NEVER THE REFERRER.
 *
 * This is the sentence the guarantee clause turns on. It is a fact about what the patient told
 * the clinic, so the only input it accepts is the patient's answer. Passing a referrer verdict
 * in here would be the pixel deciding the count through the back door, which is the one thing
 * the header of this file forbids.
 */
export function isAiSelfReport(answer: SelfReportSlug | null): boolean {
  return answer === "ai";
}

// ─────────────────────────────────────────────────────────────────────────────
// The three layers, ranked. LAYER 3 is strongest, LAYER 1 never counts.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How we know where a booking came from.
 *
 *   assistant      the AI Skin Concierge took the booking. We hold the conversation log.
 *   self_reported  a booking form asked and the patient answered.
 *   pixel_only     the pixel saw a booking and nobody was asked. CORROBORATION, NEVER A COUNT.
 */
export type CountBasis = "assistant" | "self_reported" | "pixel_only";

export const COUNT_BASIS_RANK: Record<CountBasis, number> = {
  assistant: 3,
  self_reported: 2,
  pixel_only: 1,
};

/**
 * Whether this booking may be counted toward the 5 the guarantee turns on.
 *
 * ‼️ THIS FUNCTION IS A MIRROR OF THE DATABASE, NOT THE AUTHORITY. attribution_bookings.qualified
 * is a STORED GENERATED column carrying the identical expression, so a report that forgets to
 * call this still cannot count a pixel row. It exists so the same rule can be stated in a probe
 * and in a route without either one reaching for the database.
 *
 * ‼️ BOTH HALVES ARE REQUIRED AND THEY ARE DIFFERENT QUESTIONS. `basis` is how we know anything
 * at all; `aiEvidence` is whether what we know says AI. A Concierge booking by somebody who
 * ticked "Friend or family" is perfectly attributed and is NOT a qualified appointment, because
 * the clause counts patients who say they came from AI and not patients we happened to serve.
 */
export function isQualified(basis: CountBasis, aiEvidence: boolean): boolean {
  return basis !== "pixel_only" && aiEvidence;
}
