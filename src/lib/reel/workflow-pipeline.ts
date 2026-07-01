// Avatar-first workflow pipeline (Content Engine v3) — the Slack-native creative-director flow.
//
// Decision (2026-07-03): the front door is the AVATAR. In #content-full:
//   `vektor pest_control`     -> lists that avatar's active workflows (numbered)
//   reply `workflow N`        -> Vektor returns 5 HOOKS for workflow N (hook-first)
//   reply `hook N`            -> Vektor returns 3 BODIES for the chosen hook
//   reply `body N`            -> Vektor lays out the caption storyboard (text timed to seconds)
//   reply `song <key|url>`    -> sets the song (rendering itself is Phase 2)
//
// State lives in ONE content_jobs row per session (format_id="workflow"), advanced through
// stages avatar -> hooks -> bodies -> storyboard. No new job table. Best-effort throughout.

import { slack } from "@/lib/slack-bot";
import {
  insertJob,
  getLatestJobByThread,
  updateJob,
  type ContentJob,
} from "@/lib/reel/jobs";
import { listWorkflows, loadWorkflow, resolveSong, SONGS } from "@/config/workflows";
import { loadVertical } from "@/config/verticals";
import {
  generateHooks,
  generateBodies,
  generateCaptionStoryboard,
} from "@/lib/reel/creative-director";
import { setWorkflowSong } from "@/lib/reel/workflow-author";

function numbered(items: string[]): string {
  return items.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/**
 * `vektor <avatar>` / `avatar <avatar>`: open an avatar session in #content-full. Lists the
 * avatar's active workflows and seeds a content_jobs row so thread replies (`workflow N`, etc.)
 * route back. Returns true when it posted a session.
 */
export async function startAvatarSession(args: {
  channel: string;
  verticalId: string;
}): Promise<boolean> {
  const vertical = await loadVertical(args.verticalId);
  const workflows = await listWorkflows(args.verticalId, { status: "active" });

  const header = `*Vektor* is ready for *${vertical.name}*.`;
  const body = workflows.length
    ? [
        "Active workflows:",
        numbered(workflows.map((w) => `${w.name}  (${w.category}${w.subcategory ? "/" + w.subcategory : ""})`)),
        "",
        "Reply `workflow N` to start (I will give you 5 hooks). Or scrub a new reference in #content-analyzer.",
      ].join("\n")
    : [
        "No active workflows yet for this avatar.",
        "Scrub a reference video in #content-analyzer to author one, then it shows up here.",
      ].join("\n");

  const res = await slack.postMessage(args.channel, `${header}\n\n${body}`);
  const ts = (res as { ts?: string }).ts;
  if (!ts) return false;

  await insertJob({
    formatId: "workflow",
    verticalId: args.verticalId,
    channel: args.channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "avatar",
    sourceKind: "avatar",
    data: { workflow_ids: workflows.map((w) => w.id), hooks: [], bodies: [] },
  });
  return true;
}

function idxFrom(text: string, verb: string): number | null {
  const m = new RegExp(`^\\s*${verb}\\s+(\\d{1,2})\\s*$`, "i").exec(text);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Thread reply under an avatar session: `workflow N` -> hooks, `hook N` -> bodies,
 * `body N` -> caption storyboard, `song <key|url>` -> set song. Returns true when handled.
 */
export async function handleVektorThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getLatestJobByThread(args.threadTs);
  if (!job || job.format_id !== "workflow") return false;
  const data = job.data;
  const text = args.text.trim();

  // song <key|url> — accepted at any point once a workflow is chosen.
  const songMatch = /^\s*song\s+(.+)\s*$/i.exec(text);
  if (songMatch && data.workflow_id) {
    const ref = songMatch[1].trim();
    const song = resolveSong(ref);
    await setWorkflowSong(data.workflow_id, ref);
    await updateJob(job, { stage: "await_song", data: { ...job.data, song_ref: ref } });
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `🎵 Song set: *${song.label}*. Scenes will sync to this. Rendering the MP4 is the next phase; the blueprint is saved.`
    );
    return true;
  }

  // workflow N -> 5 hooks
  const wIdx = idxFrom(text, "workflow") ?? idxFrom(text, "use");
  if (wIdx && Array.isArray(data.workflow_ids)) {
    const id = data.workflow_ids[wIdx - 1];
    if (!id) {
      await slack.postThreadReply(args.channel, args.threadTs, `No workflow ${wIdx} in the list.`);
      return true;
    }
    const workflow = await loadWorkflow(id);
    const vertical = await loadVertical(job.vertical_id);
    if (!workflow) {
      await slack.postThreadReply(args.channel, args.threadTs, "Could not load that workflow.");
      return true;
    }
    const hooks = await generateHooks({ vertical, workflow });
    await updateJob(job, { stage: "hooks", data: { ...job.data, workflow_id: id, hooks } });
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [`*${workflow.name}* — pick a hook (reply \`hook N\`):`, "", numbered(hooks)].join("\n")
    );
    return true;
  }

  // hook N -> 3 bodies
  const hIdx = idxFrom(text, "hook");
  if (hIdx && Array.isArray(data.hooks) && data.workflow_id) {
    const chosenHook = data.hooks[hIdx - 1];
    if (!chosenHook) {
      await slack.postThreadReply(args.channel, args.threadTs, `No hook ${hIdx} in the list.`);
      return true;
    }
    const workflow = await loadWorkflow(data.workflow_id);
    const vertical = await loadVertical(job.vertical_id);
    const bodies = await generateBodies({
      vertical,
      chosenHook,
      workflow: workflow ?? undefined,
    });
    await updateJob(job, { stage: "bodies", data: { ...job.data, chosen_hook: chosenHook, bodies } });
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [`Hook: *${chosenHook}*`, "", "Pick a body line (reply `body N`):", numbered(bodies)].join("\n")
    );
    return true;
  }

  // body N -> caption storyboard
  const bIdx = idxFrom(text, "body");
  if (bIdx && Array.isArray(data.bodies) && data.workflow_id && data.chosen_hook) {
    const chosenBody = data.bodies[bIdx - 1];
    if (!chosenBody) {
      await slack.postThreadReply(args.channel, args.threadTs, `No body ${bIdx} in the list.`);
      return true;
    }
    const workflow = await loadWorkflow(data.workflow_id);
    const vertical = await loadVertical(job.vertical_id);
    if (!workflow) {
      await slack.postThreadReply(args.channel, args.threadTs, "Could not load that workflow.");
      return true;
    }
    const sb = await generateCaptionStoryboard({
      vertical,
      workflow,
      chosenHook: data.chosen_hook,
      chosenBody,
    });
    await updateJob(job, {
      stage: "storyboard",
      data: { ...job.data, chosen_body: chosenBody, caption_storyboard: sb },
    });
    const timeline = sb.captions.map((c) => `  ${c.at_second}s  ${c.text}`).join("\n");
    const songHint = workflow.song_ref
      ? `Song: ${resolveSong(workflow.song_ref).label}.`
      : `No song yet. Reply \`song ${Object.keys(SONGS)[0]}\` or paste an audio URL.`;
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [
        `*Caption storyboard* for *${workflow.name}*:`,
        "```",
        timeline,
        "```",
        `*IG caption:* ${sb.ig_caption}`,
        "",
        songHint,
      ].join("\n")
    );
    return true;
  }

  return false;
}

/** True when a top-level #content-full message is an avatar command like `vektor pest_control`. */
export function parseAvatarCommand(text: string): string | null {
  const m = /^\s*(?:vektor|avatar)\s+([a-z0-9_]+)\s*$/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export type { ContentJob };
