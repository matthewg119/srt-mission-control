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
  // ‼️ STEP 3 PRINTS THE THREE RECORDS TOO, FOR REFERENCE. Matthew's call, 2026-08-24, and not
  // a bug fix: step 3 answers WHERE and WHO (registrar, the click path, mail, hosting) and step
  // 15 answers WHAT TO TYPE, and he wants the whole DNS conversation in one thread while he is
  // on the phone. Step 22 is still where the records get confirmed, and the copy says so, so
  // nobody ticks step 3 believing they have done the DNS work.
  //
  // ‼️ IT SYNTHESISES THE ROWS AND SEEDS NOTHING. seedDnsRecords needs a subdomain label, and
  // step 3 is the step that DECIDES that label, so seeding here would write a guess. Worse, the
  // CNAME value only becomes true after registerClientHosts reads the per-domain target back
  // out of Vercel at step 15: hubCnameTarget()'s fallback is measured WRONG for this project.
  // A wrong value on a row labelled `ready`, three steps before anything could correct it, is a
  // value somebody reads down the phone. Preview mode prints no target at all.
  site_dns_intel: async (clientId) => {
    const { runSiteIntel, formatSiteIntel } = await import("../site-intel");
    const r = await runSiteIntel(clientId);
    if (!r.ok || !r.intel) return { ok: r.ok, error: r.error };

    const note: string[] = [formatSiteIntel(r.intel)];

    // The resolver not answering means no subdomain was chosen, and formatSiteIntel already
    // says so. Printing a host built on a guess underneath that would contradict it.
    if (r.intel.resolverHealthy) {
      const { formatDnsRecords } = await import("../hub-setup");
      const { loadDnsRows, DNS_RECORDS } = await import("../dns-records");
      const { subdomainLabel } = await import("../normalize");
      const { supabaseAdmin } = await import("@/lib/db");

      const { data: row } = await supabaseAdmin
        .from("clients")
        .select("subdomain, domain")
        .eq("id", clientId)
        .maybeSingle();

      const domain = (row?.domain as string | null) ?? r.intel.domain;
      const label =
        r.intel.subdomainConvention ??
        subdomainLabel((row?.subdomain as string | null) ?? null, domain);

      if (label) {
        // Real rows if step 15 has already run (a re-run of step 3 on an older client), which
        // is the more useful message. Otherwise three rows that exist for one message only.
        const existing = await loadDnsRows(clientId);
        const rows =
          existing.length > 0
            ? existing
            : DNS_RECORDS.map(
                (def) =>
                  ({
                    record_key: def.key,
                    record_type: def.type,
                    host: def.host(label),
                    value: null,
                    status: "pending",
                    observed: null,
                    last_checked_at: null,
                    verified_at: null,
                  }) as Awaited<ReturnType<typeof loadDnsRows>>[number]
              );

        note.push("", ...formatDnsRecords(rows, domain, { preview: existing.length === 0 }));
      }
    }

    return { ok: true, note: note.join("\n") };
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

  // Both halves of the avatar harvest, and ONE OF THEM SPENDS NOTHING NOW (2026-08-28).
  //
  // The citations harvest still runs on every pass: it is a scrape, no model touches it, and the
  // domains it finds are what the prompt interpolates as seed sites. The research half no longer
  // runs itself on Haiku. It posts the prompt for Matthew to run in claude.com, because the
  // automatic version cost around $0.60 to $1.00 a client and came back thinner than his own run.
  // deep-research-run.ts's header carries the numbers. `run` in the thread still fires the Haiku
  // pass for anyone who wants it.
  //
  // The step stays `auto_then_manual`, and it is back to waiting for somebody to RUN the research
  // rather than only to read it. Step 11 stays shut until Matthew presses Done either way.
  avatar_harvest: async (clientId) => {
    const { runHarvest, formatHarvestSummary } = await import("../harvest");
    const { postResearchPrompt } = await import("./deep-research-run");

    const harvest = await runHarvest(clientId);
    const research = await postResearchPrompt(clientId);

    if (!harvest.ok && !research.ok) {
      return { ok: false, error: harvest.error ?? research.error };
    }

    // ‼️ FILTERED BY VERTICAL AND AVATAR, AND IT WAS NOT BEFORE. question_bank is shared across
    // every client in a vertical and has no client_id, so an unfiltered "top phrases" read prints
    // another vertical's buyers back at this client's thread as though they were this market.
    const { confirmedAvatarFor } = await import("../avatars");
    const { verticalFor } = await import("../harvest");
    const avatar = await confirmedAvatarFor(clientId);
    const resolved = await verticalFor(clientId);

    let sample: Array<{ phrase: string; objection_phrase: boolean | null }> = [];
    if (avatar && resolved.ok) {
      const { data } = await (await import("@/lib/db")).supabaseAdmin
        .from("question_bank")
        .select("phrase, objection_phrase")
        .eq("vertical", resolved.vertical)
        .eq("avatar", avatar.slug)
        .eq("source", "harvest")
        .order("commercial_intent_score", { ascending: false })
        .limit(30);

      // Chrome filtered on read, for the rows harvested before isPageChrome existed. Without it
      // this list leads with a nav bar, which is what the thread showed on 2026-08-27. Same
      // reasoning as harvestedPhrases() in deep-research-run.ts: the corpus is shared and is not
      // rebuilt, so the read side has to defend itself.
      const { isPageChrome } = await import("../harvest");
      sample = ((data ?? []) as typeof sample).filter((d) => !isPageChrome(d.phrase)).slice(0, 8);
    }

    const harvestNote = formatHarvestSummary({
      phrases: harvest.phrases ?? 0,
      pages: harvest.pages ?? 0,
      topPhrases: sample.map((d) => ({
        phrase: d.phrase,
        normalized: "",
        frequencyScore: 0,
        commercialIntentScore: 0,
        objectionPhrase: d.objection_phrase ?? false,
        sourceUrl: "",
      })),
    });

    return {
      ok: true,
      // No docId, and that is the load-bearing consequence: postResearchPrompt files no artifact,
      // so this step has no output_ref until the answer comes back. step-verify.ts's
      // avatar_harvest verifier was rewritten for exactly that. Read it before filing a document
      // here again.
      note: [
        harvestNote,
        research.note ?? `:warning: The research prompt could not be posted: ${research.error}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
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

  // ‼️ TWO DOCUMENTS, ONE RUNNER, AND THE SECOND ONE IS FILED AGAINST A DIFFERENT STEP.
  //
  // The call sheet is step 18. generateCallQuestions writes step 20's closing questions and files
  // them against `call_held`, because they are built from the SAME reports and there is no point
  // spending a second pass over them. No AUTO_RUNNERS key is added: `call_held` is a manual step
  // and giving it a runner would put it in unreachableAutoSteps()'s sights for no reason.
  //
  // ‼️ A FAILURE IN THE SECOND HALF NEVER FAILS THE FIRST. The call sheet is what the call
  // cannot happen without; the questions are what makes it a better call. generateCallQuestions
  // posts nothing to Slack on purpose (it would create step 20's anchor two steps early and break
  // one-anchor-at-a-time), so the only place its outcome can be reported is this note.
  call_sheet: async (clientId) => {
    const { generateCallSheet } = await import("./call-sheet");
    const sheet = await generateCallSheet(clientId);

    const { generateCallQuestions } = await import("./call-questions");
    const questions = await generateCallQuestions(clientId).catch((e) => ({
      ok: false as const,
      error: (e as Error).message,
    }));

    const note = questions.ok
      ? questions.note
      : `:warning: The closing questions for step 20 were not generated: ${questions.error}`;

    return { ...sheet, note };
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

  // ‼️ THE STEP THAT WAS DOING NOTHING AT ALL, AND THE ONE THAT PRODUCES THE CNAMEs.
  // registerClientHosts() is the only code here that attaches a domain to Vercel and reads the
  // REAL per-domain target back; its only callers were a board button and a CLI script. So on
  // the first pilot the step was ticked by hand, nothing was attached, and reviews.{domain}
  // answered NXDOMAIN. See hub-setup.ts for the full account.
  hub_preview: async (clientId) => {
    const { registerHubAndSeedDns } = await import("../hub-setup");
    return registerHubAndSeedDns(clientId);
  },

  // Reports how many of the three records resolve. It never asserts one is WRONG —
  // checkRecord deliberately never stores not_found, because propagation takes an hour.
  subdomain_live: async (clientId) => {
    const { checkHubResolving } = await import("../hub-setup");
    return checkHubResolving(clientId);
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
 *   baseline_scan      startBaselineScan, once runAuditPipeline returns AND the run actually
 *                      measured something. A pipeline that completed with twenty no_data rows
 *                      leaves this outstanding on purpose; see baseline-scan.ts.
 *   day_zero_archive   the Day 0 wall. `gate: true`, stamped by setDeliveryStep. It is
 *                      `mode: "manual"` now and posts a card like any other manual step — it
 *                      was "auto" with no runner, which meant no card and no execution at all.
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
 *
 * ‼️ THE PREDICATE READS `mode` AS WELL AS `auto`, AND IT USED TO READ ONLY `auto` (2026-08-25).
 *
 * `first_page` was declared `mode: "auto_then_manual"` with no `auto: true` and no runner, so it
 * satisfied neither half of the old test and was invisible to this check — while being exactly
 * the thing this check exists to find. Its card could never post, because postReadySteps waits
 * for `ready` and only a runner writes that.
 *
 * `auto` and `mode` answer different questions (`auto` = the system TICKS it, `mode` = whether it
 * waits for a person), and a step that declares EITHER kind of automation needs something behind
 * it. `day_zero_archive` is correctly excluded: it is `mode: "manual"` and asserts nothing.
 */
export function unreachableAutoSteps(): Set<string> {
  return new Set(
    DELIVERY_STEPS.filter(
      (s) =>
        (s.auto === true || s.mode === "auto" || s.mode === "auto_then_manual") &&
        !AUTO_RUNNERS[s.key] &&
        !ROUTE_COMPLETED.has(s.key)
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
