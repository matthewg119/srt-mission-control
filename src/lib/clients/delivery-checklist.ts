// The internal delivery checklist.
//
// One message, posted into the #onboarding-srt-aeo thread when a client finishes intake,
// edited in place as the team works through it. INTERNAL: it lives in the main workspace,
// never in the client's channel in the hub.
//
// A TRACKER, NOT AN AUTOMATION ENGINE. Two of these steps the system genuinely performs
// and ticks itself. The rest are a phone call, DNS records the client types into their
// own registrar, photographs uploaded to a Google listing. Pretending otherwise would
// produce a checklist that lies about what has happened, which is worse than no checklist.
//
// Step order and wording come from SRT-AEO-Onboarding-v2-PILOT.md §7 to §10 and the SOP's
// Phases 2 to 5, both in docs/specs/.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { DRAFT_COPY } from "@/config/client-messages";
import {
  askForStep,
  notifyForStep,
  postDraft,
  postDnsCallChecklist,
} from "@/lib/clients/client-drafts";
import { subdomainLabel } from "@/lib/clients/normalize";
import { DAY_ZERO_STEP_KEY, stampDay0, clearDay0IfManual } from "@/lib/clients/day-zero";

export interface DeliveryStep {
  key: string;
  label: string;
  phase: string;
  /** The system completes this one itself. */
  auto?: boolean;
  /** Nothing after this may legitimately happen before it. */
  gate?: boolean;
  /**
   * Runner v3 §2. 'auto' runs itself when ready; 'manual' and 'auto_then_manual' post to
   * Slack and wait for a button. Distinct from `auto`, which only says the SYSTEM ticks it:
   * a step can be auto_then_manual (the system does the work, a person confirms it landed).
   */
  mode?: "auto" | "manual" | "auto_then_manual";
  /**
   * Keys that must be complete before this one is honestly startable.
   *
   * ADVISORY, not enforcement, and that is deliberate. This list FLAGS out-of-order work in
   * the Slack render — the same doctrine as the Measure gate. The single exception is
   * day_zero_archive, which really does refuse, in code, in day-zero.ts. Everything else is
   * a judgement somebody made about their own week.
   */
  blockedBy?: string[];
}

