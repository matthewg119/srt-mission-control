// The two links the audit report ends on, built here rather than imported.
//
// ‼️ THIS DUPLICATES src/lib/chatgpt-ads/params.ts ON PURPOSE AND THE DUPLICATION IS THE POINT.
// Two independent reasons, and either one alone would be enough:
//
//  1. THE KEY NAMES ARE NOT THE SAME. /chatgpt-ads reads `user_showed` and `comp_showed`;
//     /onboarding2 reads `userShowed` and `compShowed` (see its page.tsx, the `num(sp.userShowed)`
//     line). A single shared builder would emit one casing, and the other page would silently
//     read null for both counts. Nothing would throw and nothing would log. The rest of the
//     params, score / city / business / competitor / r, do agree on both sides.
//
//  2. params.ts IS UNTRACKED IN GIT and belongs to another lane. PricingCta.tsx is tracked, so an
//     import across that boundary makes `main` fail to build with "Module not found" the moment
//     the component is committed, which is a red production build rather than a missing feature.
//
// So: no imports at all, and the ~5 lines of scaleToSample are copied. If params.ts ever lands on
// main AND the two pages agree on casing, this file can collapse into it. Until both are true,
// leave it alone.
//
// ‼️ NOT A PRICE FILE. The single-source rule in config/pitch.ts is about FIGURES, and there is no
// figure here. Do not read this duplication as permission to copy a price into a second file.
//
// PURE AND ISOMORPHIC, the same contract params.ts holds itself to: no node: builtins, so a client
// component can import it without failing the browser bundle.

/** What the report knows about this business that a funnel can open on. */
export interface ReportLinkParams {
  score: number | null;
  city: string | null;
  business: string | null;
  competitor: string | null;
  /** How many of the sampled answers named THEM. 0 to PROMPT_SAMPLE. */
  userShowed: number | null;
  /** How many named the competitor. Same scale. */
  compShowed: number | null;
  /** Which audit_reports row sent them, so a signing can be traced back to its report. */
  reportSlug: string | null;
}

/**
 * The denominator in "you showed up in 1 of 5 answers".
 *
 * Copied from params.ts and must stay equal to it: both funnels render the same sentence, and a
 * link that says 1 of 5 landing on a page that says 1 of 7 is worse than no number at all.
 */
export const PROMPT_SAMPLE = 5;

/**
 * Where the funnels live from the visitor's point of view.
 *
 * srtagency.com, NOT mission.srtagency.com, even though this app serves both pages. srt-agwb's
 * vercel.json rewrites the apex paths here, and the apex is the only host the canonicals name.
 */
export const FUNNEL_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://srtagency.com";

/** Scale a raw mention count onto the 0..PROMPT_SAMPLE scale the funnels speak in. */
export function scaleToSample(mentioned: number, total: number): number | null {
  if (!Number.isFinite(mentioned) || !Number.isFinite(total) || total <= 0) return null;
  if (mentioned <= 0) return 0;
  const scaled = Math.round((mentioned / total) * PROMPT_SAMPLE);
  return Math.min(PROMPT_SAMPLE, Math.max(1, scaled));
}

/** Shared assembly. Every empty value is omitted rather than sent blank. */
function buildUrl(
  path: string,
  p: Partial<ReportLinkParams>,
  showedKeys: { user: string; comp: string },
  origin: string
): string {
  const q = new URLSearchParams();
  if (p.score !== null && p.score !== undefined) q.set("score", String(p.score));
  if (p.city) q.set("city", p.city);
  if (p.business) q.set("business", p.business);
  if (p.competitor) q.set("competitor", p.competitor);
  if (p.userShowed !== null && p.userShowed !== undefined) {
    q.set(showedKeys.user, String(p.userShowed));
  }
  if (p.compShowed !== null && p.compShowed !== undefined) {
    q.set(showedKeys.comp, String(p.compShowed));
  }
  if (p.reportSlug) q.set("r", p.reportSlug);
  const qs = q.toString();
  return `${origin}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * The signing funnel, for somebody who has already decided.
 *
 * camelCase counts, because that is what src/app/onboarding2/page.tsx reads. See the note at the
 * top of this file before "fixing" the inconsistency with the other builder.
 */
export function buildOnboarding2Url(
  p: Partial<ReportLinkParams>,
  origin = FUNNEL_ORIGIN
): string {
  return buildUrl("/onboarding2", p, { user: "userShowed", comp: "compShowed" }, origin);
}

/**
 * The explainer funnel, the step between the report and any commitment.
 *
 * snake_case counts, because that is what readReportParams() in chatgpt-ads/params.ts reads.
 */
export function buildAdsFunnelUrl(
  p: Partial<ReportLinkParams>,
  origin = FUNNEL_ORIGIN
): string {
  return buildUrl("/chatgpt-ads", p, { user: "user_showed", comp: "comp_showed" }, origin);
}
