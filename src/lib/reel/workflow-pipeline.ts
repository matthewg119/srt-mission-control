// Avatar-first workflow pipeline (Content Engine v3) — the Slack-native creative-director flow.
//
// Front door is the AVATAR, and the WORKFLOW comes before the hooks (flip, 2026-07-03), so
// every hook/copy generation is grounded in the chosen workflow's profile (description,
// copy structure, visual rules). In #content-full:
//   `go`                      -> pick an avatar (or `new` to create one)
//   pick a number             -> Vektor posts ~30 headlines + a story reference block
//   `headline N` / paste text -> the WORKFLOW LIBRARY menu (descriptions + gate badges)
//   `workflow N`              -> 5 verbal + 5 title (+5 POV-first) hooks FOR that workflow
//   `title N`/`verbal N`/`pov N`/`hook <text>` -> the labeled copy card -> ✅ -> picture ->
//                                images -> song -> render prompt (+ remix upsell)
//   Pasting a ready copy block (3+ lines) at any of those stages skips the hooks and slots
//   your words straight into the workflow's boxes.
//
// Sessions are CHANNEL-SCOPED (getLatestSessionByChannel), so Matthew can drive the whole flow
// by typing in the channel; thread replies also work. Heavy Claude/image work runs in
// waitUntil so the Slack event acks fast. State lives on ONE content_jobs row. Best-effort.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import {
  insertJob,
  getLatestJobByThread,
  getLatestSessionByChannel,
  getJobByPickerTs,
  updateJob,
  type ContentJob,
  type JobData,
} from "@/lib/reel/jobs";
import { generatePovImage, uploadToReels } from "@/lib/reel/pov";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import { saveContentExample } from "@/lib/reel/content-examples";
import { fetchVideoFrames } from "@/lib/reel/content-analyzer";
import { loadWorkflow, listWorkflows, resolveSong } from "@/config/workflows";
import { loadVertical, listVerticals } from "@/config/verticals";
import {
  generateHeadlineOptions,
  generateCreativeReference,
  generateHookSet,
  generatePicturePlan,
  generatePictureIdeas,
  generateStructuredCopy,
  reslotCopyToStructure,
  parseStoryboardToRenderSpec,
  productizeCopyToWorkflow,
  generateRemixCopy,
  generateAllRemixes,
  REMIX_ANGLES,
  type StructuredCopyLine,
} from "@/lib/reel/creative-director";
import {
  specFromWorkflow,
  applyCopyToSpec,
  validateRenderSpec,
  buildVideoDescription,
  buildRenderClaudePrompt,
  textsForShot,
  workflowAspect,
} from "@/lib/reel/render-spec";
import {
  nearestHazelAspect,
  openaiSizeFor,
  imageGenEnabled,
  ImageGenPausedError,
  IMAGE_GEN_PAUSED_NOTE,
  type ImageProvider,
} from "@/lib/providers/image-gen";
import {
  setWorkflowSong,
  setWorkflowStatus,
  addRenderSequence,
  upsertWorkflow,
  workflowId,
  createWorkflowFromProductized,
  cloneWorkflowForVertical,
  addWorkflowReference,
  setProductionStatus,
  addApprovedVariation,
} from "@/lib/reel/workflow-author";
import { analyzeSong, snapSpecToBeats } from "@/lib/reel/beat-sync";
import { postWorkflowMap } from "@/lib/reel/workflow-map";
import { postSourcingCard } from "@/lib/reel/sourcing-worksheet";
import { startNewAvatar, parseNewAvatar } from "@/lib/reel/avatar-create";
import type { Workflow, WorkflowScene, RenderSpec, RenderMode } from "@/config/workflows";

function numbered(items: string[]): string {
  return items.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

function idxFrom(text: string, verb: string): number | null {
  const m = new RegExp(`^\\s*${verb}\\s+(\\d{1,2})\\s*$`, "i").exec(text);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A pasted line at the `headlines` stage is treated as Matthew's own headline UNLESS it is one
// of our commands.
const COMMAND_RE = /^\s*(go|map|library|new|vektor|avatar|workflow|template|create|finish|remixes|remix|headline|title|verbal|pov|hook|pick|song|sequence|sequences|idea|ideas|more|\d{1,2})\b/i;

// Stage guard: while a session is ACTIVE, an unrecognized reply is consumed with a "here's what
// I expected" nudge instead of falling through to the generic content-drop handler (which would
// post the welcome message, or hijack the thread into a full production-package build). The
// `cancel` command is the escape hatch — never ship a new stage here without a nudge entry.
const STAGE_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  avatar: "Didn't catch that. Reply the avatar's number from the list, or `new` for a new avatar. (`cancel` ends this session.)",
  headlines: "Didn't catch that. Reply `headline N`, type your own headline, or paste a full copy block (3+ lines).",
  hookset: "Didn't catch that. Reply `title N` / `verbal N` / `pov N`, `hook <your hook>`, or paste your copy block.",
  captions: "Didn't catch that. Reply `pick <caption#> <storyboard#>`, e.g. `pick 1 1`.",
  workflow_pick: "Didn't catch that. Reply `workflow N` (or just the number), `template N`, `create`, or `map`.",
  structured_copy: "Didn't catch that. Edit with `line N <text>`, paste a full block to re-slot, or react ✅ on the copy card.",
  remix_copy: "Didn't catch that. `line N <text>` edits, `new images` regenerates the creatives, ✅ renders with the same images.",
  picture_ideas: "Didn't catch that. Reply `idea N` (or just the number), `line N <text>` to edit the copy, `more ideas`, or `more hooks`.",
  picture: "Didn't catch that. ✅ the picture card to see the final image prompts, `redo N <new prompt>` tweaks a scene, `song <key|url>` moves on.",
  prompt_review: "Didn't catch that. `prompt N <new text>` rewrites one final prompt; ✅ the prompts card locks them.",
  awaiting_images: "Waiting on the scene images. Paste them in this thread in scene order (or comment `scene N` on an upload). `prompt N <new text>` still edits a prompt.",
  image_review: "Didn't catch that. React ✅ on the images card to approve them, `redo N <new prompt>` regenerates one, or paste a replacement image with `scene N`.",
  animation_review: "Didn't catch that. `motion N <new text>` rewrites one animation prompt; ✅ the animation card approves them all.",
  render: "Generating the images now — hang tight. Once they land, `redo N <new prompt>` tweaks any of them.",
  authoring: "Didn't catch that. ✅ the render card for the build prompt, or `redo N <new prompt>` / `modify copy` / `song <key|url>`.",
  remix_offer: "Drop the final MP4 in this thread and I'll offer variations. Or reply `remix N`, `remixes`, `modify copy`, or `save as <name>`.",
};

async function consumeWithNudge(job: ContentJob, channel: string): Promise<boolean> {
  if (job.status !== "active") return false; // done/skipped/error sessions don't own the channel
  const nudge = STAGE_NUDGES[job.stage];
  if (!nudge) return false;
  await slack.postThreadReply(channel, job.slack_thread_ts, nudge).catch(() => {});
  return true;
}
function isCommand(t: string): boolean {
  return COMMAND_RE.test(t.trim());
}

/** A multi-line paste of READY copy (3+ non-empty lines that are not a timestamp storyboard).
 *  Checked BEFORE isCommand at every copy-accepting stage, because a real copy block can start
 *  with "POV:" or a number and would otherwise be swallowed as a command (silent stall). */
function looksLikePastedCopy(t: string): boolean {
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 3 && !looksLikeStoryboard(t);
}

// ---- go: avatar picker -----------------------------------------------------------------

/** `go`: Vektor asks which avatar first, listing every avatar + a `new` option. */
export async function startGo(args: { channel: string }): Promise<boolean> {
  const avatars = (await listVerticals()).filter((a) => a.status !== "archived");
  const res = await slack.postMessage(
    args.channel,
    [
      "*Vektor.* Which avatar are we creating for?",
      numbered(avatars.map((a) => `${a.name}  (\`${a.id}\`)`)),
      "",
      "Reply with the number to start. Or `new` to create a new avatar.",
    ].join("\n")
  );
  const ts = (res as { ts?: string }).ts;
  if (!ts) return false;
  await insertJob({
    formatId: "avatar_pick",
    verticalId: "_",
    channel: args.channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "avatar",
    sourceKind: "go",
    data: { avatar_ids: avatars.map((a) => a.id) },
  });
  return true;
}

// ---- avatar session: kicks the copy engine (headlines + reference block) ----------------

/** Open an avatar session: acks, then (in waitUntil) generates ~30 headlines + the story
 *  reference block and posts them, seeding the session job at stage `headlines`. */
export async function startAvatarSession(args: { channel: string; verticalId: string }): Promise<boolean> {
  const res = await slack.postMessage(
    args.channel,
    `*Vektor* is on it for \`${args.verticalId}\`. Pulling 30 headline angles + story material...`
  );
  const ts = (res as { ts?: string }).ts;
  if (!ts) return false;
  const jobId = await insertJob({
    formatId: "workflow",
    verticalId: args.verticalId,
    channel: args.channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "headlines",
    sourceKind: "avatar",
    data: {},
  });

  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(args.verticalId);
        const [headlines, ref] = await Promise.all([
          generateHeadlineOptions({ vertical, count: 30 }),
          generateCreativeReference(vertical),
        ]);
        const refBlock = [
          "*Story material* (mix these in):",
          `*Fears:* ${ref.fears.join(" | ")}`,
          `*Beliefs:* ${ref.beliefs.join(" | ")}`,
          `*Desires:* ${ref.desires.join(" | ")}`,
          `*Facts:* ${ref.facts.join(" | ")}`,
          `*Fantasies:* ${ref.fantasies.join(" | ")}`,
          `*Horror stories:* ${ref.horror.join(" | ")}`,
        ].join("\n");
        await slack.postThreadReply(
          args.channel,
          ts,
          [
            `*${vertical.name}* — 30 headline angles. Reply \`headline N\`, or paste your own headline.`,
            "",
            numbered(headlines),
            "",
            refBlock,
          ].join("\n")
        );
        // Persist the headlines onto the job so `headline N` resolves.
        const job = await getLatestJobByThread(ts);
        if (job) await updateJob(job, { data: { ...job.data, headlines } });
      } catch (e) {
        console.error("[workflow-pipeline] startAvatarSession gen failed:", (e as Error).message);
        await slack.postThreadReply(args.channel, ts, "Could not pull headlines. Try `go` again.").catch(() => {});
      }
      void jobId;
    })()
  );
  return true;
}

// ---- the session state machine ---------------------------------------------------------

/**
 * Handle a message in an avatar session, resolved by thread first then by channel (so typing in
 * the channel works). Returns true when it handled the message. Heavy generation runs in
 * waitUntil; this returns quickly after an ack.
 */