export const DELIVERY_STEPS: DeliveryStep[] = [
  // ── MEASURE ───────────────────────────────────────────────────────────────
  { key: "intake_received", phase: "Measure", label: "Intake received, canonical NAP locked, audit attached if one exists", auto: true, mode: "auto" },
  { key: "baseline_scan", phase: "Measure", label: "Photograph I: universal_v1 across the keyed engines", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  { key: "site_dns_intel", phase: "Measure", label: "Site, hosting and DNS intelligence", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  // Key kept from the 14-step list, where it was "NAP sweep across the directory list".
  // Renaming the KEY would orphan every row already carrying it.
  { key: "nap_sweep", phase: "Measure", label: "Presence sweep: automated tier", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  { key: "presence_sweep_manual", phase: "Measure", label: "Presence sweep: manual tier, screenshots in the thread", mode: "manual", blockedBy: ["nap_sweep"] },
  { key: "presence_pdf", phase: "Measure", label: "Presence and consistency PDF report", auto: true, mode: "auto", blockedBy: ["presence_sweep_manual"] },
  { key: "competitor_shortlist", phase: "Measure", label: "Competitor shortlist of 10, I pick 3", mode: "manual", blockedBy: ["baseline_scan"] },
  { key: "review_audit", phase: "Measure", label: "Review audit: them plus the three I picked", auto: true, mode: "auto", blockedBy: ["competitor_shortlist"] },
  { key: "avatar_harvest", phase: "Measure", label: "Avatar phrase harvest: forums and cited sources", auto: true, mode: "auto", blockedBy: ["baseline_scan"] },
  { key: "findings_doc", phase: "Measure", label: "Findings written up and attached", auto: true, mode: "auto", blockedBy: ["presence_pdf", "review_audit"] },

  // ── PREPARE — before the call, none of it touches their properties ────────
  { key: "avatar_confirmed", phase: "Prepare", label: "Avatar proposed, I confirm one", mode: "manual", blockedBy: ["avatar_harvest"] },
  { key: "custom_question_set", phase: "Prepare", label: "Custom question set drafted for approval", auto: true, mode: "auto", blockedBy: ["avatar_confirmed"] },
  { key: "page_candidates", phase: "Prepare", label: "Page candidates scored, 100 for the call", auto: true, mode: "auto", blockedBy: ["avatar_confirmed"] },
  { key: "citation_cleanup_list", phase: "Prepare", label: "Citation cleanup list built and ranked", auto: true, mode: "auto", blockedBy: ["presence_pdf"] },
  { key: "hub_preview", phase: "Prepare", label: "Hub built, themed, preview live, theme confirmed by me", mode: "auto_then_manual", blockedBy: ["intake_received"] },
  { key: "review_tool_preview", phase: "Prepare", label: "Review tool preview live, themed to match", auto: true, mode: "auto", blockedBy: ["hub_preview"] },
  { key: "review_card_pdf", phase: "Prepare", label: "Review card PDF generated", auto: true, mode: "auto", blockedBy: ["hub_preview"] },
  { key: "call_sheet", phase: "Prepare", label: "Call sheet PDF generated and attached", auto: true, mode: "auto", blockedBy: ["findings_doc", "custom_question_set", "page_candidates", "hub_preview"] },

  // ── THE CALL ──────────────────────────────────────────────────────────────
  { key: "call_booked", phase: "The call", label: "Call booked", mode: "manual" },
  { key: "call_held", phase: "The call", label: "Call held: NAP aloud, question set approved, consent confirmed, preview walked, pages picked", mode: "manual", blockedBy: ["call_sheet"] },
  { key: "access_granted", phase: "The call", label: "Access granted: GBP manager, Search Console, Analytics", mode: "manual", blockedBy: ["call_held"] },
  // THREE records, and the phrasing is deliberate. "CNAME and TXT" read as two, which is
  // where the two-versus-three drift came from: there are two CNAMEs, not one.
  { key: "dns_records", phase: "The call", label: "DNS: three records added by the client, two CNAMEs and one TXT", mode: "manual", blockedBy: ["call_held"] },

  // ── DAY 0 ─────────────────────────────────────────────────────────────────
  // ‼️ THE ONE STEP THAT BLOCKS RATHER THAN FLAGS. See src/lib/clients/day-zero.ts and
  // docs/2026-08-18-day-zero-wall.sql. Completing it stamps clients.day_0_archived_at and
  // opens the publish path; unticking it clears the stamp again.
  { key: DAY_ZERO_STEP_KEY, phase: "Day 0", label: "Day-0 scan archived, before any change lands", gate: true, mode: "auto", blockedBy: ["call_held"] },

  // ── BUILD — unblocked by Day 0, not before ────────────────────────────────
  { key: "gbp_buildout", phase: "Build", label: "Google Business Profile buildout: categories, services, photos, Q&A seeded", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY, "access_granted"] },
  { key: "citation_cleanup", phase: "Build", label: "Citation cleanup executed from the list", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY, "citation_cleanup_list"] },
  { key: "subdomain_live", phase: "Build", label: "Subdomain live and verified in Search Console", mode: "auto_then_manual", blockedBy: ["dns_records"] },
  { key: "first_page", phase: "Build", label: "First pages published, measured track first", mode: "auto_then_manual", blockedBy: [DAY_ZERO_STEP_KEY, "subdomain_live"] },
  { key: "cards_printed", phase: "Build", label: "Cards printed and handed to the clinic", mode: "manual", blockedBy: ["review_card_pdf"] },
  { key: "review_request_configured", phase: "Build", label: "Automated request configured in their booking system, or card_only recorded", mode: "manual", blockedBy: ["call_held"] },
  { key: "review_tool_handed", phase: "Build", label: "Review tool handed to the named person", mode: "manual", blockedBy: ["subdomain_live"] },
  { key: "time_log_entries", phase: "Build", label: "Time log has entries from day 0", auto: true, mode: "auto", blockedBy: [DAY_ZERO_STEP_KEY] },
  { key: "weekly_report", phase: "Build", label: "Weekly report firing", auto: true, mode: "auto", blockedBy: ["first_page"] },
  { key: "day_30_date", phase: "Build", label: "Day-30 report date set", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY] },
];

const GATE_INDEX = DELIVERY_STEPS.findIndex((s) => s.gate);

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
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One renderer, used for the first post AND every update, so the message can never drift
 * from the rows. Same doctrine as formatInitialBlocks in src/lib/lead-thread.ts.
 */
/** The first step not yet complete. Null when the whole list is done. */
export function nextStep(rows: StepRow[]): DeliveryStep | null {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  return DELIVERY_STEPS.find((s) => status.get(s.key) !== "complete") ?? null;
}

