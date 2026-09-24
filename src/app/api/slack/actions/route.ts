import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { CATEGORY_LABELS, isSequenceCategory } from "@/config/sequence-categories";
import { applyLeadDisposition } from "@/lib/lead-disposition";
import { DISPOSITION_BY_ACTION_ID, LEAD_RUN_AUDIT, LEAD_LOOM } from "@/lib/lead-thread";
import type { LeadRow } from "@/lib/leads/lead-actions";
import { resolvePendingAction } from "@/lib/ai-intel/slack-approval";
import { executePendingAction, postExecutionReceipt, handleMarketingEmailCancel } from "@/lib/ai-intel/execute-action";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { draftSmsReply, type SuggestedFollowup } from "@/lib/sms-ai-engine";
import { buildSuggestionBlocks, autoSendEnabled, autoSendMinutes } from "@/lib/imessage-suggestion";
import { deliverPendingDraft } from "@/lib/imessage-send";
import { scheduleFollowup } from "@/lib/imessage-followups";
import { enqueueBridgeCommand, getBridgeStatus, formatBridgeStatusLine, type BridgeCommandType } from "@/lib/imessage-control";
import { markDraftSent } from "@/lib/clients/client-drafts";
import { RERUN_UPSTREAM_ACTION } from "@/lib/clients/rerun-gaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The [Done] / [Skip] buttons go through setDeliveryStep, which runs the generator cascade.
// waitUntil keeps Slack's 3-second ack honest, but the deferred work is still bounded by this
// number -- so without it the artifacts get killed after the response, silently.
export const maxDuration = 300;

const SLACK_API = "https://slack.com/api";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  // Mandatory, not best-effort: these buttons mutate contact records and fire
  // conversion events to Meta, so an unsigned request must never reach a handler.
  if (!signingSecret) {
    console.error("[slack/actions] SLACK_SIGNING_SECRET not set — rejecting");
    return NextResponse.json({ error: "not_configured" }, { status: 403 });
  }
  if (!timestamp || !signature) {
    return NextResponse.json({ error: "unsigned_request" }, { status: 403 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return NextResponse.json({ error: "stale_request" }, { status: 403 });
  }
  // verifySignature uses timingSafeEqual, which throws when the two buffers
  // differ in length — i.e. on a malformed header rather than a wrong one.
  let signatureOk = false;
  try {
    signatureOk = slack.verifySignature(signingSecret, timestamp, rawBody, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return NextResponse.json({ error: "bad_signature" }, { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ error: "no_payload" }, { status: 400 });
  }

  const payload = JSON.parse(payloadRaw) as SlackInteractivePayload;

  if (payload.type === "block_actions") {
    return handleBlockAction(payload);
  }

  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  return NextResponse.json({ ok: true });
}

interface SlackInteractivePayload {
  type: string;
  user: { id: string; username: string };
  trigger_id?: string;
  view?: {
    callback_id: string;
    private_metadata?: string;
    state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
  };
  actions?: Array<{ action_id: string; value: string; block_id: string }>;
  channel?: { id: string };
  message?: { ts: string; text: string };
  response_url?: string;
  container?: { message_ts?: string; channel_id?: string };
}

const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(.*))?$/i;

/**
 * Record a button press against the client it was about.
 *
 * Never awaited by the handler and never able to fail it: a log that can delay or break the thing
 * it is logging is worse than no log, and this one sits in front of every action in the switch.
 */
async function logButtonPress(
  action: { action_id: string; value?: string },
  channel: string,
  slackTs: string,
  userId: string
): Promise<void> {
  try {
    const value = action.value ?? "";
    const matched = UUID_PREFIX.exec(value);

    let clientId = matched?.[1] ?? null;
    const { currentStepKey } = await import("@/config/delivery-steps");
    // A retired key off an old card must not be logged as a step that no longer exists.
    let stepKey = matched?.[2] ? currentStepKey(matched[2]) : null;

    if (!clientId && channel) {
      const { clientForThread } = await import("@/lib/clients/onboarding-docs");
      const found = await clientForThread(channel, slackTs);
      if (found) {
        clientId = found.id;
        stepKey = found.stepKey;
      }
    }

    if (!clientId) return;

    const { logClientEvent } = await import("@/lib/clients/client-events");
    await logClientEvent({
      clientId,
      stepKey,
      source: "slack",
      kind: "button",
      author: userId,
      text: action.action_id,
      slackChannel: channel,
      // NOT slackTs: that is the CARD's timestamp, and a card is pressed more than once (Done,
      // then Re-check). Using it would make the unique constraint drop every press after the
      // first, which is exactly the history worth having.
      slackTs: null,
      slackThreadTs: slackTs,
      payload: { actionId: action.action_id, value },
    });
  } catch (e) {
    console.error("[slack/actions] button not logged:", (e as Error).message);
  }
}

async function handleBlockAction(payload: SlackInteractivePayload): Promise<NextResponse> {
  let action = payload.actions?.[0];
  console.log("[slack/actions] hit", { type: payload.type, action: action?.action_id });
  if (!action) return NextResponse.json({ ok: true });

  const slackTs = payload.container?.message_ts ?? payload.message?.ts ?? "";
  const channel = payload.container?.channel_id ?? payload.channel?.id ?? "";
  const userId = payload.user.id;

  if (!slackTs) return NextResponse.json({ ok: true });

  // ‼️ EVERY BUTTON, BEFORE THE SWITCH DECIDES WHAT IT IS. A press is a decision somebody made
  // about a client -- Done, Re-check, Skip, an avatar pick -- and it left no trace anywhere except
  // in whatever the handler happened to write. Logged here rather than in forty cases, so a new
  // button is recorded the day it is added rather than the day somebody remembers to log it.
  //
  // The client comes from the button's own value (`<clientId>:<stepKey>` on every step button) and
  // falls back to the thread. A press on something that is not about a client logs nothing.
  void logButtonPress(action, channel, slackTs, userId);

  // ‼️ AN action_id MAY CARRY A "#n" SUFFIX, AND THE SWITCH MUST NOT SEE IT (2026-09-16).
  // Slack rejects a whole message when two buttons in one block share an action_id, with
  // invalid_blocks and nothing rendered. Step 21 offers one button per pillar candidate and one per
  // rung, so every one of those cards was refused: the card body posted, the buttons did not, and the
  // only sign was a line in a server log. That is why the ladder card said "Press [Anchor at N]" next
  // to no such button. Builders that emit a set now suffix "#0", "#1", and the suffix is stripped here
  // so forty existing cases keep matching on the name they always had.
  const actionId = action.action_id.replace(/#\d+$/, "");
  action = { ...action, action_id: actionId };

  switch (actionId) {
    case "ai_approve":
    case "apply_check":
      // "Check" on a standalone /apply card resolves + executes the pending
      // apply_followup action, exactly like Approve on a normal AI card.
      return approveAction({ slackTs, channel, userId });
    case "ai_cancel":
      return cancelAction({ slackTs, channel, userId });
    case "ai_edit":
      return openEditModal({ slackTs, channel, userId, triggerId: payload.trigger_id ?? "" });
    case "sms_create_channel":
      return createSmsChannelFromSlack({ slackTs, channel, userId, contactId: action.value });
    case "lead_dnq":
    case "lead_booked_call":
    case "lead_converted":
      return leadDispositionAction({ actionId: action.action_id, channel, userId, contactId: action.value });

    case LEAD_RUN_AUDIT:
    case LEAD_LOOM:
      return leadWorkAction({ actionId: action.action_id, channel, userId, contactId: action.value });

    case "imsg_send":
      return sendSuggestion({ slackTs, channel, userId });
    case "imsg_regenerate":
      return regenerateSuggestion({ slackTs, channel });
    case "imsg_remix":
      return openRemixModal({ slackTs, channel, triggerId: payload.trigger_id ?? "" });
    case "imsg_hold":
      return holdSuggestion({ slackTs, channel, userId });
    case "imsg_cancel":
      return cancelManualSend({ slackTs, channel, userId });
    case "imsg_followup":
      return scheduleSuggestedFollowup({ slackTs, channel, userId });
    case "sequence_cancel":
      return sequenceCancel({ channel, userId, slackTs, actionValue: action.value });
    case "sequence_cat_aeo":
    case "sequence_cat_audit":
    case "sequence_cat_reengage":
    case "sequence_cat_client":
      return sequenceUpdateCategory({ channel, userId, slackTs, actionValue: action.value });
    case "bridge_restart":
    case "bridge_doctor":
    case "bridge_resync":
      return bridgeCommandAction({ actionId: action.action_id, channel, slackTs, userId });
    case "bridge_status":
      return bridgeStatusAction({ channel, slackTs });
    case "cc_wrap_approve":
    case "cc_wrap_discard":
    case "cc_wrap_attach":
      return callWrapAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userId,
        sessionId: action.value ?? "",
      });
    case "audit_send_now":
    case "audit_hold":
      return auditPitchAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userId,
        reportId: action.value ?? "",
      });
    case "client_import_archive":
    case "client_import_fresh":
      return duplicateImportAction({ actionId: action.action_id, channel, slackTs, userId, value: action.value ?? "" });
    case "fo_track":
    case "fo_ignore":
      return followupTrackAction({
        actionId: action.action_id,
        channel,
        slackTs,
        prospectId: action.value ?? "",
      });
    case "ri_draft":
    case "ri_loom":
    case "ri_paste":
      return reachinboxCardAction({
        actionId,
        channel,
        slackTs,
        userId,
        prospectId: action.value ?? "",
        triggerId: payload.trigger_id ?? "",
      });
    // The "Open in WhatsApp" button is a plain url button. Slack still posts an
    // interaction for it, and acknowledging without doing anything is correct: the tap
    // has already opened WhatsApp. Falling through to default would work, but naming it
    // stops the next person wondering whether a handler went missing.
    case "client_msg_open":
      return NextResponse.json({ ok: true });
    case "step_done":
    case "step_skip":
    case "step_problem":
    // Same handler and the same value shape. A re-check IS a Done attempt: it re-runs the
    // confirmation and ticks the step when the evidence has since arrived.
    case "step_recheck":
      return deliveryStepAction({
        actionId: action.action_id,
        channel,
        messageTs: payload.container?.message_ts ?? "",
        userId,
        userName: payload.user?.username ?? null,
        value: action.value ?? "",
      });

    // ── The contract, sent from the step card during the call (2026-09-16) ──
    // Appended rather than folded into an existing arm, which is the rule for this file.
    case "agreement_draft":
    case "agreement_link":
      return sendAgreementAction({
        actionId: action.action_id,
        channel,
        messageTs: payload.container?.message_ts ?? "",
        userId,
        value: action.value ?? "",
      });

    // ── Re-run the earlier step that writes what this one is missing (2026-09-18) ──
    // Appended rather than folded into the step_done arm above: same value shape, a different
    // verb. D7 lives in the fact that this is only ever reached by somebody pressing it.
    case RERUN_UPSTREAM_ACTION:
      return rerunUpstreamAction({
        channel,
        messageTs: payload.container?.message_ts ?? "",
        userId,
        userName: payload.user?.username ?? null,
        value: action.value ?? "",
      });

    // ── The prep call: RingOut to the client, from the offer step's card ──
    case "step_ringout":
      return stepRingOutAction({
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        clientId: action.value ?? "",
      });

    case "client_msg_sent":
      return clientMessageSentAction({
        channel,
        userId,
        value: action.value ?? "",
      });
    case "page_publish_request":
      return pagePublishRequestAction({
        channel,
        userId,
        threadTs: payload.container?.message_ts ?? "",
        value: action.value ?? "",
      });
    case "page_approve":
      return pageApproveAction({
        channel,
        slackTs: payload.container?.message_ts ?? "",
        userName: payload.user?.username ?? null,
        userId,
        value: action.value ?? "",
      });
    // ── The concierge's audience: which of the two lanes this client's widget speaks from ──
    case "concierge_audience_patient":
    case "concierge_audience_owner":
      return conciergeAudienceAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        clientId: action.value ?? "",
      });
    // ── The concierge add-on: bought on the call, or installed later ──
    case "concierge_addon_include":
    case "concierge_addon_decline":
      waitUntil(
        (async () => {
          const clientId = (action.value ?? "").trim();
          const actor = payload.user?.username ? `@${payload.user.username}` : userId;
          const { setConciergeAddon } = await import("@/lib/clients/concierge-addon");
          const res = await setConciergeAddon({
            clientId,
            status: action.action_id === "concierge_addon_include" ? "included" : "declined",
            by: actor,
          });
          await slack.postThreadReply(channel, slackTs, res.ok ? res.lines.join("\n") : `:warning: ${res.error}`);
          if (res.ok) {
            const { setDeliveryStep } = await import("@/lib/clients/delivery-checklist");
            const done = await setDeliveryStep({ clientId, stepKey: "concierge_preview", transition: "complete", actor });
            if (!done.ok) {
              const todo = done.verdict && !done.verdict.ok && done.verdict.kind === "not_yet" ? ` ${done.verdict.todo}` : "";
              await slack.postThreadReply(channel, slackTs, `:hourglass: Decision saved, step not ticked yet: ${done.error ?? "the check refused"}.${todo}`);
            }
          }
          const { postStep } = await import("@/lib/clients/step-engine");
          await postStep(clientId, "concierge_preview");
        })().catch((e) => console.error("[slack/actions] concierge addon failed:", e))
      );
      return NextResponse.json({ ok: true });
    // ── Step 36: the switch that puts the widget on their live pages, and takes it off ──
    //
    // ‼️ NEITHER BUTTON TICKS THE STEP. `concierge_live`'s verifier reads the audience, the booking
    // destination and the consent copy as well, and a switch is only one of the four. Ticking here
    // would be a green tick over unchecked work, which is the worst bug this board can have.
    case "concierge_enable":
    case "concierge_disable":
      waitUntil(
        (async () => {
          const clientId = (action.value ?? "").trim();
          const actor = payload.user?.username ? `@${payload.user.username}` : userId;
          const { setConciergeEnabled } = await import("@/lib/clients/concierge-enabled");
          const res = await setConciergeEnabled({
            clientId,
            enabled: action.action_id === "concierge_enable",
            by: actor,
            source: "slack",
          });
          await slack.postThreadReply(
            channel,
            slackTs,
            res.ok ? res.lines.join("\n") : `:warning: ${res.error}`
          );
          // Rebuilt in place rather than reposted: Slack orders a channel by post time, so a
          // delete-and-repost would move step 36 to the bottom every time somebody flipped it.
          const { postStep } = await import("@/lib/clients/step-engine");
          await postStep(clientId, "concierge_live");
        })().catch((e) => console.error("[slack/actions] concierge switch failed:", e))
      );
      return NextResponse.json({ ok: true });
    // ── Step 18: which character sits in the corner ──
    //
    // ‼️ NEITHER BUTTON TICKS THE STEP, unlike the add-on pair above. [Done] for step 18 verifies the
    // config row, the embed allowlist and a live probe of the demo link, and a character is none of
    // those. Skipping records the default so the decision is on the row, and that is all it does.
    case "mascot_menu":
    case "mascot_skip":
      waitUntil(
        (async () => {
          const clientId = (action.value ?? "").trim();
          const actor = payload.user?.username ? `@${payload.user.username}` : userId;
          const studio = await import("@/lib/clients/mascot-studio");
          if (action.action_id === "mascot_skip") {
            const res = await studio.skipMascot(clientId, actor);
            await slack.postThreadReply(channel, slackTs, res.message);
          } else {
            const lines = await studio.mascotMenu(clientId);
            await slack.postThreadReply(
              channel,
              slackTs,
              [
                "*The characters this client can have in the corner:*",
                ...lines,
                "",
                `\`mascot concepts\` writes ${studio.CONCEPT_COUNT} new ones for this client. \`mascot pick a, b, c\` shortlists ${studio.SHORTLIST} for the call.`,
                "`mascot skip` keeps the default. `mascot corner bottom-left` moves where it sits.",
              ].join("\n")
            );
          }
          const { postStep } = await import("@/lib/clients/step-engine");
          await postStep(clientId, "concierge_preview");
        })().catch((e) => console.error("[slack/actions] mascot button failed:", e))
      );
      return NextResponse.json({ ok: true });
    // ── Step 21: the awareness ladder's rung, then the pillar keyword ──
    case "ladder_write":
    case "ladder_pick":
    case "kw_pillar":
    case "kw_supports_auto":
      return step21Action({
        actionId: action.action_id,
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        value: action.value ?? "",
      });
    // ── Step 12: the screenshot gate's contact sheet ──
    //
    // ‼️ THESE ARE THE ONLY THINGS THAT APPROVE A CLUSTER. Nothing auto-approves, which is the whole
    // reason the pictures are posted into the thread instead of the scores being left in a table.
    case "kwgate_approve":
    case "kwgate_reject":
    case "kwgate_drop":
      return serpGateAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        value: action.value ?? "",
      });
    // ── Where the review page's Post button sends a customer ──
    case "review_link_open":
      return reviewLinkOpenAction({
        channel,
        slackTs,
        triggerId: payload.trigger_id ?? "",
        clientId: action.value ?? "",
      });
    // ── The offer this client's assistant hands over, approved before the call ──
    case "client_magnet_approve":
      return clientMagnetApproveAction({
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        value: action.value ?? "",
      });
    // ── LANE 2: the avatar, and the research it decides ──
    case "avatar_pick":
      return avatarPickAction({
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        value: action.value ?? "",
      });
    case "avatar_reuse_research":
    case "avatar_rerun_research":
      return avatarResearchAction({
        actionId: action.action_id,
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        clientId: action.value ?? "",
      });
    // ── LANE 1: readings become records, and only a person makes that happen ──
    case "review_confirm_readings":
      return reviewConfirmReadingsAction({
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        clientId: action.value ?? "",
      });
    case "cleanup_confirm_all":
      return cleanupConfirmAllAction({
        channel,
        slackTs,
        userName: payload.user?.username ?? null,
        userId,
        clientId: action.value ?? "",
      });
    // ── A customer's published review becomes evidence, on a person's tap ──
    case "page_review_use":
      return pageReviewUseAction({
        userName: payload.user?.username ?? null,
        userId,
        threadTs: action.value ?? "",
      });
    default:
      return NextResponse.json({ ok: true });
  }
}

