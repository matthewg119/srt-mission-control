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
} from "@/lib/reel/jobs";
import { generatePovImage, uploadToReels } from "@/lib/reel/pov";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import { saveContentExample } from "@/lib/reel/content-examples";
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
import type { ImageProvider } from "@/lib/providers/image-gen";
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
    return false;
  }

  if (job.format_id !== "workflow") return false;
  const threadTs = job.slack_thread_ts;

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
    const wfSong = await loadWorkflow(data.workflow_id);
    if (wfSong?.render_spec) {
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
      await slack.postThreadReply(
        args.channel,
        threadTs,
        `*${wfFin.name}* has ${refs}/3 reference creatives. Drop ${3 - refs} more screenshot(s)/video(s) of the manual edit in this thread (plus the song), then \`finish workflow\` again.`
      );
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
    if (!headline) return false;
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
    if (!hook) return false;

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
    if (!pm) return false;
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
    const wi = idxFrom(t, "workflow");
    const tmpl = idxFrom(t, "template");
    const pickIdx = wi ?? tmpl;
    if (!pickIdx) return false;
    if (tmpl && !data.pasted_copy) {
      await slack.postThreadReply(args.channel, threadTs, "Nothing pasted yet. Paste your copy block first, or use `workflow N`.");
      return true;
    }
    const menu = data.workflow_menu ?? [];
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
    return false;
  }

  // Stage: picture_ideas -> `idea N` locks a visual direction; `more ideas` redraws the card;
  // `more hooks` regenerates the hook menu for this workflow (more options before committing).
  if (job.stage === "picture_ideas") {
    const ii = idxFrom(t, "idea");
    if (ii) return pickPictureIdea(job, args.channel, ii);
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
    return false;
  }

  // Stage: picture -> `redo N <new prompt>` regenerates one scene's image.
  if (job.stage === "picture") {
    const rm = /^\s*redo\s+(\d{1,2})\s+(.+)\s*$/i.exec(t);
    if (rm && data.workflow_id) {
      const idx = parseInt(rm[1], 10) - 1;
      const newPrompt = rm[2].trim();
      const wf = await loadWorkflow(data.workflow_id);
      if (wf && wf.scenes[idx]) {
        await slack.postThreadReply(args.channel, threadTs, `Redoing scene ${idx + 1}...`);
        const vid = job.vertical_id;
        waitUntil(
          (async () => {
            try {
              const rendered = await renderScene(vid, newPrompt, wf);
              wf.scenes[idx].image_prompt = newPrompt;
              wf.scenes[idx].image_url = rendered?.url ?? wf.scenes[idx].image_url ?? null;
              await upsertWorkflow(wf);
              if (rendered) {
                await slack.uploadFile(args.channel, `scene${idx + 1}.png`, rendered.buffer, rendered.mimetype, threadTs);
                await saveContentExample({
                  verticalId: vid,
                  sourcePath: rendered.url,
                  storyboard: { hook: wf.name, labels: ["generated", "pov"], difficulty: "medium", shots: [] },
                  labels: ["generated", "pov"],
                  difficulty: "medium",
                  frameUrls: [rendered.url],
                });
              }
            } catch (e) {
              console.error("[workflow-pipeline] redo scene failed:", (e as Error).message);
            }
          })()
        );
        return true;
      }
    }
    return false;
  }

  return false;
}

/** Enrich a scene prompt on the avatar's references + THIS workflow's visual rules, then
 *  generate one still with the workflow's image settings (best-effort). */
async function renderScene(
  verticalId: string,
  imagePrompt: string,
  workflow?: Workflow | null
): Promise<{ url: string; buffer: Buffer; mimetype: string } | null> {
  try {
    const vertical = await loadVertical(verticalId);
    const enriched = await enrichScene(imagePrompt, {
      vertical,
      formatGroup: String(workflow?.category ?? "pov"),
      extraRules: workflow?.visual_rules,
    }).catch(() => imagePrompt);
    const img = await generatePovImage(enriched, {
      provider: workflow?.render_options?.provider as ImageProvider | undefined,
      aspect: workflow ? workflowAspect(workflow) : undefined,
      quality: workflow?.render_options?.quality,
    });
    if (!img) return null;
    const url = await uploadToReels(img.buffer, img.mimetype);
    if (!url) return null;
    return { url, buffer: img.buffer, mimetype: img.mimetype };
  } catch (e) {
    console.error("[workflow-pipeline] renderScene failed:", (e as Error).message);
    return null;
  }
}

