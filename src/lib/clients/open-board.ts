// Open a client's delivery board. The one function every door calls (2026-09-15).
//
// Matthew: "once they book we automatically start onboarding them and starting with the whole
// amount of steps". Before this there were three separate ways a board opened, each with its own copy
// of the cascade: api/onboarding/save at the end of the six-step form, startDelivery at the last
// onboarding2 chat answer, and the reset script. A booking opened nothing at all; it waited for eight
// chat answers that a prospect can simply not give.
//
// ‼️ NO SCAN. startBaselineScan is deliberately absent. Every client now arrives through an AI
// visibility audit Matthew already ran for them (the one the Loom was recorded over), and that report
// is adopted as the pre-call audit at step 2. The measured baseline is the Day 0 run at
// day_zero_archive, AFTER the offer, the avatar, the deep research and the keywords, which is the
// only moment the questions being measured are the ones that matter to this client's customers.
// A client with no audit on file gets a card saying so, and the board's Re-run baseline scan is the
// manual fallback.
//
// ‼️ THE ORDER IS LOAD-BEARING.
//  1. The claim on intake_completed_at. Write-once: two doors racing open one board. intake_received's
//     verifier reads exactly this column.
//  2. The subdomain needs the domain the claim may just have written, and hub_preview needs both.
//  3. The header BEFORE any tick. setDeliveryStep ends in refreshHeader, which needs ops_thread_ts.
//  4. The ticks BEFORE postDeliveryChecklist, so the anchors are created with steps 1 and 2 already
//     resolved and runReadyAutoSteps sees competitor_shortlist and avatar_confirmed unblocked.
//
// ‼️ NOTHING HERE THROWS. A booking is already durable when this runs. Every failure is a warning the
// caller posts where Matthew will see it.

import { supabaseAdmin } from "@/lib/db";
import { adoptPriorAudit } from "./adopt-audit";

export interface OpenBoardResult {
  /** False when another request already opened this client's board. Nothing below the claim ran. */
  claimed: boolean;
  /** The audit_reports id adopted as the pre-call audit, or null when none matched. */
  adoptedReportId: string | null;
  warnings: string[];
}