/**
 * "Can this publish?" on a page-studio card.
 *
 * ‼️ IT DOES NOT PUBLISH, AND IT MUST NOT BE CHANGED TO.
 * setPublished has exactly one caller, POST /api/clients/[id]/hub action=page_publish, and
 * that caller runs assertDay0Archived BEFORE it. That "exactly one" is what makes
 * `grep -rn "setPublished" src/` a real hole check for the Day 0 wall rather than a habit,
 * and day-zero.ts says so at the bottom of the file. A second publisher here would be a
 * second place to get the ordering wrong, on a surface with no session behind it.
 *
 * What it is for: answering the question BEFORE the walk to the board. The wall is discovered
 * at the Publish button today, which is the most expensive moment to find out.
 */
async function pagePublishRequestAction(args: {
  channel: string;
  userId: string;
  threadTs: string;
  value: string;
}): Promise<NextResponse> {
  const [clientId] = args.value.split(":");
  if (!clientId) return NextResponse.json({ ok: true });

  waitUntil(
    (async () => {
      const { readDay0 } = await import("@/lib/clients/day-zero");
      const { stepByKey } = await import("@/lib/clients/delivery-checklist");
      const { DAY_ZERO_STEP_KEY } = await import("@/config/delivery-steps");

      const board = `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/dashboard/clients/${clientId}`;
      const state = await readDay0(clientId);
      const label = stepByKey(DAY_ZERO_STEP_KEY)?.label ?? "the Day-0 archive";

      // null is the client not existing, which is a different answer from "not archived" and
      // must not be reported as one. Same rule readDay0's own callers follow: a miss is a
      // miss, never a negative.
      if (!state) {
        await slack.postThreadReply(args.channel, args.threadTs, "That client could not be read.");
        return;
      }

      // ‼️ "DAY 0 IS OPEN" IS NOT "PUBLISHING IS OPEN" ANY MORE, and this card used to say it
      // was. Since 2026-08-26 page_publish also refuses on the quality gate, so a card promising
      // an open door would send somebody to the board to meet a refusal it had just ruled out.
      // This answers the question it can answer and names the other rail rather than implying
      // there is only one.
      const text = state.archivedAt
        ? `:unlock: Day 0 was archived on ${new Date(state.archivedAt).toISOString().slice(0, 10)}` +
          `${state.source ? ` (${state.source})` : ""}, so that wall is open.
` +
          `The quality gate is the other one: it has to have read the page's exact body without ` +
          `blocking. Type \`check\` in the page thread, or press Check on the board.
${board}`
        : `:lock: Day 0 is not archived, so publishing will refuse. Tick *${label}* on the ` +
          `delivery checklist first, or waive it there with a reason.
` +
          `The quality gate applies after that, so \`check\` the page as well.
${board}`;

      const posted = (await slack.postThreadReply(args.channel, args.threadTs, text)) as {
        ok?: boolean;
        error?: string;
      };
      if (!posted?.ok) {
        console.error("[slack/actions] page_publish_request reply failed:", posted?.error ?? "unknown");
      }
    })().catch((e) =>
      console.error("[slack/actions] page_publish_request failed:", (e as Error).message)
    )
  );

  return NextResponse.json({ ok: true });
}

/**
 * Approve a page from the drafting channel, and publish it.
 *
 * Matthew, 2026-09-22: "the approve button should basically approve the page/post we were about to
 * post, it should be a confirmation for after we check the page being compliant".
 *
 * ‼️ THIS PUBLISHES, AND pagePublishRequestAction ABOVE STILL DOES NOT. They are different things
 * and both are correct. That one answers "can this publish?" BEFORE the walk to the board and is
 * deliberately read-only. This one is the press itself, and it goes through publishPage(), which is
 * the single place the Day 0 wall, the quality gate and setPublished are sequenced. The objection
 * recorded on that function was that a second publisher would be "a second place to get the
 * ordering wrong"; there is still exactly one place, and this calls it.
 *
 * ‼️ IT IS A CONFIRMATION, NOT A BYPASS. publishPage re-runs both rails, so a page edited between
 * the check and this press is refused as stale rather than published on a verdict about text that
 * is no longer on it. The button cannot skip anything the board could not skip.
 *
 * ‼️ NO WAIVE BUTTON IS EVER OFFERED BESIDE APPROVE. The waiver is mentioned only here, in the
 * refusal, which is the Day 0 wall's own rule: offering it beside Publish makes it a second button,
 * which is the same as having no wall. It needs a written reason, so it is typed rather than pressed.
 */
async function pageApproveAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  // `${clientId}:${pageId}`. Both halves are uuids, so a plain split is safe.
  const [clientId, pageId] = args.value.split(":");
  if (!clientId || !pageId) return NextResponse.json({ ok: true });

  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { publishPage } = await import("@/lib/hub/publish-page");
      const res = await publishPage({ clientId, pageId, publish: true, by: actor });

      if (!res.ok) {
        const r = res.refusal;
        const extra =
          r.blockedBy === "quality_gate" && r.waivable
            ? "\n\nIf this is a refusal you mean to overrule, type `waive: <the reason>` in this thread. " +
              "The reason is recorded on the verdict and posted to the infra channel."
            : r.blockedBy === "quality_gate" && r.gateReason !== "blocked"
              ? "\n\nRun `check` again in this thread: the verdict no longer describes what is on the page."
              : "";
        await slack.postThreadReply(args.channel, args.slackTs, `:no_entry: Not published. ${r.error}${extra}`);
        return;
      }

      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        `:white_check_mark: Approved by ${actor} and published.` +
          (res.pageUrl ? `\n${res.pageUrl}` : "\n_No client domain is attached yet, so there is no live URL._")
      );
    })().catch((e) => console.error("[slack/actions] page_approve failed:", (e as Error).message))
  );

  return NextResponse.json({ ok: true });
}

/**
 * "Mark sent" on a client draft.
 *
 * The stamp is the only record that a message actually reached a client. Nothing here
 * sends anything: the free WhatsApp Business app has no API, so a human tapped the wa.me
 * link, sent it in WhatsApp, and is now telling Mission Control that they did.
 *
 * Replies ephemerally rather than editing the card. The draft body has to stay readable
 * afterwards, because the most common next question is "what exactly did I send them".
 */