export async function handleVektorMessage(args: {
  channel: string;
  text: string;
  threadTs?: string;
}): Promise<boolean> {
  const job =
    (args.threadTs ? await getLatestJobByThread(args.threadTs) : null) ??
    (await getLatestSessionByChannel(args.channel));
  if (!job) return false;
  const data = job.data;
  const t = args.text.trim();

  // `cancel` — close the session so the channel stops routing here. This is the escape hatch
  // for the stage guard; without it an active session would swallow the channel forever.
  if (/^\s*(cancel|stop\s+session)\s*$/i.test(t) && job.status === "active") {
    await updateJob(job, { stage: "done", status: "done" });
    await slack.postThreadReply(args.channel, job.slack_thread_ts, "Session closed. `go` starts a new one.");
    return true;
  }

  // `go` avatar-picker session: number picks an avatar; `new` starts avatar creation.
  if (job.format_id === "avatar_pick") {
    if (/^\s*new\b/i.test(t)) {
      const na = parseNewAvatar(t) ?? {};
      await updateJob(job, { stage: "done", status: "done" });
      return startNewAvatar({ channel: args.channel, id: na.id, name: na.name });
    }
    const n = parseInt(t, 10);
    if (Number.isInteger(n) && n > 0 && Array.isArray(data.avatar_ids) && data.avatar_ids[n - 1]) {
      await updateJob(job, { stage: "done", status: "done" });
      return startAvatarSession({ channel: args.channel, verticalId: data.avatar_ids[n - 1] });
    }
    return consumeWithNudge(job, args.channel);
  }

  if (job.format_id !== "workflow") return false;
  const threadTs = job.slack_thread_ts;

  // `map` / `library` — the whole library as an image, mid-session (the menu footer promises it;
  // route.ts only catches the top-level form).
  if (/^\s*(map|library)\s*$/i.test(t)) {
    await postWorkflowMap(args.channel, job.vertical_id);
    return true;
  }
  // `worksheet` / `sources` [name|number] — the content-sourcing card. Bare form inside a
  // session shows the CURRENT workflow's card.
  const wsMatch = /^\s*(?:worksheet|sources)(?:\s+(.+))?\s*$/i.exec(t);
  if (wsMatch) {
    await postSourcingCard({
      channel: args.channel,
      threadTs,
      arg: wsMatch[1]?.trim(),
      workflowId: data.workflow_id,
      verticalId: job.vertical_id,
    });
    return true;
  }

  // song / sequences (available once a draft workflow exists).
  const songMatch = /^\s*song\s+(.+)\s*$/i.exec(t);
  if (songMatch && data.workflow_id) {
    const ref = songMatch[1].trim();
    await setWorkflowSong(data.workflow_id, ref);
    await updateJob(job, { data: { ...job.data, song_ref: ref } });
    await slack.postThreadReply(args.channel, threadTs, `🎵 Song set: *${resolveSong(ref).label}*.`);
    // If this workflow renders from a spec, the song is the last missing piece: move to the
    // render-authoring gate. An uploaded/pasted song URL first offers beat sync (`sync auto`
    // snaps the timeline to its beat grid); the default bed goes straight to the confirm card.
    // GATED: the render confirm only comes after the images + animation prompts are approved
    // (final_animation_prompts) — the song is stored either way.
    const wfSong = await loadWorkflow(data.workflow_id);
    if (wfSong?.render_spec) {
      if (!job.data.final_animation_prompts && job.stage !== "authoring" && job.stage !== "remix_offer" && job.stage !== "remix_copy") {
        await slack.postThreadReply(args.channel, threadTs, "Song saved. Finish the image + animation approvals first, then I confirm the render.");
        return true;
      }
      if (/^https?:\/\//i.test(ref)) {
        await slack.postThreadReply(
          args.channel,
          threadTs,
          "Reply `sync auto` to snap shot cuts + text drops to this song's beat, or `sync manual` to keep your timings."
        );
      } else {
        await postRenderConfirmCard(args.channel, threadTs, job, wfSong, ref);
      }
    }
    return true;
  }
  // `sync auto` / `sync manual` — after a song is attached, choose beat-snapped timings or the
  // typed ones. Auto reads the uploaded song's beat grid (render-service analyze-song) and snaps
  // shot boundaries + text drops to the nearest beats before the render-confirm gate.
  const syncMatch = /^\s*sync\s+(auto|manual)\s*$/i.exec(t);
  if (syncMatch && data.workflow_id) {
    const wfSync = await loadWorkflow(data.workflow_id);
    if (!wfSync) return false;
    if (!job.data.final_animation_prompts && job.stage !== "authoring" && job.stage !== "remix_offer" && job.stage !== "remix_copy") {
      await slack.postThreadReply(args.channel, threadTs, "Sync noted. Finish the image + animation approvals first, then set the sync.");
      return true;
    }
    const songRef = data.song_ref ?? wfSync.song_ref ?? null;
    if (syncMatch[1].toLowerCase() === "manual") {
      await postRenderConfirmCard(args.channel, threadTs, job, wfSync, songRef);
      return true;
    }
    const songUrl = songRef && /^https?:\/\//i.test(songRef) ? songRef : null;
    if (!songUrl) {
      await slack.postThreadReply(
        args.channel,
        threadTs,
        "Auto sync needs an uploaded song (attach the audio file in this thread). The default bed already renders on its measured beat grid, so use `sync manual`."
      );
      return true;
    }
    await slack.postThreadReply(args.channel, threadTs, "Reading the song's beat grid and snapping the timeline...");
    waitUntil(
      (async () => {
        try {
          const grid = await analyzeSong(songUrl);
          if (!grid) {
            await slack.postThreadReply(args.channel, threadTs, "Could not read the beat grid. Keep `sync manual` for now.");
            return;
          }
          const base = specFromWorkflow(wfSync);
          const filled = base ? applyCopyToSpec(base, job.data.structured_copy) : null;
          if (!filled) {
            await slack.postThreadReply(args.channel, threadTs, "No render spec to snap yet. Build the copy + picture first.");
            return;
          }
          const { spec: snapped, moved } = snapSpecToBeats(filled, grid.beats);
          await slack.postThreadReply(
            args.channel,
            threadTs,
            `Beat grid: ${grid.bpm ? `${Math.round(grid.bpm)} BPM, ` : ""}${grid.beats.length} beats. Snapped ${moved} timing${moved === 1 ? "" : "s"} to the beat.`
          );
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await postRenderConfirmCard(args.channel, threadTs, fresh, { ...wfSync, render_spec: snapped }, songRef);
        } catch (e) {
          console.error("[workflow-pipeline] sync auto failed:", (e as Error).message);
          await slack.postThreadReply(args.channel, threadTs, "Auto sync failed. Use `sync manual`.").catch(() => {});
        }
      })()
    );
    return true;
  }

  // `finish workflow` — the production gate: 3 reference creatives uploaded, then the 4th (the
  // production test render) finishes it and flips the workflow to IN PRODUCTION.
  if (/^\s*finish\s+workflow\s*$/i.test(t) && data.workflow_id) {
    const wfFin = await loadWorkflow(data.workflow_id);
    if (!wfFin) return false;
    const refs = wfFin.reference_media?.length ?? 0;
    if (refs < 3) {
      // References are OPTIONAL — never halt a session on them. Note the count, keep the
      // onboarding tracker honest (no in_production flip), and move straight to the render.
      await slack.postThreadReply(
        args.channel,
        threadTs,
        `*${wfFin.name}* has ${refs}/3 reference creatives — optional. Drop screenshots/videos of reels you like in this thread anytime to progress onboarding. Moving on to the render.`
      );
      await postRenderConfirmCard(args.channel, threadTs, job, wfFin, data.song_ref ?? wfFin.song_ref ?? null);
      return true;
    }
    await setProductionStatus(wfFin.id, "in_production");
    await slack.postThreadReply(
      args.channel,
      threadTs,
      `*${wfFin.name}*: 3 references in. Marked IN PRODUCTION. The 4th creative (the production test) renders next - confirm below. From here, 4 ✅-approved variation renders flip it LIVE.`
    );
    await postRenderConfirmCard(args.channel, threadTs, job, wfFin, data.song_ref ?? wfFin.song_ref ?? null);
    return true;
  }

  // `remixes` — draft ALL 16 narrative variations for this workflow + audio + render combo.
  if (/^\s*remixes\s*$/i.test(t) && data.workflow_id) {
    const wfRx = await loadWorkflow(data.workflow_id);
    if (!wfRx?.copy_structure?.length) {
      await slack.postThreadReply(args.channel, threadTs, "This workflow has no copy structure to remix yet.");
      return true;
    }
    await slack.postThreadReply(
      args.channel,
      threadTs,
      "Drafting all 16 remixes (same structure + song + timings, 16 different narratives)..."
    );
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const variations = await generateAllRemixes({ vertical, workflow: wfRx, baseCopy: job.data.structured_copy });
          if (!variations.length) {
            await slack.postThreadReply(args.channel, threadTs, "Could not draft the remixes. Try `remixes` again.");
            return;
          }
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await updateJob(fresh, { data: { ...fresh.data, remixes: variations } });
          const list = variations
            .map((v, i) => `${i + 1}. *${v.label}* - "${v.lines.find((l) => l.text)?.text ?? ""}"`)
            .join("\n");
          await slack.postThreadReply(
            args.channel,
            threadTs,
            [`*${variations.length} remixes drafted.* Reply \`remix N\` to load one:`, list].join("\n")
          );
        } catch (e) {
          console.error("[workflow-pipeline] remixes gen failed:", (e as Error).message);
          await slack.postThreadReply(args.channel, threadTs, "Could not draft the remixes. Try `remixes` again.").catch(() => {});
        }
      })()
    );
    return true;
  }

  // `remix N` — load a drafted variation (or write that angle fresh). ✅ on the card renders it
  // with the SAME images; `new images` regenerates the creatives from the new copy.
  const remixIdx = idxFrom(t, "remix");
  if (remixIdx && data.workflow_id) {
    const wfRx = await loadWorkflow(data.workflow_id);
    if (!wfRx?.copy_structure?.length) {
      await slack.postThreadReply(args.channel, threadTs, "This workflow has no copy structure to remix yet.");
      return true;
    }
    const stored = data.remixes?.[remixIdx - 1];
    if (stored) {
      await postRemixCopyCard(args.channel, threadTs, job, wfRx, stored.label, stored.lines);
      return true;
    }
    const angle = REMIX_ANGLES[remixIdx - 1];
    if (!angle) {
      await slack.postThreadReply(args.channel, threadTs, `Pick 1 to ${REMIX_ANGLES.length}, or \`remixes\` to draft all of them.`);
      return true;
    }
    await slack.postThreadReply(args.channel, threadTs, `Writing the *${angle.label}* remix...`);
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const lines = await generateRemixCopy({ vertical, workflow: wfRx, angle, baseCopy: job.data.structured_copy });
          if (!lines.some((l) => l.text)) {
            await slack.postThreadReply(args.channel, threadTs, "Could not write that remix. Try again.");
            return;
          }
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await postRemixCopyCard(args.channel, threadTs, fresh, wfRx, angle.label, lines);
        } catch (e) {
          console.error("[workflow-pipeline] remix gen failed:", (e as Error).message);
          await slack.postThreadReply(args.channel, threadTs, "Could not write that remix. Try again.").catch(() => {});
        }
      })()
    );
    return true;
  }

  if (/^\s*sequences\s*$/i.test(t) && data.workflow_id) {
    const wf = await loadWorkflow(data.workflow_id);
    const seqs = wf?.render_sequences ?? [];
    await slack.postThreadReply(
      args.channel,
      threadTs,
      seqs.length
        ? ["*Render sequences:*", numbered(seqs.map((s) => `${s.label} — ${resolveSong(s.song_ref).label}`))].join("\n")
        : "No render sequences yet. Add one with `sequence <song> [label]`."
    );
    return true;
  }
  const seqMatch = /^\s*sequence\s+(\S+)\s*(.*)$/i.exec(t);
  if (seqMatch && data.workflow_id) {
    const songRef = seqMatch[1].trim();
    const label = (seqMatch[2] || "").trim() || `Variant ${resolveSong(songRef).label}`;
    const seq = await addRenderSequence(data.workflow_id, {
      label,
      song_ref: songRef,
      captions: data.caption_storyboard?.captions,
    });
    await slack.postThreadReply(
      args.channel,
      threadTs,
      seq ? `🎼 Added render sequence *${seq.label}*.` : "Could not add that render sequence."
    );
    return true;
  }

  // ---- Part 2: render-spec authoring commands (need a workflow in context) ---------------
  if (data.workflow_id) {
    const wf0 = await loadWorkflow(data.workflow_id);

    // `modify copy` -> back to the labeled boxes.
    if (/^\s*modify\s+copy\s*$/i.test(t) && wf0) {
      await updateJob(job, { stage: "structured_copy" });
      const lines: StructuredCopyLine[] =
        data.structured_copy ?? (wf0.copy_structure ?? []).map((r) => ({ key: r.key, label: r.label, text: "" }));
      const card = await postStructuredCopyCard(args.channel, threadTs, wf0, lines);
      const cardTs = (card as { ts?: string }).ts;
      if (cardTs) {
        await updateJob(job, { pickerTs: cardTs, data: { ...job.data, structured_copy: lines } });
        await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
      }
      return true;
    }

    // `save draft` -> keep the current build as a draft, render nothing.
    if (/^\s*save\s+draft\s*$/i.test(t) && wf0) {
      await setWorkflowStatus(wf0.id, "draft");
      await slack.postThreadReply(args.channel, threadTs, `Saved *${wf0.name}* as a draft. Nothing rendered.`);
      return true;
    }

    // `save as <name>` -> clone the settings into a NEW draft workflow, carry them into a fresh
    // #content-full message, and leave the original as a draft. Only the new one is saved.
    const saveAs = /^\s*save\s+as\s+(.+)\s*$/i.exec(t);
    if (saveAs && wf0) {
      const newName = saveAs[1].trim();
      await startSaveAs(args.channel, job, wf0, newName);
      return true;
    }

    // A pasted storyboard/timestamps block -> parse, mismatch-guard, validate (never auto-render).
    if (looksLikeStoryboard(t) && wf0 && job.stage !== "structured_copy") {
      await slack.postThreadReply(args.channel, threadTs, "Reading your timestamps...");
      const pasted = t;
      waitUntil(handlePastedStoryboard(args.channel, threadTs, job, wf0, pasted));
      return true;
    }
  }

  // Stage: headlines -> pick/paste a headline -> the WORKFLOW picker (workflow-first order:
  // the format is chosen BEFORE any hooks, so the hooks are generated FOR that workflow).
  if (job.stage === "headlines") {
    // A pasted READY copy block (3+ lines) skips hook building entirely: store it and go
    // straight to the workflow question. Line 1 doubles as the chosen headline/hook.
    if (looksLikePastedCopy(t)) return acceptPastedCopy(args.channel, threadTs, job, t);
    let headline: string | undefined;
    const hi = idxFrom(t, "headline");
    if (hi && Array.isArray(data.headlines) && data.headlines[hi - 1]) headline = data.headlines[hi - 1];
    else if (t && !isCommand(t)) headline = t;
    if (!headline) return consumeWithNudge(job, args.channel);
    await updateJob(job, { stage: "workflow_pick", data: { ...job.data, chosen_headline: headline } });
    await postWorkflowMenu(args.channel, threadTs, job.vertical_id, {});
    return true;
  }

  // Stage: hookset -> pick a hook. In the workflow-first order the workflow is ALREADY bound
  // (data.workflow_id), so the picked hook goes straight into that workflow's copy build.
  // Mid-flight sessions from the old order (no workflow_id yet) keep the old behavior: the
  // workflow menu comes next.
  if (job.stage === "hookset") {
    // A 3+ line paste is ready copy, not a hook pick. With a workflow bound it re-slots into
    // that workflow's boxes; without one it goes through the library gate (old behavior).
    // Runs BEFORE isCommand so a block starting with "POV:"/a number can't stall the session.
    if (looksLikePastedCopy(t)) {
      if (data.workflow_id) {
        const wfP = await loadWorkflow(data.workflow_id);
        if (wfP?.copy_structure?.length) {
          await updateJob(job, { data: { ...job.data, pasted_copy: t, chosen_hook: t.split("\n")[0].trim() } });
          const freshJob = await getLatestJobByThread(threadTs);
          await startStructuredCopyBuild(args.channel, threadTs, freshJob ?? job, wfP, { pastedCopy: t });
          return true;
        }
      }
      return acceptPastedCopy(args.channel, threadTs, job, t);
    }
    let hook: string | undefined;
    let pastedCopy: string | undefined;
    const hm = /^\s*hook\s+(.+)\s*$/i.exec(t);
    if (hm) hook = hm[1].trim();
    const hs = data.hookset;
    const ti = idxFrom(t, "title");
    const vi = idxFrom(t, "verbal");
    const pi = idxFrom(t, "pov");
    if (ti && hs?.title?.[ti - 1]) hook = hs.title[ti - 1];
    if (vi && hs?.verbal?.[vi - 1]) hook = hs.verbal[vi - 1];
    if (pi && hs?.pov?.[pi - 1]) hook = hs.pov[pi - 1];
    // Any other non-command text is Matthew's own copy/message: keep it as the seed.
    if (!hook && t && !isCommand(t)) {
      pastedCopy = t;
      hook = t.split("\n")[0].trim();
    }
    if (!hook) return consumeWithNudge(job, args.channel);

    // Workflow-first order: the workflow is bound, run its copy/picture path with this hook.
    if (data.workflow_id) {
      const wf = await loadWorkflow(data.workflow_id);
      if (wf) {
        await updateJob(job, {
          data: { ...job.data, chosen_hook: hook, ...(pastedCopy ? { pasted_copy: pastedCopy } : {}) },
        });
        const freshJob = await getLatestJobByThread(threadTs);
        const j = freshJob ?? job;
        if (wf.copy_structure?.length) {
          await startStructuredCopyBuild(args.channel, threadTs, j, wf, { pastedCopy });
        } else {
          await updateJob(j, { stage: "picture" });
          await slack.postThreadReply(args.channel, threadTs, "Mapping the whole picture (scenes + timing)...");
          waitUntil(
            generateAndPostPicture({
              channel: args.channel,
              threadTs,
              verticalId: job.vertical_id,
              hook,
              caption: data.chosen_caption || "",
              storyboard: data.chosen_storyboard || "",
              workflow: wf,
            })
          );
        }
        return true;
      }
    }

    // Old-order fallback (session parked at hookset before the flip deployed).
    await updateJob(job, {
      stage: "workflow_pick",
      data: { ...job.data, chosen_hook: hook, ...(pastedCopy ? { pasted_copy: pastedCopy } : {}) },
    });
    await postWorkflowMenu(args.channel, threadTs, job.vertical_id, { pastedCopy: pastedCopy ?? job.data.pasted_copy });
    return true;
  }

  // Stage: captions -> pick caption + storyboard -> the WORKFLOW picker (copy-first).
  if (job.stage === "captions") {
    const pm = /^\s*pick\s+(\d{1,2})\s+(\d{1,2})\s*$/i.exec(t);
    if (!pm) return consumeWithNudge(job, args.channel);
    const caption = data.captions3?.[parseInt(pm[1], 10) - 1];
    const storyboard = data.storyboards3?.[parseInt(pm[2], 10) - 1];
    if (!caption || !storyboard) {
      await slack.postThreadReply(args.channel, threadTs, "Those numbers are out of range. Try `pick 1 1`.");
      return true;
    }
    await updateJob(job, {
      stage: "workflow_pick",
      data: { ...job.data, chosen_caption: caption, chosen_storyboard: storyboard },
    });
    await postWorkflowMenu(args.channel, threadTs, job.vertical_id, { pastedCopy: job.data.pasted_copy });
    return true;
  }

  // Stage: workflow_pick -> the LIBRARY gate. `workflow N` uses one, `template N` re-slots the
  // pasted copy into one's structure, `create` productizes the pasted copy into a NEW workflow.
  if (job.stage === "workflow_pick") {
    // A fresh copy paste while the menu is open replaces the stored block + re-ranks the menu.
    if (looksLikePastedCopy(t)) {
      await updateJob(job, { data: { ...job.data, pasted_copy: t, chosen_hook: t.split("\n")[0].trim() } });
      await postWorkflowMenu(args.channel, threadTs, job.vertical_id, { pastedCopy: t });
      return true;
    }
    // `create` / `new workflow`: productize the pasted copy into a saved repeatable workflow.
    if (/^\s*(create|new\s+workflow)\s*$/i.test(t)) {
      if (!data.pasted_copy) {
        await slack.postThreadReply(args.channel, threadTs, "Paste your copy block first (3+ lines), then reply `create`.");
        return true;
      }
      await slack.postThreadReply(
        args.channel,
        threadTs,
        "Productizing your copy into a new workflow (labeled roles + timings + textbox positions + category)..."
      );
      waitUntil(createWorkflowFromPastedCopy(args.channel, threadTs, job));
      return true;
    }
    const menu = data.workflow_menu ?? [];
    const wi = idxFrom(t, "workflow");
    const tmpl = idxFrom(t, "template");
    let pickIdx = wi ?? tmpl;
    // Bare "1" picks like the avatar picker; the workflow's NAME (typed or copied from the
    // menu) picks too — either way, never fall through to the generic content handler.
    if (!pickIdx && /^\d{1,2}$/.test(t)) pickIdx = parseInt(t, 10);
    if (!pickIdx && !t.includes("\n") && t.length >= 4) {
      const q = t.toLowerCase();
      const exact = menu.findIndex((m) => m.name.toLowerCase() === q);
      if (exact >= 0) pickIdx = exact + 1;
      else {
        const partial = menu
          .map((m, i) => ({ i, name: m.name.toLowerCase() }))
          .filter((m) => m.name.includes(q) || q.includes(m.name));
        if (partial.length === 1) pickIdx = partial[0].i + 1; // ambiguous names never pick
      }
    }
    if (!pickIdx) return consumeWithNudge(job, args.channel);
    if (tmpl && !data.pasted_copy) {
      await slack.postThreadReply(args.channel, threadTs, "Nothing pasted yet. Paste your copy block first, or use `workflow N`.");
      return true;
    }
    const chosen = menu[pickIdx - 1];
    if (!chosen) {
      await slack.postThreadReply(args.channel, threadTs, "That number is out of range. Reply `workflow N` from the list.");
      return true;
    }
    let wf = await loadWorkflow(chosen.id);
    if (!wf) {
      await slack.postThreadReply(args.channel, threadTs, "Could not load that workflow. Pick another.");
      return true;
    }
    // Cross-avatar template: clone it into THIS avatar's library first; never touch the source.
    if (chosen.cross_avatar && wf.vertical_id !== job.vertical_id) {
      const clone = await cloneWorkflowForVertical(wf, job.vertical_id);
      if (!clone) {
        await slack.postThreadReply(args.channel, threadTs, "Could not clone that workflow into this avatar. Pick another.");
        return true;
      }
      wf = clone;
      await slack.postThreadReply(args.channel, threadTs, `Cloned *${wf.name}* into this avatar's library.`);
    }
    // Unconfigured (draft/no copy_structure): hand back the Claude Code prompt to finish it.
    if (!chosen.configured) {
      await slack.postThreadReply(
        args.channel,
        threadTs,
        [
          `*${wf.name}* is not configured yet. To finish it, give Claude Code this:`,
          "```",
          `Configure the workflow "${wf.name}" (id: ${wf.id}, avatar: ${wf.vertical_id}) in srt-mission-control:`,
          "define its copy_structure (labeled boxes), song, shot count, and the per-second render_spec",
          "(shots + on-screen text timings + positions). Then set status=active.",
          "```",
          "Or pick another workflow.",
        ].join("\n")
      );
      return true;
    }
    // Pasted copy in hand: Matthew's words drive the build directly - re-slot them into the
    // workflow's boxes (no hook step needed, his copy IS the copy).
    if (data.pasted_copy && wf.copy_structure?.length) {
      await updateJob(job, { data: { ...job.data, workflow_id: wf.id } });
      const freshJob = await getLatestJobByThread(threadTs);
      await startStructuredCopyBuild(args.channel, threadTs, freshJob ?? job, wf, { pastedCopy: data.pasted_copy });
      return true;
    }

    // A hook already chosen (old-order mid-flight session or the captions path): keep the
    // original behavior and build straight from it.
    if (data.chosen_hook) {
      if (!wf.copy_structure?.length) {
        await updateJob(job, { stage: "picture", data: { ...job.data, workflow_id: wf.id } });
        await slack.postThreadReply(args.channel, threadTs, "Mapping the whole picture (scenes + timing)...");
        waitUntil(
          generateAndPostPicture({
            channel: args.channel,
            threadTs,
            verticalId: job.vertical_id,
            hook: data.chosen_hook || "",
            caption: data.chosen_caption || "",
            storyboard: data.chosen_storyboard || "",
            workflow: wf,
          })
        );
        return true;
      }
      await updateJob(job, { data: { ...job.data, workflow_id: wf.id } });
      const freshJob = await getLatestJobByThread(threadTs);
      await startStructuredCopyBuild(args.channel, threadTs, freshJob ?? job, wf, {});
      return true;
    }

    // Workflow-first order: the workflow is chosen, NOW generate the hooks FOR it, grounded
    // in its description, copy structure, and visual rules.
    await updateJob(job, { stage: "hookset", data: { ...job.data, workflow_id: wf.id } });
    await slack.postThreadReply(args.channel, threadTs, `Building hooks for *${wf.name}*...`);
    const chosenHeadline = data.chosen_headline || wf.name;
    const wfForHooks = wf;
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const isPov = String(wfForHooks.category) === "pov";
          const hs = await generateHookSet({ vertical, chosenHeadline, isPov, workflow: wfForHooks });
          const parts = [
            `*Hooks for ${wfForHooks.name}*`,
            "",
            "*Verbal hooks* (voiceover) — `verbal N`:",
            numbered(hs.verbal),
            "",
            "*Title hooks* (on-screen) — `title N`:",
            numbered(hs.title),
          ];
          if (hs.pov?.length) parts.push("", "*POV-first title hooks* — `pov N`:", numbered(hs.pov));
          parts.push("", "Pick one, or just *paste your own copy* (I slot it into this workflow), or `hook <text>`.");
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await updateJob(fresh, { data: { ...fresh.data, hookset: hs } });
          await slack.postThreadReply(args.channel, threadTs, parts.join("\n"));
        } catch (e) {
          console.error("[workflow-pipeline] hookset gen failed:", (e as Error).message);
          await slack
            .postThreadReply(args.channel, threadTs, "Could not build the hooks. Reply `hook <text>` to use your own.")
            .catch(() => {});
        }
      })()
    );
    return true;
  }

  // Stage: structured_copy / remix_copy -> edit lines (`line N <text>`) or paste a block to
  // re-slot. remix_copy keeps its own footer (✅ = same images) + accepts `new images`.
  if (job.stage === "structured_copy" || job.stage === "remix_copy") {
    const isRemix = job.stage === "remix_copy";
    const footer = isRemix ? remixCardFooter(data.remix_angle) : undefined;
    const lines = data.structured_copy ?? [];
    const wf = data.workflow_id ? await loadWorkflow(data.workflow_id) : null;
    if (!wf) return false;

    // `new images` (remix only): regenerate the creatives from the new copy instead of reusing
    // the original shot images. Runs the normal picture -> images -> render path.
    if (isRemix && /^\s*new\s+images\s*$/i.test(t)) {
      return buildPictureFromStructuredCopy(job, args.channel);
    }

    const lm = /^\s*line\s+(\d{1,2})\s+(.+)\s*$/i.exec(t);
    if (lm) {
      const idx = parseInt(lm[1], 10) - 1;
      if (idx < 0 || idx >= lines.length) {
        await slack.postThreadReply(args.channel, threadTs, `Line ${idx + 1} is out of range (1 to ${lines.length}).`);
        return true;
      }
      const next = lines.map((l, i) => (i === idx ? { ...l, text: lm[2].trim() } : l));
      await updateJob(job, { data: { ...job.data, structured_copy: next } });
      const card = await postStructuredCopyCard(args.channel, threadTs, wf, next, footer);
      const cardTs = (card as { ts?: string }).ts;
      if (cardTs) {
        await updateJob(job, { pickerTs: cardTs });
        await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
      }
      return true;
    }

    // A pasted multi-line block -> re-slot it into the labeled boxes. (A real copy block can
    // start with "POV:"/a number, so a 3+ line paste bypasses the command check.)
    if (t.includes("\n") && (!isCommand(t) || looksLikePastedCopy(t))) {
      await slack.postThreadReply(args.channel, threadTs, "Re-slotting your copy into the structure...");
      const pasted = t;
      waitUntil(
        (async () => {
          try {
            const vertical = await loadVertical(job.vertical_id);
            const reslotted = await reslotCopyToStructure({ vertical, workflow: wf, pastedBlock: pasted });
            const fresh = await getLatestJobByThread(threadTs);
            const card = await postStructuredCopyCard(args.channel, threadTs, wf, reslotted, footer);
            const cardTs = (card as { ts?: string }).ts;
            if (fresh) await updateJob(fresh, { pickerTs: cardTs ?? fresh.picker_msg_ts, data: { ...fresh.data, structured_copy: reslotted } });
            if (cardTs) await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
          } catch (e) {
            console.error("[workflow-pipeline] reslot failed:", (e as Error).message);
          }
        })()
      );
      return true;
    }
    return consumeWithNudge(job, args.channel);
  }

  // Stage: picture_ideas -> `idea N` locks a visual direction; `more ideas` redraws the card;
  // `more hooks` regenerates the hook menu for this workflow (more options before committing).
  if (job.stage === "picture_ideas") {
    const ii = idxFrom(t, "idea") ?? (/^\d{1,2}$/.test(t) ? parseInt(t, 10) : null);
    if (ii) return pickPictureIdea(job, args.channel, ii);
    // `line N <text>` still edits the copy at the ideas gate (the picture always builds from
    // the latest lines). The pickerTs stays on the ideas card so ✅ keeps meaning "idea 1".
    const lm = /^\s*line\s+(\d{1,2})\s+(.+)\s*$/i.exec(t);
    if (lm && data.workflow_id) {
      const wfL = await loadWorkflow(data.workflow_id);
      const lines = data.structured_copy ?? [];
      const idx = parseInt(lm[1], 10) - 1;
      if (!wfL || idx < 0 || idx >= lines.length) {
        await slack.postThreadReply(args.channel, threadTs, `Line ${idx + 1} is out of range (1 to ${lines.length}).`);
        return true;
      }
      const next = lines.map((l, i) => (i === idx ? { ...l, text: lm[2].trim() } : l));
      await updateJob(job, { data: { ...job.data, structured_copy: next } });
      await postStructuredCopyCard(
        args.channel,
        threadTs,
        wfL,
        next,
        "Updated. Still at the ideas gate — reply `idea N` (or ✅ the ideas card)."
      );
      return true;
    }
    if (/^\s*(more\s+ideas|ideas)\s*$/i.test(t)) {
      // Back to structured_copy for a beat so startPictureIdeas re-enters cleanly.
      await updateJob(job, { stage: "structured_copy" });
      const fresh = await getLatestJobByThread(threadTs);
      return startPictureIdeas(fresh ?? job, args.channel);
    }
    if (/^\s*more\s+hooks\s*$/i.test(t) && data.workflow_id) {
      const wfH = await loadWorkflow(data.workflow_id);
      if (!wfH) return false;
      await updateJob(job, { stage: "hookset" });
      await slack.postThreadReply(args.channel, threadTs, `Building fresh hooks for *${wfH.name}*...`);
      waitUntil(
        (async () => {
          try {
            const vertical = await loadVertical(job.vertical_id);
            const isPov = String(wfH.category) === "pov";
            const hs = await generateHookSet({
              vertical,
              chosenHeadline: data.chosen_headline || data.chosen_hook || wfH.name,
              isPov,
              workflow: wfH,
            });
            const parts = [
              `*Fresh hooks for ${wfH.name}*`,
              "",
              "*Verbal hooks* (voiceover) — `verbal N`:",
              numbered(hs.verbal),
              "",
              "*Title hooks* (on-screen) — `title N`:",
              numbered(hs.title),
            ];
            if (hs.pov?.length) parts.push("", "*POV-first title hooks* — `pov N`:", numbered(hs.pov));
            parts.push("", "Pick one (the copy rebuilds on it), or `hook <text>` for your own.");
            const fresh = await getLatestJobByThread(threadTs);
            if (fresh) await updateJob(fresh, { data: { ...fresh.data, hookset: hs } });
            await slack.postThreadReply(args.channel, threadTs, parts.join("\n"));
          } catch (e) {
            console.error("[workflow-pipeline] more hooks failed:", (e as Error).message);
          }
        })()
      );
      return true;
    }
    return consumeWithNudge(job, args.channel);
  }

  // Stage: prompt_review / awaiting_images -> `prompt N <new text>` rewrites one final prompt.
  // ✅ on the prompts card (handlePictureReaction) locks them; in manual mode the images are
  // then pasted into the thread, in auto mode they generate verbatim.
  if (job.stage === "prompt_review" || job.stage === "awaiting_images") {
    const pm = /^\s*prompt\s+(\d{1,2})\s+([\s\S]+?)\s*$/i.exec(t);
    if (pm && data.workflow_id) {
      const finals = [...(data.final_prompts ?? [])];
      const idx = parseInt(pm[1], 10) - 1;
      const wfP = await loadWorkflow(data.workflow_id);
      if (!wfP) return true;
      const { scenes, fromSeed } = sceneListFor(job, wfP);
      if (idx < 0 || idx >= Math.max(finals.length, scenes.length)) {
        await slack.postThreadReply(args.channel, threadTs, `Prompt ${idx + 1} is out of range (1 to ${Math.max(finals.length, scenes.length)}).`);
        return true;
      }
      finals[idx] = pm[2].trim();
      // The edited prompt is also the scene's prompt of record for the paste intake.
      const nextScenes = scenes.map((s, i) => (i === idx ? { ...s, image_prompt: finals[idx] } : s));
      await updateJob(job, { data: { ...job.data, final_prompts: finals, session_scenes: nextScenes } });
      const card = await slack.postThreadReply(
        args.channel,
        threadTs,
        buildPromptsCard(wfP.name, nextScenes, finals, { fromSeed })
      );
      const cardTs = (card as { ts?: string }).ts;
      if (cardTs && job.stage === "prompt_review") {
        await updateJob(job, { pickerTs: cardTs });
        await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
      }
      return true;
    }
    return consumeWithNudge(job, args.channel);
  }

  // Stage: animation_review -> `motion N <new text>` rewrites one animation prompt before ✅.
  if (job.stage === "animation_review") {
    const mm = /^\s*motion\s+(\d{1,2})\s+([\s\S]+?)\s*$/i.exec(t);
    if (mm && data.workflow_id) {
      const wfM = await loadWorkflow(data.workflow_id);
      if (!wfM) return true;
      const { scenes } = sceneListFor(job, wfM);
      const idx = parseInt(mm[1], 10) - 1;
      if (idx < 0 || idx >= scenes.length) {
        await slack.postThreadReply(args.channel, threadTs, `Motion ${idx + 1} is out of range (1 to ${scenes.length}).`);
        return true;
      }
      const nextScenes = scenes.map((s, i) => (i === idx ? { ...s, animation_prompt: mm[2].trim() } : s));
      await updateJob(job, { data: { ...job.data, session_scenes: nextScenes } });
      const card = await postAnimationCard(args.channel, threadTs, wfM.name, nextScenes);
      const cardTs = (card as { ts?: string }).ts;
      if (cardTs) {
        await updateJob(job, { pickerTs: cardTs });
        await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
      }
      return true;
    }
    return consumeWithNudge(job, args.channel);
  }

  // Stage: picture / image_review / authoring -> `redo N <new prompt>` regenerates one scene's
  // image (works after the render-confirm card too, which parks the stage at authoring).
  if (job.stage === "picture" || job.stage === "image_review" || job.stage === "authoring") {
    const rm = /^\s*redo\s+(\d{1,2})\s+(.+)\s*$/i.exec(t);
    if (rm && data.workflow_id) {
      const idx = parseInt(rm[1], 10) - 1;
      const newPrompt = rm[2].trim();
      const wf = await loadWorkflow(data.workflow_id);
      const { scenes } = wf ? sceneListFor(job, wf) : { scenes: [] as SessionScene[] };
      if (wf && scenes[idx]) {
        await slack.postThreadReply(args.channel, threadTs, `Redoing scene ${idx + 1}...`);
        const vid = job.vertical_id;
        waitUntil(
          (async () => {
            try {
              const rendered = await renderScene(vid, newPrompt, wf);
              // Session-scoped: the redo lands on the JOB's scenes, never mid-session on the
              // shared workflow row (the animation gate is the one sanctioned write-back).
              const nextScenes = scenes.map((s, i) =>
                i === idx
                  ? { ...s, image_prompt: newPrompt, image_url: rendered?.url ?? s.image_url ?? null, image_approved: Boolean(rendered) || s.image_approved }
                  : s
              );
              const fresh = await getLatestJobByThread(threadTs);
              if (fresh) await updateJob(fresh, { data: { ...fresh.data, session_scenes: nextScenes } });
              if (rendered) {
                // NOTE: generated images are NOT saved to content_examples — our own outputs
                // must never become reference frames (that's how wasp shots leaked into a
                // storytime). Outputs live on the session + galleries.
                await slack.uploadFile(args.channel, `scene${idx + 1}.png`, rendered.buffer, rendered.mimetype, threadTs);
                await slack.postThreadReply(args.channel, threadTs, `scene ${idx + 1}: ${rendered.stamp}`).catch(() => {});
              }
            } catch (e) {
              if (e instanceof ImageGenPausedError) {
                await slack
                  .postThreadReply(args.channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}\nPaste the replacement image in this thread with \`scene ${idx + 1}\` instead.`)
                  .catch(() => {});
                return;
              }
              console.error("[workflow-pipeline] redo scene failed:", (e as Error).message);
            }
          })()
        );
        return true;
      }
    }
    return consumeWithNudge(job, args.channel);
  }

  // Catch-all for stages with no text branch (render, remix_offer, ...): consume with the
  // stage's nudge so the generic content handler never hijacks an active session thread.
  return consumeWithNudge(job, args.channel);
}

