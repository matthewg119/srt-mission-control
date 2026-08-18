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

export interface DeliveryStep {
  key: string;
  label: string;
  phase: string;
  /** The system completes this one itself. */
  auto?: boolean;
  /** Nothing after this may legitimately happen before it. */
  gate?: boolean;
}

export const DELIVERY_STEPS: DeliveryStep[] = [
  { key: "intake_received", phase: "Measure", label: "Intake received, canonical NAP locked", auto: true },
  { key: "baseline_scan", phase: "Measure", label: "Baseline scan run", auto: true },
  { key: "nap_sweep", phase: "Measure", label: "NAP sweep across the directory list" },
  { key: "review_audit", phase: "Measure", label: "Review audit: them plus three competitors" },
  { key: "findings_doc", phase: "Measure", label: "Findings written up and attached" },

  { key: "call_booked", phase: "The call", label: "Call booked" },
  { key: "call_held", phase: "The call", label: "Call held: NAP confirmed aloud, question list approved, consent confirmed" },
  { key: "access_granted", phase: "The call", label: "Access granted: GBP manager, Search Console, Analytics" },
  // THREE records, and the phrasing is deliberate. "CNAME and TXT" read as two, which is
  // where the two-versus-three drift came from: there are two CNAMEs, not one. Always
  // "three DNS records: two CNAMEs and one TXT", so the record count and the CNAME count
  // can never be mistaken for each other.
  //
  // All three go in live on the call even though the reviews. host is not built yet. An
  // unattached CNAME simply does not resolve, and nobody visits reviews.{domain} before
  // the cards are printed. Getting a client back into their registrar a second time weeks
  // later is worse than a record sitting idle for a fortnight.
  {
    key: "dns_records",
    phase: "The call",
    label: "DNS: three records added by the client, two CNAMEs and one TXT",
  },

  {
    key: "day_zero_archive",
    phase: "Day 0",
    label: "Day-0 scan archived, before any change lands",
    gate: true,
  },

  { key: "gbp_buildout", phase: "Build", label: "Google Business Profile buildout: categories, services, photos, Q&A seeded" },
  { key: "citation_cleanup", phase: "Build", label: "Citation cleanup started" },
  { key: "subdomain_live", phase: "Build", label: "Subdomain live and verified in Search Console" },
  { key: "first_page", phase: "Build", label: "First page published" },
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

async function loadRows(clientId: string): Promise<StepRow[]> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status, completed_at, completed_by")
    .eq("client_id", clientId);
  return (data ?? []) as StepRow[];
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