async function clientMessageSentAction(args: {
  channel: string;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  const [clientId, draftKey] = args.value.split(":");
  if (!clientId || !draftKey) return NextResponse.json({ ok: true });

  waitUntil(
    markDraftSent(clientId, draftKey, args.userId)
      .then((res) =>
        slack.postEphemeral(
          args.channel,
          args.userId,
          res.alreadySent
            ? "That one was already marked sent."
            : res.ok
              ? "Marked sent."
              : "⚠️ Could not mark that sent. The draft row may have been cleared."
        )
      )
      .catch((e) => console.error("[slack/actions] client_msg_sent failed:", (e as Error).message))
  );

  return NextResponse.json({ ok: true });
}

/**
 * DNQ / Booked Call / Converted on a #hot-leads message.
 *
 * Slack kills the interaction at 3 seconds and every other handler here is
 * awaited before the 200, so the Supabase write plus the Meta CRM round-trip
 * goes in waitUntil. The message redraw happens inside applyLeadDisposition,
 * which is what the user actually sees confirm the click.
 */
async function leadDispositionAction(args: {
  actionId: string;
  channel: string;
  userId: string;
  contactId: string;
}): Promise<NextResponse> {
  const disposition = DISPOSITION_BY_ACTION_ID[args.actionId];
  if (!disposition || !args.contactId) return NextResponse.json({ ok: true });

  waitUntil(
    applyLeadDisposition({
      contactId: args.contactId,
      disposition,
      slackUserId: args.userId,
    })
      .then(async (result) => {
        if (!result.ok) {
          await slack.postEphemeral(
            args.channel,
            args.userId,
            `⚠️ Could not record that outcome: ${result.reason ?? "unknown"}`
          );
          return;
        }
        // Only surface the Meta half when it failed on a lead that should have
        // reported. Success is already visible in the redrawn message.
        if (!result.metaSent && result.reason !== "no_fb_lead_id") {
          await slack.postEphemeral(
            args.channel,
            args.userId,
            `Outcome saved, but Meta did not accept the conversion event: ${result.reason ?? "unknown"}`
          );
        }
      })
      .catch((err) =>
        console.error("[slack/actions] lead disposition failed:", err instanceof Error ? err.message : err)
      )
  );

  return NextResponse.json({ ok: true });
}

/**
 * The 🔍 Run audit and 🎥 Loom buttons on the lead card.
 *
 * Doorways to exactly the same functions the typed `run audit` and `loom` in the thread reach, so
 * the two surfaces cannot drift. Everything they say, they say IN THE LEAD'S THREAD, not as an
 * ephemeral: the answer to "what happened when I pressed that" belongs under the lead, where the
 * rest of the conversation is and where anyone else on the account can see it.
 *
 * ‼️ THE THREAD TS COMES OFF THE CONTACT ROW, NOT OFF THE CLICKED MESSAGE. They are the same value
 * today (the button lives on the top-level lead message, whose ts IS slack_thread_ts) but reading
 * the row keeps this correct if the buttons are ever added to a card further down the thread.
 */
async function leadWorkAction(args: {
  actionId: string;
  channel: string;
  userId: string;
  contactId: string;
}): Promise<NextResponse> {
  if (!args.contactId) return NextResponse.json({ ok: true });

  waitUntil(
    (async () => {
      const { runAuditForContact, proxyToAuditThread, LEAD_COLUMNS } = await import("@/lib/leads/lead-actions");
      const { supabaseAdmin } = await import("@/lib/db");
      const { data } = await supabaseAdmin
        .from("contacts")
        .select(LEAD_COLUMNS)
        .eq("id", args.contactId)
        .maybeSingle();

      const contact = data as LeadRow | null;
      if (!contact) {
        await slack.postEphemeral(args.channel, args.userId, "⚠️ That lead is not in the database any more.");
        return;
      }

      const threadTs = contact.slack_thread_ts;
      if (!threadTs) {
        await slack.postEphemeral(
          args.channel,
          args.userId,
          "⚠️ This lead has no Slack thread recorded, so I have nowhere to put the answer."
        );
        return;
      }

      const channel = contact.slack_channel || args.channel;
      const by = `<@${args.userId}>`;

      if (args.actionId === LEAD_RUN_AUDIT) {
        await runAuditForContact({ contact, channel, threadTs, by });
        return;
      }

      await proxyToAuditThread({ contact, channel, threadTs, text: "loom", label: "Loom", by });
    })().catch((err) =>
      console.error("[slack/actions] lead work button failed:", err instanceof Error ? err.message : err)
    )
  );

  return NextResponse.json({ ok: true });
}

async function approveAction(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { action, error } = await resolvePendingAction({
    slackTs: args.slackTs,
    status: "approved",
    approvedBy: args.userId,
  });

  if (error || !action) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not approve: ${error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  if (action.payload.requires_matthew && !isMatthew(args.userId)) {
    await supabaseAdmin.from("pending_slack_actions").update({ status: "pending", approved_by: null, resolved_at: null }).eq("id", action.id);
    await slack.postThreadReply(args.channel, args.slackTs, `🔒 This action requires Matthew's approval (over $50k or deal submission). <@${args.userId}>, your approval was reverted.`);
    return NextResponse.json({ ok: true });
  }

  const result = await executePendingAction({
    actionId: action.id,
    actionType: action.action_type,
    payload: action.payload,
    approvedBy: args.userId,
  });

  if (action.payload.was_approved_as_is !== false) {
    await supabaseAdmin.from("fine_tune_examples").insert({
      trigger_type: inferTriggerType(action.action_type),
      input_context: { slack_ts: args.slackTs, channel: args.channel },
      ai_draft: action.payload.body ?? JSON.stringify(action.payload).slice(0, 1000),
      human_correction: null,
      rep_id: args.userId,
      was_approved_as_is: true,
    });
  }

  // Dual-surface reconcile: an email approved here may also be sitting in
  // textwin.ai as a 'suggested' email_outbox bubble (shared draft_key). Cancel
  // the twin so it can't be re-sent from the desktop / extension.
  const draftKey = (action.payload as { draft_key?: string }).draft_key;
  if (result.ok && draftKey) {
    await supabaseAdmin
      .from("email_outbox")
      .update({ status: "cancelled" })
      .eq("draft_key", draftKey)
      .in("status", ["suggested", "pending"])
      .then(undefined, (e) => console.warn("[slack/actions] twin email_outbox cancel failed:", e?.message));
  }

  await supabaseAdmin
    .from("ai_decisions")
    .update({ was_approved: result.ok, approved_by: args.userId, slack_ts: args.slackTs })
    .match({ slack_ts: args.slackTs });

  await postExecutionReceipt({
    channel: args.channel,
    threadTs: args.slackTs,
    summary: result.ok
      ? `Executed by <@${args.userId}>. ${summarizeResult(action.action_type, result.details)}`
      : `Execution failed: ${result.error}`,
    success: result.ok,
  });

  return NextResponse.json({ ok: true });
}

async function cancelAction(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { action, error } = await resolvePendingAction({
    slackTs: args.slackTs,
    status: "cancelled",
    approvedBy: args.userId,
  });

  if (error) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not cancel: ${error}`);
    return NextResponse.json({ ok: true });
  }

  // If this was a sequence email draft, reset the enrollment so it retries in 3 days
  if (action?.action_type === "send_marketing_email" && action.payload.enrollment_id) {
    await handleMarketingEmailCancel(action.payload);
  }

  // A cancelled card must not leave a live draft sitting in Matthew's Drafts folder looking like
  // something still waiting to go out. deleteDraft re-checks isDraft against Graph first, so a
  // message he already sent by hand is never touched.
  if (action?.payload.outlook_draft_id) {
    const { microsoft } = await import("@/lib/microsoft");
    await microsoft
      .deleteDraft(action.payload.outlook_draft_id, action.payload.from_mailbox)
      .catch((e) => console.error("[reachinbox] cancel: draft not deleted:", (e as Error).message));
  }

  await slack.postThreadReply(args.channel, args.slackTs, `🚫 Cancelled by <@${args.userId}>. AI will not act on this.`);
  return NextResponse.json({ ok: true });
}

async function openEditModal(args: { slackTs: string; channel: string; userId: string; triggerId: string }): Promise<NextResponse> {
  if (!args.triggerId) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No trigger_id — cannot open edit modal.");
    return NextResponse.json({ ok: true });
  }

  const { data: existing } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, action_type, payload")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  if (!existing) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No pending action found for this message.");
    return NextResponse.json({ ok: true });
  }

  const payload = existing.payload as PendingActionPayload;
  const currentBody = payload.body ?? "";
  const currentSubject = payload.subject ?? "";

  const token = process.env.SLACK_BOT_TOKEN || "";
  const view = {
    type: "modal",
    callback_id: "ai_edit_submit",
    private_metadata: JSON.stringify({ slackTs: args.slackTs, channel: args.channel, pendingId: existing.id }),
    title: { type: "plain_text", text: "Edit AI draft" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "subject_block",
        label: { type: "plain_text", text: "Subject" },
        element: {
          type: "plain_text_input",
          action_id: "subject_input",
          initial_value: currentSubject,
        },
        optional: payload.action_type !== "send_email",
      },
      {
        type: "input",
        block_id: "body_block",
        label: { type: "plain_text", text: "Body" },
        element: {
          type: "plain_text_input",
          action_id: "body_input",
          initial_value: currentBody,
          multiline: true,
        },
      },
    ],
  };

  const res = await fetch(`${SLACK_API}/views.open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: args.triggerId, view }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not open edit modal: ${json.error}`);
  }
  return NextResponse.json({ ok: true });
}

async function handleViewSubmission(payload: SlackInteractivePayload): Promise<NextResponse> {
  if (payload.view?.callback_id === "imsg_remix_submit") {
    return handleRemixSubmit(payload);
  }
  if (payload.view?.callback_id === "review_link_submit") {
    return reviewLinkSubmit(payload);
  }
  if (payload.view?.callback_id === "ri_paste_submit") {
    return reachinboxPasteSubmit(payload);
  }
  if (payload.view?.callback_id !== "ai_edit_submit") {
    return NextResponse.json({ ok: true });
  }
  const metadata = JSON.parse(payload.view.private_metadata ?? "{}") as { slackTs?: string; channel?: string; pendingId?: string };
  if (!metadata.slackTs || !metadata.channel) return NextResponse.json({ ok: true });

  const values = payload.view.state.values;
  const editedSubject = values.subject_block?.subject_input?.value ?? "";
  const editedBody = values.body_block?.body_input?.value ?? "";
  const userId = payload.user.id;

  const { data: existing } = await supabaseAdmin
    .from("pending_slack_actions")
    .select("id, action_type, payload, merchant_id, zoho_id")
    .eq("slack_ts", metadata.slackTs)
    .maybeSingle();

  if (!existing) return NextResponse.json({ ok: true });

  const originalPayload = existing.payload as PendingActionPayload;
  const editedPayload: PendingActionPayload = {
    ...originalPayload,
    subject: editedSubject || originalPayload.subject,
    body: editedBody,
    was_approved_as_is: false,
  };

  const { action, error } = await resolvePendingAction({
    slackTs: metadata.slackTs,
    status: "edited",
    approvedBy: userId,
    editedPayload,
  });

  if (error || !action) {
    await slack.postThreadReply(metadata.channel, metadata.slackTs, `⚠️ Could not save edits: ${error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  if (action.payload.requires_matthew && !isMatthew(userId)) {
    await supabaseAdmin.from("pending_slack_actions").update({ status: "pending" }).eq("id", action.id);
    await slack.postThreadReply(metadata.channel, metadata.slackTs, `🔒 Matthew must approve (over $50k).`);
    return NextResponse.json({ ok: true });
  }

  await supabaseAdmin.from("fine_tune_examples").insert({
    trigger_type: inferTriggerType(action.action_type),
    input_context: { slack_ts: metadata.slackTs, channel: metadata.channel },
    ai_draft: originalPayload.body ?? JSON.stringify(originalPayload).slice(0, 1000),
    human_correction: editedBody,
    rep_id: userId,
    was_approved_as_is: false,
  });

  const result = await executePendingAction({
    actionId: action.id,
    actionType: action.action_type,
    payload: editedPayload,
    approvedBy: userId,
  });

  await postExecutionReceipt({
    channel: metadata.channel,
    threadTs: metadata.slackTs,
    summary: result.ok
      ? `✏️ Edited + executed by <@${userId}>. ${summarizeResult(action.action_type, result.details)}`
      : `Execution failed: ${result.error}`,
    success: result.ok,
  });

  return NextResponse.json({ response_action: "clear" });
}

// ── iMessage reply suggestions (🔄 Regenerate / 🎛 Remix) ───────────────────
// The live suggestion lives in sms_pending_drafts keyed by slack_ts. Regenerate
// re-runs the draft engine on the latest inbound message; Remix does the same
// with a free-text steer from a modal. Both update the card in place. There is
// no send — Matthew copies the reply into Messages on his Mac.

interface PendingSuggestion {
  conversation_id: string;
  slack_channel_id: string;
  regenerate_count: number | null;
}

async function loadSuggestion(slackTs: string): Promise<PendingSuggestion | null> {
  const { data } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, slack_channel_id, regenerate_count")
    .eq("slack_ts", slackTs)
    .maybeSingle();
  return (data as PendingSuggestion | null) ?? null;
}

async function getLastInbound(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sms_messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.body as string | undefined) ?? null;
}

async function applyNewDraft(
  channel: string,
  slackTs: string,
  draft: string,
  prevCount: number,
  followup?: SuggestedFollowup | null
): Promise<void> {
  const count = prevCount + 1;
  const fu = followup ?? null;
  await slack.updateMessage(channel, slackTs, `💬 Suggested reply: ${draft}`, buildSuggestionBlocks(draft, count, fu));
  // A new draft gets a fresh auto-send window (created_at reset too, so the
  // "lead replied again" guard compares against this regeneration). The follow-up
  // suggestion is refreshed to match the new draft (cleared when none).
  const armed = autoSendEnabled();
  const autoSendAt = armed
    ? new Date(Date.now() + autoSendMinutes() * 60 * 1000).toISOString()
    : null;
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({
      draft_body: draft,
      regenerate_count: count,
      created_at: new Date().toISOString(),
      auto_send_at: autoSendAt,
      auto_send_status: armed ? "pending" : "cancelled",
      suggested_followup_days: fu?.days ?? null,
      suggested_followup_reason: fu?.reason ?? null,
    })
    .eq("slack_ts", slackTs);
}

// ✋ Hold — cancel the auto-send timer for this draft and update the card.
// The suggestion stays available; it just won't fire on its own.
async function holdSuggestion(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("draft_body")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ auto_send_status: "cancelled" })
    .eq("slack_ts", args.slackTs);

  const body = (draftRow?.draft_body as string | undefined) ?? "";
  await slack.updateMessage(
    args.channel,
    args.slackTs,
    `✋ Auto-send held by <@${args.userId}>.${body ? `\n\`\`\`${body}\`\`\`` : ""}`
  );
  return NextResponse.json({ ok: true });
}

// ✋ Cancel — Matthew dismissed the "Send this?" confirm for a reply he typed into the
// channel. Drop the live draft and retire the card so nothing goes out.
async function cancelManualSend(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("draft_body")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  await supabaseAdmin.from("sms_pending_drafts").delete().eq("slack_ts", args.slackTs);

  const body = (draftRow?.draft_body as string | undefined) ?? "";
  await slack.updateMessage(
    args.channel,
    args.slackTs,
    `✋ Not sent — held by <@${args.userId}>.${body ? `\n\`\`\`${body}\`\`\`` : ""}`
  );
  return NextResponse.json({ ok: true });
}

// 📅 Follow-up — one-click schedule the proposed follow-up NOW (without sending the
// reply). Loads the pending draft for its conversation + suggested_followup_*,
// resolves the contact, schedules via the shared follow-up system, then clears the
// suggested_followup_* fields so the send path does NOT also auto-create it.
async function scheduleSuggestedFollowup(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, suggested_followup_days, suggested_followup_reason")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  const days = (draftRow?.suggested_followup_days as number | null) ?? null;
  const reason = (draftRow?.suggested_followup_reason as string | null) ?? null;
  if (!draftRow?.conversation_id || !days || !reason) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No suggested follow-up to schedule.");
    return NextResponse.json({ ok: true });
  }

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("contact_id")
    .eq("id", draftRow.conversation_id as string)
    .maybeSingle();

  if (!conv?.contact_id) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No contact on this conversation — cannot schedule a follow-up.");
    return NextResponse.json({ ok: true });
  }

  const res = await scheduleFollowup({
    contactId: conv.contact_id as string,
    reason,
    dueDate: `in ${days} days`,
    createCrmTask: true,
  });

  if (!res.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not schedule follow-up: ${res.error ?? "unknown"}`);
    return NextResponse.json({ ok: true });
  }

  // Clear the suggestion so the send path won't double-schedule it.
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ suggested_followup_days: null, suggested_followup_reason: null })
    .eq("slack_ts", args.slackTs);

  const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const when = due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  await slack.postThreadReply(args.channel, args.slackTs, `📅 Follow-up scheduled for ${when} by <@${args.userId}>: ${reason}`);
  return NextResponse.json({ ok: true });
}