/**
 * ✅ on a workflow card. Routed by the reacted job's stage:
 *   structured_copy -> build the picture (scene image prompts + grouped-by-shot preview)
 *   authoring       -> validate + emit the Claude Code prompt for the render
 *   picture         -> generate the real images per scene (today's behavior, grouped recap)
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
  if (job.stage !== "picture") return false;

  const workflowIdRef = job.data.workflow_id;
  if (!workflowIdRef) return false;

  const threadTs = job.slack_thread_ts;
  await updateJob(job, { stage: "render" });
  await slack.postThreadReply(args.channel, threadTs, "Generating the images for each scene...");

  waitUntil(
    (async () => {
      try {
        const wf = await loadWorkflow(workflowIdRef);
        if (!wf) return;
        for (let i = 0; i < wf.scenes.length; i++) {
          const scene = wf.scenes[i];
          const rendered = await renderScene(job.vertical_id, scene.image_prompt, wf);
          if (rendered) {
            scene.image_url = rendered.url;
            scene.image_approved = true;
            await slack.uploadFile(args.channel, `scene${i + 1}.png`, rendered.buffer, rendered.mimetype, threadTs);
            await saveContentExample({
              verticalId: job.vertical_id,
              sourcePath: rendered.url,
              storyboard: { hook: wf.name, labels: ["generated", "pov"], difficulty: "medium", shots: [] },
              labels: ["generated", "pov"],
              difficulty: "medium",
              frameUrls: [rendered.url],
            });
          } else {
            await slack.postThreadReply(args.channel, threadTs, `Scene ${i + 1} image failed. Retry with \`redo ${i + 1} <prompt>\`.`);
          }
        }
        await upsertWorkflow(wf);
        // Back to `picture` so `redo N` + song still work after the images land.
        await updateJob(job, { stage: "picture" });

        // Paint the picture: if this workflow renders from a spec, recap the copy grouped by shot
        // (which text lands on which image) and point at the song -> render-authoring step.
        if (wf.render_spec) {
          const base = specFromWorkflow(wf);
          const filled = base ? applyCopyToSpec(base, job.data.structured_copy) : null;
          if (filled) await slack.postThreadReply(args.channel, threadTs, buildVideoDescription(wf, filled));
          await slack.postThreadReply(
            args.channel,
            threadTs,
            [
              "Images done and saved to the library. Tweak any with `redo <n> <new prompt>`.",
              "Add the song with `song <key|url>` and I will confirm the render mode, then hand you the Claude Code prompt to build it.",
            ].join("\n")
          );
        } else {
          await slack.postThreadReply(
            args.channel,
            threadTs,
            [
              "Images done and saved to the library.",
              "Tweak any with `redo <n> <new prompt>`.",
              "Set a song with `song <key|url>`, or save an audio variant with `sequence <song> [label]`.",
            ].join("\n")
          );
        }
      } catch (e) {
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
  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(job.vertical_id);
        const lines = pastedCopy
          ? await reslotCopyToStructure({ vertical, workflow: wf, pastedBlock: pastedCopy })
          : await generateStructuredCopy({ vertical, workflow: wf, seed });
        const fresh = await getLatestJobByThread(threadTs);
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
    const workflow: Workflow = args.workflow
      ? { ...args.workflow, scenes, captions: plan.captions }
      : {
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
        data: { ...fresh.data, workflow_id: wfId, caption_storyboard: { captions: plan.captions, ig_caption: args.caption } },
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
  out.push("", "React ✅ to generate the shot images.");
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
        // Never stall the session: fall through to the direct picture build.
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh) await buildPictureFromStructuredCopy(fresh, channel);
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
  await updateJob(job, { data: { ...job.data, chosen_idea: ideaText, chosen_storyboard: ideaText } });
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
        const plan = await generatePicturePlan({
          vertical,
          chosenHook: job.data.chosen_hook || wf.name,
          chosenCaption: captionText || wf.name,
          chosenStoryboard: job.data.chosen_storyboard || wf.name,
          workflow: wf,
        });
        let scenes = plan.scenes.slice(0, shotCount);
        while (scenes.length < shotCount) {
          scenes = scenes.concat(scenes[scenes.length - 1] ?? { role: `shot ${scenes.length + 1}`, image_prompt: "first-person b-roll on the job", animation_prompt: "slow push in" });
        }
        const wfScenes: WorkflowScene[] = scenes.map((s) => ({
          role: s.role,
          image_prompt: s.image_prompt,
          animation_prompt: s.animation_prompt,
          duration_seconds: 2,
          image_url: null,
          image_approved: false,
        }));
        const updated: Workflow = { ...wf, scenes: wfScenes };
        await upsertWorkflow(updated);
        const card = await slack.postThreadReply(channel, threadTs, spec ? buildPictureCard(updated, spec) : "React ✅ to generate the images.");
        const cardTs = (card as { ts?: string }).ts;
        const fresh = await getLatestJobByThread(threadTs);
        if (fresh) await updateJob(fresh, { pickerTs: cardTs ?? fresh.picker_msg_ts, data: { ...fresh.data, candidate_spec: spec } });
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
        : `Render *${workflow.name}* with *${modeLabel}*?`,
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

  // Keep the session ALIVE for the remix upsell (16 variations of this workflow + audio combo).
  await updateJob(job, { stage: "remix_offer" });
  await postRemixOffer(channel, threadTs);
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
 * Screenshots / example videos dropped in a workflow session thread become the workflow's
 * REFERENCE CREATIVES (the production gate: 3 references -> produce the 4th -> in production).
 * Claims the drop only when this thread's session has a workflow in context.
 */
export async function handleWorkflowReferenceUpload(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
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

  let count: number | null = null;
  for (const f of media.slice(0, 5)) {
    try {
      const buf = await slack.downloadFile(f.url_private_download!);
      const url = await uploadToReels(buf, f.mimetype || "image/jpeg");
      if (!url) continue;
      const kind = (f.mimetype ?? "").startsWith("video/") ? "video" : "screenshot";
      count = await addWorkflowReference(wfId, { kind, url });
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
  const wf = await loadWorkflow(wfId);
  await slack.postThreadReply(
    args.channel,
    threadTs,
    count >= 3
      ? `Reference ${count}/3 saved for *${wf?.name ?? wfId}*. Reply \`finish workflow\` to render the production test and put it IN PRODUCTION.`
      : `Reference ${count}/3 saved for *${wf?.name ?? wfId}*. ${3 - count} more (screenshots of the manual edit, like your Reels timeline) and it can go into production.`
  );
  return true;
}

/** True when a top-level #content-full message is an avatar command like `vektor pest_control`. */
export function parseAvatarCommand(text: string): string | null {
  const m = /^\s*(?:vektor|avatar)\s+([a-z0-9_]+)\s*$/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export type { ContentJob };