// ---- session scenes: the wasp-leak fix -----------------------------------------------------
// The picture plan a session builds lives on the JOB (data.session_scenes), never on the shared
// workflows row mid-session. That row's SEEDED scenes (e.g. the wasp-nest shots a workflow was
// born with) are only a last-resort skeleton, and using them is called out loudly on the card.
// The one sanctioned write-back to the workflow row is the animation-approval gate.

type SessionScene = NonNullable<JobData["session_scenes"]>[number];

function sceneListFor(job: ContentJob, wf: Workflow): { scenes: SessionScene[]; fromSeed: boolean } {
  const sess = job.data.session_scenes;
  if (sess?.length) return { scenes: sess.map((s) => ({ ...s })), fromSeed: false };
  return {
    scenes: wf.scenes.map((s) => ({
      role: s.role,
      image_prompt: s.image_prompt,
      animation_prompt: s.animation_prompt,
      image_url: null,
      image_approved: false,
    })),
    fromSeed: true,
  };
}

const SEED_SCENES_WARNING =
  "⚠️ Using this workflow's SEED scenes (no session picture was built) — CHECK THE SUBJECT matches your copy before approving.";

/** The prompts card: one copy-paste code block per shot (mobile-friendly), ✅ locks them. */
function buildPromptsCard(wfName: string, scenes: SessionScene[], prompts: string[], opts?: { fromSeed?: boolean }): string {
  const blocks = prompts.map((p, i) => `*${i + 1}. ${scenes[i]?.role ?? `shot ${i + 1}`}*\n\`\`\`\n${p}\n\`\`\``);
  return [
    `*Final image prompts for ${wfName}* — one per shot, each in its own copy block:`,
    ...(opts?.fromSeed ? [SEED_SCENES_WARNING] : []),
    ...blocks,
    imageGenEnabled()
      ? "React ✅ to lock these prompts and generate the images."
      : "React ✅ to lock these prompts. Then generate each one yourself and paste the finished images back in this thread (auto-generation is paused).",
    "`prompt N <new text>` rewrites one first.",
  ].join("\n");
}