async function regenerateSuggestion(args: { slackTs: string; channel: string }): Promise<NextResponse> {
  const s = await loadSuggestion(args.slackTs);
  if (!s) return NextResponse.json({ ok: true });
  const lastInbound = await getLastInbound(s.conversation_id);
  if (!lastInbound) return NextResponse.json({ ok: true });
  const { draft, suggestedFollowup } = await draftSmsReply(s.conversation_id, lastInbound);
  if (!draft) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Couldn't regenerate a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(args.channel, args.slackTs, draft, (s.regenerate_count ?? 0), suggestedFollowup);
  return NextResponse.json({ ok: true });
}

// ✅ Send — deliver the current suggested reply via the active transport.
// Gated by this explicit human click. With IMESSAGE_TRANSPORT='mac' (default) the
// reply is queued into sms_outbox and the Mac bridge delivers it (the bridge's
// is_from_me read loop then mirrors it into Slack + logs sms_messages, so we don't
// log here). With 'loopmessage' it sends immediately and dispatchOutbound logs the
// outbound. Either way the card is retired and the live suggestion cancelled.
async function sendSuggestion(args: { slackTs: string; channel: string; userId: string }): Promise<NextResponse> {
  await deliverPendingDraft(args);
  return NextResponse.json({ ok: true });
}

async function openRemixModal(args: { slackTs: string; channel: string; triggerId: string }): Promise<NextResponse> {
  if (!args.triggerId) return NextResponse.json({ ok: true });
  const token = process.env.SLACK_BOT_TOKEN || "";
  const view = {
    type: "modal",
    callback_id: "imsg_remix_submit",
    private_metadata: JSON.stringify({ slackTs: args.slackTs, channel: args.channel }),
    title: { type: "plain_text", text: "Remix reply" },
    submit: { type: "plain_text", text: "Regenerate" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "instr_block",
        label: { type: "plain_text", text: "How should I adjust it?" },
        element: {
          type: "plain_text_input",
          action_id: "instr_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "e.g. shorter · more urgent · answer their pricing question" },
        },
      },
    ],
  };
  const res = await fetch(`${SLACK_API}/views.open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: args.triggerId, view }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Could not open remix: ${json.error}`);
  }
  return NextResponse.json({ ok: true });
}

async function handleRemixSubmit(payload: SlackInteractivePayload): Promise<NextResponse> {
  const meta = JSON.parse(payload.view?.private_metadata ?? "{}") as { slackTs?: string; channel?: string };
  if (!meta.slackTs || !meta.channel) return NextResponse.json({ ok: true });
  const instruction = payload.view?.state.values.instr_block?.instr_input?.value ?? "";

  const s = await loadSuggestion(meta.slackTs);
  if (!s) return NextResponse.json({ ok: true });
  const lastInbound = await getLastInbound(s.conversation_id);
  if (!lastInbound) return NextResponse.json({ ok: true });

  const { draft, suggestedFollowup } = await draftSmsReply(s.conversation_id, lastInbound, instruction || undefined);
  if (!draft) {
    await slack.postThreadReply(meta.channel, meta.slackTs, "⚠️ Couldn't remix a reply.");
    return NextResponse.json({ ok: true });
  }
  await applyNewDraft(meta.channel, meta.slackTs, draft, (s.regenerate_count ?? 0), suggestedFollowup);
  return NextResponse.json({ response_action: "clear" });
}

async function createSmsChannelFromSlack(args: {
  slackTs: string;
  channel: string;
  userId: string;
  contactId: string;
}): Promise<NextResponse> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, phone, mobile_phone, business_name, zoho_lead_id")
    .eq("id", args.contactId)
    .maybeSingle();

  if (!contact) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ Contact not found.");
    return NextResponse.json({ ok: true });
  }

  const digits = (contact.phone || contact.mobile_phone || "").replace(/\D/g, "");
  if (!digits) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ No phone number on this contact.");
    return NextResponse.json({ ok: true });
  }
  const normalizedPhone = `+1${digits.slice(-10)}`;

  const { data: convo } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      { phone: normalizedPhone, contact_id: contact.id },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id, slack_channel_name")
    .maybeSingle();

  if (!convo) {
    await slack.postEphemeral(args.channel, args.userId, "⚠️ Could not create SMS conversation record.");
    return NextResponse.json({ ok: true });
  }

  const displayName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Lead";

  const result = await ensureSmsChannel({
    conversationId: convo.id,
    phone: normalizedPhone,
    displayName,
    contactId: contact.id,
    zohoLeadId: contact.zoho_lead_id ?? null,
    businessName: contact.business_name ?? null,
  });

  const msg = result.created
    ? `✅ SMS channel created: <#${result.channelId}>`
    : `ℹ️ SMS channel already exists: <#${result.channelId}>`;

  await slack.postEphemeral(args.channel, args.userId, msg);
  return NextResponse.json({ ok: true });
}

async function sequenceCancel(args: {
  channel: string; userId: string; slackTs: string; actionValue: string;
}): Promise<NextResponse> {
  let enrollmentId: string | undefined;
  try {
    enrollmentId = (JSON.parse(args.actionValue) as { enrollment_id?: string }).enrollment_id;
  } catch { /* ignore */ }

  if (!enrollmentId) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Could not parse enrollment ID.");
    return NextResponse.json({ ok: true });
  }

  const { data: enrollment } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ status: "stopped", stopped_at: new Date().toISOString(), stop_reason: "cancelled_by_slack" })
    .eq("id", enrollmentId)
    .select("contact_name, contact_id")
    .single();

  if (!enrollment) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Enrollment not found or already stopped.");
    return NextResponse.json({ ok: true });
  }

  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `🚫 Workflow cancelled for *${enrollment.contact_name ?? "Contact"}* by <@${args.userId}>. No more emails will be sent.`
  );
  return NextResponse.json({ ok: true });
}

/**
 * Send or hold the pitch drafted for a public free-audit lead.
 *
 * Send fires the Outlook draft as-is, so any edit made in Outlook first goes out
 * with it. Hold parks the row, which also cancels the auto-send timer if that
 * switch is ever turned on.
 */
/**
 * The post-call wrap card: 👍 writes the CRM note and creates the Outlook draft.
 *
 * ‼️ Slack gives an interaction 3 seconds. The CRM plus Graph plus a Slack post is 2 to 5, so the
 * row is CLAIMED synchronously (which is what makes a retry safe) and the actual work runs in
 * waitUntil. Same shape as leadDispositionAction.
 */
async function callWrapAction(args: {
  actionId: string; channel: string; slackTs: string; userId: string; sessionId: string;
}): Promise<NextResponse> {
  if (!args.sessionId) return NextResponse.json({ ok: true });

  if (args.actionId === "cc_wrap_discard") {
    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap_state: "discarded" })
      .eq("id", args.sessionId)
      .neq("wrap_state", "done");
    await slack.postThreadReply(args.channel, args.slackTs, `🚫 Discarded by <@${args.userId}>. Nothing was written to the CRM.`);
    return NextResponse.json({ ok: true });
  }

  if (args.actionId === "cc_wrap_attach") {
    // Deliberately a plain instruction rather than a modal: attaching is rare, and the record id
    // is already in the CRM tab next to him. A modal here would be more code than value.
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      "🔍 Paste the contact URL for this call in this thread and I'll attach it, then the buttons come back."
    );
    return NextResponse.json({ ok: true });
  }

  const { claimWrap, applyWrap } = await import("@/lib/call-coach/wrap-card");
  const claimed = await claimWrap(args.sessionId);

  if (!claimed) {
    await slack.postThreadReply(args.channel, args.slackTs, "Already handled, nothing was written twice.");
    return NextResponse.json({ ok: true });
  }

  waitUntil(
    applyWrap(claimed, `slack:${args.userId}`).catch(async (e) => {
      console.error("[slack/actions] wrap apply failed:", (e as Error).message);
      await supabaseAdmin
        .from("call_coach_sessions")
        .update({ wrap_state: "failed", wrap_error: (e as Error).message })
        .eq("id", args.sessionId);
      await slack
        .postThreadReply(args.channel, args.slackTs, `⚠️ Wrap failed: ${(e as Error).message}. The buttons are still live.`)
        .catch(() => {});
    })
  );

  return NextResponse.json({ ok: true });
}

async function auditPitchAction(args: {
  actionId: string; channel: string; slackTs: string; userId: string; reportId: string;
}): Promise<NextResponse> {
  if (!args.reportId) return NextResponse.json({ ok: true });

  const { sendAuditPitch } = await import("@/lib/audit-engine/lead-pitch");

  if (args.actionId === "audit_hold") {
    await supabaseAdmin
      .from("audit_reports")
      .update({ auto_send_state: "held", auto_send_at: null })
      .eq("id", args.reportId)
      .neq("auto_send_state", "sent");
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      `✋ Held by <@${args.userId}>. The draft is still in your Outlook, nothing will send itself.`
    );
    return NextResponse.json({ ok: true });
  }

  const res = await sendAuditPitch(args.reportId, `slack:${args.userId}`);
  const message =
    res.outcome === "sent"
      ? `🚀 Sent by <@${args.userId}>. Enrolled in the follow-up ladder, next touch tomorrow.`
      : res.outcome === "already_sent"
        ? "✅ Already sent, nothing to do."
        : res.outcome === "held"
          ? "✋ This one is on hold. Un-hold it in Outlook and send from there."
          : res.outcome === "no_draft"
            ? "⚠️ No Outlook draft on this report, so there is nothing to send."
            : `⚠️ Send failed: ${res.detail ?? "unknown error"}`;

  await slack.postThreadReply(args.channel, args.slackTs, message);
  return NextResponse.json({ ok: true });
}

/**
 * Follow-Up Operator: vouch for (or dismiss) an address the Outlook sweep found
 * with no audit behind it. Tracking is what makes a row schedulable — until
 * this fires, an unconfirmed prospect is never drafted for and never due.
 */
/**
 * Import data from duplicate / Keep it fresh, on the duplicate onboarding card (src/lib/clients/duplicate-card.ts).
 *
 * ‼️ ANSWERED IN THE CARD'S THREAD, AND THE IMPORT RUNS AFTER THE ACK. An import is a few dozen writes and
 * Slack gives three seconds, so the press is acknowledged at once and the result is posted when it is done.
 * Pressing it twice is safe: an archive is claimed before it is imported and refuses every import after that.
 */
async function duplicateImportAction(args: {
  actionId: string; channel: string; slackTs: string; userId: string; value: string;
}): Promise<NextResponse> {
  const { readImportValue } = await import("@/lib/clients/duplicate-card");
  const target = readImportValue(args.value);
  if (!target) return NextResponse.json({ ok: true });

  if (args.actionId === "client_import_fresh") {
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      `:seedling: <@${args.userId}> kept this onboarding fresh. The archive stays where it is and can still be imported.`
    );
    return NextResponse.json({ ok: true });
  }

  waitUntil(
    (async () => {
      const { importFromArchive } = await import("@/lib/clients/archive");
      const res = await importFromArchive({ archiveId: target.archiveId, clientId: target.clientId, by: `<@${args.userId}>` }).catch(
        (e) => ({ ok: false as const, error: (e as Error).message })
      );
      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        res.ok
          ? [`:recycle: <@${args.userId}> imported the archived data into this onboarding:`, ...res.lines.map((l) => `  • ${l}`)].join("\n")
          : `:warning: The import did not run: ${res.error}`
      );
    })()
  );
  return NextResponse.json({ ok: true });
}

async function followupTrackAction(args: {
  actionId: string; channel: string; slackTs: string; prospectId: string;
}): Promise<NextResponse> {
  if (!args.prospectId) return NextResponse.json({ ok: true });

  const { updateProspect, getProspectById } = await import("@/lib/followup-operator/prospects");
  const { nextTouchAt, snapTo9amET } = await import("@/lib/followup-operator/cadence");

  const p = await getProspectById(args.prospectId);
  if (!p) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ That prospect is no longer in the pipeline.");
    return NextResponse.json({ ok: true });
  }

  if (args.actionId === "fo_ignore") {
    await updateProspect(p.id, { paused: true });
    await slack.postThreadReply(args.channel, args.slackTs, `✖ Ignored. *${p.email}* stays out of the board.`);
    return NextResponse.json({ ok: true });
  }

  // ‼️ CONFIRMING SOMEBODY WITH NO LOOM WOULD SEND THEM STRAIGHT INTO A HOLE. (2026-09-03)
  //
  // The follow-ups board carries one kind of person now: somebody who has had the walkthrough.
  // The digest enforces that by pausing any due row it cannot prove has a Loom, and that check
  // fails closed. So a tap here on a prospect with no Loom would mark them tracked, schedule
  // them, and then have them silently disappear on the next run, with nothing but a console line
  // to say why. Refusing out loud is the only honest answer.
  //
  // This matters most for ReachInbox campaign replies. They are the only rows that reach the
  // unconfirmed section now that the Outlook sweep no longer enrols, and they belong to the
  // campaign digest, which is a different card with a different job.
  const { hasLoom } = await import("@/lib/followup-operator/loom-enrol");
  if (!(await hasLoom(p))) {
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      `:no_entry: Not tracking *${p.email}*: no Loom on record for them.\n` +
        "The follow-ups board only carries people who have had the walkthrough, so tracking them " +
        "here would schedule them and then drop them silently on the next run.\n" +
        (p.source === "reachinbox"
          ? "This is a campaign reply. Work it from the campaign card, or record a Loom for them " +
            "and the ladder starts itself."
          : "Record a Loom for them and the D+3 nudge and D+7 call schedule themselves.")
    );
    return NextResponse.json({ ok: true });
  }

  // Start the ladder from the pitch that was actually sent, not from now.
  const anchor = p.first_sent_at ? new Date(p.first_sent_at) : new Date();
  const due = nextTouchAt(p.step, anchor) ?? snapTo9amET(new Date(Date.now() + 24 * 60 * 60 * 1000));
  await updateProspect(p.id, { confirmed: true, next_touch_at: due.toISOString() });

  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `✅ Tracking *${p.email}*. Next touch ${due.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" })}.`
  );
  return NextResponse.json({ ok: true });
}

