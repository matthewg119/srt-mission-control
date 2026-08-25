// BrainHeart's confirmation pass: what makes a checkmark mean something.
//
// ‼️ THE WHOLE POINT IS THAT A STEP IS NOT DONE BECAUSE A BUTTON WAS PRESSED.
//
// [Done] used to write `status: complete` and post a tick. That is a record of somebody's
// intention, not of the work, and thirty-three of them add up to a delivery log that cannot be
// audited by the person who most needs to audit it. Every step now has to answer "what would I
// look at to know this happened", and the answer is written down here, per step, in code.
//
// TWO HONEST TIERS AND NO THIRD:
//
//   system   the app observed real state — rows in a table, an answer from a resolver, an
//            HTTP 200. Marked :white_check_mark:.
//   thread   a human put an artifact in the step's thread (a photo, the call notes, a
//            screenshot) and the app read that artifact BACK. Marked :ballot_box_with_check:.
//
// The tiers are never interchangeable and the wording never crosses over. A thread-tier line
// may only describe THE ARTIFACT IT FOUND, never the fact that artifact stands for: "confirmed
// by 1 photo in this thread" is true, "the cards are printed" is not something a photo proves.
// Exactly the distinction day_0_source draws between photograph_2 and manual_step, and the
// reason `verified_source` has no third value in the schema.
//
// ‼️ THERE IS NO OVERRIDE AND THERE MUST NOT BE ONE. Matthew's instruction was that a step
// which cannot be confirmed does not get ticked and does not get worked around: it says what
// is wrong and, when the fault is ours, what to fix. That is why `broken` carries a `fix` field
// aimed at a code change rather than at more clicking. Adding a "mark done anyway" button would
// need a third `verified_source` value, which means writing a migration and reading this first.
//
// ‼️ NEVER CLAIM EVIDENCE THAT WAS NOT CHECKED. A verifier that cannot reach its evidence
// returns `broken`, never `ok`. Same rule run-prompts.ts enforces with status:"no_data": an
// absent answer is reported as absent and never guessed.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { DELIVERY_STEPS, type StepKey } from "@/config/delivery-steps";
import { PLATFORM_COUNT } from "@/config/presence-platforms";

// ─────────────────────────────────────────────────────────────────────────────
// The verdict
// ─────────────────────────────────────────────────────────────────────────────

export type Verdict =
  | { ok: true; kind: "system"; evidence: string[] }
  | { ok: true; kind: "thread"; evidence: string[] }
  /** The work simply has not happened yet. Nothing is broken; there is something to do. */
  | { ok: false; kind: "not_yet"; checked: string; found: string; todo: string }
  /** The evidence PATH is faulty. Not work owed — a bug, with somewhere to send it. */
  | { ok: false; kind: "broken"; checked: string; found: string; fix: string };

const verified = (...evidence: string[]): Verdict => ({ ok: true, kind: "system", evidence });
const confirmed = (...evidence: string[]): Verdict => ({ ok: true, kind: "thread", evidence });
const notYet = (checked: string, found: string, todo: string): Verdict => ({
  ok: false,
  kind: "not_yet",
  checked,
  found,
  todo,
});
const broken = (checked: string, found: string, fix: string): Verdict => ({
  ok: false,
  kind: "broken",
  checked,
  found,
  fix,
});

export interface VerifyCtx {
  clientId: string;
  stepKey: StepKey;
  /** The delivery row: output_ref, error_detail and the anchor whose thread holds evidence. */
  row: {
    status: string;
    output_ref: string | null;
    error_detail: string | null;
    slack_anchor_ts: string | null;
  };
  client: Record<string, unknown>;
}

type Verifier = (ctx: VerifyCtx) => Promise<Verdict>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared probes
// ─────────────────────────────────────────────────────────────────────────────

/** One optional extra predicate. Enough for every count here and typed without a cast. */
interface CountFilter {
  col: string;
  /** Equality against this value. */
  eq?: string | boolean;
  /** `is not null`, for "has this column been filled in". */
  notNull?: boolean;
}

async function countRows(
  table: string,
  clientId: string,
  filter?: CountFilter
): Promise<number | null> {
  let q = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (filter?.eq !== undefined) q = q.eq(filter.col, filter.eq);
  if (filter?.notNull) q = q.not(filter.col, "is", null);
  const { count, error } = await q;
  // ‼️ null means COULD NOT CHECK and is not the same as zero. A failed query reported as 0
  // would be a verifier confidently telling somebody their work is missing because Supabase
  // blinked. Same reasoning as slack.getReactionCount returning null rather than 0.
  if (error) {
    console.error(`[step-verify] count on ${table} failed:`, error.message);
    return null;
  }
  return count ?? 0;
}

const dbUnreachable = (table: string) =>
  broken(
    `a count of ${table} for this client`,
    "the query itself failed, so nothing could be confirmed either way",
    `This is not about the work. Supabase did not answer a count on ${table}. Retry in a moment; ` +
      `if it keeps happening, check the service role key and the table's RLS policies.`
  );