/** Enrich one scene prompt on THIS workflow's reference library + visual rules. Falls back to
 *  the raw prompt on any error. Shared by the prompt-review gate (which shows the result for
 *  approval) and renderScene's direct path (redo etc.). */
async function enrichWorkflowPrompt(
  verticalId: string,
  imagePrompt: string,
  workflow?: Workflow | null
): Promise<string> {
  try {
    const vertical = await loadVertical(verticalId);
    return await enrichScene(imagePrompt, {
      vertical,
      formatGroup: String(workflow?.category ?? "pov"),
      extraRules: workflow?.visual_rules,
      workflow: workflow
        ? { id: workflow.id, category: String(workflow.category), description: workflow.description ?? null }
        : null,
    });
  } catch {
    return imagePrompt;
  }
}

/** Human label for the provider a workflow's images generate with, plus the TRUE output
 *  aspect (hazel collapses portrait requests to 2:3). Posted under every generated image
 *  so "which model made this?" is answered per image, never by eye. */
function providerStamp(workflow?: Workflow | null): string {
  const prov = (workflow?.render_options?.provider as string | undefined) ?? "openai";
  const requested = workflow ? workflowAspect(workflow) : "3:4";
  const labels: Record<string, string> = {
    "higgsfield-gpt": "gpt-image-2 (hazel)",
    higgsfield: "Soul",
    openai: "gpt-image-2 (OpenAI direct)",
    elevenlabs: "Seedream",
  };
  const label = labels[prov] ?? prov;
  if (prov === "openai") {
    const size = openaiSizeFor(requested);
    const cropNote = size === "1024x1536" && requested !== "2:3" ? ` (requested ${requested}, crop in render)` : "";
    return `${label} @ ${size}${cropNote}`;
  }
  const rendered = prov === "higgsfield-gpt" ? nearestHazelAspect(requested) : requested;
  const aspectNote = rendered === requested ? requested : `${rendered} (requested ${requested})`;
  return `${label} @ ${aspectNote}`;
}

/** Enrich a scene prompt on the workflow's references + visual rules (see enrichWorkflowPrompt),
 *  then generate one still with the workflow's image settings (best-effort).
 *  opts.skipEnrich: the prompt was already enriched AND approved at the prompt-review gate —
 *  send it verbatim so what Matthew approved is exactly what generates. */
async function renderScene(
  verticalId: string,
  imagePrompt: string,
  workflow?: Workflow | null,
  opts?: { skipEnrich?: boolean }
): Promise<{ url: string; buffer: Buffer; mimetype: string; stamp: string } | null> {
  try {
    const enriched = opts?.skipEnrich
      ? imagePrompt
      : await enrichWorkflowPrompt(verticalId, imagePrompt, workflow);
    const img = await generatePovImage(enriched, {
      provider: workflow?.render_options?.provider as ImageProvider | undefined,
      aspect: workflow ? workflowAspect(workflow) : undefined,
      quality: workflow?.render_options?.quality,
    });
    if (!img) return null;
    const url = await uploadToReels(img.buffer, img.mimetype);
    if (!url) return null;
    return { url, buffer: img.buffer, mimetype: img.mimetype, stamp: providerStamp(workflow) };
  } catch (e) {
    // The kill switch stays LOUD: callers post the paused note instead of a generic failure.
    if (e instanceof ImageGenPausedError) throw e;
    console.error("[workflow-pipeline] renderScene failed:", (e as Error).message);
    return null;
  }
}

/**
 * ✅ on a workflow card. Routed by the reacted job's stage:
 *   structured_copy -> build the picture (scene image prompts + grouped-by-shot preview)
 *   picture         -> PROMPT REVIEW: enrich every scene prompt and post them for approval
 *   prompt_review   -> generate the real images with the approved prompts, verbatim
 *   authoring       -> validate + emit the Claude Code prompt for the render
 * Returns true when handled.
 */
export async function handlePictureReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  if (!["white_check_mark", "heavy_check_mark", "+1"].includes(args.reaction)) return false;
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.format_id !== "workflow") return false;

  // ✅ on the labeled copy: the IDEAS GATE comes first - 3 visual directions to pick from
  // before a single image credit is spent. ✅ on the ideas card = lock idea 1.
  if (job.stage === "structured_copy") return startPictureIdeas(job, args.channel);
  if (job.stage === "picture_ideas") return pickPictureIdea(job, args.channel, 1);
  if (job.stage === "remix_copy") return renderRemixSameImages(job, args.channel);
  if (job.stage === "authoring") return emitRenderPrompt(job, args.channel);
  // ✅ on the picture card -> the PROMPT REVIEW gate (see the exact prompts before any credit).
  if (job.stage === "picture") return startPromptReview(job, args.channel);
  // ✅ on the images card -> the ANIMATION gate; ✅ on the animation card -> approve + write-back.
  if (job.stage === "image_review") return startAnimationReview(job, args.channel);
  if (job.stage === "animation_review") return approveAnimationPrompts(job, args.channel);
  if (job.stage !== "prompt_review") return false;
  return approvePrompts(job, args.channel);
}

/** ✅ on the prompts card: the prompts are LOCKED. Auto mode (IMAGE_GEN_ENABLED=true) generates
 *  them verbatim; manual mode (the default) asks Matthew to generate the images himself and
 *  paste them into the thread — pasted = approved AND saved as workflow references. */