async function sequenceUpdateCategory(args: {
  channel: string; userId: string; slackTs: string; actionValue: string;
}): Promise<NextResponse> {
  let enrollmentId: string | undefined;
  let category: string | undefined;
  try {
    const parsed = JSON.parse(args.actionValue) as { enrollment_id?: string; category?: string };
    enrollmentId = parsed.enrollment_id;
    category = parsed.category;
  } catch { /* ignore */ }

  if (!enrollmentId || !category) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Could not parse action data.");
    return NextResponse.json({ ok: true });
  }

  const { data: enrollment } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ category })
    .eq("id", enrollmentId)
    .eq("status", "active")
    .select("contact_name")
    .single();

  if (!enrollment) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Enrollment not found or not active.");
    return NextResponse.json({ ok: true });
  }

  const label = isSequenceCategory(category) ? CATEGORY_LABELS[category] : category.toUpperCase();
  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    `✅ Category updated to ${label} for *${enrollment.contact_name ?? "Contact"}* by <@${args.userId}>.`
  );
  return NextResponse.json({ ok: true });
}

// ── iMessage bridge control buttons (🔄 Restart / 🩺 Doctor / ♻️ Resync / 📡 Status) ──
// Restart/Doctor/Resync queue a command the Mac bridge drains on its next ~10s
// outbox poll. Status reads the heartbeat server-side (works even if the Mac is down).
async function bridgeCommandAction(args: { actionId: string; channel: string; slackTs: string; userId: string }): Promise<NextResponse> {
  const type = args.actionId.replace("bridge_", "") as BridgeCommandType;
  const res = await enqueueBridgeCommand(type, args.userId);
  const msg = res.ok
    ? `🛰️ <@${args.userId}> queued *${type}* — bridge will pick it up within ~10s.`
    : `⚠️ Could not queue *${type}*: ${res.error}`;
  await slack.postThreadReply(args.channel, args.slackTs, msg);
  return NextResponse.json({ ok: true });
}

async function bridgeStatusAction(args: { channel: string; slackTs: string }): Promise<NextResponse> {
  const s = await getBridgeStatus();
  await slack.postThreadReply(args.channel, args.slackTs, formatBridgeStatusLine(s));
  return NextResponse.json({ ok: true });
}

function isMatthew(slackUserId: string): boolean {
  const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";
  return matthewId !== "" && slackUserId === matthewId;
}

function inferTriggerType(actionType: string): string {
  // "reply_funder" / "submit_deal" went with the funding business; anything
  // still arriving with those types is a stale card and lands in the default.
  return "lead_state";
}

function summarizeResult(actionType: string, details?: Record<string, unknown>): string {
  if (!details) return "";
  if (actionType === "send_email") {
    return `Sent to ${details.to ?? "unknown"}.`;
  }
  if (actionType === "update_zoho") {
    return `Zoho updated (stage → ${details.stage ?? "n/a"}).`;
  }
  if (actionType === "apply_followup") {
    const did = Array.isArray(details.did) ? (details.did as string[]) : [];
    return did.length ? `Done:\n${did.map((d) => `• ${d}`).join("\n")}` : "Nothing to do.";
  }
  return "";
}


/**
 * [Done] [Skip — not applicable] [I hit a problem] on one delivery step.
 *
 * Runner v3 §2 and §3. Three rules that this function exists to keep:
 *
 *  1. NEVER AUTO-ADVANCE PAST A HUMAN. Only the button completes a manual step. Files
 *     landing in the thread file evidence; they do not tick anything.
 *  2. [Done] ON AN UPLOAD STEP VALIDATES THE COUNT, NAMES WHAT IS MISSING, AND STAYS OPEN.
 *     It does not quietly accept four screenshots where eighteen were asked for, because
 *     the gap only surfaces later, when the findings doc is being assembled and the
 *     evidence is not there.
 *  3. A SKIP CARRIES A REASON. §17: a skipped platform "renders as 'not checked' in every
 *     artifact, never as 'no issues found.'" A reason-less skip is how the second thing
 *     happens.
 */
async function deliveryStepAction(args: {
  actionId: string;
  channel: string;
  messageTs: string;
  userId: string;
  userName: string | null;
  value: string;
}): Promise<NextResponse> {
  const [clientId, rawStepKey] = args.value.split(":");
  if (!clientId || !rawStepKey) return NextResponse.json({ ok: true });
  // ‼️ NORMALISED BEFORE ANYTHING READS OR WRITES IT. A card posted before the 2026-09-19
  // rename still carries `review_tool_preview` in its value, and setDeliveryStep below would
  // otherwise write that retired key straight back into a table the migration has moved.
  const { currentStepKey } = await import("@/config/delivery-steps");
  const stepKey = currentStepKey(rawStepKey);

  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { setDeliveryStep, stepByKey } = await import("@/lib/clients/delivery-checklist");
      // No postReadySteps here any more: setDeliveryStep runs the whole cascade for both
      // outcomes now, and calling it again from this side would double-post the next card.
      const { stepPrecondition } = await import("@/lib/clients/step-engine");
      const step = stepByKey(stepKey);
      if (!step) return;

      // ‼️ A STALE CARD IS DIAGNOSED HERE, BEFORE ANY HANDLER, BECAUSE NEITHER HANDLER CAN TELL
      // THE DIFFERENCE BETWEEN WORK OWED AND A DEAD ID.
      //
      // A Slack button freezes `${clientId}:${stepKey}` into its value at post time, so a client
      // that gets re-onboarded leaves every earlier card pointing at an id that no longer exists.
      // `client_delivery_steps.client_id` cascades on delete, so that id has no step rows either,
      // and both handlers then answer with something true and useless: [Done] hits the verifier's
      // "no clients row with id ..." precondition, [Skip] matches zero rows and reports "no
      // <step> row exists for this client". Neither names the cause.
      //
      // It happened to SRT Agency LLC. An August card for `gbp_buildout` refused both buttons
      // while that step's row sat pending under a different id, so the step looked unskippable
      // when the card was merely orphaned. Nothing is written on this path: it diagnoses and
      // re-posts, it never rescues the old card.
      const stale = await staleCardSuccessor(clientId, args);
      if (stale) {
        await tellActorEphemeral(args, stale.message);
        return;
      }

      // ── Done, and Re-check, which is Done without the write ─────────────
      if (args.actionId === "step_done" || args.actionId === "step_recheck") {
        // Stays open, on purpose. This is the one place the engine argues back, and the list
        // of what it argues about lives in step-engine rather than here so the board and any
        // future caller get the same refusals. See stepPrecondition().
        const gate = await stepPrecondition(clientId, stepKey);
        if (!gate.ok) {
          await tellActor(args, clientId, gate.message ?? "Not yet.");

          // ‼️ A REFUSAL IS THE ONE MOMENT THE CARD IS KNOWN TO BE OUT OF DATE, SO RE-RENDER IT.
          //
          // Until now NOTHING in production re-ran a card body. postStep is called only by
          // scripts, postReadySteps skips any step that already has a slack_message_ts, and the
          // three buttons either answer ephemerally (here) or REPLACE the card with a one-line
          // outcome. So a card rendered wrong stayed wrong, and the standing advice to "press a
          // button and let production re-render it" was describing behaviour that did not exist.
          // It cost SRT Agency's hub_preview card a preview link: rendered from a shell with no
          // CLIENT_LINK_SECRET, it read "no shareable link could be minted" for a day, which is
          // a true sentence about the wrong environment sitting in a card about production.
          //
          // ‼️ AND IT WRITES NOTHING. postStep edits the existing slack_message_ts rather than
          // re-posting, so the anchor keeps its position (Slack orders by post time and a
          // delete-and-repost moves a step to the bottom permanently). Its trailing status
          // update is gated `.in("status", ["pending","blocked","ready","error"])` and a card
          // that exists sits at awaiting_me, so that statement matches no row. It also
          // early-returns on complete/skipped, so it cannot resurrect a resolved step.
          //
          // The refusal goes first and the render is caught, because the person pressed the
          // button to be told why it will not go through. A render fault must not swallow that.
          const { postStep } = await import("@/lib/clients/step-engine");
          await postStep(clientId, stepKey).catch((e: Error) =>
            console.error(`[slack/actions] card re-render failed for ${stepKey}:`, e.message)
          );
          return;
        }

        const done = await setDeliveryStep({ clientId, stepKey, transition: "complete", actor });

        // ‼️ THE CARD IS NOT REWRITTEN WHEN THE WRITE FAILED, and it used to be.
        // setDeliveryStep has always returned { ok:false, error } on a failed row write or a
        // failed Day-0 stamp, and this line discarded it and ticked the card green regardless.
        // That is the inverse of "Done does nothing" and it is the worse of the two: a step
        // that SAYS it is complete, over a row that never changed.
        if (!done.ok) {
          // ‼️ A REFUSED CONFIRMATION IS NOT A CRASH AND MUST NOT READ LIKE ONE.
          //
          // setDeliveryStep now verifies before it writes, so { ok: false } has two very
          // different causes. A verdict means BrainHeart looked and could not confirm the
          // work: that belongs in the step's thread as a durable record of what was checked,
          // with a [Re-check] button and, when the fault is ours, the fix to paste into
          // Claude Code. Anything else is a genuine write failure and keeps the old notice.
          //
          // There is deliberately no "mark done anyway" button here. A step that cannot be
          // confirmed does not get ticked, and `verified_source` has no value that would let
          // one be recorded.
          if (done.verdict && !done.verdict.ok) {
            const { refusalText } = await import("@/lib/clients/step-verify");
            const { notifyStep } = await import("@/lib/clients/step-board");
            const posted = await notifyStep(
              clientId,
              stepKey,
              refusalText(step.label, done.verdict),
              recheckBlocks(clientId, stepKey, done.verdict)
            );
            // Ephemeral only as a backstop: if the thread post failed, the person who pressed
            // the button would otherwise see nothing at all happen.
            if (!posted.ok) await tellActor(args, clientId, done.error ?? "Not confirmed.");
            return;
          }
          await stepFailureNotice(args, clientId, step.label, done.error ?? "the row could not be written");
          return;
        }

        // ‼️ A CARD THAT COMPLETES AND OFFERS NOTHING IS THE BUG BEING FIXED. This was one
        // line and a full stop, on the single most-pressed button on the board. The footer is
        // derived from DELIVERY_STEPS rather than typed, so it cannot name a step number that
        // has moved. asDone, because what comes next is computed as though this step is done,
        // which at this point it is.
        const doneNext = await nextStepFooter(clientId, stepKey, { asDone: true });
        await resolveStepCard(
          args.channel,
          clientId,
          stepKey,
          `:white_check_mark: *${step.label}* — done by ${actor}.${doneNext}`
        );
        return;
      }

      // ── Skip ────────────────────────────────────────────────────────────
      //
      // ‼️ THIS GOES THROUGH setDeliveryStep, and it used to write the row itself.
      // Doing it directly meant a skip got `postReadySteps` and nothing else — no
      // `refreshStages`, no checklist re-render, and no `runReadyAutoSteps`. Since both
      // schedulers count a skipped row as done, the step released its blockers on paper
      // while the generators behind them were never asked to run. Skipping the manual
      // presence sweep left the presence PDF, and everything downstream of it, parked.
      if (args.actionId === "step_skip") {
        const skip = await setDeliveryStep({
          clientId,
          stepKey,
          transition: "skipped",
          skippedReason: `Marked not applicable by ${actor}`,
          actor,
        });

        if (!skip.ok) {
          await stepFailureNotice(args, clientId, step.label, skip.error ?? "the row could not be written");
          return;
        }

        // A skip advances the board exactly as a completion does, so it owes the same footer.
        const skipNext = await nextStepFooter(clientId, stepKey, { asDone: true });
        await resolveStepCard(
          args.channel,
          clientId,
          stepKey,
          `:heavy_minus_sign: *${step.label}* — skipped by ${actor}. ` +
            `It renders as "not checked" everywhere, never as "no issues found". ` +
            `Reply here with why, so the artifact can say it.${skipNext}`
        );
        return;
      }

      // ── I hit a problem ─────────────────────────────────────────────────
      const { data: flagged, error: flagError } = await supabaseAdmin
        .from("client_delivery_steps")
        .update({
          status: "error",
          error_detail: `Flagged by ${actor} from Slack`,
          updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId)
        .eq("step_key", stepKey)
        .select("id");

      // Same zero-rows-is-not-an-error trap as setDeliveryStep. Flagging a problem against a
      // step that has no row is the one moment where being told so matters most.
      if (flagError || !flagged?.length) {
        await stepFailureNotice(
          args,
          clientId,
          step.label,
          flagError?.message ?? "there is no row for this step on this client"
        );
        return;
      }

      await resolveStepCard(
        args.channel,
        clientId,
        stepKey,
        `:warning: *${step.label}* — ${actor} hit a problem. Say what happened in this thread. ` +
          `It is now in the #alerts-infra digest and it will not advance on its own.` +
          // NOT asDone: a flagged step blocks whatever was waiting on it, so naming the step it
          // unblocks would be pointing at work that is now further away, not closer.
          (await nextStepFooter(clientId, stepKey, {
            own: ["  • Re-open it with the buttons on the card once the problem is fixed."],
          }))
      );
    })().catch(async (e) => {
      // ‼️ THIS IIFE HAD NO CATCH, unlike every neighbouring handler in this file.
      // Anything that threw inside it — a missing table, a Supabase timeout, a dynamic import
      // failing on a cold module graph — killed the rest of the function silently, INCLUDING
      // resolveStepCard. The card kept its three buttons, Slack said nothing, and the only
      // trace was a Vercel log nobody was watching. That is the shape of "I hit Done and
      // nothing happens".
      const reason = (e as Error).message;
      console.error(`[slack/actions] ${args.actionId} on ${stepKey} failed:`, reason);
      const { stepByKey: byKey } = await import("@/lib/clients/delivery-checklist");
      await stepFailureNotice(args, clientId, byKey(stepKey)?.label ?? stepKey, reason).catch(() => {});
    })
  );

  return NextResponse.json({ ok: true });
}

