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
};

/**
 * Auto steps with no runner behind them.
 *
 * Not a formality. These are the steps that still render `_auto_` in Slack while nothing
 * implements them, and the honest thing is to know which they are rather than assume the map is
 * complete. Called by the test suite and worth calling from a health check.
 *
 * Known and accepted today: intake_received and baseline_scan are ticked by the routes that
 * genuinely perform them, review_audit / custom_question_set / page_candidates /
 * citation_cleanup_list / review_tool_preview / time_log_entries / weekly_report are not built
 * yet, and day_zero_archive is a gate rather than a generator.
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