export function renderChecklist(name: string, rows: StepRow[]): string {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  const done = (key: string) => status.get(key) === "complete";

  const lines: string[] = [`*Delivery checklist: ${name}*`, ""];
  let phase = "";
  let n = 0;

  for (const step of DELIVERY_STEPS) {
    n++;
    if (step.phase !== phase) {
      phase = step.phase;
      lines.push(`*${phase}*`);
    }
    const box = done(step.key) ? ":white_check_mark:" : "·";
    const auto = step.auto ? "  _auto_" : "";
    lines.push(`${box}  ${n}. ${step.label}${auto}`);
  }

  const completed = DELIVERY_STEPS.filter((s) => done(s.key)).length;
  lines.push("");
  lines.push(`${completed} of ${DELIVERY_STEPS.length} done.`);

  // What to do next, named. The checklist knowing which step is outstanding and making
  // someone scan the list to work it out is a small tax paid on every glance, and the
  // draft that goes with a step is exactly the thing that gets forgotten.
  const next = nextStep(rows);
  if (next) {
    const ask = askForStep(next.key);
    lines.push(
      ask
        ? `Next: ${next.label}. The ${DRAFT_COPY[ask.key]?.label ?? ask.key} draft is in this thread.`
        : `Next: ${next.label}.`
    );
  }

  // The Day-0 gate. PILOT §9 and SOP §2.3 both require the archive to exist BEFORE
  // anything changes on the hub, GBP or a directory, because every later scorecard is
  // measured against it. Ticking a build step first does not undo the damage, so the
  // checklist says so out loud rather than silently allowing it.
  // The MEASURE gate. The call is the meeting where we tell them what the AI is saying
  // about them and agree who we are going after, and both of those come out of the
  // baseline. Holding it first means walking in with opinions instead of screenshots, and
  // it means the hundred prompts get picked against a guess at their ideal customer
  // rather than against what the engines actually returned.
  //
  // Flags, never blocks. Same doctrine as the market-overlap check: a call booked early
  // is a judgement somebody made, and a checklist that refused would just get worked
  // around. What it must not do is stay quiet.
  const measureDone = ["baseline_scan", "findings_doc"].every(done);
  if (!measureDone && (done("call_booked") || done("call_held"))) {
    lines.push(
      `:warning: The call is on the board but the baseline is not finished. Run the audit and write the findings up first, or the call is opinions instead of screenshots.`
    );
  }

  // Out-of-order work, named. blockedBy is ADVISORY — it says so on the interface — so this
  // is the whole of its enforcement: a line that makes the gap visible on the next glance.
  // Capped at three, because a checklist that lists twelve complaints gets scrolled past.
  const outOfOrder = DELIVERY_STEPS.filter(
    (s) => done(s.key) && (s.blockedBy ?? []).some((k) => !done(k))
  ).slice(0, 3);
  for (const s of outOfOrder) {
    const missing = (s.blockedBy ?? []).filter((k) => !done(k));
    const names = missing.map((k) => stepByKey(k)?.label ?? k).join(", ");
    lines.push(`:warning: "${s.label}" is ticked but ${names} is not.`);
  }

  if (GATE_INDEX >= 0 && !done(DELIVERY_STEPS[GATE_INDEX].key)) {
    const jumped = DELIVERY_STEPS.slice(GATE_INDEX + 1).filter((s) => done(s.key));
    if (jumped.length > 0) {
      lines.push(
        `:warning: ${jumped.length} build step${jumped.length > 1 ? "s are" : " is"} done but the Day-0 scan was never archived. ` +
          `Day 30, 60 and 90 have nothing to measure against.`
      );
    }
  }

  return lines.join("\n");
}

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
 * Post the checklist as a reply under the intake card. Idempotent: the ts is claimed with
 * a conditional UPDATE guarded on `is null`, so two concurrent completions produce one
 * checklist, not two.
 */