async function approvePrompts(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  if (imageGenEnabled()) return generateSceneImages(job, channel);
  const wf = await loadWorkflow(wfId);
  if (!wf) return false;
  const threadTs = job.slack_thread_ts;
  const { scenes } = sceneListFor(job, wf);
  const finals = job.data.final_prompts ?? [];
  // The approved prompt becomes each scene's prompt of record for the paste intake.
  const nextScenes = scenes.map((s, i) => ({ ...s, image_prompt: finals[i] ?? s.image_prompt, image_url: null, image_approved: false }));
  await updateJob(job, { stage: "awaiting_images", data: { ...job.data, session_scenes: nextScenes } });
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*Prompts locked.* Generate each one yourself (auto-generation is paused) and paste the finished images back in this thread:`,
      ...nextScenes.map((s, i) => `${i + 1}. ${s.role}`),
      "",
      "Paste in scene order, or comment `scene N` on an upload to target a slot. Every pasted image is approved on arrival and saved to this workflow's reference library.",
      `0 of ${nextScenes.length} received.`,
    ].join("\n")
  );
  return true;
}

/** All scene images are in (pasted or generated + ✅). Post the animation-prompts card. */
async function startAnimationReview(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const wf = await loadWorkflow(wfId);
  if (!wf) return false;
  const threadTs = job.slack_thread_ts;
  const { scenes } = sceneListFor(job, wf);
  await updateJob(job, { stage: "animation_review" });
  const card = await postAnimationCard(channel, threadTs, wf.name, scenes);
  const cardTs = (card as { ts?: string }).ts;
  if (cardTs) {
    await updateJob(job, { pickerTs: cardTs });
    await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
  }
  return true;
}

/** The animation card: per-scene Seedance 2.0 motion prompts, `motion N <text>` edits, ✅ approves.
 *  No animation credits are spent here — approved prompts ride into the render spec (and the
 *  future Seedance I2V step slots in behind this gate). */
async function postAnimationCard(channel: string, threadTs: string, wfName: string, scenes: SessionScene[]): Promise<unknown> {
  return slack.postThreadReply(
    channel,
    threadTs,
    [
      `*Animation prompts for ${wfName}* (Seedance 2.0, motion only) — one per scene:`,
      ...scenes.map((s, i) => `${i + 1}. *${s.role}* — ${s.animation_prompt || "_(none)_"}`),
      "",
      "`motion N <new text>` rewrites one. React ✅ to approve them all (nothing animates yet; these go into the render).",
    ].join("\n")
  );
}

/** ✅ on the animation card: approve the motion prompts, write the session's scenes back onto
 *  the workflow row (the ONE sanctioned write-back), then move to the song/render step. */
async function approveAnimationPrompts(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const wf = await loadWorkflow(wfId);
  if (!wf) return false;
  const threadTs = job.slack_thread_ts;
  const { scenes } = sceneListFor(job, wf);
  const finalMotions = scenes.map((s) => s.animation_prompt);
  const wfScenes: WorkflowScene[] = scenes.map((s, i) => ({
    role: s.role,
    image_prompt: s.image_prompt,
    animation_prompt: s.animation_prompt,
    duration_seconds: wf.scenes[i]?.duration_seconds ?? 2,
    image_url: s.image_url ?? null,
    image_approved: Boolean(s.image_approved),
  }));
  await upsertWorkflow({ ...wf, scenes: wfScenes });
  await updateJob(job, { data: { ...job.data, session_scenes: scenes, final_animation_prompts: finalMotions } });
  const songRef = job.data.song_ref ?? wf.song_ref ?? null;
  if (songRef && wf.render_spec) {
    const fresh = await getLatestJobByThread(threadTs);
    await postRenderConfirmCard(channel, threadTs, fresh ?? job, { ...wf, scenes: wfScenes }, songRef);
  } else {
    await slack.postThreadReply(
      channel,
      threadTs,
      "Animation approved. Add the song with `song <key|url>` (or attach the audio file here) and I confirm the render."
    );
  }
  return true;
}

/** The PROMPT REVIEW gate: enrich every SESSION scene's prompt (references + rules baked in)
 *  and post the EXACT text that will go to gpt-image-2, one copy block per shot.
 *  `prompt N <new text>` edits one; ✅ locks them (manual paste or auto-generate). */
async function startPromptReview(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const threadTs = job.slack_thread_ts;
  await updateJob(job, { stage: "prompt_review" });
  await slack.postThreadReply(channel, threadTs, "Writing the final image prompts (references + rules baked in)...");

  waitUntil(
    (async () => {
      try {
        const wf = await loadWorkflow(wfId);
        if (!wf) return;
        const { scenes, fromSeed } = sceneListFor(job, wf);
        const prompts: string[] = [];
        for (const scene of scenes) {
          prompts.push(await enrichWorkflowPrompt(job.vertical_id, scene.image_prompt, wf));
        }
        const card = await slack.postThreadReply(channel, threadTs, buildPromptsCard(wf.name, scenes, prompts, { fromSeed }));
        const cardTs = (card as { ts?: string }).ts;
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh)
          await updateJob(fresh, {
            pickerTs: cardTs ?? fresh.picker_msg_ts,
            data: { ...fresh.data, final_prompts: prompts, session_scenes: scenes },
          });
        if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        console.error("[workflow-pipeline] prompt review failed:", (e as Error).message);
        await slack
          .postThreadReply(channel, threadTs, "Could not write the final prompts. React ✅ on the picture card again to retry.")
          .catch(() => {});
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh) await updateJob(fresh, { stage: "picture" });
      }
    })()
  );
  return true;
}

/** AUTO mode only (IMAGE_GEN_ENABLED=true): generate the scene images using the APPROVED final
 *  prompts verbatim (no re-enrichment), then park at the IMAGE REVIEW gate — ✅ moves to the
 *  animation gate, `redo N <prompt>` regenerates one. Session-scoped: results land on the job. */
async function generateSceneImages(job: ContentJob, channel: string): Promise<boolean> {
  const workflowIdRef = job.data.workflow_id;
  if (!workflowIdRef) return false;
  const args = { channel };

  const threadTs = job.slack_thread_ts;
  await updateJob(job, { stage: "render" });
  await slack.postThreadReply(args.channel, threadTs, "Generating the images for each scene...");

  waitUntil(
    (async () => {
      try {
        const wf = await loadWorkflow(workflowIdRef);
        if (!wf) return;
        const finals = job.data.final_prompts ?? [];
        const { scenes } = sceneListFor(job, wf);
        let ok = 0;
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          const approved = finals[i];
          // The approved prompt becomes the scene's prompt of record (what you approved is
          // what the scene IS); it is sent verbatim, no second enrichment pass.
          if (approved) scene.image_prompt = approved;
          const rendered = await renderScene(job.vertical_id, scene.image_prompt, wf, {
            skipEnrich: Boolean(approved),
          });
          if (rendered) {
            scene.image_url = rendered.url;
            scene.image_approved = true;
            ok++;
            // Generated images intentionally NOT saved to content_examples (see redo path note).
            await slack.uploadFile(args.channel, `scene${i + 1}.png`, rendered.buffer, rendered.mimetype, threadTs);
            await slack.postThreadReply(args.channel, threadTs, `scene ${i + 1}: ${rendered.stamp}`).catch(() => {});
          } else {
            await slack.postThreadReply(args.channel, threadTs, `Scene ${i + 1} image failed. Retry with \`redo ${i + 1} <prompt>\`.`);
          }
        }
        // Session-scoped results + the IMAGE REVIEW gate (✅ -> animation prompts).
        const freshJob = await getLatestJobByThread(threadTs);
        const card = await slack.postThreadReply(
          args.channel,
          threadTs,
          [
            `*Images: ${ok}/${scenes.length} generated.*`,
            "React ✅ to approve them and move to the animation prompts.",
            "`redo N <new prompt>` regenerates one, or paste a replacement image with `scene N`.",
          ].join("\n")
        );
        const cardTs = (card as { ts?: string }).ts;
        if (freshJob)
          await updateJob(freshJob, {
            stage: "image_review",
            pickerTs: cardTs ?? freshJob.picker_msg_ts,
            data: { ...freshJob.data, session_scenes: scenes },
          });
        if (cardTs) await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        if (e instanceof ImageGenPausedError) {
          // Kill switch flipped mid-flight: stay retryable at prompt_review, say so loudly.
          await slack.postThreadReply(args.channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`).catch(() => {});
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await updateJob(fresh, { stage: "prompt_review" });
          return;
        }
        console.error("[workflow-pipeline] handlePictureReaction gen failed:", (e as Error).message);
      }
    })()
  );
  return true;
}

// ---- helpers: menus, cards, picture build, render authoring ----------------------------

/** Accept a pasted READY copy block (3+ lines): skip hook generation entirely, store the block,
 *  and go straight to the workflow question. Line 1 doubles as the chosen headline/hook. */
async function acceptPastedCopy(channel: string, threadTs: string, job: ContentJob, block: string): Promise<boolean> {
  const first = block.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  await updateJob(job, {
    stage: "workflow_pick",
    data: {
      ...job.data,
      pasted_copy: block,
      chosen_headline: job.data.chosen_headline ?? first,
      chosen_hook: first,
    },
  });
  await postWorkflowMenu(channel, threadTs, job.vertical_id, { pastedCopy: block });
  return true;
}

/** One row of the persisted workflow menu (`workflow N` / `template N` index into this). */
interface WorkflowMenuEntry {
  id: string;
  name: string;
  category: string;
  subcategory?: string | null;
  status: string;
  configured: boolean;
  cross_avatar?: boolean;
}

/**
 * Post the workflow LIBRARY as the "which workflow?" gate: the avatar's workflows grouped by
 * category (active first), then configured workflows from other avatars as templates. When a
 * copy block was pasted, lead with which workflows FIT its structure (slot-count match).
 * Empty library + pasted copy: skip the menu and productize the copy into a new workflow.
 * Persists the flat numbering so `workflow N` / `template N` resolve.
 */
/** Kick off the labeled-copy build for a bound workflow: re-slot Matthew's pasted copy into
 *  the boxes when he supplied it, otherwise generate fresh copy seeded from the chosen hook.
 *  Ends on the structured-copy card with the ✅ primed. (Shared by the workflow_pick and
 *  hookset stages in the workflow-first order.) */
async function startStructuredCopyBuild(
  channel: string,
  threadTs: string,
  job: ContentJob,
  wf: Workflow,
  opts: { pastedCopy?: string }
): Promise<void> {
  const data = job.data;
  await updateJob(job, { stage: "structured_copy", data: { ...job.data, workflow_id: wf.id } });
  await slack.postThreadReply(channel, threadTs, `Building the copy for *${wf.name}*...`);
  const seed = {
    headline: data.chosen_headline,
    hook: data.chosen_hook,
    caption: data.chosen_caption,
    storyboard: data.chosen_storyboard,
  };
  const pastedCopy = opts.pastedCopy ?? data.pasted_copy;
  // A real pasted block (3+ lines) is Matthew's own words — pre-approved by definition, so the
  // fitted copy card posts for reference and the IDEAS GATE follows immediately (no ✅ wait).
  // A 1-line typed hook also lands in pasted_copy via the hookset branch and keeps the ✅ gate.
  const isPasted = Boolean(pastedCopy && looksLikePastedCopy(pastedCopy));
  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(job.vertical_id);
        const lines = pastedCopy
          ? await reslotCopyToStructure({ vertical, workflow: wf, pastedBlock: pastedCopy })
          : await generateStructuredCopy({ vertical, workflow: wf, seed });
        const fresh = await getLatestJobByThread(threadTs);
        if (isPasted) {
          // pickerTs stays OFF this card so a late ✅ on it resolves to no job (idempotent).
          await postStructuredCopyCard(
            channel,
            threadTs,
            wf,
            lines,
            "Your copy, fitted to the boxes. Edit any line with `line N <text>` — the picture always uses the latest lines."
          );
          if (fresh) await updateJob(fresh, { data: { ...fresh.data, structured_copy: lines } });
          const fresh2 = await getLatestJobByThread(threadTs);
          if (fresh2) await startPictureIdeas(fresh2, channel);
          return;
        }
        const card = await postStructuredCopyCard(channel, threadTs, wf, lines);
        const cardTs = (card as { ts?: string }).ts;
        if (fresh)
          await updateJob(fresh, {
            pickerTs: cardTs ?? fresh.picker_msg_ts,
            data: { ...fresh.data, structured_copy: lines },
          });
        if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        console.error("[workflow-pipeline] structured copy gen failed:", (e as Error).message);
        await slack.postThreadReply(channel, threadTs, "Could not build the copy. Try another workflow.").catch(() => {});
      }
    })()
  );
}

async function postWorkflowMenu(
  channel: string,
  threadTs: string,
  verticalId: string,
  opts: { pastedCopy?: string } = {}
): Promise<void> {
  const own = (await listWorkflows(verticalId, { status: "all" })).filter((w) => w.status !== "archived");

  // Empty library + pasted copy: nothing to pick from, so create the workflow on the spot.
  if (!own.length && opts.pastedCopy) {
    await slack.postThreadReply(
      channel,
      threadTs,
      "No workflows for this avatar yet. Productizing your copy into a new workflow (labeled roles + timings + textbox positions + category)..."
    );
    const job = await getLatestJobByThread(threadTs);
    if (job) {
      if (!job.data.pasted_copy) await updateJob(job, { data: { ...job.data, pasted_copy: opts.pastedCopy } });
      waitUntil(createWorkflowFromPastedCopy(channel, threadTs, job));
    }
    return;
  }

  // Templates from other avatars: configured (active) workflows with a real structure, capped.
  const others = (await listWorkflows(undefined, { status: "active" }))
    .filter((w) => w.vertical_id !== verticalId && (w.copy_structure?.length || w.render_spec))
    .slice(0, 8);

  // Group own workflows by category (sorted), active first within each; templates last.
  const ordered: Array<{ w: Workflow; cross: boolean }> = [];
  const cats = Array.from(new Set(own.map((w) => String(w.category || "other")))).sort();
  for (const c of cats) {
    const group = own
      .filter((w) => String(w.category || "other") === c)
      .sort((a, b) =>
        a.status === b.status
          ? (a.subcategory ?? "").localeCompare(b.subcategory ?? "")
          : a.status === "active"
            ? -1
            : 1
      );
    for (const w of group) ordered.push({ w, cross: false });
  }
  for (const w of others) ordered.push({ w, cross: true });

  const menu: WorkflowMenuEntry[] = ordered.map(({ w, cross }) => ({
    id: w.id,
    name: w.name,
    category: String(w.category),
    subcategory: w.subcategory ?? null,
    status: w.status,
    configured: w.status === "active",
    ...(cross ? { cross_avatar: true } : {}),
  }));

  const describe = (w: Workflow): string => {
    const slots = w.copy_structure?.length ?? 0;
    const shots = w.render_spec?.shots.length ?? w.render_options?.max_shots ?? 0;
    const dur = w.render_spec?.duration_seconds;
    const bits = [
      slots ? `${slots} slots` : "",
      shots ? `${shots} shots` : "",
      dur ? `${dur}s` : "",
      w.render_options?.aspect ?? "",
    ].filter(Boolean);
    return bits.length ? `  (${bits.join(" · ")})` : "";
  };

  // Onboarding gate badge: LIVE / onboarding N/4 approved variations / refs N/3.
  const gateBadge = (w: Workflow): string => {
    if (w.production_status === "live") return "  ★ LIVE";
    if (w.production_status === "in_production") return `  onboarding ${(w.approved_variations ?? []).length}/4`;
    const refs = w.reference_media?.length ?? 0;
    return refs > 0 ? `  refs ${refs}/3` : "";
  };

  // Render grouped: category headers for own workflows, then the templates section. Each row
  // carries the workflow's one-line description so the menu doubles as the library inventory.
  const lines: string[] = [];
  let lastHeader = "";
  ordered.forEach(({ w, cross }, i) => {
    const header = cross ? "Templates from other avatars" : String(w.category || "other");
    if (header !== lastHeader) {
      lines.push(`*${header}*`);
      lastHeader = header;
    }
    const tag = cross ? `  [${w.vertical_id}]` : w.status === "active" ? "" : "  - needs config";
    lines.push(`  ${i + 1}. ${w.name}${w.subcategory ? ` (${w.subcategory})` : ""}${describe(w)}${gateBadge(w)}${tag}`);
    if (w.description) {
      const d = w.description.length > 90 ? `${w.description.slice(0, 87)}...` : w.description;
      lines.push(`      _${d}_`);
    }
  });

  // Fit suggestion: rank by slot-count match against the pasted line count (own avatar first).
  let fitLine = "";
  if (opts.pastedCopy) {
    const n = opts.pastedCopy.split("\n").map((l) => l.trim()).filter(Boolean).length;
    const scored = ordered
      .map(({ w, cross }, i) => ({ i: i + 1, w, cross, slots: w.copy_structure?.length ?? 0 }))
      .filter((x) => x.slots > 0 && Math.abs(x.slots - n) <= 1)
      .sort((a, b) => {
        const da = Math.abs(a.slots - n) - Math.abs(b.slots - n);
        if (da !== 0) return da;
        if (a.cross !== b.cross) return a.cross ? 1 : -1;
        return a.i - b.i;
      })
      .slice(0, 3);
    if (scored.length) {
      fitLine =
        `Your ${n}-line copy fits: ` +
        scored.map((x) => `*${x.i}. ${x.w.name}* (${x.slots} slots)`).join("  ·  ");
    }
  }

  const footer = opts.pastedCopy
    ? [
        "Reply:",
        "• `workflow N` - use it (your pasted copy gets slotted into its boxes)",
        "• `template N` - same, said explicitly: re-slot YOUR copy into its structure",
        "• `create` - build a NEW workflow from your copy (roles + timings + positions, saved to the library)",
        "• `map` - see the whole library",
      ]
    : [
        "Reply `workflow N` to use one, or paste your copy block (3+ lines) and I rank which workflows fit it.",
        "`create` after pasting builds a new workflow from your copy. `map` shows the whole library.",
      ];

  await slack.postThreadReply(
    channel,
    threadTs,
    [
      "*Which workflow are we building?*",
      fitLine,
      lines.length ? lines.join("\n") : "_No workflows yet. Paste your copy and reply `create`._",
      "",
      ...footer,
    ]
      .filter(Boolean)
      .join("\n")
  );
  const job = await getLatestJobByThread(threadTs);
  if (job) await updateJob(job, { data: { ...job.data, workflow_menu: menu } });
}

/** `create` (or empty library + pasted copy): productize the pasted block into a saved ACTIVE
 *  workflow, show the structure (roles + timings + positions + category), then continue the
 *  normal flow from the structured-copy card seeded with the operator's exact lines. */
async function createWorkflowFromPastedCopy(channel: string, threadTs: string, job: ContentJob): Promise<void> {
  try {
    const pasted = job.data.pasted_copy;
    if (!pasted) return;
    const vertical = await loadVertical(job.vertical_id);
    const p = await productizeCopyToWorkflow({ vertical, pastedBlock: pasted, hook: job.data.chosen_hook });
    if (!p) {
      await slack.postThreadReply(channel, threadTs, "Could not structure that copy. Try `create` again, or pick a workflow with `workflow N`.");
      return;
    }
    const created = await createWorkflowFromProductized({
      verticalId: job.vertical_id,
      p,
      songRef: job.data.song_ref ?? null,
    });
    if (!created) {
      await slack.postThreadReply(channel, threadTs, "Could not save the new workflow. Try `create` again.");
      return;
    }
    const { workflow: wf, specErrors } = created;
    const lines: StructuredCopyLine[] = p.lines.map((l) => ({ key: l.key, label: l.label, text: l.text }));
    const structure = p.lines
      .map((l) => `  [${l.label}] "${l.text}"  ->  shot ${l.shot}, ${l.at_second}s to ${l.out_second}s, ${l.position}`)
      .join("\n");
    await slack.postThreadReply(
      channel,
      threadTs,
      [
        `Saved as workflow: *${wf.name}* (${wf.category}${wf.subcategory ? "/" + wf.subcategory : ""}, ${p.shots.length} shots, ${p.duration_seconds}s, ${wf.render_options.aspect}).`,
        "Same structure, different copy next time. The pattern:",
        structure,
        specErrors.length ? "Fix before rendering:\n" + specErrors.map((e) => `• ${e}`).join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    const card = await postStructuredCopyCard(channel, threadTs, wf, lines);
    const cardTs = (card as { ts?: string }).ts;
    const fresh = await getLatestJobByThread(threadTs);
    if (fresh)
      await updateJob(fresh, {
        stage: "structured_copy",
        pickerTs: cardTs ?? fresh.picker_msg_ts,
        data: { ...fresh.data, workflow_id: wf.id, structured_copy: lines },
      });
    if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
  } catch (e) {
    console.error("[workflow-pipeline] createWorkflowFromPastedCopy failed:", (e as Error).message);
    await slack.postThreadReply(channel, threadTs, "Could not create the workflow. Try `create` again.").catch(() => {});
  }
}

/** Post the labeled copy boxes for a workflow (each `N. *Label* — text`). The optional footer
 *  overrides the default ✅ hint (the remix card renders with the SAME images). */
async function postStructuredCopyCard(
  channel: string,
  threadTs: string,
  workflow: Workflow,
  lines: StructuredCopyLine[],
  footer?: string
): Promise<unknown> {
  const body = lines.map((l, i) => `${i + 1}. *${l.label}* — ${l.text || "_(empty)_"}`).join("\n");
  return slack.postThreadReply(
    channel,
    threadTs,
    [
      `*${workflow.name}* — copy. Edit any line with \`line N <text>\`, or paste a full block to re-slot.`,
      body,
      "",
      footer ?? "React ✅ when the copy is right (then I paint it onto the shot images).",
    ].join("\n")
  );
}