export async function openClientBoard(
  clientId: string,
  opts: {
    /** For the header's first line. */
    name: string;
    headline?: string;
    /** The report they clicked Get Started on. Matched before contact, email and domain. */
    reportSlug?: string | null;
    /**
     * Column writes that ride on the claim (intakePatchFrom for a booking). intake_completed_at and
     * onboarding_status are always set; everything else is the caller's.
     */
    intakePatch?: Record<string, unknown>;
  }
): Promise<OpenBoardResult> {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    console.error(`[open-board] ${msg}`);
    warnings.push(msg);
  };
  const now = new Date().toISOString();

  // ── 1. The claim ──
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("clients")
    .update({
      ...(opts.intakePatch ?? {}),
      intake_completed_at: now,
      onboarding_status: "intake_complete",
      updated_at: now,
    })
    .eq("id", clientId)
    .is("intake_completed_at", null)
    .select("id, domain, subdomain, ops_thread_ts")
    .maybeSingle();

  if (claimErr) {
    warn(`the board could not be claimed: ${claimErr.message}`);
    return { claimed: false, adoptedReportId: null, warnings };
  }
  if (!claimed) return { claimed: false, adoptedReportId: null, warnings };

  // ── 2. Subdomain and the hub cache ──
  if (claimed.domain && !claimed.subdomain) {
    const { chooseSubdomain } = await import("./provision");
    await chooseSubdomain(clientId, claimed.domain as string).catch((e) =>
      warn(`subdomain choice failed: ${(e as Error).message}`)
    );
  }
  try {
    const { revalidateClientHub } = await import("@/lib/hub/resolve");
    revalidateClientHub();
  } catch (e) {
    warn(`hub revalidate failed: ${(e as Error).message}`);
  }

  const { error: stageErr } = await supabaseAdmin
    .from("client_onboarding_steps")
    .update({ status: "complete", completed_at: now })
    .eq("client_id", clientId)
    .eq("stage", "intake");
  if (stageErr) warn(`intake stage update failed: ${stageErr.message}`);

  // ── 3. The header, in the client's own channel ──
  if (!claimed.ops_thread_ts) {
    const { openOpsThread } = await import("@/lib/onboarding2/delivery");
    const ops = await openOpsThread({ clientId, name: opts.name, headline: opts.headline }).catch((e) => ({
      ts: null,
      warning: (e as Error).message,
    }));
    if (ops.warning) warn(`the board header did not post: ${ops.warning}`);
  }

  // ── 4. Seed, adopt the audit, tick what is already true ──
  const { seedDeliverySteps, autoCompleteStep, postDeliveryChecklist } = await import("./delivery-checklist");
  await seedDeliverySteps(clientId).catch((e) => warn(`seeding the delivery steps failed: ${(e as Error).message}`));

  const adopted = await adoptPriorAudit(clientId, { reportSlug: opts.reportSlug }).catch((e) => ({
    reportId: null,
    promoted: false,
    detail: `adopt failed: ${(e as Error).message}`,
  }));
  console.log(`[open-board] prior audit: ${adopted.detail}`);

  const intake = await autoCompleteStep(clientId, "intake_received");
  if (!intake.ok) warn(`intake_received could not be ticked: ${intake.error ?? "unknown"}`);

  if (adopted.reportId) {
    const step2 = await autoCompleteStep(clientId, "baseline_scan");
    if (!step2.ok) warn(`the adopted audit did not confirm step 2: ${step2.error ?? "unknown"}`);
  }

  // ── 5. The board ──
  await postDeliveryChecklist(clientId).catch((e) => warn(`the delivery board did not post: ${(e as Error).message}`));

  const { notifyStep } = await import("./step-board");
  const note = adopted.reportId
    ? `:link: Pre-call audit attached: ${adopted.detail}. No new scan was run. The measured Day 0 run happens at the Day 0 step, after the offer, avatar, research and keywords are locked.`
    : `:grey_question: No finished audit on file for this business, so step 2 is open and nothing was scanned. Hit *Re-run baseline scan* on the client board when you want one.`;
  await notifyStep(clientId, "baseline_scan", note).catch(() => {});

  return { claimed: true, adoptedReportId: adopted.reportId, warnings };
}

/**
 * The one card in #onboarding-srt-aeo for a client started from the dashboard. A booking posts
 * bookedCard instead (lib/onboarding2/card.ts); both lead with the channel link.
 */
export async function announceClientStart(args: {
  clientId: string;
  name: string;
  website: string | null;
  opsChannelId: string | null;
  board: OpenBoardResult;
  warnings: string[];
}): Promise<void> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) {
    console.error("[open-board] SLACK_CLIENT_ONBOARDING_CHANNEL unset, the start card was not posted.");
    return;
  }
  const { channelLine } = await import("./provision");
  const { slack } = await import("@/lib/slack-bot");
  const app = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const allWarnings = [...args.warnings, ...args.board.warnings];

  const text = [
    `:seedling: *Client started: ${args.name}*`,
    ``,
    channelLine(args.opsChannelId),
    `*Board:* ${app}/dashboard/clients/${args.clientId}`,
    args.website ? `*Website:* ${args.website}` : `*Website:* not given`,
    args.board.claimed
      ? args.board.adoptedReportId
        ? `:white_check_mark: Board opened, pre-call audit attached, no new scan run`
        : `:grey_question: Board opened, no audit on file, step 2 waits and nothing was scanned`
      : `:information_source: Board was already open`,
    ...(allWarnings.length ? [``, ...allWarnings.map((w) => `- ${w}`)] : []),
  ].join("\n");

  await slack.postMessage(channel, text);
}