export async function postDeliveryChecklist(clientId: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    console.error("[delivery-checklist] SLACK_CLIENT_ONBOARDING_CHANNEL unset, checklist not posted");
    return;
  }

  const client = await loadClient(clientId);
  if (!client) return;
  if (client.ops_checklist_ts) return; // already posted
  if (!client.ops_thread_ts) {
    console.error("[delivery-checklist] no ops_thread_ts, cannot thread the checklist");
    return;
  }

  const rows = await loadRows(clientId);
  const text = renderChecklist(displayName(client), rows);

  const res = (await slack.postThreadReply(
    channel,
    client.ops_thread_ts as string,
    text
  )) as { ok?: boolean; ts?: string };

  if (!res?.ok || !res.ts) return;

  await supabaseAdmin
    .from("clients")
    .update({ ops_checklist_ts: res.ts, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .is("ops_checklist_ts", null);

  // And post whatever is startable right now, under the checklist. At intake that is a
  // short list — most steps are blocked behind Photograph I — which is the intended shape:
  // the thread fills as the work becomes real, rather than dumping 33 cards on day one.
  const { postReadySteps } = await import("@/lib/clients/step-engine");
  await postReadySteps(clientId).catch((e) =>
    console.error("[delivery-checklist] initial step posts failed:", (e as Error).message)
  );
}

/** Re-render the existing message from current rows. Never throws into a caller. */
export async function refreshDeliveryChecklist(clientId: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return;

  const client = await loadClient(clientId);
  if (!client?.ops_checklist_ts) return;

  const rows = await loadRows(clientId);
  try {
    await slack.updateMessage(
      channel,
      client.ops_checklist_ts as string,
      renderChecklist(displayName(client), rows)
    );
  } catch (e) {
    // A Slack hiccup must not undo the row write that already happened.
    console.error("[delivery-checklist] refresh failed:", (e as Error).message);
  }
}

/**
 * Tick a step: write the row, re-render the message, and say so in the thread.
 *
 * The thread reply is the point. A message that silently mutates gives no notification
 * and no history, so the checklist shows the current state and the thread underneath it
 * reads as a log of who did what and when.
 */
export async function setDeliveryStep(args: {
  clientId: string;
  stepKey: string;
  complete: boolean;
  actor?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const step = stepByKey(args.stepKey);
  if (!step) return { ok: false, error: "Unknown step." };

  const { error } = await supabaseAdmin
    .from("client_delivery_steps")
    .update({
      status: args.complete ? "complete" : "pending",
      completed_at: args.complete ? new Date().toISOString() : null,
      completed_by: args.complete ? (args.actor ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", args.clientId)
    .eq("step_key", args.stepKey);

  if (error) return { ok: false, error: error.message };

  // The Day-0 stamp rides on the tick so the two cannot drift. It is the one side effect
  // here that is allowed to fail loudly: everything below this deliberately swallows
  // errors so a Slack hiccup cannot undo the row write, but a stamp that silently did not
  // happen would leave the wall shut with the checklist saying it is open, and the person
  // who ticked it would find out at the moment they try to publish.
  //
  // source 'manual_step', never 'photograph_2': a tick asserts the archive happened, it is
  // not evidence that it did. See day-zero.ts.
  if (args.stepKey === DAY_ZERO_STEP_KEY) {
    try {
      if (args.complete) {
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
          `The step was ${args.complete ? "ticked" : "unticked"}, but the Day-0 stamp on ` +
          `the client record failed: ${(e as Error).message}. Publishing is still blocked. ` +
          `Un-tick and tick again once that is fixed.`,
      };
    }
  }

  await refreshDeliveryChecklist(args.clientId).catch(() => {});

  if (args.complete) {
    await notifyThread(
      args.clientId,
      `:white_check_mark: ${step.label}${args.actor ? `  _${args.actor}_` : ""}`
    ).catch(() => {});
  }

  // Drafts follow the checklist rather than the other way round, and they never block it:
  // the row write above has already happened and a Slack or copy problem must not undo it.
  await offerDraftsFor(args.clientId, args.stepKey, args.complete).catch(() => {});

  // Completing a step can unblock others. Posting them is what makes this a step engine
  // rather than a list: the next piece of work appears in the thread without anyone going
  // to look for it. Imported lazily to keep the module cycle one-directional — step-engine
  // reads DELIVERY_STEPS from here.
  if (args.complete) {
    const { postReadySteps } = await import("@/lib/clients/step-engine");
    await postReadySteps(args.clientId).catch((e) =>
      console.error("[delivery-checklist] posting ready steps failed:", (e as Error).message)
    );
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
  completed: boolean
): Promise<void> {
  if (!completed) return;

  const notify = notifyForStep(stepKey);
  // Vars, not bare. postDraft() defaults to {} and the notify_first_page copy puts
  // {pageUrl} on a line of its own, so with no vars fill() blanked the token and the
  // client got told a page was live with no link to it. The URL is DERIVED here rather
  // than typed on the board: it is a fact about the record, and the hostname is the one
  // part of it a person would get wrong.
  if (notify) await postDraft(clientId, notify.key, await notifyVars(clientId, notify.key)).catch(() => {});

  const rows = await loadRows(clientId);
  const next = nextStep(rows);
  if (!next) return;

  const ask = askForStep(next.key);
  if (ask) await postDraft(clientId, ask.key).catch(() => {});

  // The DNS step is the one that strands a non-technical owner, so the call checklist
  // goes up with the ask rather than being something to remember to go and find.
  if (next.key === "dns_records") await postDnsCallChecklist(clientId).catch(() => {});
}

/** Everything internal about this client goes here, under the intake card. */
export async function notifyThread(clientId: string, text: string): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return;

  const client = await loadClient(clientId);
  if (!client?.ops_thread_ts) return;

  await slack.postThreadReply(channel, client.ops_thread_ts as string, text);
}

/** Used by the system when it completes a step itself. */
export async function autoCompleteStep(
  clientId: string,
  stepKey: string,
  note?: string
): Promise<void> {
  await setDeliveryStep({ clientId, stepKey, complete: true, actor: "Mission Control" });
  if (note) await notifyThread(clientId, note).catch(() => {});
}