// ---- Remix upsell: 16 narrative variations of the same workflow + audio + render ---------

function remixCardFooter(angleLabel?: string): string {
  return [
    `React ✅ to render this *${angleLabel ?? "remix"}* variation with the SAME images.`,
    "Reply `new images` to regenerate the creatives from this copy, or `line N <text>` to edit.",
  ].join("\n");
}

/** Post a remix's labeled copy for approval and park the session at remix_copy (✅ = render the
 *  variation with the same images; `new images` = regenerate creatives from the new copy). */
async function postRemixCopyCard(
  channel: string,
  threadTs: string,
  job: ContentJob,
  workflow: Workflow,
  angleLabel: string,
  lines: StructuredCopyLine[]
): Promise<void> {
  const card = await postStructuredCopyCard(channel, threadTs, workflow, lines, remixCardFooter(angleLabel));
  const cardTs = (card as { ts?: string }).ts;
  await updateJob(job, {
    stage: "remix_copy",
    pickerTs: cardTs ?? job.picker_msg_ts,
    data: { ...job.data, structured_copy: lines, remix_angle: angleLabel },
  });
  if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
}

/** ✅ on a remix copy card: re-render the SAME images + song with the new copy (straight to the
 *  render-confirm gate; the spec's texts are overlaid from the approved remix lines). */
async function renderRemixSameImages(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const wf = await loadWorkflow(wfId);
  if (!wf) return false;
  const threadTs = job.slack_thread_ts;
  await slack.postThreadReply(
    channel,
    threadTs,
    `Building the *${job.data.remix_angle ?? "remix"}* variation with the same images + song...`
  );
  await postRenderConfirmCard(channel, threadTs, job, wf, job.data.song_ref ?? wf.song_ref ?? null);
  return true;
}

/** The upsell after a render prompt is emitted: one click away from 16 more variations of the
 *  same workflow + audio + render combo. */
async function postRemixOffer(channel: string, threadTs: string): Promise<void> {
  const list = REMIX_ANGLES.map((a, i) => `${i + 1}. ${a.label}`).join("   ·   ");
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      "*Want a variation of this video?* Same workflow + song + timings, a different narrative:",
      list,
      "",
      "Reply `remix N` for one, or `remixes` to draft all 16 at once.",
      "The new copy comes back for approval: ✅ renders it with the SAME images, `new images` regenerates the creatives from the new copy.",
    ].join("\n")
  );
}

/** For an animated workflow whose seed scenes carry authored motion prompts, those per-shot
 *  animation prompts are LOCKED (e.g. draw-on styles encode the exact second each element is
 *  drawn) and must survive prompt regeneration verbatim. Returns them in shot order, or
 *  undefined when the workflow doesn't opt in (non-animated, or no authored scene motion). */
function lockedAnimationPromptsFor(wf?: Workflow): string[] | undefined {
  if (!wf || wf.render_spec?.mode !== "animated") return undefined;
  const motions = (wf.scenes ?? []).map((s) => (s?.animation_prompt ?? "").trim());
  return motions.some((m) => m.length > 0) ? motions : undefined;
}

/** The plain picture flow for an active workflow with NO copy structure (today's behavior). */
async function generateAndPostPicture(args: {
  channel: string;
  threadTs: string;
  verticalId: string;
  hook: string;
  caption: string;
  storyboard: string;
  workflow?: Workflow;
}): Promise<void> {
  try {
    const vertical = await loadVertical(args.verticalId);
    const plan = await generatePicturePlan({
      vertical,
      chosenHook: args.hook,
      chosenCaption: args.caption,
      chosenStoryboard: args.storyboard,
      workflow: args.workflow,
      lockedAnimationPrompts: lockedAnimationPromptsFor(args.workflow),
    });
    const name = args.workflow?.name || (args.hook || args.storyboard).slice(0, 60);
    const wfId = args.workflow?.id || workflowId(args.verticalId, "pov", name);
    const scenes: WorkflowScene[] = plan.scenes.map((s) => ({
      role: s.role,
      image_prompt: s.image_prompt,
      animation_prompt: s.animation_prompt,
      duration_seconds: 2,
      image_url: null,
      image_approved: false,
    }));
    // Only a brand-NEW draft workflow is upserted here (the row must exist). An existing
    // workflow's row is NOT touched mid-session — the plan lives on the job (session_scenes)
    // until the animation gate writes it back.
    if (!args.workflow) {
      const workflow: Workflow = {
        id: wfId,
        vertical_id: args.verticalId,
        name,
        category: "pov",
        subcategory: null,
        status: "draft",
        scenes,
        captions: plan.captions,
        song_ref: null,
        render_sequences: [],
        render_options: { min_shots: scenes.length, max_shots: scenes.length, clip_seconds: 2, aspect: "9:16" },
        example_video_url: null,
        example_storyboard: null,
        shot_screenshots: [],
        source_kind: "authored",
        source_example_id: null,
      };
      await upsertWorkflow(workflow);
    }

    const sceneLines = plan.scenes
      .map((s, i) => `*Scene ${i + 1} — ${s.role}*\n  image: ${s.image_prompt}\n  motion: ${s.animation_prompt}`)
      .join("\n\n");
    const timeline = plan.captions.map((c) => `  ${c.at_second}s  ${c.text}`).join("\n");
    const card = await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [
        `*The picture* for *${name}*:`,
        sceneLines,
        "",
        "*On-screen text (timed):*",
        "```",
        timeline,
        "```",
        "React ✅ to generate the images. Reply to tweak any scene first.",
      ].join("\n")
    );
    const cardTs = (card as { ts?: string }).ts;
    const fresh = await getLatestJobByThread(args.threadTs);
    if (fresh)
      await updateJob(fresh, {
        pickerTs: cardTs ?? fresh.picker_msg_ts,
        data: {
          ...fresh.data,
          workflow_id: wfId,
          caption_storyboard: { captions: plan.captions, ig_caption: args.caption },
          session_scenes: scenes.map((s) => ({
            role: s.role,
            image_prompt: s.image_prompt,
            animation_prompt: s.animation_prompt,
            image_url: null,
            image_approved: false,
          })),
        },
      });
    if (cardTs) await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
  } catch (e) {
    console.error("[workflow-pipeline] generateAndPostPicture failed:", (e as Error).message);
    await slack.postThreadReply(args.channel, args.threadTs, "Could not map the picture. Try `pick` again.").catch(() => {});
  }
}