/**
 * The refusal card's one button.
 *
 * ONE button, and the omission is the design. [Re-check] re-runs the same confirmation, which
 * is the only honest way forward when the answer was "not yet": either the work has since
 * happened or it has not. There is no second button that ticks the step anyway, because that
 * is precisely the behaviour this whole pass exists to remove.
 *
 * A `broken` verdict gets no button at all. Re-checking a code fault produces the same fault,
 * and offering the button would invite somebody to press it ten times instead of reading the
 * fix directly underneath it.
 */
function recheckBlocks(
  clientId: string,
  stepKey: string,
  verdict: { kind: string }
): SlackBlock[] | undefined {
  if (verdict.kind !== "not_yet") return undefined;
  return [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "step_recheck",
          text: { type: "plain_text", text: "Re-check" },
          value: `${clientId}:${stepKey}`,
        },
      ],
    },
  ];
}


/**
 * Draft the agreement email, or mint the signing link.
 *
 * ‼️ THE ANSWER IS EPHEMERAL AND THE SIDE EFFECT IS NOT. A signing link is a bearer credential:
 * anybody who can read it can sign as that client. Posting it into the ops thread would put it in
 * a log several people read and Slack keeps forever, so it goes back only to the person who
 * pressed the button, and they paste it where it belongs.
 *
 * ‼️ EVERY FAILURE IS SAID OUT LOUD RATHER THAN SWALLOWED. The whole value of this button is that
 * it is pressed mid-call, so a silent failure is Matthew reading out a URL that does not exist.
 */
async function sendAgreementAction(args: {
  actionId: string;
  channel: string;
  messageTs: string;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  // Same `clientId:stepKey` value shape the step buttons use, so the card builds them the same way.
  const clientId = (args.value || "").split(":")[0];
  if (!clientId) {
    await tellActor(args, clientId, "That button carried no client id.");
    return NextResponse.json({ ok: true });
  }

  const { draftAgreementEmail, mintSigningLink } = await import("@/lib/clients/send-agreement");

  if (args.actionId === "agreement_draft") {
    const res = await draftAgreementEmail(clientId);
    await tellActor(
      args,
      clientId,
      res.ok
        ? `Draft created in your Outlook. ${res.webLink ? `<${res.webLink}|Open it>` : "Check your Drafts folder."} It has the unsigned PDF attached and the signing link in the body. Nothing has sent.`
        : `Could not draft it: ${res.error ?? "unknown error"}`
    );
    return NextResponse.json({ ok: true });
  }

  const res = await mintSigningLink(clientId);
  await tellActor(
    args,
    clientId,
    res.ok && res.url
      ? `Signing link for this client, ${res.templateVersion}:

${res.url}

Only you can see this message. Paste it to them. When they sign, this step ticks itself.`
      : `Could not create a link: ${res.error ?? "unknown error"}`
  );
  return NextResponse.json({ ok: true });
}

/**
 * Did that Slack call actually work?
 *
 * ‼️ slackFetch NEVER THROWS. Slack answers HTTP 200 for everything and puts real failures in
 * `ok: false`, so every `.catch(() => {})` around a Slack call in this handler was catching
 * nothing whatsoever: a `message_not_found`, a `cant_update_message`, a bot that is not in the
 * channel, or a missing scope all resolved as success and the caller carried on as though the
 * message had landed. Check the body, never the promise.
 */
function slackOk(res: Record<string, unknown> | null | undefined): boolean {
  return Boolean(res && res.ok === true);
}

/**
 * Say something to the person who pressed the button, wherever it can be said.
 *
 * Ephemeral first, because a refusal is about their click and does not belong in the log
 * everybody reads. The ops thread is the fallback rather than the default for the opposite
 * reason: saying it too loudly beats saying nothing, and saying nothing is what happened.
 */
async function tellActor(
  args: { channel: string; messageTs: string; userId: string },
  clientId: string,
  text: string
): Promise<void> {
  const res = await slack
    .postEphemeral(args.channel, args.userId, text, args.messageTs)
    .catch(() => null);
  if (slackOk(res)) return;

  const { notifyThread } = await import("@/lib/clients/delivery-checklist");
  await notifyThread(clientId, text).catch(() =>
    console.error("[slack/actions] could not reach the actor or the ops thread:", text)
  );
}

/**
 * Re-run the earlier step that writes what the step being looked at is missing.
 *
 * The block a re-run posts names that step and prints `rerun N`; this is the same move as a button,
 * for the reason every other button on this board exists: the command is one line away and the
 * button is the line nobody has to retype.
 *
 * ‼️ D7 IS NOT WEAKENED BY IT. Nothing here fires on its own. The gap block PROPOSES, this runs only
 * on a press, and `fresh: true` is deliberate: the press comes from a DIFFERENT step's thread, so the
 * upstream step gets a new card at the bottom of the channel, which is exactly `rerun step N`'s own
 * semantics. Re-using its anchor would re-run a step twenty messages up where nobody is looking.
 *
 * ‼️ staleCardSuccessor FIRST, LIKE EVERY OTHER STEP BUTTON. A button freezes `${clientId}:${stepKey}`
 * at post time and a re-onboard mints a new id under the same slug, so an old block would otherwise
 * re-run a step on a dead tenant and report something true and useless about a missing row.
 */
async function rerunUpstreamAction(args: {
  channel: string;
  messageTs: string;
  userId: string;
  userName: string | null;
  value: string;
}): Promise<NextResponse> {
  const [clientId, stepKey] = args.value.split(":");
  if (!clientId || !stepKey) return NextResponse.json({ ok: true });

  const by = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { isStepKey } = await import("@/config/delivery-steps");
      if (!isStepKey(stepKey)) return;

      const stale = await staleCardSuccessor(clientId, args);
      if (stale) {
        await tellActorEphemeral(args, stale.message);
        return;
      }

      const { rerunStep } = await import("@/lib/clients/step-rerun");
      const res = await rerunStep({ clientId, stepKey, fresh: true, by }).catch((e) => ({
        ok: false,
        line: `${stepKey}: threw (${(e as Error).message}).`,
      }));
      await tellActorEphemeral(args, `:repeat: ${res.line}`);
    })()
  );

  return NextResponse.json({ ok: true });
}

/**
 * Is this card pointing at a client that no longer exists, and if so, which client replaced it?
 *
 * Returns null on the happy path, which is every press on a live client, at the cost of one
 * primary-key lookup. When the row is gone it re-posts the step against the successor and returns
 * the sentence to show the person who pressed.
 *
 * ‼️ THE SUCCESSOR IS READ OFF THE CARD'S OWN TEXT, NOT GUESSED. The dead id cascaded its rows
 * away, so nothing in the database still remembers which business it was; the only surviving
 * record of that is the name Slack already rendered onto the message. Every live client's legal
 * name, DBA and slug is matched against the pressed message, and a re-post happens only when
 * EXACTLY ONE matches. Two matches, or none, reports the candidates and writes nothing, because
 * re-anchoring one clinic's step onto another clinic's board is a worse failure than the one
 * being fixed here.
 */
async function staleCardSuccessor(
  clientId: string,
  args: { channel: string; messageTs: string; userId: string; value: string }
): Promise<{ message: string } | null> {
  const { data: alive } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (alive) return null;

  const { currentStepKey } = await import("@/config/delivery-steps");
  const stepKey = currentStepKey(args.value.split(":")[1] ?? "");
  const { stepByKey } = await import("@/lib/clients/delivery-checklist");
  const label = stepByKey(stepKey)?.label ?? stepKey;

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name")
    .neq("id", clientId);

  const roster = clients ?? [];
  const head =
    `:warning: *This card is stale, and that is why ${label} would not budge.*\n` +
    `It was posted against client \`${clientId}\`, which is not a row in \`clients\` any ` +
    `more, so both buttons on it have nothing to write to. The step itself is fine.\n`;

  // The card as Slack holds it. Blocks carry the client name too, so the whole payload is read.
  const msg = await slack.getMessage(args.channel, args.messageTs).catch(() => null);
  const haystack = (msg ? JSON.stringify(msg) : "").toLowerCase();

  const matches = roster.filter((c) => {
    const names = [c.legal_name, c.dba_name, c.slug].filter(
      (n): n is string => typeof n === "string" && n.trim().length > 2
    );
    return names.some((n) => haystack.includes(n.toLowerCase()));
  });

  if (matches.length !== 1) {
    const list = roster.length
      ? roster
          .map((c) => `  • ${c.legal_name ?? c.slug} \`${c.slug}\` / \`${c.id}\``)
          .join("\n")
      : "  (no other client rows exist)";
    return {
      message:
        head +
        (matches.length > 1
          ? `More than one live client is named on this card, so nothing was re-posted.\n`
          : `This card does not name a live client, so nothing was re-posted.\n`) +
        `Live clients:\n${list}\n` +
        `Work the step from that client's own board, or re-anchor it with ` +
        `\`scripts/_reanchor-board.ts <clientId>\`.`,
    };
  }

  const live = matches[0];
  const { postStepAnchor } = await import("@/lib/clients/step-board");
  const { postStep } = await import("@/lib/clients/step-engine");
  const anchored = await postStepAnchor(live.id, stepKey);
  if (anchored.ok) await postStep(live.id, stepKey).catch(() => undefined);

  return {
    message:
      head +
      `The live record for this business is *${live.legal_name ?? live.slug}* ` +
      `(\`${live.slug}\` / \`${live.id}\`).\n` +
      (anchored.ok
        ? `A fresh card for this step is now on that board. Use that one, this card is dead.`
        : `A fresh card could not be posted (${anchored.error ?? "unknown"}). Re-anchor with ` +
          `\`scripts/_reanchor-board.ts <clientId>\`.`),
  };
}

/**
 * Say something to the person who pressed, without touching the ops thread.
 *
 * ‼️ NOT tellActor(). That one falls back to notifyThread(clientId), which needs a live client
 * row, so on a stale card the fallback would fail on its way to explaining that the client does
 * not exist. Ephemeral or a console line.
 */
async function tellActorEphemeral(
  args: { channel: string; messageTs: string; userId: string },
  text: string
): Promise<void> {
  const res = await slack
    .postEphemeral(args.channel, args.userId, text, args.messageTs)
    .catch(() => null);
  if (!slackOk(res)) console.error("[slack/actions] could not reach the actor:", text);
}

/** A button that did not do what it said. Names the step, the reason, and what is still true. */
async function stepFailureNotice(
  args: { channel: string; messageTs: string; userId: string },
  clientId: string,
  stepLabel: string,
  reason: string
): Promise<void> {
  await tellActor(
    args,
    clientId,
    `:warning: *${stepLabel}* did not go through: ${reason}\n` +
      `The step is unchanged and the buttons are still live, so nothing is half-done. ` +
      `Try it again, and if it repeats say so in this thread.`
  );
}

/**
 * Replace the step's card with its outcome, in place.
 *
 * The buttons have to go: a resolved step still offering [Done] is an invitation to
 * double-click it, and the thread underneath stays as the log of what happened.
 */
async function resolveStepCard(
  channel: string,
  clientId: string,
  stepKey: string,
  text: string
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_message_ts")
    .eq("client_id", clientId)
    .eq("step_key", stepKey)
    .maybeSingle();

  const ts = (data?.slack_message_ts as string | null) ?? null;

  // ‼️ BOTH FAILURE PATHS NOW FALL BACK TO A THREAD REPLY, and that is the point of this
  // function. A null ts used to `return` outright, and a failed chat.update was swallowed by a
  // `.catch(() => {})` that never fired — see slackOk above. Between them a step could be
  // genuinely complete while its card kept all three buttons and nothing anywhere said so.
  if (ts) {
    const res = await slack
      .updateMessage(channel, ts, text, [{ type: "section", text: { type: "mrkdwn", text } }])
      .catch(() => null);
    if (slackOk(res)) return;
  }

  const { notifyThread } = await import("@/lib/clients/delivery-checklist");
  await notifyThread(clientId, text).catch((e) =>
    console.error("[slack/actions] could not resolve the card or reach the ops thread:", (e as Error).message)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LANE 1 — the two confirm buttons
//
// ‼️ THESE ARE THE HUMAN HALF OF "THE TOOL PROPOSES, A PERSON CONFIRMS", AND THEY ARE THE ONLY
// WRITERS OF THE COLUMNS THEY WRITE. A model read a number off a picture and put it in a
// `proposed` slot; nothing downstream reads that slot. One tap moves the whole batch into the
// real columns and records who did it, which is what makes the tick mean something.
//
// One tap for a batch rather than one per row is deliberate. The alternative to a batch confirm
// is not a more careful review, it is the eighteen-row form nobody fills in, which is the state
// this whole lane exists to get out of.
// ─────────────────────────────────────────────────────────────────────────────

async function reviewConfirmReadingsAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  clientId: string;
}): Promise<NextResponse> {
  if (!args.clientId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { applyProposedReadings, loadReviewAudit, formatReviewGrid } = await import(
        "@/lib/clients/review-audit"
      );

      const result = await applyProposedReadings({ clientId: args.clientId, by: actor });

      if (!result.ok) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          `:warning: Nothing was confirmed: ${result.error}. The proposals are still there.`
        );
        return;
      }

      const lines = [
        result.confirmed > 0
          ? `:white_check_mark: ${result.confirmed} reading${result.confirmed === 1 ? "" : "s"} confirmed by ${actor} and written to the grid.`
          : ":information_source: There was nothing outstanding to confirm.",
      ];

      // ‼️ WHAT COULD NOT BE WRITTEN IS SAID OUT LOUD. A date column cannot hold "3 weeks ago",
      // and converting one into a specific day would be inventing a fact that then appears in a
      // document as though somebody read it there.
      if (result.datesDropped.length) {
        lines.push(
          `The most recent review date was written as a phrase rather than a date on ${result.datesDropped.join(", ")}, so those stayed empty.`
        );
      }
      if (result.noCount.length) {
        lines.push(
          `No total was legible on ${result.noCount.join(", ")}, so those were not confirmed at all. Zero reviews and an unreadable total are opposite claims.`
        );
      }

      const rows = await loadReviewAudit(args.clientId);
      lines.push("", formatReviewGrid({ rows }));

      await slack.postThreadReply(args.channel, args.slackTs, lines.join("\n"));
    })().catch((e) => console.error("[slack/actions] review_confirm_readings failed:", e))
  );

  return NextResponse.json({ ok: true });
}

