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
import { loadWorkflow, resolveSong } from "@/config/workflows";
import { loadVertical, listVerticals } from "@/config/verticals";
import {
  generateHeadlineOptions,
  generateCreativeReference,
  generateHookSet,
  generateCaptionsAndStoryboards,
  generatePicturePlan,
} from "@/lib/reel/creative-director";
import { setWorkflowSong, addRenderSequence, upsertWorkflow, workflowId } from "@/lib/reel/workflow-author";
import { startNewAvatar, parseNewAvatar } from "@/lib/reel/avatar-create";
import type { Workflow, WorkflowScene } from "@/config/workflows";

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
const COMMAND_RE = /^\s*(go|map|library|new|vektor|avatar|workflow|headline|title|verbal|pov|hook|pick|song|sequence|sequences|\d{1,2})\b/i;
function isCommand(t: string): boolean {
  return COMMAND_RE.test(t.trim());
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

  // Stage: headlines -> pick/paste a headline -> hookset.
  if (job.stage === "headlines") {
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
          parts.push("", "Or send your own with `hook <text>`.");
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

  // Stage: hookset -> choose the hook -> captions + storyboards.
  if (job.stage === "hookset") {
    let hook: string | undefined;
    const hm = /^\s*hook\s+(.+)\s*$/i.exec(t);
    if (hm) hook = hm[1].trim();
    const hs = data.hookset;
    const ti = idxFrom(t, "title");
    const vi = idxFrom(t, "verbal");
    const pi = idxFrom(t, "pov");
    if (ti && hs?.title?.[ti - 1]) hook = hs.title[ti - 1];
    if (vi && hs?.verbal?.[vi - 1]) hook = hs.verbal[vi - 1];
    if (pi && hs?.pov?.[pi - 1]) hook = hs.pov[pi - 1];
    if (!hook) return false;
    await updateJob(job, { stage: "captions", data: { ...job.data, chosen_hook: hook } });
    await slack.postThreadReply(args.channel, threadTs, `Hook: *${hook}*. Drafting captions + storyboards...`);
    const chosenHook = hook;
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const cs = await generateCaptionsAndStoryboards({ vertical, chosenHook });
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh)
            await updateJob(fresh, {
              data: { ...fresh.data, captions3: cs.captions, storyboards3: cs.storyboards },
            });
          await slack.postThreadReply(
            args.channel,
            threadTs,
            [
              "*Captions* — pick with `pick <caption#> <story#>`:",
              numbered(cs.captions),
              "",
              "*Storyboards:*",
              numbered(cs.storyboards),
              "",
              "Example: `pick 1 2` (caption 1, storyboard 2).",
            ].join("\n")
          );
        } catch (e) {
          console.error("[workflow-pipeline] captions gen failed:", (e as Error).message);
        }
      })()
    );
    return true;
  }

  // Stage: captions -> pick caption + storyboard -> the picture plan + a checkmark to render.
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
      stage: "picture",
      data: { ...job.data, chosen_caption: caption, chosen_storyboard: storyboard },
    });
    await slack.postThreadReply(args.channel, threadTs, "Mapping the whole picture (scenes + timing)...");
    const hook = data.chosen_hook || "";
    waitUntil(
      (async () => {
        try {
          const vertical = await loadVertical(job.vertical_id);
          const plan = await generatePicturePlan({
            vertical,
            chosenHook: hook,
            chosenCaption: caption,
            chosenStoryboard: storyboard,
          });

          // Persist as a reusable draft workflow (templatable blueprint).
          const name = (hook || storyboard).slice(0, 60);
          const wfId = workflowId(job.vertical_id, "pov", name);
          const scenes: WorkflowScene[] = plan.scenes.map((s) => ({
            role: s.role,
            image_prompt: s.image_prompt,
            animation_prompt: s.animation_prompt,
            duration_seconds: 2,
            image_url: null,
            image_approved: false,
          }));
          const workflow: Workflow = {
            id: wfId,
            vertical_id: job.vertical_id,
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
            threadTs,
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
          const fresh = await getLatestJobByThread(threadTs);
          if (fresh)
            await updateJob(fresh, {
              pickerTs: cardTs ?? fresh.picker_msg_ts,
              data: { ...fresh.data, workflow_id: wfId, caption_storyboard: { captions: plan.captions, ig_caption: caption } },
            });
          if (cardTs) await slack.addReaction(args.channel, cardTs, "white_check_mark").catch(() => {});
        } catch (e) {
          console.error("[workflow-pipeline] picture plan failed:", (e as Error).message);
          await slack.postThreadReply(args.channel, threadTs, "Could not map the picture. Try `pick` again.").catch(() => {});
        }
      })()
    );
    return true;
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
 * ✅ on a picture card: generate the real image for every scene, post them, write the urls back
 * onto the workflow, and save each to the library (same edit-and-save loop as other images).
 * Returns true when handled.
 */
export async function handlePictureReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  if (!["white_check_mark", "heavy_check_mark", "+1"].includes(args.reaction)) return false;
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.format_id !== "workflow" || job.stage !== "picture") return false;
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
        await slack.postThreadReply(
          args.channel,
          threadTs,
          [
            "Images done and saved to the library.",
            "Tweak any with `redo <n> <new prompt>`.",
            "Set a song with `song <key|url>`, or save an audio variant with `sequence <song> [label]`.",
          ].join("\n")
        );
      } catch (e) {
        console.error("[workflow-pipeline] handlePictureReaction gen failed:", (e as Error).message);
      }
    })()
  );
  return true;
}

/** True when a top-level #content-full message is an avatar command like `vektor pest_control`. */
export function parseAvatarCommand(text: string): string | null {
  const m = /^\s*(?:vektor|avatar)\s+([a-z0-9_]+)\s*$/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export type { ContentJob };
