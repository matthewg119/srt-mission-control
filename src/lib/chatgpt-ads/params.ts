// The personalization carried from the audit report into /chatgpt-ads.
//
// PURE AND ISOMORPHIC, the same rule src/lib/medspa/validate.ts and src/lib/scan/normalize.ts
// hold themselves to. The report page imports buildFunnelUrl() to write the link, the funnel
// page imports readReportParams() to read it back, and the route imports the same reader to
// re-check what the browser sent. Nothing here may import a node: builtin: one top-level
// `import ... from "crypto"` fails the browser bundle with "Module not found" and tsc does not
// warn you, because a bundler boundary is not a type error.
//
// PARSE LENIENTLY. This was an explicit instruction and it is also the right call: these params
// arrive in a link that was pasted into an email, forwarded, shortened, and opened on a phone
// keyboard. A junk ?score= must render the generic headline and continue, never 400 a visitor
// who is one tap from becoming a lead. Every reader below returns null instead of throwing.

/** The five things the report knows about this clinic that the funnel can use. */
export interface ReportParams {
  score: number | null;
  city: string | null;
  business: string | null;
  competitor: string | null;
  /** How many of the sampled answers named THEM. 0 to PROMPT_SAMPLE. */
  userShowed: number | null;
  /** How many named the competitor. Same scale. */
  compShowed: number | null;
  /** Which audit_reports row sent them, so a lead can be traced back to its report. */
  reportSlug: string | null;
}

export const EMPTY_PARAMS: ReportParams = {
  score: null,
  city: null,
  business: null,
  competitor: null,
  userShowed: null,
  compShowed: null,
  reportSlug: null,
};

/**
 * The denominator in "you showed up in 1 of 5 answers".
 *
 * The real audit asks far more than five questions, and the hero deliberately quotes a
 * five-question sample instead of the full run. Five is a number somebody can hold in their
 * head while a video plays; "you appeared in 3 of 47" is a statistic, not a gut punch. The
 * report itself still shows every prompt, so nothing is being hidden, and scaleToSample()
 * below is the one place the conversion happens.
 */
export const PROMPT_SAMPLE = 5;

function readInt(v: string | null | undefined, min: number, max: number): number | null {
  if (v === null || v === undefined) return null;
  const n = Number.parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function readText(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  // Collapse whitespace the same way clean() does, then cap. A '+' in a query string has
  // already been decoded to a space by URLSearchParams, so "Glow+Med+Spa" arrives correct.
  const s = String(v).replace(/\s+/g, " ").trim().slice(0, max);
  return s ? s : null;
}

/** Read the params off anything with a .get(), which covers URLSearchParams and Next's own. */
export function readReportParams(q: {
  get(key: string): string | null | undefined;
}): ReportParams {
  return {
    score: readInt(q.get("score"), 0, 100),
    city: readText(q.get("city"), 80),
    business: readText(q.get("business"), 120),
    competitor: readText(q.get("competitor"), 120),
    userShowed: readInt(q.get("user_showed"), 0, PROMPT_SAMPLE),
    compShowed: readInt(q.get("comp_showed"), 0, PROMPT_SAMPLE),
    reportSlug: readText(q.get("r"), 64),
  };
}

/** Same reader for a plain object, which is the shape a JSON body arrives in. */
export function readReportParamsFromObject(o: Record<string, unknown>): ReportParams {
  return readReportParams({
    get: (k: string) => {
      const v = o[k];
      return v === undefined || v === null ? null : String(v);
    },
  });
}

/**
 * Convert "mentioned in 12 of 47 prompts" into the 0 to 5 the hero speaks.
 *
 * Rounds rather than floors, so a clinic that appears in 40% of answers reads as 2 of 5 and
 * not 2 of 5 only when it crosses 40%. It never returns 0 for a non-zero count: appearing
 * somewhere and being told you appeared nowhere is the one error that makes the whole report
 * look wrong to the person who can check it.
 */
export function scaleToSample(mentioned: number, total: number): number | null {
  if (!Number.isFinite(mentioned) || !Number.isFinite(total) || total <= 0) return null;
  if (mentioned <= 0) return 0;
  const scaled = Math.round((mentioned / total) * PROMPT_SAMPLE);
  return Math.min(PROMPT_SAMPLE, Math.max(1, scaled));
}

/**
 * Where the funnel lives, from the visitor's point of view.
 *
 * srtagency.com/chatgpt-ads, NOT mission.srtagency.com/chatgpt-ads, even though this app is
 * what serves it. srt-agwb/vercel.json rewrites the apex path here, and the apex is the
 * primary domain and the only host every canonical, og:url and sitemap entry names. Sending
 * somebody to the mission subdomain would put a second host in front of the brand for no
 * reason, which is the exact mistake the portal subdomain made.
 */
export const FUNNEL_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://srtagency.com";
export const FUNNEL_PATH = "/chatgpt-ads";

/** Build the link the report and the delivery email both use. Skips every empty value. */
export function buildFunnelUrl(p: Partial<ReportParams>, origin = FUNNEL_ORIGIN): string {
  const q = new URLSearchParams();
  if (p.score !== null && p.score !== undefined) q.set("score", String(p.score));
  if (p.city) q.set("city", p.city);
  if (p.business) q.set("business", p.business);
  if (p.competitor) q.set("competitor", p.competitor);
  if (p.userShowed !== null && p.userShowed !== undefined) {
    q.set("user_showed", String(p.userShowed));
  }
  if (p.compShowed !== null && p.compShowed !== undefined) {
    q.set("comp_showed", String(p.compShowed));
  }
  if (p.reportSlug) q.set("r", p.reportSlug);
  const qs = q.toString();
  return `${origin}${FUNNEL_PATH}${qs ? `?${qs}` : ""}`;
}