/**
 * [Use this quote] in a page-studio thread.
 *
 * ‼️ IT TAKES THE STUDIO THREAD TS, NOT A CLIENT ID, and that is what makes it self-contained.
 * The session row IS the thread, so one value resolves the client, the claimed page and the
 * proposal together, and a button pressed in the wrong thread finds nothing rather than filing
 * a quote against whoever was last worked on.
 *
 * ‼️ IT POSTS BACK INTO THE STUDIO THREAD, not into args.channel/slackTs. The card lives in the
 * page studio channel and the conversation about this page is that thread; a reply hung off the
 * card would start a second thread inside it.
 */
async function pageReviewUseAction(args: {
  userName: string | null;
  userId: string;
  threadTs: string;
}): Promise<NextResponse> {
  if (!args.threadTs) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { confirmStudioReviewQuote } = await import("@/lib/clients/page-studio");
      await confirmStudioReviewQuote({ threadTs: args.threadTs, by: actor });
    })().catch((e) =>
      console.error("[actions] page_review_use failed:", (e as Error).message)
    )
  );

  return NextResponse.json({ ok: true });
}

/**
 * The `*Next:*` block, as a string ready to append to a reply.
 *
 * ‼️ IT NEVER THROWS AND NEVER BLOCKS THE REPLY. This runs between a person pressing a button
 * and the message that says what happened. A footer is worth having; it is not worth losing the
 * confirmation over, so a failure here returns "" and the reply goes out without it.
 */
async function nextStepFooter(
  clientId: string,
  stepKey: string,
  opts: { asDone?: boolean; own?: string[] } = {}
): Promise<string> {
  try {
    const { nextStepLines } = await import("@/lib/clients/next-steps");
    const { isStepKey } = await import("@/config/delivery-steps");
    if (!isStepKey(stepKey)) return "";
    const lines = await nextStepLines(clientId, stepKey, opts);
    return lines.length ? `\n\n${lines.join("\n")}` : "";
  } catch (e) {
    console.error("[slack/actions] next-step footer failed:", (e as Error).message);
    return "";
  }
}

async function cleanupConfirmAllAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  clientId: string;
}): Promise<NextResponse> {
  if (!args.clientId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { confirmProposedListings } = await import("@/lib/clients/listing-read");
      const result = await confirmProposedListings({ clientId: args.clientId, by: actor });

      if (!result.ok) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          `:warning: Nothing was confirmed: ${result.error}. The proposals are still there.`
        );
        return;
      }

      if (result.confirmed === 0) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          ":information_source: There was nothing outstanding to confirm."
        );
        return;
      }

      const summary = Object.entries(result.byStatus)
        .map(([status, platforms]) => `${platforms.length} ${status} (${platforms.join(", ")})`)
        .join(" · ");

      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        [
          `:white_check_mark: ${result.confirmed} listing${result.confirmed === 1 ? "" : "s"} confirmed by ${actor}.`,
          summary,
          "",
          "Those are what the citation cleanup list and the presence PDF read now. Nothing has",
          "been submitted anywhere: the list is the work, and a person does the work.",
        ].join("\n")
      );
    })().catch((e) => console.error("[slack/actions] cleanup_confirm_all failed:", e))
  );

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// LANE 2 — the avatar picker, and the research it decides
//
// ‼️ THREE BUTTONS ON A CARD RATHER THAN A LINK TO A PANEL, AND THE REASON IS MEASURED.
// clients.primary_avatar had a column, a CHECK constraint and a verifier and no writer anywhere,
// and the card said "The proposal is on the board" pointing at a panel that did not exist. On the
// first real client the step came out `skipped`. The panel exists now; so does the button, in the
// place the decision is actually being read.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [Call now] on the prep call card (offer_locked).
 *
 * ‼️ initiateRingOut, NOT triggerSpeedToLead. The speed-to-lead path is lead-shaped: it checks the
 * DNC list, a thirty minute cooldown and business hours, writes call_log as speed_to_lead and
 * posts to the hot leads channel. A client being onboarded is none of those. RingOut itself dials
 * any number: it rings RC_AGENT_NUMBER first and, once that is answered, rings the client from
 * RC_BUSINESS_NUMBER. Checked 2026-09-11: no new permission and no new number was needed.
 *
 * The phone is read fresh from the client row, never from the button's value, so a card posted
 * before somebody corrected the number dials the corrected one.
 */
async function stepRingOutAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  clientId: string;
}): Promise<NextResponse> {
  const clientId = args.clientId.trim();
  if (!clientId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { supabaseAdmin } = await import("@/lib/db");
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("phone, legal_name, dba_name")
        .eq("id", clientId)
        .maybeSingle();

      const phone = ((client?.phone as string | null) ?? "").trim();
      const name = ((client?.dba_name as string | null) || (client?.legal_name as string | null)) ?? "the client";

      if (!phone) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          ":warning: There is no phone on the client record, so there is nothing to dial. Add it on the board and press Call now again."
        );
        return;
      }

      const agent = (process.env.RC_AGENT_NUMBER ?? "").trim();
      if (!agent) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          `:warning: RC_AGENT_NUMBER is not set, so RingOut has no phone of yours to ring first. Dial ${phone} by hand.`
        );
        return;
      }

      const { initiateRingOut } = await import("@/lib/ringcentral");
      const res = await initiateRingOut(agent, phone, (process.env.RC_AGENT_EXTENSION ?? "").trim() || undefined);

      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        res.success
          ? `:telephone_receiver: Ringing your phone now, then ${name} at ${phone}. Started by ${actor}.`
          : `:warning: RingOut did not start: ${res.error ?? "no reason given"}. Dial ${phone} by hand.`
      );
    })().catch((e) => console.error("[slack/actions] step_ringout failed:", e))
  );

  return NextResponse.json({ ok: true });
}

/**
 * Step 21's buttons. Every one is the same function as its thread command, so the card and the thread
 * cannot disagree about what picking a rung does.
 */
/**
 * Step 12's gate card: approve a cluster, reject one, or drop one keyword off it.
 *
 * ‼️ THE VALUE IS `<clientId>:<entityId>` AND THE CLIENT ID COMES FIRST. logButtonPress matches a
 * UUID prefix to work out which client a press belongs to, so anything else in front of it makes the
 * press unattributable in the history while still working, which is the worst of both.
 *
 * The entity is a CLUSTER id for approve and reject and a KEYWORD id for drop, because those are the
 * units those decisions are about. Three action ids rather than one with a mode, so the dispatcher
 * above reads as what it does.
 */
async function serpGateAction(args: {
  actionId: string;
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  const [clientId, entityId] = args.value.split(":");
  if (!clientId || !entityId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const strategy = await import("@/lib/clients/keyword-strategy");
      let text: string;
      if (args.actionId === "kwgate_approve") {
        text = await strategy.approveClusterAction(clientId, entityId, actor);
      } else if (args.actionId === "kwgate_reject") {
        text = await strategy.rejectClusterAction(clientId, entityId, actor);
      } else {
        text = await strategy.dropKeywordAction(clientId, entityId, actor);
      }

      const { postClientReply } = await import("@/lib/clients/client-events");
      await postClientReply({
        clientId,
        stepKey: "keyword_set",
        channel: args.channel,
        threadTs: args.slackTs,
        text,
      }).catch(() => {});
    })().catch((e) => console.error("[slack/actions] serp gate action threw:", (e as Error).message))
  );

  return NextResponse.json({ ok: true });
}

async function step21Action(args: {
  actionId: string;
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  const [clientId, arg] = args.value.split(":");
  if (!clientId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const ladder = await import("@/lib/clients/anchor-ladder");
      let text: string;
      if (args.actionId === "ladder_write") {
        await slack.postThreadReply(args.channel, args.slackTs, ":hourglass_flowing_sand: Writing the awareness ladder. About a minute.");
        const res = await ladder.writeLadder(clientId, actor);
        text = res.ok ? res.lines.join("\n") : `:warning: No ladder: ${res.error}`;
      } else if (args.actionId === "ladder_pick") {
        const res = await ladder.pickRung(clientId, Number(arg), actor);
        text = res.ok ? res.message : `:warning: ${res.error}`;
      } else if (args.actionId === "kw_pillar") {
        text = (await ladder.pickPillar(clientId, arg ?? "", actor)).message;
      } else {
        text = (await ladder.pickSupports(clientId, "auto", actor)).message;
      }
      await slack.postThreadReply(args.channel, args.slackTs, text);
      if (args.actionId === "kw_pillar" || args.actionId === "kw_supports_auto") {
        const note = await ladder.proposeWhenPicked(clientId);
        if (note) await slack.postThreadReply(args.channel, args.slackTs, note);
      }
      const { postStep } = await import("@/lib/clients/step-engine");
      await postStep(clientId, "pre_call_pages");
    })().catch((e) => console.error("[slack/actions] step 21 action failed:", e))
  );
  return NextResponse.json({ ok: true });
}

/**
 * [Paste review link] on the review steps' cards: a modal with the six platforms and a URL box.
 *
 * The same writer as `review link: <url>` in the thread (lib/clients/review-link.ts), so a Yelp
 * link picked as Trustpilot is refused here exactly as it is there.
 */
async function reviewLinkOpenAction(args: {
  channel: string;
  slackTs: string;
  triggerId: string;
  clientId: string;
}): Promise<NextResponse> {
  const token = process.env.SLACK_BOT_TOKEN || "";
  const clientId = args.clientId.trim();
  if (!clientId || !args.triggerId) return NextResponse.json({ ok: true });

  const { REVIEW_PLATFORMS } = await import("@/lib/hub/review-destinations");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("review_destination_primary")
    .eq("id", clientId)
    .maybeSingle();
  const primary = REVIEW_PLATFORMS.find((p) => p.key === (client?.review_destination_primary as string | null));
  const option = (p: (typeof REVIEW_PLATFORMS)[number]) => ({
    text: { type: "plain_text", text: p.name },
    value: p.key,
  });

  const view = {
    type: "modal",
    callback_id: "review_link_submit",
    private_metadata: JSON.stringify({ clientId, channel: args.channel, slackTs: args.slackTs }),
    title: { type: "plain_text", text: "Review link" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "The page a customer lands on to write the review. The AI Referral Engine's Post button opens it.",
        },
      },
      {
        type: "input",
        block_id: "platform_block",
        label: { type: "plain_text", text: "Platform" },
        element: {
          type: "static_select",
          action_id: "platform_input",
          options: REVIEW_PLATFORMS.map(option),
          ...(primary ? { initial_option: option(primary) } : {}),
        },
      },
      {
        type: "input",
        block_id: "url_block",
        label: { type: "plain_text", text: "Review page URL" },
        element: {
          type: "plain_text_input",
          action_id: "url_input",
          placeholder: { type: "plain_text", text: primary?.placeholder ?? "https://g.page/r/..." },
        },
      },
    ],
  };

  const res = await fetch(`${SLACK_API}/views.open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: args.triggerId, view }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `:warning: Could not open the review link box: ${json.error}`);
  }
  return NextResponse.json({ ok: true });
}

async function reviewLinkSubmit(payload: SlackInteractivePayload): Promise<NextResponse> {
  const meta = JSON.parse(payload.view?.private_metadata ?? "{}") as { clientId?: string; channel?: string; slackTs?: string };
  const values = payload.view?.state.values ?? {};
  const platformKey = values.platform_block?.platform_input?.selected_option?.value ?? null;
  const url = values.url_block?.url_input?.value ?? "";
  if (!meta.clientId) return NextResponse.json({ ok: true });

  const actor = payload.user.username ? `@${payload.user.username}` : payload.user.id;
  const { setReviewLink } = await import("@/lib/clients/review-link");
  const res = await setReviewLink({ clientId: meta.clientId, url, platformKey, actor, source: "slack" });

  // A refusal stays in the modal, under the box that caused it, instead of a thread message nobody sees.
  if (!res.ok) {
    return NextResponse.json({ response_action: "errors", errors: { url_block: res.error.slice(0, 150) } });
  }

  const clientId = meta.clientId;
  waitUntil(
    (async () => {
      if (meta.channel && meta.slackTs) {
        await slack.postThreadReply(
          meta.channel,
          meta.slackTs,
          `:white_check_mark: *${res.platform.name}* link saved by ${actor}. The review page now ends with "${res.platform.label}".\n${res.line}`
        );
      }
      const { setDeliveryStep } = await import("@/lib/clients/delivery-checklist");
      const { postStep } = await import("@/lib/clients/step-engine");
      await setDeliveryStep({ clientId, stepKey: "review_card_pdf", transition: "complete", actor }).catch(() => null);
      await postStep(clientId, "review_card_pdf").catch(() => {});
      await postStep(clientId, "referral_engine_preview").catch(() => {});
    })().catch((e) => console.error("[slack/actions] review link follow-up failed:", e))
  );

  return NextResponse.json({ response_action: "clear" });
}

/**
 * [Patient lane] and [Owner lane] on the concierge_preview card.
 *
 * ‼️ THE ONE PLACE A PERSON SAYS WHO THE WIDGET IS TALKING TO. `concierge_configs.audience` decides
 * which magnet catalogue resolves, whether competitor ammo is offered at all, and where booking
 * hands off. Provisioning seeds it from the client's vertical, which is a proposal; this is the
 * ratification, and concierge_live refuses until it has happened.
 *
 * The card is rebuilt rather than re-posted, so the button labels show the new state in place.
 * Slack orders a channel by post time and a delete-and-repost would move the step to the bottom.
 */
async function conciergeAudienceAction(args: {
  actionId: string;
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  clientId: string;
}): Promise<NextResponse> {
  const clientId = args.clientId.trim();
  if (!clientId) return NextResponse.json({ ok: true });

  const audience = args.actionId === "concierge_audience_owner" ? "owner" : "patient";
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { confirmConciergeAudience } = await import("@/lib/clients/concierge-audience");
      const result = await confirmConciergeAudience({ clientId, audience, by: actor });

      if (!result.ok) {
        await slack.postThreadReply(args.channel, args.slackTs, `:warning: Not confirmed: ${result.error}`);
        return;
      }

      await slack.postThreadReply(args.channel, args.slackTs, result.line);

      // Rebuild in place so the buttons read "(confirmed)" and the body drops the grey question
      // mark. postStep is idempotent on slack_message_ts and updates rather than posting.
      const { postStep } = await import("@/lib/clients/step-engine");
      await postStep(clientId, "concierge_preview");
    })().catch((e) => console.error("[slack/actions] concierge_audience failed:", e))
  );

  return NextResponse.json({ ok: true });
}

/**
 * Approve one of the offers drafted for this client, before any page of theirs exists.
 *
 * ‼️ THE HUMAN HALF OF "THE TOOL PROPOSES, A PERSON CONFIRMS", AND IT IS THE ONLY ROUTE INTO
 * lead_magnets. approveMagnetCandidate does the mint and every copy re-check; this handler does
 * nothing but read who pressed and hand it over. A model wrote five offers into a table nothing
 * downstream reads, and one tap moves exactly one of them into the catalogue every visitor sees.
 *
 * pageId is null on purpose. These were written for the business rather than for a page, so there
 * is nothing to point at the minted key: the ladder reaches it at the client rung instead.
 */
async function clientMagnetApproveAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  // `${clientId}:${candidateId}`. Both halves are uuids, so a plain split is safe here, unlike
  // avatar_pick where the label can carry a colon.
  const [clientId, candidateId] = args.value.split(":");
  if (!clientId || !candidateId) return NextResponse.json({ ok: true });

  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { approveMagnetCandidate } = await import("@/lib/concierge/magnet-drafts");
      const result = await approveMagnetCandidate({
        clientId,
        pageId: null,
        candidateId,
        by: actor,
      });

      if (!result.ok) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          `:warning: Not approved: ${result.error}`
        );
        return;
      }

      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        `:white_check_mark: *${result.title}* is now this client's offer, approved by ${actor}. ` +
          `The pill reads "${result.ctaLabel}". It resolves on every page of the replica and on ` +
          `every hub page written later that does not name something more specific. The other ` +
          `drafts are set aside.`
      );

      // Rebuild the step card so its counts and its magnet line describe what is true now.
      const { postStep } = await import("@/lib/clients/step-engine");
      await postStep(clientId, "site_replica");
    })().catch((e) => console.error("[slack/actions] client_magnet_approve failed:", e))
  );

  return NextResponse.json({ ok: true });
}