/** Files filed against this step's thread. The anchor ts IS the thread, so this is exact. */
async function docsInThread(ctx: VerifyCtx): Promise<number | null> {
  if (!ctx.row.slack_anchor_ts) return 0;
  const { count, error } = await supabaseAdmin
    .from("client_docs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId)
    .eq("slack_thread_ts", ctx.row.slack_anchor_ts);
  if (error) {
    console.error("[step-verify] client_docs count failed:", error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * The human-written replies in this step's thread.
 *
 * Bot messages are excluded, and that exclusion is load-bearing: this module posts its own
 * refusals into the same thread, so counting them would let a verifier be satisfied by its own
 * complaint. Returns null when the thread could not be read, which is `broken`, not zero.
 */
async function humanReplies(ctx: VerifyCtx): Promise<string[] | null> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel || !ctx.row.slack_anchor_ts) return null;

  const msgs = await slack.conversationsReplies(channel, ctx.row.slack_anchor_ts, 60);
  // conversationsReplies returns [] both for "no replies" and for "the call failed", so an
  // empty array cannot be distinguished from a failure. Element 0 is always the parent when
  // the call worked, so its absence is the tell.
  if (msgs.length === 0) return null;

  return msgs
    .slice(1)
    .filter((m) => !m.bot_id && !m.app_id && typeof m.text === "string")
    .map((m) => (m.text as string).trim())
    .filter((t) => t.length > 0);
}

const threadUnreadable = broken(
  "the replies in this step's thread",
  "Slack did not return the thread, so any artifact in it is invisible to this check",
  "Confirm SLACK_BOT_TOKEN is set and the bot is a member of #onboarding-srt-aeo with the " +
    "channels:history scope. Until it can read the thread it cannot confirm anything posted there.",
);

/** A date somewhere in the text. Deliberately loose: it is evidence, not a parser. */
const DATE_RE =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|(mon|tue|wed|thu|fri|sat|sun)[a-z]*|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/** An artifact somebody uploaded, or a reply that names one. The shared shape of tier two. */
async function artifactInThread(
  ctx: VerifyCtx,
  what: string,
  todo: string
): Promise<Verdict> {
  const docs = await docsInThread(ctx);
  if (docs === null) return dbUnreachable("client_docs");
  if (docs > 0) {
    return confirmed(
      `${docs} file${docs === 1 ? "" : "s"} filed against this step's thread`,
      `That is evidence an artifact was posted, not proof of ${what}.`
    );
  }

  const replies = await humanReplies(ctx);
  if (replies === null) return threadUnreadable;

  return notYet(
    "files and replies in this step's thread",
    replies.length > 0
      ? `${replies.length} repl${replies.length === 1 ? "y" : "ies"}, none of them a file`
      : "nothing in the thread yet",
    todo
  );
}

/** A generated artifact wrote its output_ref and the doc row is really there. */
async function artifactOnRecord(ctx: VerifyCtx, label: string): Promise<Verdict> {
  if (!ctx.row.output_ref) {
    return notYet(
      "the step's output_ref",
      "empty, so no artifact has been generated for this step",
      `Un-tick and re-tick the step to re-run the generator, or say what happened in the thread. ` +
        `Every runner is idempotent, so re-running is safe.`
    );
  }

  const { count, error } = await supabaseAdmin
    .from("client_docs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", ctx.clientId)
    .eq("delivery_step_key", ctx.stepKey);

  if (error) return dbUnreachable("client_docs");
  if (!count) {
    return broken(
      "the generated file behind this step's output_ref",
      `output_ref is set to "${ctx.row.output_ref}" but no client_docs row carries this step key`,
      `The generator recorded an artifact it did not file. Check deliverArtifact() in ` +
        `src/lib/clients/artifacts/deliver.ts for this step: an upload that fails still returns ` +
        `ok:true from Slack when the bot is not a channel member.`
    );
  }

  return verified(`${label} is filed against this client (${count} file${count === 1 ? "" : "s"})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The map. Record<StepKey, Verifier> is the compile-time proof it covers all 33.
// ─────────────────────────────────────────────────────────────────────────────

export const STEP_VERIFIERS: Record<StepKey, Verifier> = {
  // ── MEASURE ────────────────────────────────────────────────────────────────
  intake_received: async (ctx) => {
    const at = ctx.client.intake_completed_at as string | null;
    if (!at) {
      return notYet(
        "clients.intake_completed_at",
        "empty, so the intake form was never finished",
        "Send the client their /onboarding link again and wait for step 6 to save."
      );
    }
    return verified(`intake completed at ${at}`);
  },

  // ‼️ THE REPORT IS FOUND BY audit_reports.client_id, NEWEST FIRST. THREE THINGS HERE ARE
  // DELIBERATE AND THE NEXT PERSON WILL TRY TO UNDO ALL THREE.
  //
  // 1. NOT clients.audit_report_id. That column exists and is ALWAYS NULL: nothing in this repo
  //    has ever written it, and this verifier was its only reader. So step 2 refused for every
  //    client that had a perfectly good audit attached, and it took steps 7 and 9 down with it
  //    because both are blockedBy baseline_scan. The link lives the other way round, on
  //    audit_reports.client_id (docs/2026-08-19-artifact-plumbing.sql), and it IS populated.
  //
  // 2. `score`, NOT `visibility_score`. There is no visibility_score column. PostgREST fails the
  //    WHOLE select with 42703 on one unknown name in the projection, so a single wrong word
  //    here makes a working verifier return `broken` about a report that is fine. That was the
  //    second fault, hiding behind the first.
  //
  // 3. client_id ONLY, with no contact_id or domain fallback. deep-research-brief.ts:225-238
  //    explains why: both of those can match a `prospect_audit`, the one-engine prospecting run
  //    the audit bot fires at a lead, and A2 D-P14 says such a run is never a photograph. This
  //    is the baseline the day 30, 60 and 90 numbers are measured against, so "a run fired FOR
  //    this client" is the only acceptable link. presence-pdf.ts resolves it the same way.
  baseline_scan: async (ctx) => {
    const { data: report, error } = await supabaseAdmin
      .from("audit_reports")
      .select("id, status, score")
      .eq("client_id", ctx.clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return dbUnreachable("audit_reports");

    if (!report) {
      return notYet(
        "audit_reports rows carrying this client's id",
        "no baseline run has been recorded against this client",
        "Photograph I has not started. Un-tick this step to re-run the baseline scan."
      );
    }

    if (report.status !== "done") {
      return notYet(
        "this client's newest audit report",
        `its status is "${report.status}", not "done"`,
        "The scan is still running, or it stopped part way. Give it a few minutes, then re-check."
      );
    }

    const reportId = report.id as string;

    const { count, error: runErr } = await supabaseAdmin
      .from("audit_runs")
      .select("id", { count: "exact", head: true })
      .eq("report_id", reportId);
    if (runErr) return dbUnreachable("audit_runs");

    const { count: answered } = await supabaseAdmin
      .from("audit_runs")
      .select("id", { count: "exact", head: true })
      .eq("report_id", reportId)
      .neq("status", "no_data");

    if (!count) {
      return broken(
        "audit_runs for this client's newest report",
        "the report says done but not one prompt run was recorded",
        "A report marked done with no runs means finishReport ran over an empty batch. Check " +
          "src/app/api/audit/process/route.ts for this report id before trusting any score."
      );
    }

    return verified(
      `${count} audit_runs rows, ${answered ?? 0} with a real answer`,
      `report status done, score ${report.score ?? "unscored"}`
    );
  },

  site_dns_intel: async (ctx) => {
    const intel = ctx.client.site_intel as Record<string, unknown> | null;
    if (!intel || Object.keys(intel).length === 0) {
      return notYet(
        "clients.site_intel",
        "empty, so nothing was recorded about the site, its host or its DNS",
        "Un-tick the step to re-run the intelligence pass."
      );
    }
    const registrar = (intel.registrar as string | null) ?? null;
    const ns = (ctx.client.dns_nameservers as string[] | null) ?? null;
    if (!registrar && !(ns && ns.length > 0)) {
      return broken(
        "clients.site_intel and clients.dns_nameservers",
        "site_intel is populated but carries neither a registrar nor any nameservers",
        "The intelligence pass wrote a shell. Check resolveDnsProvider() in " +
          "src/lib/clients/dns-records.ts: unknown nameservers return provider null on purpose, " +
          "but an EMPTY nameserver list means the lookup itself never resolved."
      );
    }
    return verified(
      `site_intel recorded${registrar ? `, registrar ${registrar}` : ""}`,
      ns && ns.length > 0 ? `nameservers ${ns.slice(0, 2).join(", ")}` : "nameservers not resolved"
    );
  },

  nap_sweep: async (ctx) => {
    const n = await countRows("nap_discrepancies", ctx.clientId);
    if (n === null) return dbUnreachable("nap_discrepancies");
    if (n === 0) {
      return broken(
        "nap_discrepancies rows for this client",
        `found 0, expected ${PLATFORM_COUNT}`,
        "The seed wrote nothing. This step has failed two different ways and the fix for the " +
          "first caused the second, so check which one you have. 42P10 (\"no unique or " +
          "exclusion constraint matching the ON CONFLICT specification\") means the target in " +
          "seedPresenceSweep does not match any index: confirm " +
          "nap_discrepancies_client_platform_url_key exists and is declared NULLS NOT DISTINCT " +
          "(docs/2026-08-24-step-board-fixes.sql). A duplicate-key violation means the target " +
          "has been removed again, which turns the upsert back into a plain INSERT. The target " +
          "BELONGS there; it is the index that has to be inferrable from a column list."
      );
    }
    if (n < PLATFORM_COUNT) {
      return notYet(
        "nap_discrepancies rows for this client",
        `${n} of ${PLATFORM_COUNT} platforms seeded`,
        "Un-tick the step to re-run the seed. It upserts, so nothing already filled in is lost."
      );
    }
    return verified(`${n} platform rows seeded for the manual tier to work through`);
  },

  // ‼️ THE GATE IS ANY FOUR DISTINCT PLATFORMS, ATTRIBUTED, NOT FOUR NAMED ONES AND NOT FILES.
  //
  // It counted client_docs rows against PLATFORM_COUNT once, then the core six by name. Both
  // were wrong in the same direction: the first could not tell six platforms from six
  // screenshots of Yelp, because every pasted Slack screenshot is called image.png; the second
  // forced a fixed set on somebody who knows which platforms matter for this client. Matthew's
  // call, 2026-08-25: any four DISTINCT platforms of any tier, his choice.
  //
  // ‼️ CORE_SIX AND EXTENDED ARE UNTOUCHED BY THIS. They are the remediation tiers, and they
  // are read far outside this gate: citation-cleanup.ts sorts core-six first and multiplies
  // effort by it, presence-pdf.ts renders the tiers separately, and findings section 3 goes to
  // the client. A gate and a tier are different facts.
  //
  // Still THREAD tier, and the wording stays inside what a screenshot proves: that the searches
  // were run and captured, never what they showed. What they showed is confirmed_status, which
  // is a different step and a different control.
  presence_sweep_manual: async (ctx) => {
    const { presenceCoverageFor, describeCoverage } = await import("./step-engine");
    const cover = await presenceCoverageFor(ctx.clientId, ctx.stepKey);
    if (cover === null) return dbUnreachable("client_docs");

    if (cover.short > 0) {
      const extra =
        cover.unattributed > 0
          ? `. ${cover.unattributed} file${cover.unattributed === 1 ? "" : "s"} in the thread could not be attributed from the message or the address bar, so they are filed but not counted`
          : "";
      return notYet(
        "screenshots filed against this step's thread, counted by distinct platform",
        `${cover.distinct} of the ${cover.needed} platforms needed${extra}`,
        `${cover.short} more, any platform on the list and your choice which. Post one platform ` +
          "per message with its name in the message, or leave the Chrome address bar in the shot " +
          "and the URL is read for you. Where a business genuinely has no listing, the screenshot " +
          "of the empty search result is the evidence."
      );
    }

    return confirmed(
      `screenshots filed for ${cover.distinct} distinct platforms in this step's thread: ${describeCoverage(cover)}`,
      "That is evidence the searches were run and captured, not a reading of what they showed."
    );
  },

  presence_pdf: async (ctx) => artifactOnRecord(ctx, "the presence and consistency PDF"),

  competitor_shortlist: async (ctx) => {
    const total = await countRows("competitor_candidates", ctx.clientId);
    if (total === null) return dbUnreachable("competitor_candidates");
    const picked = await countRows("competitor_candidates", ctx.clientId, {
      col: "selected",
      eq: true,
    });
    if (picked === null) return dbUnreachable("competitor_candidates");

    if (total === 0) {
      return notYet(
        "competitor_candidates for this client",
        "the shortlist was never built",
        "Un-tick the step to rebuild it from the baseline scan's named competitors."
      );
    }
    if (picked === 0) {
      return notYet(
        "competitor_candidates marked selected",
        `${total} candidates on the shortlist, none picked`,
        "Pick three on the client board. The review audit and the findings doc are both built " +
          "from that choice, so an empty pick makes both of them about nobody."
      );
    }
    return verified(`${picked} of ${total} shortlisted competitors picked`);
  },

  // ‼️ THE CLIENT'S OWN COUNTS ARE REQUIRED. THE COMPETITORS' ARE NOT.
  //
  // Matthew, 2026-08-25: "Review audit is good for the customer but not neccesary for
  // competitors, so make that optional, not for the subject clients reviews, those we need to
  // pull at least 1." The competitor rows are still seeded, because they are the work list and
  // findings section 3 uses them when they are filled, and they never block this step.
  //
  // ‼️ A PROPOSAL IS NOT A RECORD AND MUST NOT SATISFY THIS. review_count is written by
  // applyProposedReadings, from one button press by a person. A row carrying only `proposed`
  // reads as not recorded here, exactly as it does everywhere else.
  review_audit: async (ctx) => {
    const rows = await countRows("review_audit_rows", ctx.clientId);
    if (rows === null) return dbUnreachable("review_audit_rows");
    if (rows === 0) {
      return notYet(
        "review_audit_rows for this client",
        "no review audit rows exist",
        "Un-tick the step to re-seed the grid from the client and the competitors picked."
      );
    }

    const { data, error } = await supabaseAdmin
      .from("review_audit_rows")
      .select("subject_type, review_count, proposed")
      .eq("client_id", ctx.clientId);

    // ‼️ A MISSING COLUMN IS NOT AN UNREACHABLE DATABASE AND MUST NOT SAY IT IS. PostgREST fails
    // the WHOLE select on one unknown name, so before the lane 1 migration is applied this
    // verifier cannot check anything at all. dbUnreachable would send somebody to look at the
    // service role key and the RLS policies, which are both fine. The fix is one file.
    if (error && /proposed/.test(error.message)) {
      return broken(
        "review_audit_rows, including the proposed reading a screenshot produced",
        `the column does not exist yet: ${error.message}`,
        "Run docs/2026-08-25-lane-1-screenshots.sql. It adds review_audit_rows.proposed and " +
          ".proposed_source, which is where a reading lands before a person confirms it. Until " +
          "then this step cannot be confirmed either way and is correctly refusing to guess."
      );
    }
    if (error) return dbUnreachable("review_audit_rows");

    const all = data ?? [];
    const clientRows = all.filter((r) => r.subject_type === "client");
    const clientRecorded = clientRows.filter((r) => r.review_count !== null).length;
    const competitorRecorded = all.filter(
      (r) => r.subject_type === "competitor" && r.review_count !== null
    ).length;
    const waiting = all.filter((r) => r.review_count === null && r.proposed !== null).length;

    if (clientRecorded === 0) {
      const extra =
        waiting > 0
          ? ` ${waiting} row${waiting === 1 ? " carries a reading" : "s carry readings"} off a screenshot, waiting on [Confirm these readings]: a proposal is not a record.`
          : "";
      return notYet(
        "review_audit_rows for the CLIENT carrying a measured review_count",
        `0 of ${clientRows.length} of the client's own rows are recorded.${extra}`,
        "No platform here has an API, so the counts come off the listings. Drop the screenshots " +
          "in this thread and confirm the readings, or type them on the client board. At least " +
          "one of the client's own is needed; the competitors' are optional and never block."
      );
    }

    return verified(
      `${clientRecorded} of ${clientRows.length} of the client's own review rows carry a measured count`,
      competitorRecorded > 0
        ? `${competitorRecorded} competitor rows are filled in too, which is optional and was done`
        : "No competitor counts are recorded, which is optional and does not block this step"
    );
  },

  avatar_harvest: async (ctx) => {
    // Same fallback runHarvest() uses, so this counts the rows that run really wrote.
    const vertical =
      ((ctx.client.vertical_slug as string | null) ||
        (ctx.client.business_type as string | null)) ??
      null;

    // ‼️ question_bank HAS NO client_id. This count is per VERTICAL and it is SHARED: every med
    // spa ever harvested is in it, forever. It cannot say anything about this client's run and
    // the wording below must not pretend it does. The per-client evidence is output_ref, which
    // is the deep-research brief this step generated, and that is what the success line leads
    // with.
    let verticalPhrases: number | null = 0;
    if (vertical) {
      const { count, error } = await supabaseAdmin
        .from("question_bank")
        .select("id", { count: "exact", head: true })
        .eq("vertical", vertical);
      verticalPhrases = error ? null : (count ?? 0);
    }
    if (verticalPhrases === null) return dbUnreachable("question_bank");

    if (!ctx.row.output_ref && verticalPhrases === 0) {
      return notYet(
        "the deep-research brief for this step, and the shared question_bank corpus for this vertical",
        "neither the harvest nor the brief has produced anything",
        "Un-tick the step to re-run the harvest. The brief is generated for a person to RUN " +
          "and paste back, so it is only half of this step."
      );
    }
    if (!ctx.row.output_ref) {
      return notYet(
        "the deep-research brief for this step",
        `${verticalPhrases} phrases in the vertical-wide corpus, but no brief was generated for this client`,
        "The cited-source half is done. Un-tick to regenerate the brief."
      );
    }
    return verified(
      "the deep-research brief for this client is generated and filed",
      `${verticalPhrases} phrases sit in question_bank for ${vertical ?? "this vertical"}, which is ` +
        "the shared corpus for the whole vertical and not a count of this client's harvest"
    );
  },

  findings_doc: async (ctx) => artifactOnRecord(ctx, "the findings document"),

  // ── PREPARE ────────────────────────────────────────────────────────────────
  // ‼️ THIS VERIFIER WAS CORRECT AND UNSATISFIABLE FOR THE WHOLE LIFE OF THE COLUMN.
  // clients.primary_avatar had two readers and NO WRITER anywhere, so it read null forever and
  // this step could only ever be skipped. Its refusal said "Pick one on the client board" and
  // there was no such control. Both halves exist now: a panel at #avatar and three buttons on the
  // card. The check itself barely changes, which is the point: it was never the broken half.
  avatar_confirmed: async (ctx) => {
    const avatar = ctx.client.primary_avatar as string | null;
    if (!avatar) {
      return notYet(
        "clients.primary_avatar",
        "no avatar has been confirmed",
        "Pick one of the three on this card, or reply `avatar: laser hair removal` with your " +
          "own, or use the Avatar panel on the client board. Step 10 researches whoever is " +
          "picked, and the custom question set and the page candidates are both scored against " +
          "it, so none of the three means anything until this is answered."
      );
    }
    const label = (ctx.client.primary_avatar_label as string | null) ?? avatar;
    const by = (ctx.client.primary_avatar_confirmed_by as string | null) ?? null;
    return verified(
      `primary avatar ${avatar} (${label}) confirmed${by ? ` by ${by}` : ""}`,
      "Everything downstream is aimed at this customer: the phrase harvest, the tracked question " +
        "set and the page ranking."
    );
  },

  custom_question_set: async (ctx) => {
    const { data, error } = await supabaseAdmin
      .from("client_question_sets")
      .select("version, status, questions")
      .eq("client_id", ctx.clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return dbUnreachable("client_question_sets");
    if (!data) {
      return notYet(
        "client_question_sets for this client",
        "no question set has been drafted",
        "Un-tick the step to regenerate it from the confirmed avatar."
      );
    }
    const n = Array.isArray(data.questions) ? (data.questions as unknown[]).length : 0;
    if (n === 0) {
      return broken(
        "the drafted question set",
        `a ${data.version} row exists but its questions array is empty`,
        "The generator wrote a row with no questions. Check custom-question-set.ts: an empty " +
          "array means the model returned nothing usable and the failure was swallowed."
      );
    }
    return verified(`${n} questions drafted as ${data.version} (${data.status})`);
  },

  page_candidates: async (ctx) => {
    const n = await countRows("page_candidates", ctx.clientId);
    if (n === null) return dbUnreachable("page_candidates");
    if (n === 0) {
      return notYet(
        "page_candidates for this client",
        "no candidates have been scored",
        "Un-tick the step to re-run the scoring pass."
      );
    }
    return verified(`${n} page candidates scored and ranked`);
  },

  citation_cleanup_list: async (ctx) => artifactOnRecord(ctx, "the citation cleanup list"),

  hub_preview: async (ctx) => {
    const { data: hosts, error } = await supabaseAdmin
      .from("client_hosts")
      .select("host, kind, vercel_attached_at, vercel_error")
      .eq("client_id", ctx.clientId);
    if (error) return dbUnreachable("client_hosts");

    const rows = hosts ?? [];
    const attached = rows.filter((h) => h.vercel_attached_at);
    if (attached.length === 0) {
      return broken(
        "client_hosts rows carrying a vercel_attached_at",
        rows.length === 0
          ? "no hosts have been registered for this client at all"
          : `${rows.length} host rows exist but none records a successful attach`,
        "registerHubAndSeedDns never ran, or Vercel refused. A client_hosts row exists because " +
          "POST /v10/projects/{id}/domains returned 200, so its absence means the attach did not " +
          "happen. Check HUB_VERCEL_TOKEN / HUB_VERCEL_PROJECT_ID / HUB_VERCEL_TEAM_ID are set" +
          (rows.find((h) => h.vercel_error)
            ? `. Vercel said: ${rows.find((h) => h.vercel_error)?.vercel_error}`
            : ".")
      );
    }

    // ‼️ CONFIRMED IS confirmedAt, NOT "has overrides". A client who looked at the default
    // palette and kept it deliberately is confirmed, and gating on activeTheme() made that
    // state unreachable: step 15 could never complete for anybody happy with the defaults, and
    // steps 16, 17 and 18 sat behind it. Overrides are read only so the evidence line can say
    // which of the two states this is. Still system tier: a stored timestamp is real state.
    const { themeConfirmed, themeOverrides } = await import("./hub-setup");
    if (!(await themeConfirmed(ctx.clientId))) {
      // The label says "themed". Ticking with the theme unconfirmed is what made
      // review_tool_preview refuse on the next line with a message that read as its own fault.
      return notYet(
        "the theme on this client's hub",
        `${attached.length} host${attached.length === 1 ? "" : "s"} attached, theme not confirmed`,
        "Open the client board, Theme panel, then press Confirm. Set the colours first, or " +
          "press Confirm with nothing set to keep SRT's defaults deliberately. Either is a " +
          "decision; leaving it unconfirmed is not."
      );
    }
    const overrides = await themeOverrides(ctx.clientId);

    return verified(
      `${attached.length} host${attached.length === 1 ? "" : "s"} attached to Vercel (${attached
        .map((h) => h.host)
        .join(", ")})`,
      overrides.length
        ? `theme confirmed (${overrides.join(", ")})`
        : "theme confirmed with no overrides, so the hub renders SRT's defaults deliberately"
    );
  },

  review_tool_preview: async (ctx) => {
    const { data, error } = await supabaseAdmin
      .from("client_hosts")
      .select("host, vercel_attached_at")
      .eq("client_id", ctx.clientId)
      .eq("kind", "reviews")
      .maybeSingle();
    if (error) return dbUnreachable("client_hosts");
    if (!data?.vercel_attached_at) {
      return notYet(
        "the reviews host for this client",
        data ? "a row exists but nothing was attached" : "no reviews host is registered",
        "The reviews host is attached by the hub step. Confirm step 15 first."
      );
    }

    const { verifyReviewToolPreview } = await import("./review-preview");
    const res = await verifyReviewToolPreview(ctx.clientId);
    if (!res.ok) {
      return notYet(
        `a live request to ${data.host}`,
        res.error ?? "the preview did not answer",
        "An attached domain with no DNS record behind it does not resolve yet, which is normal " +
          "before the client adds the CNAME. Re-check after the DNS step."
      );
    }
    return verified(`${data.host} answered a live request`);
  },

  review_card_pdf: async (ctx) => artifactOnRecord(ctx, "the review card PDF"),

  call_sheet: async (ctx) => artifactOnRecord(ctx, "the call sheet PDF"),

  // ── THE CALL ───────────────────────────────────────────────────────────────
  call_booked: async (ctx) => {
    const replies = await humanReplies(ctx);
    if (replies === null) return threadUnreadable;
    const dated = replies.find((r) => DATE_RE.test(r));
    if (!dated) {
      return notYet(
        "replies in this step's thread carrying a date",
        replies.length > 0 ? `${replies.length} replies, none with a date in them` : "nothing in the thread yet",
        "Reply in this thread with when the call is, then press Done. There is no calendar " +
          "integration, so the thread is the only record of it."
      );
    }
    return confirmed(
      `a reply in this thread names a date: "${dated.slice(0, 80)}"`,
      "That is a booking somebody wrote down, not a confirmed calendar entry."
    );
  },

  call_held: async (ctx) => {
    const replies = await humanReplies(ctx);
    if (replies === null) return threadUnreadable;

    const { looksLikeCallNotes } = await import("@/lib/audit-engine/notes-guards");
    const notes = replies.find((r) => looksLikeCallNotes(r).ok);
    if (!notes) {
      return notYet(
        "replies in this step's thread that read as call notes",
        replies.length > 0
          ? `${replies.length} replies, none long enough to be notes from a call`
          : "nothing in the thread yet",
        "Paste the notes from the call into this thread, then press Done. This step's label " +
          "lists five things the call has to cover, and the notes are the only record that they " +
          "were. They also feed the post-call email."
      );
    }
    return confirmed(
      `a reply in this thread reads as call notes (${notes.length} characters)`,
      "That is evidence a call was written up, not that every item on the label was covered."
    );
  },

  // ‼️ THE PAYMENT GATE LIVES HERE, NOT ONLY IN stepPrecondition, AND THAT IS THE POINT.
  //
  // stepPrecondition is called from src/app/api/slack/actions/route.ts and NOWHERE ELSE, so a
  // gate living only there is bypassed by the client board's checkbox, which posts straight to
  // /api/clients/[id]/delivery-step and calls setDeliveryStep. setDeliveryStep runs verifyStep
  // before the row write on every surface, so this is the only place a refusal actually holds.
  // The Slack copy carries the same refusal so the button answers at the press.
  //
  // It is `not_yet`, never `broken`: there is real work owed (record the payment) and the step
  // keeps its [Re-check] button. A `broken` verdict gets none, on purpose, and this is not a
  // code fault.
  access_granted: async (ctx) => {
    const { paymentRecorded, isRecorded, paymentLine, ACCESS_GATE_REASON, ACCESS_GATE_TODO } =
      await import("./payment");

    const result = await paymentRecorded(ctx.clientId);
    if (!result.ok) {
      return broken(
        "clients.payment_recorded_at",
        `the read failed, so nothing could be confirmed either way: ${result.error}`,
        "Check that docs/2026-08-25-lane-3-payment.sql has been run against this database. " +
          "Until those four columns exist this step cannot be gated OR confirmed."
      );
    }

    if (!isRecorded(result.payment)) {
      return notYet(
        "clients.payment_recorded_at",
        "no payment has been recorded for this client",
        `${ACCESS_GATE_REASON} ${ACCESS_GATE_TODO}`
      );
    }

    const verdict = await artifactInThread(
      ctx,
      "access actually being granted",
      "Post a screenshot of the GBP manager invite, Search Console users and the Analytics " +
        "access into this thread. None of the three has an API we are keyed for, so the " +
        "screenshot is the only evidence available."
    );

    // ‼️ THE PAYMENT LINE RIDES ON THE EVIDENCE, IT NEVER SUBSTITUTES FOR IT. A recorded
    // payment says the gate is open; it says nothing about whether access was granted, and a
    // thread-tier line may only describe the artifact it found.
    if (verdict.ok) {
      return { ...verdict, evidence: [...verdict.evidence, paymentLine(result.payment)] };
    }
    return verdict;
  },

  dns_records: async (ctx) => {
    const { loadDnsRows, recheckDnsRecords, allVerified } = await import("./dns-records");
    // Re-check before judging. A person presses Done the moment the client hits Save, and the
    // stored status is whatever the last sweep saw, which is usually older than that.
    const domain = (ctx.client.domain as string | null) ?? null;
    if (!domain) {
      return broken(
        "clients.domain",
        "no domain is on file, so there is no name to resolve the records against",
        "The intake never captured a domain. Set it on the client board before this step can " +
          "mean anything: fqdn() composes every record from it."
      );
    }
    await recheckDnsRecords(ctx.clientId, domain).catch((e) =>
      console.error("[step-verify] dns re-check failed:", (e as Error).message)
    );
    const rows = await loadDnsRows(ctx.clientId);

    if (rows.length === 0) {
      return broken(
        "client_dns_records for this client",
        "no DNS rows have been seeded",
        "seedDnsRecords never ran, which happens when the hub step did not complete. Confirm " +
          "step 15 first; it seeds all three records."
      );
    }
    if (!allVerified(rows)) {
      const state = rows.map((r) => `${r.host} ${r.record_type} ${r.status}`).join(", ");
      return notYet(
        "client_dns_records after a fresh resolver check",
        state,
        "A record reads `added` when somebody typed it and `verified` when the resolver saw it, " +
          "and the gap between those is where a build silently stalls. Propagation is usually " +
          "minutes. Press Re-check rather than ticking past it."
      );
    }
    return verified(`all ${rows.length} records answer from the resolver`);
  },

  // ── DAY 0 ──────────────────────────────────────────────────────────────────
  // ‼️ IT CANNOT CHECK THE STAMP, BECAUSE TICKING IT IS WHAT WRITES THE STAMP.
  // setDeliveryStep calls stampDay0() after the row write, and this runs before it. So the
  // evidence has to be the archive itself, in the thread. That also makes this step stricter
  // than it was: it sits in front of the only hard rail in the repo and was a bare assertion.
  day_zero_archive: async (ctx) =>
    artifactInThread(
      ctx,
      "a Day-0 archive having been taken",
      "Post the archived Day-0 scan into this thread before ticking. This is the baseline the " +
        "day 30/60/90 numbers are measured against, and once a page is live it cannot be " +
        "recovered by being careful afterwards. Ticking here stamps day_0_source as " +
        "manual_step, which is an assertion the archive happened and is never a photograph."
    ),

  // ── BUILD ──────────────────────────────────────────────────────────────────
  gbp_buildout: async (ctx) =>
    artifactInThread(
      ctx,
      "the profile being built out",
      "Post a screenshot of the finished profile into this thread: categories, services, " +
        "photos and the seeded Q&A. There is no Business Profile API key here, so the " +
        "screenshot is the evidence."
    ),

  // ‼️ IT READS THE CONFIRMED STATUS, NOT `status`, AND THAT USED TO BE A GREEN TICK OVER
  // WORK NOBODY HAD DONE.
  //
  // `status` is the SEED column: seedPresenceSweep writes 'not_checked' into it nineteen times
  // and nothing ever writes 'mismatch' there. `confirmed_status` is the ANSWER, and every other
  // consumer in this codebase reads it through effectiveStatus() (citation-cleanup.ts,
  // findings.ts, call-sheet.ts, presence-pdf.ts). This verifier counted `status = 'mismatch'`,
  // got zero for the obvious reason, and returned ":white_check_mark: no listings remain at
  // mismatch, out of 18 swept" for a client where not one listing had been opened. An absence
  // of findings is not a finding of correctness, which is the single rule this whole subsystem
  // exists to hold. See the doc block at presence-sweep.ts on effectiveStatus.
  //
  // The not_checked refusal comes FIRST. A board with two confirmed mismatches and sixteen
  // untouched rows would otherwise refuse only about the two, which reads as "sixteen are fine".
  citation_cleanup: async (ctx) => {
    // Counted separately from loadSweep because loadSweep swallows a query error into an empty
    // array, and "the query failed" must never render as "no rows exist". Same reason countRows
    // returns null rather than 0.
    const total = await countRows("nap_discrepancies", ctx.clientId);
    if (total === null) return dbUnreachable("nap_discrepancies");
    if (total === 0) {
      return broken(
        "nap_discrepancies for this client",
        "no presence rows exist, so there is no cleanup list to have executed",
        "The sweep never seeded. Confirm step 4 first."
      );
    }

    const { loadSweep, countByStatus } = await import("./presence-sweep");
    const rows = await loadSweep(ctx.clientId);
    const counts = countByStatus(rows);

    if (counts.not_checked > 0) {
      return notYet(
        "the confirmed status on every nap_discrepancies row",
        `${counts.not_checked} of ${rows.length} listings carry no confirmed status, so they read as not checked`,
        "Confirm each listing on the Presence sweep panel of the client board. A row with no " +
          "confirmed status has not been read by anybody, and a cleanup step cannot be ticked " +
          "over rows nobody has looked at. Runner v3 section 6: the tool proposes, a person confirms."
      );
    }

    if (counts.mismatch > 0) {
      return notYet(
        "nap_discrepancies still confirmed at mismatch",
        `${counts.mismatch} of ${rows.length} listings still disagree with the canonical NAP`,
        "Fix them or mark the ones that cannot be fixed, then re-check. A listing left at " +
          "`mismatch` reads as outstanding work, not as a decision."
      );
    }

    return verified(
      `all ${rows.length} listings carry a confirmed status and none is at mismatch`,
      `${counts.match} match, ${counts.duplicate} duplicate, ${counts.missing} missing`
    );
  },

  // ‼️ IT READS THE DNS ROWS, NOT checkHubResolving()'s ok FLAG, AND THAT USED TO BE A GREEN
  // TICK OVER A HOST THAT DOES NOT RESOLVE.
  //
  // checkHubResolving() returns ok:true for any client with a domain on file. That is CORRECT
  // for its other job: it is the auto runner for this step, and a runner that returned ok:false
  // on an unresolved record would park the step in a terminal `error` over propagation, which
  // is not a fault. But this verifier passed that flag straight through and printed the note
  // underneath, so a live board read ":white_check_mark: subdomain_live" above the words
  // "0 of 3 resolving". Same class of bug as citation_cleanup: the check ran, the answer was no,
  // and the tick did not look at it.
  //
  // The hub CNAME is the one that decides. `reviews` and the Search Console TXT are checked and
  // reported, but this step is "subdomain live", and a hub that does not resolve is not live
  // whatever the other two say. first_page sits behind this.
  subdomain_live: async (ctx) => {
    const { checkHubResolving } = await import("./hub-setup");
    const res = await checkHubResolving(ctx.clientId);
    if (!res.ok) {
      return notYet(
        "a live request to the hub host",
        res.error ?? res.note ?? "the host did not answer",
        "The CNAME has to resolve before this is true. Confirm the DNS step, then give " +
          "propagation a few minutes and press Re-check."
      );
    }

    // recheckDnsRecords already ran inside checkHubResolving, so this reads what it just wrote.
    const { loadDnsRows } = await import("./dns-records");
    const rows = await loadDnsRows(ctx.clientId);
    const hub = rows.find((r) => r.record_key === "cname_hub");

    if (!hub) {
      return broken(
        "the cname_hub row for this client",
        "no hub CNAME record has been seeded",
        "seedDnsRecords never ran for this client. Confirm step 15 first: registerHubAndSeedDns " +
          "is what writes the three rows."
      );
    }

    if (hub.status !== "verified") {
      const others = rows
        .filter((r) => r.record_key !== "cname_hub")
        .map((r) => `${r.host} ${r.record_type} ${r.status}`)
        .join(", ");
      return notYet(
        "the hub CNAME, resolved by a real lookup",
        `\`${hub.host}\` is ${hub.status}, not verified${others ? ` (${others})` : ""}`,
        "Nothing published is reachable until this record resolves. A record added in the last " +
          "hour is normally still propagating, so give it time and press Re-check. If it stays " +
          "at `ready` for a day, the record was never added; if it reads `mismatch`, it points " +
          "somewhere else and the value in the DNS panel is the one to compare against."
      );
    }

    const verifiedCount = rows.filter((r) => r.status === "verified").length;
    return verified(
      `\`${hub.host}\` resolves to the hub target (record status verified)`,
      `${verifiedCount} of ${rows.length} DNS records verified`
    );
  },

  first_page: async (ctx) => {
    const published = await countRows("client_pages", ctx.clientId, {
      col: "status",
      eq: "published",
    });
    if (published === null) return dbUnreachable("client_pages");
    if (published === 0) {
      const total = await countRows("client_pages", ctx.clientId);
      return notYet(
        "client_pages with status published",
        total ? `${total} page${total === 1 ? "" : "s"} written, none published` : "no pages written yet",
        "Publish from the client board. Publishing refuses while the Day-0 archive is unstamped, " +
          "which is the one hard rail here and is working as intended if that is what stops you."
      );
    }
    return verified(`${published} page${published === 1 ? "" : "s"} published on the client's hub`);
  },

  cards_printed: async (ctx) =>
    artifactInThread(
      ctx,
      "cards being printed and handed over",
      "Post a photo of the printed cards into this thread. Nothing observable from here says a " +
        "card exists on a counter."
    ),

  review_request_configured: async (ctx) => {
    const mode = ctx.client.review_request_mode as string | null;
    // card_only is a real recorded decision on the row, so it is system evidence. It is also
    // half the label: "configured in their booking system, OR card_only recorded".
    if (mode === "card_only") {
      return verified("clients.review_request_mode is card_only, which this step's label allows");
    }
    if (mode === "booking_system") {
      return artifactInThread(
        ctx,
        "the automation being switched on",
        "The mode is recorded as booking_system, so post a screenshot of the configured request " +
          "into this thread. Their booking software is not something this app can query."
      );
    }
    // ‼️ THIS REFUSAL USED TO POINT AT A CONTROL THAT DID NOT EXIST, so the step could never be
    // confirmed by anybody. `clients.review_request_mode` had two readers (here and
    // call-sheet.ts) and NO WRITER anywhere in the repo — the same readers-with-no-writer class
    // as competitor_candidates.selected. The Review handover panel is that writer now, and the
    // todo names its URL rather than "the client board" generally.
    return notYet(
      "clients.review_request_mode",
      "not set, so neither branch of this step has been chosen",
      "Record it on the Review handover panel of the client board: booking_system or card_only. " +
        "The label allows either, but it has to be one of them. While you are there, add the " +
        "review URLs: the tool's Post on Google button reads them and shows a fallback hint " +
        "when they are missing."
    );
  },

  review_tool_handed: async (ctx) => {
    const owner = ctx.client.review_owner_name as string | null;
    const replies = await humanReplies(ctx);
    if (replies === null) return threadUnreadable;
    if (replies.length === 0) {
      return notYet(
        "replies in this step's thread",
        "nothing in the thread yet",
        `Reply naming who it was handed to${owner ? ` (the record says ${owner})` : ""} and how ` +
          "they were shown it. The step says handed to the NAMED PERSON, and a link sent to a " +
          "business address is not a handover."
      );
    }
    return confirmed(
      `a reply in this thread records the handover: "${replies[0].slice(0, 80)}"`,
      "That is somebody's account of the handover, written down."
    );
  },

  time_log_entries: async (ctx) => {
    const day0 = ctx.client.day_0_archived_at as string | null;
    let q = supabaseAdmin
      .from("time_log")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ctx.clientId);
    if (day0) q = q.gte("logged_at", day0);
    const { count, error } = await q;
    if (error) return dbUnreachable("time_log");

    if (!count) {
      return notYet(
        day0 ? `time_log entries since day 0 (${day0})` : "time_log entries for this client",
        "none",
        "Log the time on the client board. This is what the pilot's cost is measured from, so " +
          "an empty log makes the pilot unevaluable rather than free."
      );
    }
    return verified(`${count} time log entr${count === 1 ? "y" : "ies"}${day0 ? " since day 0" : ""}`);
  },

  // ‼️ THIS STEP COULD NEVER BE TICKED BY ANYBODY, AND IT USED `artifactOnRecord` TO DO IT.
  //
  // That helper demands `output_ref` plus a `client_docs` row, i.e. it assumes a generator ran
  // through deliverArtifact. `weekly_report` has no AUTO_RUNNERS entry and is in ROUTE_COMPLETED
  // on purpose: it is a PREDICATE about ongoing behaviour, not a document. runWeeklyReports
  // writes a `client_weekly_reports` row, posts the body into the step's thread, and calls
  // autoCompleteStep — which lands here, gets `not_yet`, and writes nothing. Every week. Forever.
  //
  // The `todo` made it worse by telling whoever read it to "un-tick and re-tick to re-run the
  // generator", naming a generator that does not exist and never will.
  //
  // Same class as review_request_configured: a verifier pointed at the wrong evidence, so honest
  // finished work reads as outstanding. The real evidence is the reports themselves.
  weekly_report: async (ctx) => {
    const { data, error, count } = await supabaseAdmin
      .from("client_weekly_reports")
      .select("week_stamp", { count: "exact" })
      .eq("client_id", ctx.clientId)
      .order("week_stamp", { ascending: false })
      .limit(1);

    if (error) return dbUnreachable("client_weekly_reports");

    if (!count) {
      return notYet(
        "client_weekly_reports rows for this client",
        "no weekly report has posted yet",
        "Nothing is owed here until the digest next runs, and it posts on one weekday. This is " +
          "a rhythm rather than a task: the first report that actually posts ticks the step by " +
          "itself, so there is nothing to do but let it run."
      );
    }

    const newest = (data?.[0]?.week_stamp as string | null) ?? null;
    return verified(
      `${count} weekly report${count === 1 ? "" : "s"} posted for this client`,
      ...(newest ? [`newest is week ${newest}`] : [])
    );
  },

  day_30_date: async (ctx) => {
    const replies = await humanReplies(ctx);
    if (replies === null) return threadUnreadable;
    const dated = replies.find((r) => DATE_RE.test(r));
    if (!dated) {
      return notYet(
        "replies in this step's thread carrying a date",
        replies.length > 0 ? `${replies.length} replies, none with a date` : "nothing in the thread yet",
        "Reply with the day-30 report date. The reminder rides on the follow-up digest and " +
          "counts from the Day-0 stamp, so this is the human record of what was promised."
      );
    }
    return confirmed(
      `a reply in this thread names a date: "${dated.slice(0, 80)}"`,
      "That is the date somebody wrote down, not a scheduled job."
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// The entry point
// ─────────────────────────────────────────────────────────────────────────────

// ‼️ clients.audit_report_id IS NOT IN THIS LIST ON PURPOSE. The column exists and is always
// NULL: nothing in this repo has ever written it. baseline_scan was its only reader and it
// resolved the report through a pointer nobody sets, so step 2 refused for every client that
// had a real audit. Reports are found by audit_reports.client_id, newest first. The column
// stays in the schema (dropping it is a migration for no gain, the same treatment
// clients.slack_channel_id got) and stays out of every projection.
const CLIENT_COLUMNS =
  "id, legal_name, dba_name, slug, domain, subdomain, intake_completed_at, " +
  "site_intel, dns_nameservers, primary_avatar, primary_avatar_label, review_request_mode, " +
  "review_owner_name, day_0_archived_at, day_0_source, vertical_slug, business_type";

/**
 * Confirm one step, or say precisely why it cannot be confirmed.
 *
 * ‼️ IT NEVER THROWS. A verifier that blows up must not read as either pass or fail: it
 * returns `broken` naming the throw, because "the check itself crashed" is a fault report and
 * silently swallowing it would tick a step on an exception.
 */
export async function verifyStep(clientId: string, stepKey: string): Promise<Verdict> {
  const step = DELIVERY_STEPS.find((s) => s.key === stepKey);
  if (!step) {
    return broken(
      "the step definition",
      `"${stepKey}" is not one of the ${DELIVERY_STEPS.length} delivery steps`,
      "A row carries a step key that DELIVERY_STEPS does not define. Either the key was renamed " +
        "in src/config/delivery-steps.ts, which orphans every row already carrying it, or the " +
        "row predates the current list."
    );
  }

  const verifier = STEP_VERIFIERS[stepKey as StepKey];
  if (!verifier) {
    return broken(
      "the verifier for this step",
      `no entry in STEP_VERIFIERS for "${stepKey}"`,
      "STEP_VERIFIERS is typed Record<StepKey, Verifier>, so a missing entry should not compile. " +
        "Seeing this at runtime means the map was widened or the key was cast."
    );
  }

  const [{ data: client }, { data: row }] = await Promise.all([
    supabaseAdmin.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).maybeSingle(),
    supabaseAdmin
      .from("client_delivery_steps")
      .select("status, output_ref, error_detail, slack_anchor_ts")
      .eq("client_id", clientId)
      .eq("step_key", stepKey)
      .maybeSingle(),
  ]);

  if (!client) {
    return broken(
      "the client record",
      `no clients row with id ${clientId}`,
      "The client was deleted while its delivery steps were still being worked."
    );
  }
  if (!row) {
    return broken(
      "this client's row for the step",
      `no client_delivery_steps row for "${stepKey}"`,
      "The delivery steps were never seeded for this client, or this one was deleted. " +
        "seedDeliverySteps() upserts all of them and is safe to re-run."
    );
  }

  const ctx: VerifyCtx = {
    clientId,
    stepKey: stepKey as StepKey,
    row: row as VerifyCtx["row"],
    // Cast through unknown: CLIENT_COLUMNS is a concatenated constant, so PostgREST's typed
    // select cannot infer a row shape from it and hands back GenericStringError.
    client: client as unknown as Record<string, unknown>,
  };

  let verdict: Verdict;
  try {
    verdict = await verifier(ctx);
  } catch (e) {
    return broken(
      "this step's evidence",
      `the check threw: ${(e as Error).message}`,
      `The verifier for "${stepKey}" in src/lib/clients/step-verify.ts crashed rather than ` +
        "returning a verdict. It is a bug in the check, not a statement about the work."
    );
  }

  // ‼️ A RECORDED ERROR OUTRANKS "not yet". A step whose runner already failed is not work
  // somebody owes; it is a fault, and telling them to go and do it would send them looking for
  // a task that cannot succeed until the code is fixed.
  if (!verdict.ok && verdict.kind === "not_yet" && ctx.row.error_detail) {
    return broken(
      verdict.checked,
      `${verdict.found}. The step also recorded an error: "${ctx.row.error_detail}"`,
      "That error came from the runner, so this is a code fault rather than work still owed. " +
        "Paste it into Claude Code with the step key."
    );
  }

  return verdict;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** One line for the anchor and the row's verified_detail. Tier-appropriate wording only. */
export function verdictDetail(verdict: Verdict): string {
  if (!verdict.ok) return "";
  return verdict.evidence.join(" · ");
}

/** What goes in the step's thread when [Done] refuses. */
export function refusalText(stepLabel: string, verdict: Verdict): string {
  if (verdict.ok) return "";

  const lines = [
    `:warning: *Not confirmed: ${stepLabel}*`,
    "",
    `I checked ${verdict.checked}.`,
    `Found: ${verdict.found}.`,
    "",
  ];

  if (verdict.kind === "broken") {
    lines.push("*This is a fault, not work you still owe.* Fix it in Claude Code:");
    lines.push(`> ${verdict.fix}`);
  } else {
    lines.push(verdict.todo);
  }

  lines.push("");
  lines.push("The step is still open and has no checkmark.");
  return lines.join("\n");
}

/** What goes in the step's thread when [Done] goes through. */
export function confirmationText(
  stepLabel: string,
  verdict: Verdict,
  actor: string | null
): string {
  if (!verdict.ok) return "";

  const mark = verdict.kind === "system" ? ":white_check_mark:" : ":ballot_box_with_check:";
  const how =
    verdict.kind === "system"
      ? "Verified against the record"
      : "Confirmed from what is in this thread";

  return [
    `${mark} *${stepLabel}*`,
    `${how}${actor ? `, ticked by ${actor}` : ""}:`,
    ...verdict.evidence.map((e) => `• ${e}`),
  ].join("\n");
}
