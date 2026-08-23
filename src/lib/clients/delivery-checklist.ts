// The delivery checklist: the transitions, not the rendering.
//
// ‼️ IT NO LONGER OWNS A MESSAGE. It used to post one 33-line message into the
// #onboarding-srt-aeo thread and edit it in place. The board is now one top-level message per
// step (step-board.ts) plus a pinned header, so what lives here is the state machine: verify,
// write the row, stamp Day 0, roll the stages up, offer the drafts, cascade. Rendering moved.
// INTERNAL either way: it lives in the main workspace, never in the client's hub.
//
// A TRACKER, NOT AN AUTOMATION ENGINE. Some of these steps the system genuinely performs
// and ticks itself. The rest are a phone call, DNS records the client types into their
// own registrar, photographs uploaded to a Google listing. Pretending otherwise would
// produce a checklist that lies about what has happened, which is worse than no checklist.
//
// ‼️ AND A TICK IS NOW EVIDENCE, NOT AN ASSERTION. setDeliveryStep asks step-verify.ts to
// confirm the work BEFORE it writes the row, and a step that cannot be confirmed is not
// written at all. There is no override. See step-verify.ts for why and for the two tiers.
//
// Step order and wording come from SRT-AEO-Onboarding-v2-PILOT.md §7 to §10 and the SOP's
// Phases 2 to 5, both in docs/specs/.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import {
  askForStep,
  notifyForStep,
  postDraft,
  postDnsCallChecklist,
} from "@/lib/clients/client-drafts";
import { subdomainLabel } from "@/lib/clients/normalize";
import { DAY_ZERO_STEP_KEY, stampDay0, clearDay0IfManual } from "@/lib/clients/day-zero";
import { refreshStages } from "@/lib/clients/stage-rollup";
import {
  MARK_CONFIRMED,
  MARK_SKIPPED,
  MARK_VERIFIED,
  markAnchor,
  notifyStep,
  pinHeader,
  postStepAnchor,
  refreshHeader,
  refreshStepAnchor,
} from "@/lib/clients/step-board";
import { confirmationText, verdictDetail, verifyStep, type Verdict } from "@/lib/clients/step-verify";

// The step definitions moved to @/config/delivery-steps so a client component can import
// them without pulling this module (and node:dns, via the step engine) into the browser
// bundle. Re-exported here because every existing import points at this file.
import { DELIVERY_STEPS, type DeliveryStep } from "@/config/delivery-steps";
export { DELIVERY_STEPS };
// `export type { X } from "..."` re-exports WITHOUT creating a local binding, so the
// signatures below could not see the name. Imported as well as re-exported.
export type { DeliveryStep } from "@/config/delivery-steps";

export function stepByKey(key: string): DeliveryStep | undefined {
  return DELIVERY_STEPS.find((s) => s.key === key);
}

interface StepRow {
  step_key: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
}