async function avatarPickAction(args: {
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  value: string;
}): Promise<NextResponse> {
  // `${clientId}:${slot}:${label}` — the label is last because it is the only part that can
  // contain a colon, and splitting on the first two keeps it whole.
  const [clientId, slot, ...rest] = args.value.split(":");
  const label = rest.join(":").trim();
  if (!clientId || !slot || !label) return NextResponse.json({ ok: true });

  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { confirmAvatar } = await import("@/lib/clients/avatars");
      const result = await confirmAvatar({ clientId, slot, label, by: actor });

      if (!result.ok) {
        await slack.postThreadReply(args.channel, args.slackTs, `:warning: Not confirmed: ${result.error}`);
        return;
      }

      const lines = [
        `:white_check_mark: Avatar confirmed: *${label}* (${slot}), by ${actor}.`,
        result.changed && result.previous
          ? `It replaces *${result.previous.label}*, which is kept in this client's avatar history.`
          : "",
        result.audience?.note ?? "",
        "The phrase harvest researches this buyer, and the custom question set and the page",
        "candidates are both scored against them. Press [Done] on this step when you are happy.",
      ].filter(Boolean);

      await slack.postThreadReply(args.channel, args.slackTs, lines.join("\n"));
    })().catch((e) => console.error("[slack/actions] avatar_pick failed:", e))
  );

  return NextResponse.json({ ok: true });
}

/**
 * [Reuse it] and [Run it again] on step 10's card.
 *
 * ‼️ THE RESEARCH IS KEYED ON (vertical, avatar_slug) AND NOT ON THE CLIENT, WHICH IS THE WHOLE
 * FEATURE. Matthew: "this way if another client has the same LHR client, we can use the same
 * prompt saved in the databse and make it optional to run deep research again." The second med
 * spa aiming at laser hair removal gets the first one's work.
 *
 * [Run it again] deliberately does NOT delete what is stored. It says the step is waiting for a
 * fresh paste; the cached research stays for every other client in the vertical, who did not ask
 * for it to be thrown away.
 */
async function avatarResearchAction(args: {
  actionId: string;
  channel: string;
  slackTs: string;
  userName: string | null;
  userId: string;
  clientId: string;
}): Promise<NextResponse> {
  if (!args.clientId) return NextResponse.json({ ok: true });
  const actor = args.userName ? `@${args.userName}` : args.userId;

  waitUntil(
    (async () => {
      const { confirmedAvatarFor, reuseAvatarResearch, avatarBriefFor } = await import(
        "@/lib/clients/avatars"
      );
      const { verticalFor } = await import("@/lib/clients/harvest");

      const avatar = await confirmedAvatarFor(args.clientId);
      const resolved = await verticalFor(args.clientId);

      if (!avatar || !resolved.ok) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          ":warning: No avatar is confirmed on this client, so there is no research to reuse."
        );
        return;
      }

      if (args.actionId === "avatar_rerun_research") {
        // ‼️ THIS USED TO SAY "run the three messages in the brief above", which was copy from the
        // design before last: there is no brief and there are no three messages. It re-posts the
        // prompt now, which is the thing the step actually hands over.
        const cached = await avatarBriefFor(resolved.vertical, avatar.slug);
        // ‼️ SINCE 2026-09-15 THIS RE-POSTS STEP 11's FRAMEWORK SCRIPT, the same thing the runner hands over,
        // or the note saying it waits for an approved sales letter. `prompt short` still gives the compact
        // prompt for anybody who wants to start without the letter.
        const { postFrameworkScript } = await import("@/lib/clients/framework-thread");
        const posted = await postFrameworkScript(args.clientId);

        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          [
            `:arrows_counterclockwise: Running it again for *${avatar.label}*, asked by ${actor}.`,
            !posted.ok
              ? `:warning: The framework script could not be posted: ${posted.error}`
              : posted.posted
                ? "The framework script is posted in step 11's thread. Bring the four answers back there."
                : "The framework script waits for an approved sales letter (see step 11's thread). `prompt short` there gives the short research prompt now.",
            cached?.researchText
              ? "What is already stored is left alone until the new answer lands. It belongs to every client in this vertical, not just this one."
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
        return;
      }

      const result = await reuseAvatarResearch({
        clientId: args.clientId,
        vertical: resolved.vertical,
        avatarSlug: avatar.slug,
      });

      if (!result.ok) {
        await slack.postThreadReply(
          args.channel,
          args.slackTs,
          `:warning: Nothing was reused: ${result.error}`
        );
        return;
      }

      await slack.postThreadReply(
        args.channel,
        args.slackTs,
        [
          `:recycle: Reused the stored research for *${avatar.label}*, by ${actor}.`,
          `*${result.stored} new phrases*, ${result.seen} already in the bank for this avatar.`,
          `That is ${result.timesReused} client${result.timesReused === 1 ? "" : "s"} this research has now served.`,
          "",
          "These are candidates, not a tracked set. The custom set is approved on the call and",
          "frozen then. The step is still open: press [Done] when you are satisfied.",
        ].join("\n")
      );
    })().catch((e) => console.error("[slack/actions] avatar research action failed:", e))
  );

  return NextResponse.json({ ok: true });
}


// ── ReachInbox campaign reply card ────────────────────────────────────────────────────────────
//
// Three buttons hang under each reply in #vektor-email-director. Draft and Loom both cost real
// money, so both take an in-flight claim before they start; Paste is free and opens a modal, which
// must happen inside Slack's 3 second trigger_id window and therefore cannot be deferred.

async function reachinboxCardAction(args: {
  actionId: string;
  channel: string;
  slackTs: string;
  userId: string;
  prospectId: string;
  triggerId: string;
}): Promise<NextResponse> {
  if (!args.prospectId) return NextResponse.json({ ok: true });

  const { getProspectById } = await import("@/lib/followup-operator/prospects");
  const p = await getProspectById(args.prospectId);
  if (!p) {
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      ":warning: That prospect is no longer in the pipeline."
    );
    return NextResponse.json({ ok: true });
  }

  if (args.actionId === "ri_paste") {
    return reachinboxOpenPasteModal({
      channel: args.channel,
      slackTs: args.slackTs,
      triggerId: args.triggerId,
      prospectId: p.id,
    });
  }

  const action: "draft" | "loom" = args.actionId === "ri_draft" ? "draft" : "loom";
  const { claimThreadAction, finishThreadAction } = await import("@/lib/reachinbox/claims");

  const claimed = await claimThreadAction({
    prospectId: p.id,
    action,
    channel: args.channel,
    slackTs: args.slackTs,
    userId: args.userId,
  });
  if (!claimed) {
    await slack.postEphemeral(
      args.channel,
      args.userId,
      action === "draft"
        ? ":hourglass: A draft for them is already being written. Give it a moment."
        : ":hourglass: A Loom run for them is already going. An audit takes four to six minutes.",
      p.slack_thread_ts ?? undefined
    );
    return NextResponse.json({ ok: true });
  }

  // The slow half. A Loom run can outlive this lambda; the claim is released either way, and a
  // second press after a finished run picks up the existing report for free.
  waitUntil(
    (async () => {
      try {
        const { runDraftForProspect, runLoomForProspect } = await import("@/lib/reachinbox/actions");
        const outcome =
          action === "draft" ? await runDraftForProspect(p) : await runLoomForProspect(p);
        await finishThreadAction({ slackTs: args.slackTs, action, outcome });
      } catch (err) {
        console.error(`[reachinbox] ${action} failed:`, err);
        await finishThreadAction({ slackTs: args.slackTs, action, outcome: "error" });
        if (p.slack_channel_id && p.slack_thread_ts) {
          await slack.postThreadReply(
            p.slack_channel_id,
            p.slack_thread_ts,
            `:warning: That failed: ${(err as Error).message}`
          );
        }
      }
    })()
  );

  return NextResponse.json({ ok: true });
}

async function reachinboxOpenPasteModal(args: {
  channel: string;
  slackTs: string;
  triggerId: string;
  prospectId: string;
}): Promise<NextResponse> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !args.triggerId) return NextResponse.json({ ok: true });

  const view = {
    type: "modal",
    callback_id: "ri_paste_submit",
    // noteTs is the message the button sits on, so the submit can rewrite that exact card. The
    // thread ts is deliberately NOT carried here: it is read fresh off the prospect row at submit
    // time, so a stale metadata field cannot point the answer at the wrong thread.
    private_metadata: JSON.stringify({
      prospectId: args.prospectId,
      channel: args.channel,
      noteTs: args.slackTs,
    }),
    title: { type: "plain_text", text: "Their reply" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "reply_block",
        label: { type: "plain_text", text: "What they said" },
        element: {
          type: "plain_text_input",
          action_id: "reply_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Paste it exactly as they wrote it." },
        },
      },
    ],
  };

  const res = await fetch(`${SLACK_API}/views.open`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trigger_id: args.triggerId, view }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    await slack.postThreadReply(
      args.channel,
      args.slackTs,
      `:warning: Could not open the paste box: ${json.error}`
    );
  }
  return NextResponse.json({ ok: true });
}

async function reachinboxPasteSubmit(payload: SlackInteractivePayload): Promise<NextResponse> {
  const meta = JSON.parse(payload.view?.private_metadata ?? "{}") as {
    prospectId?: string;
    channel?: string;
    noteTs?: string;
  };
  const pasted = (payload.view?.state.values.reply_block?.reply_input?.value ?? "").trim();
  if (!meta.prospectId || !meta.channel || !meta.noteTs || !pasted) {
    return NextResponse.json({ ok: true });
  }

  const { getProspectById, updateProspect, logTouch } = await import(
    "@/lib/followup-operator/prospects"
  );
  const p = await getProspectById(meta.prospectId);
  if (!p) return NextResponse.json({ ok: true });

  const now = new Date().toISOString();

  // Their words land in the same log the webhook and the Outlook sweep write to, so everything
  // downstream asks one question of one place.
  await logTouch({
    prospect_id: p.id,
    direction: "inbound",
    channel: "email",
    body: pasted,
    outcome: "replied",
    occurred_at: now,
    metadata: { source: "slack_paste", by: payload.user.id, note_ts: meta.noteTs },
  });
  await updateProspect(p.id, { last_reply_at: now });

  // Rewrite the note in place: the quote replaces the "no reply text" apology, and the Paste
  // button disappears because the thing it was announcing is no longer true.
  const { buildReplyNote } = await import("@/lib/reachinbox/announce");
  const { buildReplyActions } = await import("@/lib/reachinbox/card");
  const { campaignReplyMailbox } = await import("@/lib/followup-operator/campaign-replies");

  const note = buildReplyNote({
    email: p.email,
    campaignName: p.campaign,
    replyText: pasted,
    occurredAt: now,
    mailboxLaneOff: !campaignReplyMailbox(),
  });
  const actions = buildReplyActions({ prospectId: p.id, hasReplyText: true });
  await slack.updateMessage(meta.channel, meta.noteTs, note.text, [...note.blocks, actions]);

  return NextResponse.json({ response_action: "clear" });
}