/** Build a picture card grouped by shot: each shot's image prompt + the copy that lands on it. */
function buildPictureCard(workflow: Workflow, spec: RenderSpec): string {
  const modeLabel = spec.mode === "animated" ? "video (animated clips)" : "static images";
  const out: string[] = [`*The picture* for *${workflow.name}* (${modeLabel}, ${spec.duration_seconds}s):`];
  for (const shot of [...spec.shots].sort((a, b) => a.i - b.i)) {
    const scene = workflow.scenes[shot.i - 1];
    out.push(`*Shot ${shot.i}* (${shot.start}s to ${shot.end}s)${scene?.role ? ` — ${scene.role}` : ""}`);
    if (scene?.image_prompt) out.push(`  image: ${scene.image_prompt}`);
    for (const tx of textsForShot(spec, shot.i)) {
      const pos = tx.position ? ` (${tx.position})` : "";
      out.push(`  ${tx.at_second}s to ${tx.out_second ?? shot.end}s  "${tx.text || tx.role || ""}"${pos}`);
    }
  }
  out.push("", "React ✅ to see the final image prompts (nothing generates yet).");
  return out.join("\n");
}

/** ✅ on the labeled-copy card: the IDEAS GATE. Post 3 distinct visual directions (each: title +
 *  one b-roll gist per shot, matched to the approved copy) and wait for `idea N` before any
 *  image generates. `more ideas` redraws; `more hooks` goes back to the hook menu. */
async function startPictureIdeas(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const threadTs = job.slack_thread_ts;
  await updateJob(job, { stage: "picture_ideas" });
  await slack.postThreadReply(channel, threadTs, "Copy locked. Drafting 3 visual directions for the b-roll...");

  waitUntil(
    (async () => {
      try {
        const wf = await loadWorkflow(wfId);
        if (!wf) return;
        const vertical = await loadVertical(job.vertical_id);
        const ideas = await generatePictureIdeas({
          vertical,
          workflow: wf,
          structuredCopy: job.data.structured_copy ?? [],
        });
        const body: string[] = [`*Visual directions for ${wf.name}* — pick one before any image generates:`];
        ideas.forEach((idea, i) => {
          body.push("", `*${i + 1}. ${idea.title}*`);
          idea.shots.forEach((s, j) => body.push(`   Shot ${j + 1}: ${s}`));
        });
        body.push(
          "",
          "Reply `idea N` (or react ✅ for idea 1) to lock it and paint the picture.",
          "`more ideas` for 3 fresh directions · `more hooks` for new hook options."
        );
        const card = await slack.postThreadReply(channel, threadTs, body.join("\n"));
        const cardTs = (card as { ts?: string }).ts;
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh)
          await updateJob(fresh, {
            pickerTs: cardTs ?? fresh.picker_msg_ts,
            data: { ...fresh.data, picture_ideas: ideas },
          });
        if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        console.error("[workflow-pipeline] picture ideas failed:", (e as Error).message);
        // The IDEA GATE is MANDATORY. The old fallthrough built the picture with NO chosen idea,
        // which let the workflow's seeded subject (the wasp nest) drive the prompts. Stay at the
        // copy card and retry instead.
        await slack
          .postThreadReply(channel, threadTs, "Could not draft the visual directions. React ✅ on the copy card again (or reply `more ideas`) to retry.")
          .catch(() => {});
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh) await updateJob(fresh, { stage: "structured_copy" });
      }
    })()
  );
  return true;
}

/** Lock visual direction N and hand off to the picture build (the idea rides in as the
 *  storyboard seed so every scene prompt follows the chosen direction). */
async function pickPictureIdea(job: ContentJob, channel: string, n: number): Promise<boolean> {
  const ideas = job.data.picture_ideas ?? [];
  const idea = ideas[n - 1];
  const threadTs = job.slack_thread_ts;
  if (!idea) {
    await slack.postThreadReply(channel, threadTs, `No idea ${n} on the card. Reply \`idea 1\`-\`idea ${ideas.length || 3}\` or \`more ideas\`.`);
    return true;
  }
  const ideaText = [`Visual direction: ${idea.title}`, ...idea.shots.map((s, i) => `Shot ${i + 1}: ${s}`)].join("\n");
  // chosen_idea_shots = each shot's NON-NEGOTIABLE subject for the picture plan.
  await updateJob(job, { data: { ...job.data, chosen_idea: ideaText, chosen_storyboard: ideaText, chosen_idea_shots: idea.shots } });
  await slack.postThreadReply(channel, threadTs, `Locked *${idea.title}*.`);
  const fresh = await getLatestJobByThread(threadTs);
  return buildPictureFromStructuredCopy(fresh ?? job, channel);
}

/** ✅ on the labeled-copy card: generate one image prompt per shot from the copy, upsert them onto
 *  the workflow, and post the picture grouped by shot (copy painted on the images). */
async function buildPictureFromStructuredCopy(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const threadTs = job.slack_thread_ts;
  await updateJob(job, { stage: "picture" });
  await slack.postThreadReply(channel, threadTs, "Painting the picture (mapping copy to the shots)...");

  waitUntil(
    (async () => {
      try {
        const wf = await loadWorkflow(wfId);
        if (!wf) return;
        const structured = job.data.structured_copy ?? [];
        const base = specFromWorkflow(wf);
        const spec = base ? applyCopyToSpec(base, structured) : null;
        const shotCount = spec?.shots.length || wf.render_options.max_shots || 3;
        const vertical = await loadVertical(job.vertical_id);
        const captionText = structured.map((l) => l.text).filter(Boolean).join(" / ");
        // NEVER seed the subject from wf.name (a workflow literally named "wasp nest removal"
        // used to drive the subject whenever no idea was picked). The session's copy is the
        // fallback; the chosen idea's per-shot gists are the per-shot subjects.
        const plan = await generatePicturePlan({
          vertical,
          chosenHook: job.data.chosen_hook || structured.find((l) => l.text)?.text || "",
          chosenCaption: captionText,
          chosenStoryboard: job.data.chosen_storyboard || captionText,
          chosenIdeaShots: job.data.chosen_idea_shots,
          workflow: wf,
          lockedAnimationPrompts: lockedAnimationPromptsFor(wf),
        });
        let scenes = plan.scenes.slice(0, shotCount);
        while (scenes.length < shotCount) {
          scenes = scenes.concat(scenes[scenes.length - 1] ?? { role: `shot ${scenes.length + 1}`, image_prompt: "first-person b-roll on the job", animation_prompt: "slow push in" });
        }
        // SESSION-SCOPED (the wasp-leak fix): the plan lives on the JOB, not the shared
        // workflows row. The animation gate is the one sanctioned write-back.
        const sessionScenes: SessionScene[] = scenes.map((s) => ({
          role: s.role,
          image_prompt: s.image_prompt,
          animation_prompt: s.animation_prompt,
          image_url: null,
          image_approved: false,
        }));
        const preview: Workflow = {
          ...wf,
          scenes: sessionScenes.map((s, i) => ({
            role: s.role,
            image_prompt: s.image_prompt,
            animation_prompt: s.animation_prompt,
            duration_seconds: wf.scenes[i]?.duration_seconds ?? 2,
            image_url: null,
            image_approved: false,
          })),
        };
        const card = await slack.postThreadReply(channel, threadTs, spec ? buildPictureCard(preview, spec) : "React ✅ to see the final image prompts.");
        const cardTs = (card as { ts?: string }).ts;
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh)
          await updateJob(fresh, {
            pickerTs: cardTs ?? fresh.picker_msg_ts,
            // A fresh picture invalidates previously approved prompts.
            data: { ...fresh.data, candidate_spec: spec, final_prompts: undefined, session_scenes: sessionScenes },
          });
        if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        console.error("[workflow-pipeline] buildPictureFromStructuredCopy failed:", (e as Error).message);
        await slack.postThreadReply(channel, threadTs, "Could not paint the picture. Try `modify copy`.").catch(() => {});
      }
    })()
  );
  return true;
}

/** After the song is set, confirm the render mode + validate, then wait for ✅ to emit the prompt. */
async function postRenderConfirmCard(
  channel: string,
  threadTs: string,
  job: ContentJob,
  workflow: Workflow,
  songRef: string | null
): Promise<void> {
  const mode: RenderMode = (workflow.render_spec?.mode as RenderMode) ?? "static_images";
  const base = specFromWorkflow(workflow, mode);
  if (!base) return;
  const spec = applyCopyToSpec(base, job.data.structured_copy);
  spec.song_ref = songRef;
  const errs = validateRenderSpec(spec);
  const modeLabel = mode === "animated" ? "video (animated clips)" : "static images";
  const onboarding =
    workflow.production_status === "in_production"
      ? `Onboarding ${(workflow.approved_variations ?? []).length}/4 approved variations to LIVE.`
      : workflow.production_status === "live"
        ? "★ This workflow is LIVE."
        : "";
  const card = await slack.postThreadReply(
    channel,
    threadTs,
    [
      buildVideoDescription(workflow, spec),
      "",
      onboarding,
      errs.length
        ? "*Fix these before rendering:*\n" + errs.map((e) => `• ${e}`).join("\n")
        : `*We have everything: copy, images, animation prompts, song.* Render *${workflow.name}* with *${modeLabel}*?`,
      errs.length
        ? ""
        : "React ✅ to get the Claude Code prompt to build this render. Post a clip for any shot to switch it to video.",
    ]
      .filter(Boolean)
      .join("\n")
  );
  const cardTs = (card as { ts?: string }).ts;
  await updateJob(job, {
    stage: "authoring",
    pickerTs: cardTs ?? job.picker_msg_ts,
    data: { ...job.data, candidate_spec: spec, render_mode: mode, song_ref: songRef ?? undefined },
  });
  if (cardTs && !errs.length) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
}

/** ✅ on the render-confirm card: validate once more, then post the Claude Code prompt + the
 *  machine-readable video description. */
async function emitRenderPrompt(job: ContentJob, channel: string): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const threadTs = job.slack_thread_ts;
  const wf = await loadWorkflow(wfId);
  if (!wf) return false;
  let spec = job.data.candidate_spec as RenderSpec | undefined;
  if (!spec) {
    const base = specFromWorkflow(wf, job.data.render_mode);
    spec = base ? applyCopyToSpec(base, job.data.structured_copy) : undefined;
  }
  if (!spec) {
    await slack.postThreadReply(channel, threadTs, "No render spec to build yet.");
    return true;
  }
  if (job.data.song_ref) spec.song_ref = job.data.song_ref;
  const errs = validateRenderSpec(spec);
  if (errs.length) {
    await slack.postThreadReply(channel, threadTs, ["Cannot render yet:", ...errs.map((e) => `• ${e}`)].join("\n"));
    return true;
  }
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      "Here is the Claude Code prompt to build this render:",
      buildRenderClaudePrompt(wf, spec),
      "",
      "*Video description* (for the analyzer + creative director):",
      buildVideoDescription(wf, spec),
    ].join("\n")
  );

  // Onboarding gate: every ✅-approved render counts as an APPROVED VARIATION. Once a workflow
  // is in production, 4 of them flip it LIVE. The array keeps growing after live too - it is
  // the workflow's generated-examples gallery on the dashboard.
  if (wf.production_status === "in_production" || wf.production_status === "live") {
    const count = await addApprovedVariation(wf.id, {
      label: (job.data.remix_angle as string | undefined) ?? "base",
      structured_copy: (job.data.structured_copy ?? []).map((l) => ({ key: l.key, text: l.text })),
      song_ref: spec.song_ref ?? null,
      thread_ts: threadTs,
      image_urls: wf.scenes.map((s) => s.image_url).filter((u): u is string => Boolean(u)),
    });
    if (count !== null && wf.production_status === "in_production") {
      if (count >= 4) {
        await setProductionStatus(wf.id, "live");
        await slack.postThreadReply(channel, threadTs, `★ *${wf.name}* is LIVE. ${count} approved variations in the library.`);
      } else {
        await slack.postThreadReply(channel, threadTs, `Onboarding ${count}/4 approved variations. ${4 - count} more to go LIVE.`);
      }
    }
  }

  // Keep the session ALIVE: the variations suggestion card fires when the final MP4 lands in
  // this thread (handleWorkflowReferenceUpload). `remix N` / `remixes` still work as text.
  await updateJob(job, { stage: "remix_offer" });
  await slack.postThreadReply(
    channel,
    threadTs,
    "When the render is done, drop the final MP4 in this thread — I'll log it and offer variations of this exact version."
  );
  return true;
}

/** `save as <name>`: clone the workflow's settings into a new DRAFT, carry them into a fresh
 *  #content-full message + session, and leave the original as a draft. */
async function startSaveAs(channel: string, job: ContentJob, wf0: Workflow, newName: string): Promise<void> {
  const cloneId = workflowId(wf0.vertical_id, String(wf0.category), newName);
  const clone: Workflow = {
    ...wf0,
    id: cloneId,
    name: newName,
    status: "draft",
    source_kind: "reference_video",
    shot_screenshots: [],
    used_at: null,
  };
  await upsertWorkflow(clone);
  await setWorkflowStatus(wf0.id, "draft"); // leave the original as a draft
  const shots = clone.render_spec?.shots.length ?? clone.copy_structure?.length ?? 0;
  const msg = await slack.postMessage(
    channel,
    [
      `*New workflow* *${newName}* started from *${wf0.name}* (both drafts now).`,
      `Carried: ${shots} shots, song ${resolveSong(clone.song_ref).label}, ${String(clone.category)}/${clone.subcategory ?? "general"}.`,
      "Add or change the song with `song <key|url>`, paste new timestamps, or upload an example video. Then I hand you the Claude Code prompt.",
    ].join("\n")
  );
  const ts = (msg as { ts?: string }).ts;
  if (ts) {
    await insertJob({
      formatId: "workflow",
      verticalId: wf0.vertical_id,
      channel,
      threadTs: ts,
      pickerTs: ts,
      stage: "authoring",
      sourceKind: "save_as",
      data: { workflow_id: cloneId, structured_copy: job.data.structured_copy, save_as_from: wf0.id },
    });
  }
}

/** Heuristic: a pasted block that looks like a shot/timestamp storyboard. */
function looksLikeStoryboard(t: string): boolean {
  if (!/\n/.test(t)) return false;
  const timing = /\b\d+(\.\d+)?\s*(?:to|-|–)\s*\d+(\.\d+)?\s*s?\b/i;
  const shotHdr = /\b(video|shot|clip)\s*\d+\b/i;
  const txtCount = (t.match(/\btxt\b/gi) ?? []).length;
  return timing.test(t) && (shotHdr.test(t) || txtCount >= 2);
}