/** Seeded whole, so the message renders the entire journey from the first post. */
export async function seedDeliverySteps(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("client_delivery_steps").upsert(
    DELIVERY_STEPS.map((s) => ({ client_id: clientId, step_key: s.key, status: "pending" })),
    { onConflict: "client_id,step_key", ignoreDuplicates: true }
  );
  if (error) console.error("[delivery-checklist] seed failed:", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ RESOLVED IS NOT THE SAME AS DONE, AND BOTH READINGS ARE NEEDED HERE.
 *
 * `resolved` means the step is not outstanding: it was ticked OR marked not applicable. That
 * is the reading the SCHEDULERS use (step-engine counts both when it walks blockedBy), so it
 * has to be the reading `nextStep` uses too. It was `!== "complete"`, which meant a skipped
 * step was the answer to "what is next" forever — the checklist kept pointing at the one
 * piece of work somebody had explicitly decided not to do.
 *
 * `done` means it was actually ticked, and that is the reading the WARNINGS use. A skipped
 * step must never satisfy the measure gate or the Day-0 check: "we decided not to" and "we
 * did it" are opposite claims, and those two warnings exist to catch exactly that confusion.
 */
const isResolved = (s: string | undefined) => s === "complete" || s === "skipped";

/** The first step still outstanding. Skipped counts as settled. Null when nothing is left. */
export function nextStep(rows: StepRow[]): DeliveryStep | null {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  return DELIVERY_STEPS.find((s) => !isResolved(status.get(s.key))) ?? null;
}

/**
 * ‼️ renderChecklist WAS DELETED HERE, AND ITS WARNINGS MOVED RATHER THAN DIED.
 *
 * It rendered all 33 steps into one message, which was the only summary anybody had while
 * everything lived in a single thread. With one top-level message per step the list is the
 * channel, and a 43-line message repeating it is the wall printed twice.
 *
 * Its three warnings were NOT duplicated by the per-step messages, because each of them is a
 * statement about the steps taken TOGETHER: the Measure gate, out-of-order work, and build
 * steps done before the Day-0 archive. Those live in headerText() in step-board.ts now. The
 * per-step marks could never have carried them.
 */

/**
 * Rows for one client, self-healing.
 *
 * ‼️ IN-FLIGHT CLIENTS. Runner v3 §18: a tenant provisioned under the old 14-step checklist
 * migrates IN PLACE. Rather than a one-shot migration somebody has to remember to run, the
 * read tops the row set up whenever it is short — seedDeliverySteps upserts with
 * ignoreDuplicates, so this adds the missing nineteen and touches none of the fourteen that
 * already carry status and completed_at.
 *
 * The alternative was a SQL block, and a SQL block only fixes the clients that existed the
 * day it ran. This one also fixes the row somebody restores from a backup next year.
 */
async function loadRows(clientId: string): Promise<StepRow[]> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, completed_at, completed_by")
    .eq("client_id", clientId);

  let rows = (data ?? []) as StepRow[];

  // Short means this client predates the current list. Top it up and re-read once.
  // Guarded on > 0 so a client with genuinely no rows yet is left to seedDeliverySteps at
  // intake rather than being half-provisioned by a read.
  if (rows.length > 0 && rows.length < DELIVERY_STEPS.length) {
    await seedDeliverySteps(clientId);
    const { data: after } = await supabaseAdmin
      .from("client_delivery_steps")
      .select("step_key, status, completed_at, completed_by")
      .eq("client_id", clientId);
    rows = (after ?? rows) as StepRow[];
  }

  return rows;
}

async function loadClient(clientId: string) {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, ops_thread_ts, ops_checklist_ts")
    .eq("id", clientId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

/**
 * The tokens a notify draft needs beyond the ones baseVars() already derives.
 *
 * Only notify_first_page needs anything today. Kept as a lookup rather than folded into
 * baseVars() because baseVars is synchronous and shared by every draft, and this needs a
 * query that only one of them cares about.
 */
async function notifyVars(clientId: string, draftKey: string): Promise<Record<string, string>> {
  if (draftKey !== "notify_first_page") return {};

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("domain, subdomain")
    .eq("id", clientId)
    .maybeSingle();

  const domain = (client?.domain as string | null) ?? null;
  if (!domain) return {};

  const { data: page } = await supabaseAdmin
    .from("client_pages")
    .select("slug")
    .eq("client_id", clientId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const slug = (page?.slug as string | null) ?? null;
  // No page yet means the step was ticked by hand before anything was published. Return
  // nothing rather than a link to the hub index dressed up as the page: fill() tidies the
  // gap, and a message with a missing line is better than one pointing somewhere wrong.
  if (!slug) return {};

  const label = subdomainLabel((client?.subdomain as string | null) ?? null, domain);
  return { pageUrl: `https://${label}.${domain}/${slug}` };
}

function displayName(client: Record<string, unknown>): string {
  return (client.dba_name as string) || (client.legal_name as string) || "Client";
}

/**
 * Open the board for a client: pin the header, then start whatever is reachable.
 *
 * ‼️ IT NO LONGER POSTS THE 33-LINE CHECKLIST, AND THAT IS THE POINT OF THE REBUILD.
 *
 * It used to post renderChecklist() as a reply and store the ts in clients.ops_checklist_ts.
 * With one top-level message per step in the channel, a forty-three line message listing the
 * same thirty-three steps is the wall printed a second time. What Matthew needs from a channel
 * is a count, the ONE step to work next and a link to it, which is what the pinned header is.
 *
 * renderChecklist survives and the dashboard still renders it. ops_checklist_ts is KEPT and
 * simply stops being written, the same treatment slack_channel_id got after the per-client
 * channels were dropped: an old client really does have a checklist message, and dropping the
 * column would orphan it.
 */
export async function postDeliveryChecklist(clientId: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    console.error("[delivery-checklist] SLACK_CLIENT_ONBOARDING_CHANNEL unset, board not opened");
    return;
  }

  const client = await loadClient(clientId);
  if (!client) return;
  if (!client.ops_thread_ts) {
    console.error("[delivery-checklist] no ops_thread_ts, cannot open the board");
    return;
  }

  // The intake message BECOMES the header, edited in place rather than replaced, so it keeps
  // its position at the top of the run and whatever client-level drafts hang under it.
  await refreshHeader(clientId);
  await pinHeader(clientId);

  // ‼️ AUTO STEPS RUN BEFORE MANUAL CARDS ARE POSTED, AND THE ORDER IS LOAD-BEARING.
  // postStep parks a row in awaiting_me and runReadyAutoSteps will not claim a row in that
  // state, so running these the other way round starved every auto_then_manual runner:
  // registerHubAndSeedDns, runHarvest and checkHubResolving never executed on this path.
  const { postReadySteps, runReadyAutoSteps } = await import("@/lib/clients/step-engine");
  await runReadyAutoSteps(clientId).catch((e) =>
    console.error("[delivery-checklist] initial auto steps failed:", (e as Error).message)
  );
  await postReadySteps(clientId).catch((e) =>
    console.error("[delivery-checklist] initial step posts failed:", (e as Error).message)
  );
  await refreshHeader(clientId);
}

/**
 * Re-render the running summary. Never throws into a caller.
 *
 * The name is kept because a dozen call sites say it and they all mean the same thing: bring
 * the summary back in line with the rows. What it updates is now the pinned header rather than
 * a 33-line message.
 */
export async function refreshDeliveryChecklist(clientId: string): Promise<void> {
  await refreshHeader(clientId);
}

/**
 * Tick a step: write the row, re-render the message, and say so in the thread.
 *
 * The thread reply is the point. A message that silently mutates gives no notification
 * and no history, so the checklist shows the current state and the thread underneath it
 * reads as a log of who did what and when.
 */
/**
 * ‼️ THREE STATES, NOT A BOOLEAN, AND `skipped` IS WHY.
 *
 * This took `complete: boolean` and the Slack [Skip] button therefore could not use it — so
 * that handler wrote `status: 'skipped'` to Supabase directly and called `postReadySteps`
 * on its own. Everything else this function does was skipped with it: no `refreshStages`,
 * no `refreshDeliveryChecklist`, and above all no `runReadyAutoSteps`.
 *
 * That is not a cosmetic gap. `postReadySteps` and `runReadyAutoSteps` both count a skipped
 * row as done when they read the blocker graph, so skipping a step is supposed to release
 * whatever it was blocking. Instead the generators sat there: skip `competitor_shortlist`
 * and `review_audit` never starts, skip the manual sweep and the presence PDF never builds.
 * The checklist went quiet and looked like it was thinking.
 *
 * A skip is a real transition and it goes through the same door as a tick.
 */
export type StepTransition = "complete" | "skipped" | "reopened";

export async function setDeliveryStep(args: {
  clientId: string;
  stepKey: string;
  transition: StepTransition;
  /** Only read on 'skipped'. Written to the row so the artifacts can say WHY it was skipped. */
  skippedReason?: string | null;
  actor?: string | null;
}): Promise<{ ok: boolean; error?: string; verdict?: Verdict }> {
  const step = stepByKey(args.stepKey);
  if (!step) return { ok: false, error: "Unknown step." };

  const complete = args.transition === "complete";
  const skipped = args.transition === "skipped";

  // ‼️ CONFIRMATION RUNS BEFORE THE ROW WRITE, AND A REFUSAL WRITES NOTHING AT ALL.
  //
  // This is the difference between a checkmark that records the work and one that records
  // somebody pressing a button. Ordering it after the write would leave a row saying complete
  // with a verdict saying it is not, and the row is what the artifacts, the stage rollup and
  // the day 30/60/90 reminders all read.
  //
  // Only a tick is gated. A SKIP is a decision, not a claim about work, and there is nothing
  // to verify about deciding a step does not apply — gating it would be asking for evidence
  // that something did not need doing. A REOPEN is the remedy and must never be blocked.
  let verdict: Verdict | undefined;
  if (complete) {
    verdict = await verifyStep(args.clientId, args.stepKey);
    if (!verdict.ok) {
      return {
        ok: false,
        verdict,
        error:
          verdict.kind === "broken"
            ? `Could not confirm ${step.label}. ${verdict.found}.`
            : `Not yet: ${verdict.found}.`,
      };
    }
  }
  // Both a tick and a skip are somebody RESOLVING the step, so both stamp who and when.
  // Only 'reopened' clears them, because only that one says the work is outstanding again.
  const resolved = complete || skipped;
  const now = new Date().toISOString();

  const { data: written, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .update({
      status: complete ? "complete" : skipped ? "skipped" : "pending",
      completed_at: resolved ? now : null,
      completed_by: resolved ? (args.actor ?? null) : null,
      // Cleared on reopen and on a plain tick: a reason left behind from an earlier skip
      // would print on the artifact next to a step that is now genuinely done.
      skipped_reason: skipped
        ? (args.skippedReason ?? `Marked not applicable by ${args.actor ?? "Mission Control"}`)
        : null,
      // What was checked and what it found, in the same words Slack was given. Cleared on
      // anything that is not a confirmed tick, so a reopened step cannot keep an old proof:
      // the CHECK constraint requires source and timestamp to be present or absent together.
      verified_source: verdict?.ok ? verdict.kind : null,
      verified_detail: verdict?.ok ? verdictDetail(verdict) : null,
      verified_at: verdict?.ok ? now : null,
      updated_at: now,
    })
    .eq("client_id", args.clientId)
    .eq("step_key", args.stepKey)
    .select("id");

  if (error) return { ok: false, error: error.message };

  // ‼️ AN UPDATE THAT MATCHED NOTHING IS NOT AN ERROR, AND IT USED TO READ AS SUCCESS.
  // A client whose delivery rows were never seeded, or a step key renamed out from under a
  // row, affects zero rows and returns no error — so this answered { ok: true } and the Slack
  // handler rewrote the card as done over a row that does not exist. `.select()` is what makes
  // the difference visible; without it PostgREST has nothing to count.
  if (!written?.length) {
    return { ok: false, error: `no ${args.stepKey} row exists for this client, so nothing was written` };
  }

  // The Day-0 stamp rides on the tick so the two cannot drift. It is the one side effect
  // here that is allowed to fail loudly: everything below this deliberately swallows
  // errors so a Slack hiccup cannot undo the row write, but a stamp that silently did not
  // happen would leave the wall shut with the checklist saying it is open, and the person
  // who ticked it would find out at the moment they try to publish.
  //
  // source 'manual_step', never 'photograph_2': a tick asserts the archive happened, it is
  // not evidence that it did. See day-zero.ts.
  //
  // ‼️ A SKIP DOES NOT OPEN THE WALL, and it is the one place skip and tick diverge.
  // Everywhere else a skipped step counts as resolved. Here it cannot: the wall protects the
  // baseline the day 30/60/90 numbers are measured against, and "not applicable" is not a
  // statement that the archive happened. Skipping is treated as reopening for this purpose,
  // so the stamp is cleared and publishing stays blocked until somebody signs a waiver.
  if (args.stepKey === DAY_ZERO_STEP_KEY) {
    try {
      if (complete) {
        await stampDay0({
          clientId: args.clientId,
          source: "manual_step",
          by: args.actor ?? null,
        });
      } else {
        await clearDay0IfManual(args.clientId);
      }
    } catch (e) {
      // Say exactly what happened. "The step is ticked but the wall is still shut" is a
      // confusing state to discover by trying to publish an hour later.
      return {
        ok: false,
        error:
          `The step was ${complete ? "ticked" : args.transition}, but the Day-0 stamp on ` +
          `the client record failed: ${(e as Error).message}. Publishing is still blocked. ` +
          `Un-tick and tick again once that is fixed.`,
      };
    }
  }

  // The eight pilot stages on the board are DERIVED from these rows, so they are
  // recomputed on every transition rather than maintained separately. Before this, nothing
  // advanced them past 'intake' and the board contradicted this very checklist. Swallowed
  // like everything else below: the row write has already happened.
  await refreshStages(args.clientId).catch((e) =>
    console.error("[delivery-checklist] stage rollup failed:", (e as Error).message)
  );

  await refreshDeliveryChecklist(args.clientId).catch(() => {});

  // ‼️ THE ANCHOR IS ENSURED FIRST, AND WITHOUT THIS STEP 1 NEVER GETS ITS CHECKMARK.
  //
  // A step can be resolved before anything has posted it. intake_received is the live case:
  // onIntakeComplete calls autoCompleteStep on it BEFORE postDeliveryChecklist runs, so at
  // this point in the very first transition of a client's life there is no anchor to mark.
  // refreshStepAnchor and markAnchor both correctly return no_anchor rather than inventing
  // one, so without this the first step would resolve invisibly and the channel would open
  // with step 2.
  //
  // postStepAnchor is idempotent and returns the existing ts, so this is free on every other
  // transition.
  await postStepAnchor(args.clientId, args.stepKey);

  // The board. Three writes, in this order, and the order is what makes the channel readable:
  // the anchor's TEXT is rewritten from the row, the REACTION is set to match, and the pinned
  // header is recounted. A reopen passes null and markAnchor clears whatever was there, so an
  // un-ticked step cannot keep a checkmark that contradicts its own row.
  await refreshStepAnchor(args.clientId, args.stepKey);
  await markAnchor(
    args.clientId,
    args.stepKey,
    complete
      ? verdict?.ok && verdict.kind === "system"
        ? MARK_VERIFIED
        : MARK_CONFIRMED
      : skipped
        ? MARK_SKIPPED
        : null
  );
  await refreshHeader(args.clientId);

  // The evidence goes in the step's own thread, as a record of WHAT was checked rather than
  // a bare tick. A line saying "verified: 20 audit_runs rows, 14 answered" is auditable three
  // weeks later; ":white_check_mark: Photograph I" is not.
  if (complete && verdict?.ok) {
    await notifyStep(
      args.clientId,
      args.stepKey,
      confirmationText(step.label, verdict, args.actor ?? null)
    );
  } else if (skipped) {
    await notifyStep(
      args.clientId,
      args.stepKey,
      `:${MARK_SKIPPED}: *${step.label}* — skipped${args.actor ? ` by ${args.actor}` : ""}. ` +
        `It reads as not checked everywhere, never as no issues found.`
    );
  }

  // Drafts follow the checklist rather than the other way round, and they never block it:
  // the row write above has already happened and a Slack or copy problem must not undo it.
  await offerDraftsFor(args.clientId, args.stepKey, args.transition).catch(() => {});

  // Completing a step can unblock others. Posting them is what makes this a step engine
  // rather than a list: the next piece of work appears in the thread without anyone going
  // to look for it. Imported lazily to keep the module cycle one-directional — step-engine
  // reads DELIVERY_STEPS from here.
  //
  // ‼️ A SKIP CASCADES TOO. postReadySteps and runReadyAutoSteps both read a skipped row as
  // done, so a skip releases whatever that step was blocking. Gating this on `complete` is
  // what left the [Skip] button looking like it had hung the checklist.
  //
  // ‼️ A REOPEN CASCADES TOO, AND IT DID NOT UNTIL NOW.
  // `resolved` is complete-or-skipped, so unticking a step wrote `pending` and stopped there.
  // For an auto step that made the checkbox a dead end: the ONLY way to make a runner run
  // again was to transition some OTHER step and hope this one got picked up in the sweep.
  // Unticking an auto step is the plainest possible way to say "do that again", and every
  // runner in AUTO_RUNNERS is idempotent by construction — the sweeps upsert, the generators
  // overwrite their own artifact, and registerClientHosts treats an already-attached domain
  // as success. postReadySteps cannot double-post either: it skips any step that already has
  // a slack_message_ts.
  {
    const { postReadySteps, runReadyAutoSteps } = await import("@/lib/clients/step-engine");
    // ‼️ AUTO FIRST, AND IT USED TO BE THE OTHER WAY ROUND. postStep parks a row at
    // `awaiting_me`, which runReadyAutoSteps will not claim, so posting first made every
    // auto_then_manual step's own runner unclaimable. postReadySteps now also refuses to post
    // such a card before its runner has left the row at `ready`, so the starvation cannot come
    // back through some other caller — but running them in the right order is what lets a
    // finished runner post its card in the SAME pass rather than the next transition's.
    //
    // ‼️ Awaited on purpose, both of them: these run inside route handlers that Vercel may
    // freeze the moment the response returns, and a fire-and-forget generator would silently
    // vanish mid-render. Same reasoning as the awaited kick-off in run-audit-pipeline.
    await runReadyAutoSteps(args.clientId).catch((e) =>
      console.error("[delivery-checklist] running auto steps failed:", (e as Error).message)
    );
    await postReadySteps(args.clientId).catch((e) =>
      console.error("[delivery-checklist] posting ready steps failed:", (e as Error).message)
    );
    // The cascade can resolve further steps, so the count and the "next" line are recomputed
    // once the dust settles rather than left showing the state from before the sweep.
    await refreshHeader(args.clientId);
  }

  return { ok: true };
}

/**
 * Post whatever draft this transition earns.
 *
 * Two different moments, and mixing them up is the bug worth naming: a NOTIFY is news, so
 * it fires when the step COMPLETES. An ASK is something we still need from them, so it has
 * to arrive while the step is outstanding, which means when it becomes the NEXT one. An
 * ask fired on completion would be a message asking for DNS records the day after they
 * were added.
 *
 * Both are idempotent at the database, so a step toggled off and on again re-runs this
 * without posting anything twice.
 */
async function offerDraftsFor(
  clientId: string,
  stepKey: string,
  transition: StepTransition
): Promise<void> {
  if (transition === "reopened") return;

  // ‼️ A SKIPPED STEP GETS THE ASK BUT NEVER THE NOTIFY, and the asymmetry is the point.
  // A NOTIFY is news about work we did — "your first page is up", "the scan is done". Firing
  // one because the step was marked not applicable tells a paying client we did something we
  // explicitly did not do. The ASK below is unaffected: whatever is next still needs asking
  // for, and that is exactly why the skip cascades at all.
  const notify = transition === "complete" ? notifyForStep(stepKey) : null;
  // Vars, not bare. postDraft() defaults to {} and the notify_first_page copy puts
  // {pageUrl} on a line of its own, so with no vars fill() blanked the token and the
  // client got told a page was live with no link to it. The URL is DERIVED here rather
  // than typed on the board: it is a fact about the record, and the hostname is the one
  // part of it a person would get wrong.
  // Into the thread of the step that just completed: a NOTIFY is news ABOUT that step.
  if (notify)
    await postDraft(clientId, notify.key, await notifyVars(clientId, notify.key), stepKey).catch(
      () => {}
    );

  const rows = await loadRows(clientId);
  const next = nextStep(rows);
  if (!next) return;

  // Into the thread of the step that is now NEXT, which is the step the ask is asking for.
  const ask = askForStep(next.key);
  if (ask) await postDraft(clientId, ask.key, {}, next.key).catch(() => {});

  // The DNS step is the one that strands a non-technical owner, so the call checklist
  // goes up with the ask rather than being something to remember to go and find.
  if (next.key === "dns_records") await postDnsCallChecklist(clientId).catch(() => {});
}

/**
 * Client-level messages, under the pinned header.
 *
 * ‼️ NOT FOR ANYTHING ABOUT A STEP. Use notifyStep() from step-board.ts for that. This is
 * the function that produced the wall: every card, note, tick and draft an onboarding emitted
 * went through it and landed in one thread, so nothing on screen corresponded to one step.
 * What is left for it is the handful of things that belong to the CLIENT and to no step: the
 * intro draft and the day 30/60/90 reports.
 */
export async function notifyThread(clientId: string, text: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return;

  const client = await loadClient(clientId);
  if (!client?.ops_thread_ts) return;

  await slack.postThreadReply(channel, client.ops_thread_ts as string, text);
}

/**
 * Used by the system when it completes a step itself.
 *
 * ‼️ IT GOES THROUGH THE SAME CONFIRMATION AS THE BUTTON, AND THAT IS DELIBERATE. A runner
 * returning ok:true is the runner's own account of itself; the verifier goes and looks. A
 * generator that "succeeded" while writing nothing gets no checkmark, which is exactly the
 * failure that produced a hub_preview card claiming hostnames were attached to Vercel when
 * nothing had run.
 *
 * ‼️ AND IT REPORTS. The return used to be `void`, so setDeliveryStep's { ok: false } was
 * discarded entirely and a refused auto step looked identical to a completed one from here.
 */
export async function autoCompleteStep(
  clientId: string,
  stepKey: string,
  note?: string
): Promise<{ ok: boolean; error?: string }> {
  // The note first. It is the runner's account of what it produced and it belongs in the
  // step's thread whether or not the confirmation then passes: on a refusal it is the
  // context for why, and posting it after would put it below the complaint.
  if (note) await notifyStep(clientId, stepKey, note);

  const res = await setDeliveryStep({
    clientId,
    stepKey,
    transition: "complete",
    actor: "Mission Control",
  });

  if (!res.ok) {
    const step = stepByKey(stepKey);
    if (res.verdict && !res.verdict.ok) {
      // Said out loud in the step's thread, with the fix when there is one. A silent refusal
      // would leave an auto step sitting at awaiting_me with nothing explaining why.
      const { refusalText } = await import("@/lib/clients/step-verify");
      await notifyStep(clientId, stepKey, refusalText(step?.label ?? stepKey, res.verdict));
    }
    console.error(`[delivery-checklist] auto-complete refused for ${stepKey}:`, res.error);
  }

  return { ok: res.ok, error: res.error };
}
