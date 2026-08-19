// Generate an artifact, file it, put it in front of a human. One path, four documents.
//
// Every generator in this folder ends the same way: bytes, a client_docs row, an output_ref on
// the delivery step, and something in the ops thread. Writing that four times would guarantee
// four slightly different answers to "what happens when the upload fails".
//
// ‼️ THE FALLBACK IS LOAD-BEARING, NOT DEFENSIVE.
// CLAUDE.md records that the bot is NOT a member of #onboarding-srt-aeo (C0BLK797PNU):
// conversations.history returns not_in_channel there. files.completeUploadExternal takes a
// channel_id, so every artifact upload will fail the same way until the bot is invited. That is
// a Slack workspace fact, not a bug in this code, and it must not mean the artifact vanishes.
// So the file is ALWAYS stored first and always reachable at /api/clients/{id}/docs/{docId};
// the Slack upload is a convenience layered on top. If it fails, the thread gets the link and
// says plainly why.
//
// The order is deliberate: store, then record, then post. A step whose output_ref points at a
// real row but whose Slack post failed is recoverable. A Slack post linking a doc that was
// never stored is not.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { storeGeneratedDoc } from "../onboarding-docs";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface DeliverResult {
  ok: boolean;
  docId?: string;
  /** True when the bytes reached Slack. False means the thread got a link instead. */
  uploaded: boolean;
  error?: string;
}

export async function deliverArtifact(args: {
  clientId: string;
  stepKey: string;
  filename: string;
  buffer: Buffer;
  /** One line above the file in the thread. Say what it is and what to do with it. */
  message: string;
  contentType?: string;
}): Promise<DeliverResult> {
  const stored = await storeGeneratedDoc({
    clientId: args.clientId,
    stepKey: args.stepKey,
    filename: args.filename,
    buffer: args.buffer,
    contentType: args.contentType,
  });

  if (!stored.ok || !stored.docId) {
    console.error(`[artifacts/deliver] store failed for ${args.stepKey}:`, stored.error);
    return { ok: false, uploaded: false, error: stored.error };
  }

  const docUrl = `${appUrl()}/api/clients/${args.clientId}/docs/${stored.docId}`;

  // The step's output_ref is the durable pointer to what it produced. Written before the Slack
  // post so a failed post leaves the step correct rather than empty.
  await supabaseAdmin
    .from("client_delivery_steps")
    .update({ output_ref: stored.docId, updated_at: new Date().toISOString() })
    .eq("client_id", args.clientId)
    .eq("step_key", args.stepKey);

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("ops_thread_ts")
    .eq("id", args.clientId)
    .maybeSingle();

  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  const threadTs = (client?.ops_thread_ts as string | null) ?? null;

  if (!channel || !threadTs) {
    console.error(
      `[artifacts/deliver] ${args.stepKey} stored as ${stored.docId} but there is no ops thread to post it to`
    );
    return { ok: true, docId: stored.docId, uploaded: false };
  }

  // ‼️ ok:true IS NOT PROOF THE FILE ARRIVED, AND THIS IS THE ONE FAILURE THAT LOOKS LIKE SUCCESS.
  //
  // slack-bot.ts's joinChannel docstring records it: "files.completeUploadExternal's channel
  // share silently no-ops (still returns ok:true) if the bot isn't actually a member." So a
  // check of `upload.ok` alone would post the message, report uploaded:true, tick the step, and
  // deliver nothing — the worst shape a bug can take here, because every surface says the
  // artifact went out.
  //
  // The response carries the files it actually shared. An empty list means nothing landed,
  // whatever the ok flag says, and that falls through to the link path below.
  const upload = await slack.uploadFilePDF(channel, args.filename, args.buffer, threadTs);
  const sharedFiles = (upload as { files?: unknown[] })?.files;
  const reallyShared = upload?.ok === true && Array.isArray(sharedFiles) && sharedFiles.length > 0;

  if (reallyShared) {
    await slack.postThreadReply(channel, threadTs, args.message).catch(() => {});
    return { ok: true, docId: stored.docId, uploaded: true };
  }

  const why =
    (upload as { error?: string })?.error ??
    (upload?.ok === true ? "Slack accepted the upload but shared no file" : "unknown");
  const hint =
    why.includes("not_in_channel") ||
    why.includes("channel_not_found") ||
    why.includes("shared no file")
      ? " That usually means the bot is not a member of this channel. Invite it and the next artifact arrives as a file."
      : "";

  await slack
    .postThreadReply(
      channel,
      threadTs,
      `${args.message}\n\nThe file could not be attached (${why}).${hint}\nIt is filed and readable here: ${docUrl}`
    )
    .catch(() => {});

  return { ok: true, docId: stored.docId, uploaded: false };
}
