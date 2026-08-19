// Which delivery step runs which generator.
//
// ‼️ THIS IS THE FILE THAT MAKES `_auto_` TRUE.
// Before it, DELIVERY_STEPS declared `auto: true` on presence_pdf, avatar_harvest,
// findings_doc, review_card_pdf and call_sheet, `postReadySteps` skipped every auto step
// (`if (step.mode === "auto") continue;`) and nothing else ran them either. The checklist said
// the system would do those five and the system did none of them. delivery-checklist.ts's own
// header calls that "a checklist that lies about what has happened, which is worse than no
// checklist."
//
// One map, so the answer to "does this auto step actually do something" is a single lookup
// rather than a grep, and so a future auto step added to DELIVERY_STEPS with no entry here is
// visible instead of quietly inert. `unimplementedAutoSteps()` below is the check.

import { DELIVERY_STEPS } from "../delivery-checklist";

export interface AutoResult {
  ok: boolean;
  error?: string;
  docId?: string;
  /** One line for the ops thread when the step did something worth narrating. */
  note?: string;
}

export type AutoRunner = (clientId: string) => Promise<AutoResult>;

/**
 * Lazily imported, every one of them.
 *
 * These modules pull in jsPDF, the QR encoder and the Supabase client. Importing them eagerly
 * would drag all of that into any bundle that touches the checklist, including edge paths that
 * only wanted a step label.
 */
export const AUTO_RUNNERS: Record<string, AutoRunner> = {
  site_dns_intel: async (clientId) => {
    const { runSiteIntel, formatSiteIntel } = await import("../site-intel");
    const r = await runSiteIntel(clientId);
    return { ok: r.ok, error: r.error, note: r.intel ? formatSiteIntel(r.intel) : undefined };
  },

  nap_sweep: async (clientId) => {
    const { runAutomatedSweep } = await import("../presence-sweep");
    const r = await runAutomatedSweep(clientId);
    return { ok: r.ok, error: r.error, note: r.note };
  },

  presence_pdf: async (clientId) => {
    const { generatePresencePdf } = await import("./presence-pdf");
    return generatePresencePdf(clientId);
  },

  // Both halves of step 9. The citations harvest runs itself; the brief is generated and then
  // WAITS for a person, which is why the step is auto_then_manual rather than auto.
  avatar_harvest: async (clientId) => {
    const { runHarvest, formatHarvestSummary } = await import("../harvest");
    const { generateDeepResearchBrief } = await import("./deep-research-brief");

    const harvest = await runHarvest(clientId);
    const brief = await generateDeepResearchBrief(clientId);

    if (!harvest.ok && !brief.ok) {
      return { ok: false, error: harvest.error ?? brief.error };
    }

    const { data } = await (await import("@/lib/db")).supabaseAdmin
      .from("question_bank")
      .select("phrase, objection_phrase")
      .eq("source", "harvest")
      .order("commercial_intent_score", { ascending: false })
      .limit(8);

    return {
      ok: true,
      docId: brief.docId,
      note: formatHarvestSummary({
        phrases: harvest.phrases ?? 0,
        pages: harvest.pages ?? 0,
        topPhrases: (data ?? []).map((d) => ({
          phrase: d.phrase as string,
          normalized: "",
          frequencyScore: 0,
          commercialIntentScore: 0,
          objectionPhrase: (d.objection_phrase as boolean) ?? false,
          sourceUrl: "",
        })),
      }),
    };
  },

  findings_doc: async (clientId) => {
    const { generateFindings } = await import("./findings");
    return generateFindings(clientId);
  },

  review_card_pdf: async (clientId) => {
    const { generateReviewCard } = await import("./review-card");
    return generateReviewCard(clientId);
  },

  call_sheet: async (clientId) => {
    const { generateCallSheet } = await import("./call-sheet");
    return generateCallSheet(clientId);
  },

  // ── The five added when the `auto` tag was made true across the board ──────

  review_audit: async (clientId) => {
    // auto_then_manual: this seeds the capture rows and posts the card, and a person types the
    // numbers. No review provider is keyed, so there is no automated path to a review count and
    // ticking this outright would mark a measurement complete that measured nothing.
    const { runReviewAudit } = await import("../review-audit");
    const r = await runReviewAudit(clientId);
    return { ok: r.ok, error: r.error, note: r.note };
  },

  custom_question_set: async (clientId) => {
    const { generateCustomQuestionSet } = await import("./custom-question-set");
    return generateCustomQuestionSet(clientId);
  },

  page_candidates: async (clientId) => {
    const { generatePageCandidates } = await import("./page-candidates");
    return generatePageCandidates(clientId);
  },

  citation_cleanup_list: async (clientId) => {
    const { generateCitationCleanupList } = await import("./citation-cleanup");
    return generateCitationCleanupList(clientId);
  },

  review_tool_preview: async (clientId) => {
    // Produces no bytes. It verifies that the preview is genuinely themed and posts the URL,
    // and refuses when the theme is unconfirmed — which is the only way "themed to match" can
    // be false. See review-preview.ts.
    const { verifyReviewToolPreview } = await import("../review-preview");
    return verifyReviewToolPreview(clientId);
  },
};

