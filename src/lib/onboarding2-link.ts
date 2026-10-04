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
/**
 * The campaign that produced this report, carried forward to the funnel.
 *
 * ‼️ WITHOUT THIS THE utm ON A COLD EMAIL MEASURES NOTHING, and that was true until
 * 2026-09-16. readAttribution() in lib/medspa/pixel.ts reads utm_campaign only from the page it
 * is running on, and /onboarding2/page.tsx does read all four off its own query string, so the
 * destination always worked. The break was in the middle: the report lives at a NEW url, reached
 * days later from an email, and the Get Started link did not carry them.
 */
export interface ReportUtm {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}

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
  origin: string,
  utm?: ReportUtm
): string {
  const q = new URLSearchParams();
  // Written first so they read left to right in the order a person expects, and so a missing
  // report param never separates the campaign from the link it belongs to.
  if (utm?.utmSource) q.set("utm_source", utm.utmSource);
  if (utm?.utmMedium) q.set("utm_medium", utm.utmMedium);
  if (utm?.utmCampaign) q.set("utm_campaign", utm.utmCampaign);
  if (utm?.utmContent) q.set("utm_content", utm.utmContent);
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
 * Where an audit report sends somebody, and which presentation they land on.
 *
 * ‼️ EVERY AUDIT SURFACE GOES THROUGH THESE TWO CONSTANTS, WHICH IS THE POINT OF THEM BEING
 * CONSTANTS. The report's Get Started button, the delivery email, the Loom script and the lead
 * action all resolve through buildOnboarding2Url() below, so switching the winning variant is one
 * edit here rather than four edits in four lanes that would drift the first time one was missed.
 *
 * ‼️ THE FREE-FIRST ROUTE, NOT THE TWO-CARD PICKER (Matthew, 2026-09-29). A reader arriving from an
 * audit report has just been told they are invisible in AI search; the picker asked them to price a
 * PRICE_YEAR decision in the same glance as a free one. /onboarding2/free shows the free engine
 * alone and puts the appointments offer behind its button. /onboarding2 still exists, still works,
 * and is still what a /pricing link with ?offer= resolves to.
 *
 * ‼️ v IS EMITTED EXPLICITLY EVEN THOUGH "1" IS ALSO DEFAULT_VARIANT over in variants.ts. A link
 * that relies on the default is a link that silently changes meaning the day somebody moves the
 * default, and these URLs are pasted into emails and Loom scripts that outlive the deploy.
 */
export const REPORT_FUNNEL_PATH = "/onboarding2/start";

/**
 * ‼️ EMPTY, AND THE EMPTY STRING IS A DECISION RATHER THAN A GAP (2026-09-30).
 *
 * `?v=` selected one of the six presentations on /onboarding2/free. /onboarding2/start has no
 * variants: the six-way presentation test is finished, Matthew picked the bottom sheet, and it is
 * the only way that route shows an offer. A `v` on these URLs would now be a param nothing reads,
 * pasted into emails and Loom scripts that outlive several deploys, and the first person to see it
 * would reasonably assume a test was still running.
 *
 * Kept as a constant rather than deleted because buildOnboarding2Url below is the one place that
 * decides whether to append it, and a future route that DOES have variants sets it here and gets
 * every audit surface at once. That is the same argument the note above makes for the path.
 */
export const REPORT_FUNNEL_VARIANT = "";

/**
 * The signing funnel, for somebody who has already decided.
 *
 * camelCase counts, because that is what src/app/onboarding2/page.tsx reads. See the note at the
 * top of this file before "fixing" the inconsistency with the other builder.
 *
 * ‼️ THIS CHANGES REPORTS THAT HAVE ALREADY BEEN SENT, AND THAT IS THE INTENDED BEHAVIOUR RATHER
 * THAN A SIDE EFFECT. /r/[slug] is server-rendered on every request, so the button is built fresh
 * from whatever this file says at the moment somebody opens the link. A report mailed last month
 * and opened tomorrow gets the new funnel. The same property is why PricingCta.tsx's header bans
 * stating a price or a guarantee on the report at all: a TERM that changes under an already-sent
 * document is a contradiction, whereas a DESTINATION that changes is just the current front door.
 */
export function buildOnboarding2Url(
  p: Partial<ReportLinkParams>,
  origin = FUNNEL_ORIGIN,
  utm?: ReportUtm
): string {
  const url = buildUrl(REPORT_FUNNEL_PATH, p, { user: "userShowed", comp: "compShowed" }, origin, utm);
  // Appended rather than threaded through buildUrl(), which is shared with buildAdsFunnelUrl() and
  // has no business knowing about variants.
  //
  // ‼️ AN EMPTY VARIANT APPENDS NOTHING AT ALL, rather than a bare `v=`. The current destination
  // has no variants (see the constant), and `?v=` with no value on every audit link is a param that
  // looks like a bug to the next person who reads one of these URLs out of an email.
  if (!REPORT_FUNNEL_VARIANT) return url;
  // ‼️ THE ?/& CHECK IS NOT DEFENSIVE PADDING. buildUrl omits the `?` entirely when every param is
  // empty, and that case is reachable: PricingCta renders on a pending or failed report with no
  // score, no competitor and no counts, and every prop optional. Without the check that report's
  // button would point at /onboarding2/startv=1.
  return `${url}${url.includes("?") ? "&" : "?"}v=${REPORT_FUNNEL_VARIANT}`;
}

/**
 * THE booking link for a report's prospect: the same /onboarding2 URL the report's Get Started
 * button opens, carrying r=<slug> (2026-09-15).
 *
 * ‼️ NOT SRT_ONBOARDING_CALL_URL. That was a bare Calendly page, and a booking made there never
 * reaches the app: no client, no channel, no board. Booking through /onboarding2 is what starts
 * onboarding, and the slug is what attaches THIS report to the client as its pre-call audit. The Loom
 * script, the beat sheet and the delivery email all send people here.
 */
export function bookingUrlForReport(
  report: { slug?: string | null; score?: number | null; city?: string | null; client_name?: string | null },
  origin = FUNNEL_ORIGIN
): string {
  return buildOnboarding2Url(
    {
      score: report.score ?? null,
      city: report.city ?? null,
      business: report.client_name ?? null,
      reportSlug: report.slug ?? null,
    },
    origin
  );
}

/**
 * The explainer funnel.
 *
 * ‼️ NO CALLER AS OF 2026-09-03. The audit report dropped its second button that day and this is
 * kept deliberately, not by oversight: it is the one-line undo if report-to-signing conversion
 * falls and the softer step has to come back. See the note in PricingCta.tsx. Delete it only when
 * that question is settled.
 *
 * snake_case counts, because that is what readReportParams() in chatgpt-ads/params.ts reads.
 */
export function buildAdsFunnelUrl(
  p: Partial<ReportLinkParams>,
  origin = FUNNEL_ORIGIN
): string {
  return buildUrl("/chatgpt-ads", p, { user: "user_showed", comp: "comp_showed" }, origin);
}