/** Parse a pasted storyboard, mismatch-guard it against the workflow, validate, and either offer
 *  options (never auto-render) or move to the render-confirm gate. */
async function handlePastedStoryboard(
  channel: string,
  threadTs: string,
  job: ContentJob,
  wf0: Workflow,
  pasted: string
): Promise<void> {
  try {
    const mode: RenderMode = (wf0.render_spec?.mode as RenderMode) ?? "static_images";
    const spec = await parseStoryboardToRenderSpec({ text: pasted, mode, songRef: job.data.song_ref ?? wf0.song_ref });
    if (!spec) {
      await slack.postThreadReply(channel, threadTs, "Could not read those timestamps. Check the format and try again.");
      return;
    }
    const structRoles = wf0.copy_structure?.length ?? 0;
    const structShots = wf0.render_spec?.shots.length ?? wf0.render_options.max_shots ?? 0;
    const mismatch =
      (structRoles > 0 && spec.texts.length !== structRoles) || (structShots > 0 && spec.shots.length !== structShots);
    await updateJob(job, { data: { ...job.data, candidate_spec: spec } });

    if (mismatch) {
      await slack.postThreadReply(
        channel,
        threadTs,
        [
          "This is not what you said.",
          `The workflow *${wf0.name}* is ${structRoles} lines / ${structShots} shots; your paste is ${spec.texts.length} lines / ${spec.shots.length} shots.`,
          "What do you want to do?",
          "• `modify copy` — bring the copy back to the structure",
          "• `save as <new name>` — keep this as a new workflow (the original stays a draft)",
          "• `save draft` — save the current build and stop",
        ].join("\n")
      );
      return;
    }
    const errs = validateRenderSpec(spec);
    if (errs.length) {
      await slack.postThreadReply(channel, threadTs, ["Fix these before rendering:", ...errs.map((e) => `• ${e}`)].join("\n"));
      return;
    }
    await postRenderConfirmCard(channel, threadTs, job, { ...wf0, render_spec: spec }, spec.song_ref ?? null);
  } catch (e) {
    console.error("[workflow-pipeline] handlePastedStoryboard failed:", (e as Error).message);
  }
}

/**
 * Launch a workflow's Slack session from the app ("Run in Slack"): post to #content-full, seed a
 * job at the structured_copy stage for this workflow, generate + post the labeled copy card with a
 * ✅. The rest of the flow (edit copy -> paint picture -> images -> song -> render prompt) runs in
 * Slack as usual. Returns the thread ts so the app can deep-link.
 */
export async function launchWorkflowInSlack(id: string): Promise<{ ok: boolean; threadTs?: string }> {
  const channel = process.env.SLACK_CONTENT_FULL_CHANNEL;
  if (!channel) return { ok: false };
  const wf = await loadWorkflow(id);
  if (!wf) return { ok: false };
  const res = await slack.postMessage(
    channel,
    `*Vektor* launching *${wf.name}* (\`${wf.vertical_id}\`) from the app. Building the copy...`
  );
  const ts = (res as { ts?: string }).ts;
  if (!ts) return { ok: false };

  if (!wf.copy_structure?.length) {
    await slack.postThreadReply(channel, ts, `*${wf.name}* has no copy structure yet. Configure it via Claude Code first.`);
    return { ok: true, threadTs: ts };
  }

  await insertJob({
    formatId: "workflow",
    verticalId: wf.vertical_id,
    channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "structured_copy",
    sourceKind: "app_launch",
    data: { workflow_id: wf.id },
  });

  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(wf.vertical_id);
        const lines = await generateStructuredCopy({ vertical, workflow: wf, seed: {} });
        const card = await postStructuredCopyCard(channel, ts, wf, lines);
        const cardTs = (card as { ts?: string }).ts;
        const fresh = await getLatestJobByThread(ts);
        if (fresh)
          await updateJob(fresh, { pickerTs: cardTs ?? fresh.picker_msg_ts, data: { ...fresh.data, structured_copy: lines } });
        if (cardTs) await slack.addReaction(channel, cardTs, "white_check_mark").catch(() => {});
      } catch (e) {
        console.error("[workflow-pipeline] launchWorkflowInSlack gen failed:", (e as Error).message);
      }
    })()
  );
  return { ok: true, threadTs: ts };
}

// ---- Slack file drops: song attach + reference creatives --------------------------------

interface DroppedFile {
  name?: string;
  mimetype?: string;
  url_private_download?: string;
}

function isAudioFile(f: DroppedFile): boolean {
  return (f.mimetype ?? "").startsWith("audio/") || /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.name ?? "");
}

/**
 * An AUDIO file dropped in #content-full: store it in Supabase and attach it as the active
 * session's song (this is how new workflows get their audio without leaving Slack). Claims the
 * message only when an active workflow session exists; returns false otherwise.
 */
export async function handleSongAttachment(args: {
  channel: string;
  threadTs?: string;
  files: DroppedFile[];
}): Promise<boolean> {
  const audio = args.files.find(isAudioFile);
  if (!audio?.url_private_download) return false;
  const job =
    (args.threadTs ? await getLatestJobByThread(args.threadTs) : null) ??
    (await getLatestSessionByChannel(args.channel));
  if (!job || job.format_id !== "workflow") return false;
  const threadTs = job.slack_thread_ts;
  try {
    const buf = await slack.downloadFile(audio.url_private_download);
    const url = await uploadToReels(buf, audio.mimetype || "audio/mp4");
    if (!url) {
      await slack.postThreadReply(args.channel, threadTs, "Could not store that audio. Try attaching it again.");
      return true;
    }
    await updateJob(job, { data: { ...job.data, song_ref: url } });
    if (job.data.workflow_id) {
      await setWorkflowSong(job.data.workflow_id, url);
      await addWorkflowReference(job.data.workflow_id, { kind: "audio", url });
      const wf = await loadWorkflow(job.data.workflow_id);
      await slack.postThreadReply(
        args.channel,
        threadTs,
        [
          `🎵 Song attached to *${wf?.name ?? "the workflow"}*.`,
          wf?.render_spec
            ? "Reply `sync auto` to snap shot cuts + text drops to its beat, or `sync manual` to keep your timings."
            : "It rides along once the render spec exists.",
        ].join(" ")
      );
    } else {
      await slack.postThreadReply(
        args.channel,
        threadTs,
        "🎵 Song stored for this session. It attaches to the workflow you pick or `create`."
      );
    }
    return true;
  } catch (e) {
    console.error("[workflow-pipeline] song attach failed:", (e as Error).message);
    await slack.postThreadReply(args.channel, threadTs, "Could not attach that audio. Try again.").catch(() => {});
    return true;
  }
}

/**
 * Media dropped in a workflow session thread, routed by the session's stage:
 *   awaiting_images / image_review -> SCENE IMAGES (manual-image mode): each pasted image is
 *     approved on arrival, fills the next unfilled scene slot (or `scene N` in the message
 *     targets one), and is ALSO saved to the workflow's reference library — the dataset that
 *     grounds future prompts and future automation.
 *   remix_offer + a video -> the FINAL RENDERED MP4: logged on the session, then the
 *     variations suggestion card posts.
 *   anything else -> REFERENCE CREATIVES (the production gate: 3 refs -> produce the 4th).
 * Claims the drop only when this thread's session has a workflow in context.
 */
export async function handleWorkflowReferenceUpload(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
  text?: string;
}): Promise<boolean> {
  const media = args.files.filter(
    (f) =>
      f.url_private_download &&
      ((f.mimetype ?? "").startsWith("image/") || (f.mimetype ?? "").startsWith("video/"))
  );
  if (!media.length) return false;
  const job = await getLatestJobByThread(args.threadTs);
  if (!job || job.format_id !== "workflow" || !job.data.workflow_id) return false;
  const wfId = job.data.workflow_id;
  const threadTs = job.slack_thread_ts;

  // ---- Scene-image intake (manual-image mode) ----------------------------------------------
  const sess = job.data.session_scenes ?? [];
  if ((job.stage === "awaiting_images" || job.stage === "image_review") && sess.length) {
    const images = media.filter((f) => (f.mimetype ?? "").startsWith("image/"));
    if (!images.length) {
      await slack.postThreadReply(args.channel, threadTs, "Waiting on the scene IMAGES here (videos come later at the render step).");
      return true;
    }
    const wfForScenes = await loadWorkflow(wfId);
    const scenes = sess.map((s) => ({ ...s }));
    // `scene N` in the message targets a slot (and replaces it); otherwise fill in order.
    const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(args.text ?? "");
    let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
    for (const f of images.slice(0, scenes.length)) {
      let slot = target ?? scenes.findIndex((s) => !s.image_url);
      if (slot === null || slot < 0 || slot >= scenes.length) {
        if (target === null) {
          await slack.postThreadReply(
            args.channel,
            threadTs,
            `All ${scenes.length} scenes have images. Comment \`scene N\` on an upload to replace one, or react ✅ to continue.`
          );
          break;
        }
        slot = Math.min(Math.max(target, 0), scenes.length - 1);
      }
      try {
        const buf = await slack.downloadFile(f.url_private_download!);
        const url = await uploadToReels(buf, f.mimetype || "image/png");
        if (!url) {
          await slack.postThreadReply(args.channel, threadTs, "Could not store that image. Try uploading it again.");
          continue;
        }
        scenes[slot] = { ...scenes[slot], image_url: url, image_approved: true };
        // The feedback dataset: every approved manual image grounds this workflow's future
        // prompts (loadReferenceFrames workflow tier) — this is the railway to automation.
        await saveContentExample({
          verticalId: job.vertical_id,
          workflowId: wfId,
          sourcePath: url,
          storyboard: { hook: scenes[slot].role || wfForScenes?.name || wfId, shots: [] },
          labels: ["approved_manual", "scene_image"],
          difficulty: "medium",
          frameUrls: [url],
        }).catch((e) => console.error("[workflow-pipeline] scene-image example save failed:", (e as Error).message));
        const filled = scenes.filter((s) => s.image_url).length;
        await slack.postThreadReply(
          args.channel,
          threadTs,
          `Scene ${slot + 1} (*${scenes[slot].role}*) received and approved. ${filled} of ${scenes.length}.`
        );
      } catch (e) {
        console.error("[workflow-pipeline] scene-image intake failed:", (e as Error).message);
        await slack.postThreadReply(args.channel, threadTs, "Could not save that image. Try uploading it again.").catch(() => {});
      }
      if (target !== null) target++;
    }
    await updateJob(job, { data: { ...job.data, session_scenes: scenes } });
    if (scenes.every((s) => s.image_url)) {
      await slack.postThreadReply(
        args.channel,
        threadTs,
        [
          `*All ${scenes.length} scene images are in:*`,
          ...scenes.map((s, i) => `${i + 1}. *${s.role}* — ${s.image_url}`),
          "",
          "Moving to the animation prompts.",
        ].join("\n")
      );
      const fresh = await getLatestJobByThread(threadTs);
      await startAnimationReview(fresh ?? job, args.channel);
    }
    return true;
  }

  // ---- Final rendered MP4 -> the variations suggestion card --------------------------------
  if (job.stage === "remix_offer") {
    const video = media.find((f) => (f.mimetype ?? "").startsWith("video/"));
    if (video?.url_private_download) {
      try {
        const buf = await slack.downloadFile(video.url_private_download);
        const url = await uploadToReels(buf, video.mimetype || "video/mp4");
        if (url) await updateJob(job, { data: { ...job.data, final_video_url: url } });
      } catch (e) {
        console.error("[workflow-pipeline] final video store failed:", (e as Error).message);
      }
      await slack.postThreadReply(args.channel, threadTs, "*Final video received.*");
      await postRemixOffer(args.channel, threadTs);
      return true;
    }
  }

  const wfForRefs = await loadWorkflow(wfId);
  let count: number | null = null;
  for (const f of media.slice(0, 5)) {
    try {
      const buf = await slack.downloadFile(f.url_private_download!);
      const url = await uploadToReels(buf, f.mimetype || "image/jpeg");
      if (!url) continue;
      const kind = (f.mimetype ?? "").startsWith("video/") ? "video" : "screenshot";
      count = await addWorkflowReference(wfId, { kind, url });
      // Every dropped ref ALSO lands in THIS workflow's reference library, so it grounds
      // every future image the workflow generates (loadReferenceFrames workflowId tier).
      // Videos get frames sampled; a sampling failure still saves the row (logged).
      let frameUrls: string[] = [url];
      if (kind === "video") {
        const sampled = await fetchVideoFrames(url, 4).catch(() => ({ ok: false as const }));
        frameUrls = sampled.ok && sampled.frames?.length ? sampled.frames : [];
        if (!frameUrls.length)
          console.error("[workflow-pipeline] reference video frame sampling failed; row saved without frames:", url);
      }
      await saveContentExample({
        verticalId: job.vertical_id,
        workflowId: wfId,
        sourcePath: url,
        storyboard: { hook: wfForRefs?.name ?? wfId, shots: [] },
        labels: ["workflow_reference", kind],
        difficulty: "medium",
        frameUrls,
      });
    } catch (e) {
      console.error("[workflow-pipeline] reference upload failed:", (e as Error).message);
    }
  }
  if (count == null) {
    await slack.postThreadReply(
      args.channel,
      threadTs,
      "Could not save those as references (is the reference_media migration applied?)."
    );
    return true;
  }
  const wf = wfForRefs;
  await slack.postThreadReply(
    args.channel,
    threadTs,
    (count >= 3
      ? `Reference ${count}/3 saved for *${wf?.name ?? wfId}*. Reply \`finish workflow\` to render the production test and put it IN PRODUCTION.`
      : `Reference ${count}/3 saved for *${wf?.name ?? wfId}*. ${3 - count} more (screenshots of reels you like) and it can go into production.`) +
      "\nSaved to this workflow's reference library — future images will be grounded on it."
  );
  return true;
}

/** True when a top-level #content-full message is an avatar command like `vektor pest_control`. */
export function parseAvatarCommand(text: string): string | null {
  const m = /^\s*(?:vektor|avatar)\s+([a-z0-9_]+)\s*$/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export type { ContentJob };