/**
 * Auto steps that something OTHER than AUTO_RUNNERS completes.
 *
 * These carry `auto: true` and have no entry in AUTO_RUNNERS, but they are not stalled — the
 * route that actually performs the work ticks them:
 *
 *   intake_received    /api/onboarding/save, once the intake is complete
 *   baseline_scan      startBaselineScan, once runAuditPipeline returns
 *   day_zero_archive   the Day 0 wall. `gate: true`, stamped by setDeliveryStep
 *
 * Listed explicitly because the alternative is inferring it, and the inference would be
 * "no runner means stalled", which is wrong for exactly these three.
 */
export const ROUTE_COMPLETED = new Set([
  "intake_received",
  "baseline_scan",
  "day_zero_archive",
  // Added when the seven unreachable auto steps were closed out. Both of these are PREDICATES
  // about ongoing behaviour rather than documents, which is why neither is in AUTO_RUNNERS:
  //
  //   time_log_entries  /api/clients/[id]/time-log, on the first entry saved
  //   weekly_report     runWeeklyReports, on the first report that actually posts
  //
  // A runner for either would be called once, find the thing had not happened yet, and park
  // in terminal `error` — a checklist reporting a failure for work that was merely in the
  // future. There is a nudge behind each, riding the daily digest.
  "time_log_entries",
  "weekly_report",
]);

/**
 * Auto steps that CANNOT complete: nothing runs them and no route ticks them.
 *
 * ‼️ THIS IS WHY IT EXISTS, AND IT IS NOT BOOKKEEPING.
 *
 * `runReadyAutoSteps` will not start a step while a blocker is incomplete. A blocker that can
 * never complete is therefore not a blocker, it is a DEADLOCK — and two of the four artifacts
 * were in one:
 *
 *   findings_doc  blockedBy [presence_pdf, review_audit]
 *                 review_audit is auto, unimplemented, never ticks
 *   call_sheet    blockedBy [findings_doc, custom_question_set, page_candidates, hub_preview]
 *                 two of those are auto and unimplemented
 *
 * So the findings report and the call sheet — the whole point of the exercise — could never
 * have generated, on any client, ever. Nothing would have errored; they would simply have sat
 * at `pending` while the checklist showed them as work the system was going to do.
 *
 * That also puts the hard gate at odds with the doctrine this repo states twice: blockedBy
 * "FLAGS out-of-order work" and day_zero_archive is the single exception that really refuses.
 * Waiving unreachable blockers restores that, and narrowly: a blocker a HUMAN can satisfy still
 * blocks, because that one is a real wait rather than a dead end.
 */
export function unreachableAutoSteps(): Set<string> {
  return new Set(
    DELIVERY_STEPS.filter(
      (s) => s.auto === true && !AUTO_RUNNERS[s.key] && !ROUTE_COMPLETED.has(s.key)
    ).map((s) => s.key)
  );
}

/**
 * Auto steps with no runner behind them.
 *
 * Not a formality. These are the steps that still render `_auto_` in Slack while nothing
 * implements them, and the honest thing is to know which they are rather than assume the map is
 * complete. Called by the test suite and worth calling from a health check.
 *
 * Known and accepted today, and all four are in ROUTE_COMPLETED rather than missing:
 * intake_received and baseline_scan are ticked by the routes that genuinely perform them, and
 * time_log_entries and weekly_report are predicates about ongoing behaviour rather than
 * documents. day_zero_archive is a gate rather than a generator and carries no `auto`.
 *
 * The list this used to name — review_audit, custom_question_set, page_candidates,
 * citation_cleanup_list, review_tool_preview — are all implemented now, which is what took
 * unreachableAutoSteps() to empty and released the findings/call-sheet deadlock.
 *
 * ‼️ A NON-EMPTY DIFFERENCE BETWEEN THIS AND ROUTE_COMPLETED IS THE REGRESSION TO CATCH.
 * An auto step in neither is a step whose `_auto_` tag is a lie, which is the whole reason
 * this file exists.
 */
export function unimplementedAutoSteps(): string[] {
  return DELIVERY_STEPS.filter((s) => s.auto && !AUTO_RUNNERS[s.key]).map((s) => s.key);
}

/** Steps this session made real. Used by the tests to catch a regression in the wiring. */
export const IMPLEMENTED_THIS_SESSION = [
  "site_dns_intel",
  "nap_sweep",
  "presence_pdf",
  "avatar_harvest",
  "findings_doc",
  "review_card_pdf",
  "call_sheet",
] as const;
