// Avatar-first workflow pipeline (Content Engine v3) — the Slack-native creative-director flow.
//
// Front door is the AVATAR. In #content-full:
//   `go`                      -> pick an avatar (or `new` to create one)
//   pick a number             -> Vektor posts ~30 headlines + a story reference block
//   `headline N` / paste text -> 5 verbal + 5 title (+5 POV-first) hooks
//   `title N`/`verbal N`/`pov N`/`hook <text>` -> 3 captions + 3 storyboards
//   `pick <caption#> <story#>`-> the picture plan (scene image+animation prompts + timed
//                                captions) with a checkmark to render the real images
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
  generateStructuredCopy,
  reslotCopyToStructure,
  parseStoryboardToRenderSpec,
  productizeCopyToWorkflow,
  type StructuredCopyLine,
} from "@/lib/reel/creative-director";
import {
  specFromWorkflow,
  applyCopyToSpec,
  validateRenderSpec,
  buildVideoDescription,
  buildRenderClaudePrompt,
  textsForShot,
} from "@/lib/reel/render-spec";
import {
  setWorkflowSong,
  setWorkflowStatus,
  addRenderSequence,
  upsertWorkflow,
  workflowId,
  createWorkflowFromProductized,
  cloneWorkflowForVertical,
} from "@/lib/reel/workflow-author";
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
const COMMAND_RE = /^\s*(go|map|library|new|vektor|avatar|workflow|template|create|finish|headline|title|verbal|pov|hook|pick|song|sequence|sequences|\d{1,2})\b/i;
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
    // render-authoring gate (confirm mode, validate, then emit the Claude Code prompt).
    const wfSong = await loadWorkflow(data.workflow_id);
    if (wfSong?.render_spec) {
      await postRenderConfirmCard(args.channel, threadTs, job, wfSong, ref);
    }
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

  // Stage: headlines -> pick/paste a headline -> hookset.
  if (job.stage === "headlines") {
    // A pasted READY copy block (3+ lines) skips hook building entirely: store it and go
    // straight to the workflow question. Line 1 doubles as the chosen headline/hook.
    if (looksLikePastedCopy(t)) return acceptPastedCopy(args.channel, threadTs, job, t);
    let headline: string | undefined;
    const hi = idxFrom(t, "headline");
    if (hi && Array.isArray(data.headlines) && data.headlines[hi - 1]) headline = data.headlines[hi - 1];
    else if (t && !isCommand(t)) headline = t;
    if (!headline) return false;
    await updateJob(job, { stage: "hookset", data: { ...job.data, chosen_headline: headline } });
    await slack.postThreadReply(args.channel, threadTs, `Building hooks for: *${headline}*...`);
    const chosen = headline;
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const isPov = true; // POV is our default brand format; always offer the POV-first set.
          const hs = await generateHookSet({ vertical, chosenHeadline: chosen, isPov });
          const parts = [
            "*Verbal hooks* (voiceover) — `verbal N`:",
            numbered(hs.verbal),
            "",
            "*Title hooks* (on-screen) — `title N`:",
            numbered(hs.title),
          ];
          if (hs.pov?.length) parts.push("", "*POV-first title hooks* — `pov N`:", numbered(hs.pov));
          parts.push("", "Pick one, or just *paste your own copy* (I will slot it into the workflow), or `hook <text>`.");
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh) await updateJob(fresh, { data: { ...fresh.data, hookset: hs } });
          await slack.postThreadReply(args.channel, threadTs, parts.join("\n"));
        } catch (e) {
          console.error("[workflow-pipeline] hookset gen failed:", (e as Error).message);
        }
      })()
    );
    return true;
  }

  // Stage: hookset -> pick a hook OR paste your own copy -> straight to the WORKFLOW picker.
  // (This is the gate: the workflow question comes right after the hooks, and a pasted copy block
  // is accepted here so the session never stalls and the labeled copy is seeded from your words.)
  if (job.stage === "hookset") {
    // Same fast path as the headlines stage: a 3+ line paste is ready copy, not a hook pick.
    // Runs BEFORE isCommand so a block starting with "POV:"/a number can't stall the session.
    if (looksLikePastedCopy(t)) return acceptPastedCopy(args.channel, threadTs, job, t);
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
    // Active but no labeled copy structure (e.g. seeded POV): use today's picture flow unchanged.
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

    // Configured with a copy structure: generate the labeled copy, then let Matthew edit it.
    await updateJob(job, { stage: "structured_copy", data: { ...job.data, workflow_id: wf.id } });
    await slack.postThreadReply(args.channel, threadTs, `Building the copy for *${wf.name}*...`);
    const seed = {
      headline: data.chosen_headline,
      hook: data.chosen_hook,
      caption: data.chosen_caption,
      storyboard: data.chosen_storyboard,
    };
    const pastedCopy = data.pasted_copy;
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          // If Matthew pasted his own copy, re-slot HIS words into the boxes (feedback on his
          // message); otherwise generate fresh copy seeded from the chosen hook.
          const lines = pastedCopy
            ? await reslotCopyToStructure({ vertical, workflow: wf, pastedBlock: pastedCopy })
            : await generateStructuredCopy({ vertical, workflow: wf, seed });
          const fresh = await getLatestJobByThread(threadTs);
          const card = await postStructuredCopyCard(args.channel, threadTs, wf, lines);
          const cardTs = (card as { ts?: string }).ts;
          if (fresh)
            await updateJob(fresh, {
              pickerTs: cardTs ?? fresh.picker_msg_ts,
              data: { ...fresh.data, structured_copy: lines },
            });
          if (cardTs) await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
        } catch (e) {
          console.error("[workflow-pipeline] structured copy gen failed:", (e as Error).message);
          await slack.postThreadReply(args.channel, threadTs, "Could not build the copy. Try another workflow.").catch(() => {});
        }
      })()
    );
    return true;
  }

  // Stage: structured_copy -> edit lines (`line N <text>`) or paste a raw block to re-slot.
  if (job.stage === "structured_copy") {
    const lines = data.structured_copy ?? [];
    const wf = data.workflow_id ? await loadWorkflow(data.workflow_id) : null;
    if (!wf) return false;

    const lm = /^\s*line\s+(\d{1,2})\s+(.+)\s*$/i.exec(t);
    if (lm) {
      const idx = parseInt(lm[1], 10) - 1;
      if (idx < 0 || idx >= lines.length) {
        await slack.postThreadReply(args.channel, threadTs, `Line ${idx + 1} is out of range (1 to ${lines.length}).`);
        return true;
      }
      const next = lines.map((l, i) => (i === idx ? { ...l, text: lm[2].trim() } : l));
      await updateJob(job, { data: { ...job.data, structured_copy: next } });
      const card = await postStructuredCopyCard(args.channel, threadTs, wf, next);
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
            const card = await postStructuredCopyCard(args.channel, threadTs, wf, reslotted);
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
              const rendered = await renderScene(vid, newPrompt);
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

/** Enrich a scene prompt on the avatar's references + generate one still (best-effort). */
async function renderScene(
  verticalId: string,
  imagePrompt: string
): Promise<{ url: string; buffer: Buffer; mimetype: string } | null> {
  try {
    const vertical = await loadVertical(verticalId);
    const enriched = await enrichScene(imagePrompt, { vertical, formatGroup: "pov" }).catch(() => imagePrompt);
    const img = await generatePovImage(enriched);
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

  if (job.stage === "structured_copy") return buildPictureFromStructuredCopy(job, args.channel);
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
          const rendered = await renderScene(job.vertical_id, scene.image_prompt);
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

  // Render grouped: category headers for own workflows, then the templates section.
  const lines: string[] = [];
  let lastHeader = "";
  ordered.forEach(({ w, cross }, i) => {
    const header = cross ? "Templates from other avatars" : String(w.category || "other");
    if (header !== lastHeader) {
      lines.push(`*${header}*`);
      lastHeader = header;
    }
    const tag = cross ? `  [${w.vertical_id}]` : w.status === "active" ? "" : "  - needs config";
    lines.push(`  ${i + 1}. ${w.name}${w.subcategory ? ` (${w.subcategory})` : ""}${describe(w)}${tag}`);
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

/** Post the labeled copy boxes for a workflow (each `N. *Label* — text`). Returns the Slack post. */
async function postStructuredCopyCard(
  channel: string,
  threadTs: string,
  workflow: Workflow,
  lines: StructuredCopyLine[]
): Promise<unknown> {
  const body = lines.map((l, i) => `${i + 1}. *${l.label}* — ${l.text || "_(empty)_"}`).join("\n");
  return slack.postThreadReply(
    channel,
    threadTs,
    [
      `*${workflow.name}* — copy. Edit any line with \`line N <text>\`, or paste a full block to re-slot.`,
      body,
      "",
      "React ✅ when the copy is right (then I paint it onto the shot images).",
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
  const card = await slack.postThreadReply(
    channel,
    threadTs,
    [
      buildVideoDescription(workflow, spec),
      "",
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
  await updateJob(job, { stage: "done", status: "done" });
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

/** True when a top-level #content-full message is an avatar command like `vektor pest_control`. */
export function parseAvatarCommand(text: string): string | null {
  const m = /^\s*(?:vektor|avatar)\s+([a-z0-9_]+)\s*$/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export type { ContentJob };
