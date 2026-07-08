// Workflow Creator agent — everything that happens in #agent-wokrflow-creator.
//
// THE place to create new workflows (clean lane split, 2026-07-09):
//   go              -> numbered avatar list
//   reply N         -> the avatar report (30 headlines + story material, same as
//                      #content-full) then "Waiting for content"
//   drop content    -> the audio + images/videos + your copy (one message or several)
//   -> the agent proposes 3 RENDER VARIATIONS, each with a summary and a ready-to-paste
//      Claude Code prompt block that builds that variation's render in srt-reel-render
//      (custom endpoint wf-<slug>-vN accepting the render-spec payload, or "no code
//      needed" when the generic engine covers it)
//   keep N [name <text>] -> saves that variation as an ACTIVE workflow (song, style DNA,
//      timeline, copy boxes), instantly usable in #ai-content-pest-control.
//
// format_id "workflow_agent", stages awc_avatar -> awc_await_content -> awc_variations.
// Self-routes by content_jobs; every handler returns false when no agent job claims it.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import {
  insertJob,
  getLatestJobByThread,
  getLatestJobByChannelFormat,
  getJobByPickerTs,
  updateJob,
  type ContentJob,
} from "@/lib/reel/jobs";
import { uploadToReels } from "@/lib/reel/pov";
import { resolveStillFrame } from "@/lib/reel/pov-studio";
import { analyzeSong, snapSpecToBeats } from "@/lib/reel/beat-sync";
import {
  generateHeadlineOptions,
  generateCreativeReference,
} from "@/lib/reel/creative-director";
import {
  upsertWorkflow,
  workflowId,
  addWorkflowReference,
} from "@/lib/reel/workflow-author";
import { saveContentExample } from "@/lib/reel/content-examples";
import { stripEmDashes } from "@/lib/reel/text";
import { supabaseAdmin } from "@/lib/db";
import { loadVertical, listVerticals } from "@/config/verticals";
import type { RenderSpec, Workflow, WorkflowScene } from "@/config/workflows";

export const AGENT_FORMAT_ID = "workflow_agent";

const APPROVE = new Set(["white_check_mark", "heavy_check_mark", "+1"]);
const CANCEL = new Set(["no_entry_sign", "no_entry", "x", "-1"]);

interface DroppedFile {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

interface AgentVariation {
  name: string;
  idea: string; // one-paragraph summary of the render design
  style_dna: string;
  duration: number;
  shots: Array<{ role: string; start: number; end: number }>;
  texts: Array<{ text: string; at_second: number; out_second: number; position: string }>;
  render_notes: string; // what makes this variation's render distinct
  needs_custom: boolean; // false = the generic render-spec engine covers it
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

function isAudio(f: DroppedFile): boolean {
  return (f.mimetype ?? "").startsWith("audio/") || /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.name ?? "");
}

async function post(channel: string, threadTs: string, text: string): Promise<string | null> {
  const res = await slack.postThreadReply(channel, threadTs, text).catch(() => null);
  return ((res as { ts?: string } | null)?.ts as string) ?? null;
}

const AWC_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  awc_avatar: "Reply with the avatar's number from the list. (`cancel` ends this session.)",
  awc_await_content: "Waiting for content. Send the audio + your images/videos + the copy (one message or several). I need at least the audio and the copy (2+ lines). `status` shows what I have; `ready` forces the variations.",
  awc_variations: "Reply `keep N` (optionally `keep N name <text>`) to save one, `more` for 3 fresh variations, or `variation N <feedback>` to redo one.",
};

async function getAgentJob(channel: string, threadTs?: string | null): Promise<ContentJob | null> {
  if (threadTs) {
    const byThread = await getLatestJobByThread(threadTs);
    if (byThread && byThread.format_id === AGENT_FORMAT_ID && byThread.status === "active") return byThread;
    if (byThread) return null;
  }
  return getLatestJobByChannelFormat(channel, AGENT_FORMAT_ID);
}

// ---- session start ---------------------------------------------------------------------------

/** `go` in the agent channel: post the avatar list, open the session. */
export async function startAgentSession(args: { channel: string }): Promise<boolean> {
  const avatars = (await listVerticals()).filter((a) => a.status !== "archived");
  const res = await slack
    .postMessage(
      args.channel,
      [
        "*Workflow Creator.* Which avatar is this workflow for?",
        avatars.map((a, i) => `${i + 1}. ${a.name}  (\`${a.id}\`)`).join("\n"),
        "",
        "Reply with the number.",
      ].join("\n")
    )
    .catch(() => null);
  const ts = ((res as { ts?: string } | null)?.ts as string) ?? null;
  if (!ts) return false;
  await insertJob({
    formatId: AGENT_FORMAT_ID,
    verticalId: "_",
    channel: args.channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "awc_avatar",
    sourceKind: "go",
    data: { avatar_ids: avatars.map((a) => a.id) },
  });
  return true;
}

async function pickAvatar(job: ContentJob, channel: string, n: number): Promise<void> {
  const ids = job.data.avatar_ids ?? [];
  const pick = ids[n - 1];
  if (!pick) {
    await post(channel, job.slack_thread_ts, `Pick a number between 1 and ${ids.length}.`);
    return;
  }
  await supabaseAdmin.from("content_jobs").update({ vertical_id: pick }).eq("id", job.id);
  await updateJob(job, { stage: "awc_await_content" });
  await post(channel, job.slack_thread_ts, `Avatar \`${pick}\`. Pulling the report...`);

  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(pick);
        const [headlines, ref] = await Promise.all([
          generateHeadlineOptions({ vertical, count: 30 }),
          generateCreativeReference(vertical),
        ]);
        await post(
          channel,
          job.slack_thread_ts,
          [
            `*${vertical.name}* — 30 headline angles (raw material for your copy):`,
            headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"),
            "",
            "*Story material* (mix these in):",
            `*Fears:* ${ref.fears.join(" | ")}`,
            `*Beliefs:* ${ref.beliefs.join(" | ")}`,
            `*Desires:* ${ref.desires.join(" | ")}`,
            `*Facts:* ${ref.facts.join(" | ")}`,
            `*Fantasies:* ${ref.fantasies.join(" | ")}`,
            `*Horror stories:* ${ref.horror.join(" | ")}`,
          ].join("\n")
        );
        await post(
          channel,
          job.slack_thread_ts,
          "*Waiting for content.* Send the audio + your images/videos + the copy (one message or several). I need at least the audio and the copy (2+ lines)."
        );
      } catch (e) {
        console.error("[workflow-agent] report failed:", (e as Error).message);
        await post(channel, job.slack_thread_ts, "Could not pull the report, but the session is live. Send the audio + copy whenever ready.");
      }
    })()
  );
}

// ---- content intake ----------------------------------------------------------------------------

async function downloadSlackUrl(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN || ""}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function contentStatus(job: ContentJob): string {
  const parts = [
    job.data.song_ref ? "audio in" : "audio missing",
    `${(job.data.agent_media ?? []).length} image(s)`,
    (job.data.agent_copy ?? []).length ? `${job.data.agent_copy!.length} copy lines` : "copy missing",
  ];
  return parts.join(" | ");
}

async function maybeGenerateVariations(job: ContentJob, channel: string): Promise<void> {
  const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
  if (!fresh.data.song_ref || !(fresh.data.agent_copy ?? []).length) return;
  await post(channel, fresh.slack_thread_ts, "I have everything. Designing 3 render variations...");
  waitUntil(generateAndPostVariations(fresh, channel));
}

async function intakeFiles(job: ContentJob, channel: string, files: DroppedFile[]): Promise<void> {
  const threadTs = job.slack_thread_ts;
  let changed = false;
  const media = [...(job.data.agent_media ?? [])];
  const patch: Record<string, unknown> = {};

  const audio = files.find(isAudio);
  if (audio?.url_private_download) {
    const buf = await downloadSlackUrl(audio.url_private_download);
    const url = buf ? await uploadToReels(buf, audio.mimetype || "audio/mp4") : null;
    if (url) {
      const grid = await analyzeSong(url);
      patch.song_ref = url;
      if (grid) patch.beat_grid = grid;
      changed = true;
      await post(
        channel,
        threadTs,
        grid
          ? `Audio in. BPM ${grid.bpm ? Math.round(grid.bpm) : "?"} | ${grid.duration ? grid.duration.toFixed(1) : "?"}s | ${grid.beats.length} beats.`
          : "Audio in (no beat grid could be read; timings will not beat-snap)."
      );
    } else {
      await post(channel, threadTs, "Could not store that audio. Try attaching it again.");
    }
  }

  for (const f of files) {
    if (isAudio(f)) continue;
    const still = await resolveStillFrame(f);
    if (!still) continue;
    const buf = await downloadSlackUrl(still.url);
    const url = buf ? await uploadToReels(buf, still.mimetype || "image/jpeg") : null;
    if (url) {
      media.push(url);
      changed = true;
    }
  }
  if (media.length !== (job.data.agent_media ?? []).length) {
    patch.agent_media = media;
    await post(channel, threadTs, `${media.length} image(s) on file.`);
  }

  if (changed) {
    await updateJob(job, { data: { ...job.data, ...patch } });
    await maybeGenerateVariations(job, channel);
  }
}

// ---- variations ---------------------------------------------------------------------------------

function isVariation(v: unknown): v is AgentVariation {
  const a = v as AgentVariation;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof a.name === "string" &&
    typeof a.idea === "string" &&
    typeof a.style_dna === "string" &&
    typeof a.duration === "number" &&
    Array.isArray(a.shots) &&
    a.shots.every((s) => s && typeof s.role === "string" && typeof s.start === "number" && typeof s.end === "number") &&
    Array.isArray(a.texts) &&
    a.texts.every((t) => t && typeof t.text === "string" && typeof t.at_second === "number") &&
    typeof a.needs_custom === "boolean"
  );
}

async function proposeRenderVariations(job: ContentJob, feedback?: string): Promise<AgentVariation[]> {
  const vertical = await loadVertical(job.vertical_id);
  const grid = job.data.beat_grid;
  const copy = job.data.agent_copy ?? [];
  const mediaCount = (job.data.agent_media ?? []).length;

  interface Result {
    variations: AgentVariation[];
  }
  const system = [
    `You are the render designer for short vertical reels for a ${vertical.business_descriptor}.`,
    "Given a song's beat grid, the operator's on-screen copy lines, and how many images he",
    "supplied, design THREE clearly different RENDER VARIATIONS of the same video: different",
    "shot pacing, text placement rhythm, and feel. Rules:",
    "- Vertical 9:16, stills-based shots (each held for its slot).",
    "- Shots are contiguous from 0 to the duration; 3 to 6 shots typical; duration 6 to 20s.",
    "- Every copy line appears exactly once as a timed text box (at_second/out_second inside its shot).",
    "- Positions: top, upper_side, upper_middle, center, lower, bottom.",
    "- Land shot cuts and text pops near beat times when a grid is given.",
    "- style_dna = one dense block of visual invariants (character, location, lighting, lens, wardrobe).",
    "- idea = one tight paragraph a human reads to feel the video.",
    "- render_notes = what is distinct about THIS variation's render treatment.",
    "- needs_custom = true ONLY when the treatment cannot be done by a generic engine that",
    "  holds stills and pops text chips at timestamps (e.g. split screens, progress bars,",
    "  karaoke word-by-word text). Otherwise false.",
    "- Never use em dashes anywhere.",
    "",
    `Avatar: ${vertical.avatar_summary ?? vertical.name}`,
    `Brand look: ${vertical.style_token}`,
    grid
      ? `Beat grid: BPM ${grid.bpm ?? "?"}, duration ${grid.duration ?? "?"}s, beats at: ${grid.beats.slice(0, 24).map((b) => b.toFixed(2)).join(", ")}${grid.beats.length > 24 ? " ..." : ""}`
      : "No beat grid available.",
    `Operator supplied ${mediaCount} image(s). Prefer a shot count near that when it is 2 or more.`,
    feedback ? `Operator feedback to honor: ${stripEmDashes(feedback)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await callClaudeJSON<Result>({
    model: model(),
    system,
    user: ["The on-screen copy lines (in order):", ...copy.map((c, i) => `${i + 1}. ${c}`), "", "Return the 3 variations as JSON."].join("\n"),
    maxTokens: 3500,
    temperature: 0.8,
    schemaHint:
      '{ "variations": [{ "name": string, "idea": string, "style_dna": string, "duration": number, "shots": [{ "role": string, "start": number, "end": number }], "texts": [{ "text": string, "at_second": number, "out_second": number, "position": string }], "render_notes": string, "needs_custom": boolean }] }',
    validate: (v: unknown): v is Result =>
      typeof v === "object" && v !== null && Array.isArray((v as Result).variations) && (v as Result).variations.every(isVariation),
  });

  // Beat-snap each variation's timeline when a grid exists.
  const beats = grid?.beats ?? [];
  return data.variations.slice(0, 3).map((v) => {
    if (!beats.length) return v;
    const spec = variationToSpec(v, job.data.song_ref ?? null);
    const { spec: snapped } = snapSpecToBeats(spec, beats, 0.45);
    return {
      ...v,
      duration: snapped.duration_seconds,
      shots: snapped.shots.map((s, i) => ({ role: v.shots[i]?.role ?? `shot ${s.i}`, start: s.start, end: s.end })),
      texts: snapped.texts.map((t, i) => ({
        text: t.text,
        at_second: t.at_second,
        out_second: t.out_second ?? snapped.duration_seconds,
        position: t.position ?? v.texts[i]?.position ?? "center",
      })),
    };
  });
}

function variationToSpec(v: AgentVariation, songRef: string | null): RenderSpec {
  return {
    mode: "static_images",
    song_ref: songRef,
    duration_seconds: v.duration,
    shots: v.shots.map((s, i) => ({ i: i + 1, start: s.start, end: s.end })),
    texts: v.texts.map((t, i) => ({
      n: i + 1,
      text: t.text,
      at_second: t.at_second,
      out_second: t.out_second,
      position: t.position,
      role: `line_${i + 1}`,
    })),
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workflow"
  );
}

/** The ready-to-paste Claude Code prompt that builds this variation's render. */
function buildVariationClaudePrompt(
  v: AgentVariation,
  n: number,
  songUrl: string | null,
  bpm: number | null
): string {
  const slug = `wf-${slugify(v.name)}-v${n}`;
  const timeline = [
    "Shots (stills, contiguous slots):",
    ...v.shots.map((s, i) => `  Shot ${i + 1}: ${s.start}s to ${s.end}s  (${s.role})`),
    "On-screen text (exact in/out seconds + position):",
    ...v.texts.map((t) => `  ${t.at_second}s to ${t.out_second}s  "${t.text}"  @ ${t.position}`),
  ].join("\n");

  if (!v.needs_custom) {
    return [
      "```",
      `Variation ${n} "${v.name}" needs NO new render code.`,
      "It renders through the existing generic endpoint render-service/api/render-spec.py",
      "(stills held per slot + text chips popping at the timestamps below).",
      "",
      timeline,
      `Song: ${songUrl ?? "default bed"}${bpm ? ` (~${Math.round(bpm)} BPM)` : ""}, duration ${v.duration}s.`,
      "```",
    ].join("\n");
  }

  return [
    "```",
    `Build a new render endpoint in the srt-reel-render project (the render-service/ folder):`,
    `render-service/api/${slug}.py for the "${v.name}" workflow variation.`,
    "",
    `Render treatment: ${v.render_notes}`,
    `Style: ${v.style_dna}`,
    "",
    timeline,
    `Song: ${songUrl ?? "default bed"}${bpm ? ` (~${Math.round(bpm)} BPM)` : ""}, total duration ${v.duration}s (loop a shorter song, trim a longer one).`,
    "",
    "CONTRACT (must match exactly, so Mission Control can call it):",
    "- POST JSON: { song_url, duration, shots: [{ image_url, start, end }],",
    "  texts: [{ text, at_second, out_second, position, color?, size? }] }",
    "- Auth header x-reel-secret must equal env REEL_RENDER_SECRET.",
    "- Response: { url } (upload the MP4 to the Supabase reels bucket like the other endpoints).",
    "- 720x1280 at 30fps H.264. Reuse the primitives in api/srt_reel/spec_engine.py and",
    "  api/srt_reel/engine.py (cover, render_chip, ease_pop) instead of new drawing code.",
    `- Register the function in render-service/vercel.json ("api/${slug}.py": memory 2048,`,
    '  maxDuration 120, includeFiles "api/srt_reel/**"), then deploy the render-service project.',
    "```",
  ].join("\n");
}

async function generateAndPostVariations(job: ContentJob, channel: string, feedback?: string): Promise<void> {
  const threadTs = job.slack_thread_ts;
  try {
    const variations = await proposeRenderVariations(job, feedback);
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, {
      stage: "awc_variations",
      data: { ...fresh.data, variations: variations as unknown[] },
    });
    const bpm = fresh.data.beat_grid?.bpm ?? null;
    for (let i = 0; i < variations.length; i++) {
      const v = variations[i];
      await post(
        channel,
        threadTs,
        [
          `*Variation ${i + 1}: ${v.name}*${v.needs_custom ? "  (needs a custom render build)" : "  (renders on the generic engine)"}`,
          v.idea,
          `${v.shots.length} shots, ${v.duration.toFixed(1)}s. ${v.render_notes}`,
          "",
          buildVariationClaudePrompt(v, i + 1, fresh.data.song_ref ?? null, bpm),
        ].join("\n")
      );
    }
    await post(
      channel,
      threadTs,
      [
        "Build and test the ones you like (paste the blocks into Claude Code), then:",
        "`keep N` saves that variation as an ACTIVE workflow (add `name <text>` to name it).",
        "`more` = 3 fresh variations. `variation N <feedback>` = redo one.",
      ].join("\n")
    );
  } catch (e) {
    console.error("[workflow-agent] variations failed:", (e as Error).message);
    await post(channel, threadTs, `Could not design the variations (${(e as Error).message.slice(0, 140)}). Reply \`ready\` to retry.`);
  }
}

// ---- keep N -------------------------------------------------------------------------------------

async function keepVariation(job: ContentJob, channel: string, n: number, name?: string): Promise<void> {
  const threadTs = job.slack_thread_ts;
  const variations = (job.data.variations ?? []) as AgentVariation[];
  const v = variations[n - 1];
  if (!v) {
    await post(channel, threadTs, `There is no variation ${n}.`);
    return;
  }
  const finalName = stripEmDashes(name?.trim() || v.name);
  const wfId = workflowId(job.vertical_id, "agent", finalName);
  const spec = variationToSpec(v, job.data.song_ref ?? null);
  const media = job.data.agent_media ?? [];
  const scenes: WorkflowScene[] = v.shots.map((s, i) => ({
    role: s.role,
    image_prompt: `${v.style_dna.replace(/[.\s]+$/, "")}. ${s.role}. No text, captions, logos, or watermarks in the image. 9:16 vertical.`,
    animation_prompt: "",
    duration_seconds: Math.round((s.end - s.start) * 10) / 10,
    image_url: media[i] ?? null,
    image_approved: Boolean(media[i]),
  }));
  const build = v.needs_custom ? `wf-${slugify(v.name)}-v${n}` : "render_spec";

  const workflow: Workflow = {
    id: wfId,
    vertical_id: job.vertical_id,
    name: finalName,
    category: "broll",
    subcategory: "agent",
    status: "active",
    scenes,
    captions: v.texts.map((t) => ({ text: t.text, at_second: t.at_second })),
    copy_structure: v.texts.map((t, i) => ({
      key: `line_${i + 1}`,
      label: `Line ${i + 1}`,
      guidance: "On-screen line from the agent session.",
      shot: spec.shots.find((s) => t.at_second >= s.start - 0.05 && t.at_second < s.end)?.i ?? 1,
      at_second: t.at_second,
      out_second: t.out_second,
      position: t.position,
    })),
    render_spec: spec,
    song_ref: job.data.song_ref ?? null,
    render_sequences: [],
    render_options: { aspect: "9:16", build },
    example_video_url: null,
    example_storyboard: null,
    shot_screenshots: [],
    source_kind: "agent",
    source_example_id: null,
    production_status: "building",
    description: stripEmDashes(v.idea).slice(0, 200),
  };

  const ok = await upsertWorkflow(workflow);
  if (!ok) {
    await post(channel, threadTs, "Could not save the workflow row. Try `keep N` again.");
    return;
  }
  // v2 columns via a dedicated update (tolerant of a missing migration).
  try {
    await supabaseAdmin
      .from("workflows")
      .update({
        style_dna: v.style_dna,
        beat_grid: job.data.beat_grid ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", wfId);
  } catch (e) {
    console.error("[workflow-agent] v2 fields update failed:", (e as Error).message);
  }
  // Dropped media become the workflow's reference library; the song its audio reference.
  for (const url of media) {
    await saveContentExample({
      verticalId: job.vertical_id,
      workflowId: wfId,
      sourcePath: url,
      storyboard: { hook: finalName, shots: [] },
      labels: ["workflow_reference", "agent_seed"],
      difficulty: "medium",
      frameUrls: [url],
    }).catch(() => {});
  }
  if (job.data.song_ref) await addWorkflowReference(wfId, { kind: "audio", url: job.data.song_ref });

  await updateJob(job, { stage: "done", status: "done" });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  await post(
    channel,
    threadTs,
    [
      `*Saved and ACTIVE:* \`${wfId}\` ("${finalName}", build: ${build}).`,
      "It now shows up in #ai-content-pest-control drop matching and the 3x/day prompt drops.",
      build !== "render_spec"
        ? "Reminder: build + deploy its custom render endpoint from the Claude Code block above before the first render."
        : "It renders on the generic engine, nothing else to build.",
      appUrl ? `Tune it any time: ${appUrl}/dashboard/content-workflows/${wfId}` : "",
      "`go` starts the next workflow.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// ---- routers --------------------------------------------------------------------------------------

/** Text message in the agent channel (top level or thread). */
export async function handleAgentMessage(args: {
  channel: string;
  threadTs?: string;
  text: string;
}): Promise<boolean> {
  const job = await getAgentJob(args.channel, args.threadTs);
  if (!job) return false;
  const text = args.text.trim();
  const channel = args.channel;

  if (/^\s*cancel\s*$/i.test(text)) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(channel, job.slack_thread_ts, "Session cancelled. `go` starts a fresh one.");
    return true;
  }

  switch (job.stage) {
    case "awc_avatar": {
      const n = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
      if (n) {
        await pickAvatar(job, channel, parseInt(n, 10));
        return true;
      }
      await post(channel, job.slack_thread_ts, AWC_NUDGES.awc_avatar!);
      return true;
    }
    case "awc_await_content": {
      if (/^\s*status\s*$/i.test(text)) {
        await post(channel, job.slack_thread_ts, contentStatus(job));
        return true;
      }
      if (/^\s*(ready|done|go)\s*$/i.test(text)) {
        if (!job.data.song_ref || !(job.data.agent_copy ?? []).length) {
          await post(channel, job.slack_thread_ts, `Not yet: ${contentStatus(job)}.`);
        } else {
          await post(channel, job.slack_thread_ts, "Designing 3 render variations...");
          waitUntil(generateAndPostVariations(job, channel));
        }
        return true;
      }
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        await updateJob(job, { data: { ...job.data, agent_copy: lines.map(stripEmDashes) } });
        await post(channel, job.slack_thread_ts, `Copy in (${lines.length} lines). ${contentStatus({ ...job, data: { ...job.data, agent_copy: lines } } as ContentJob)}`);
        await maybeGenerateVariations(job, channel);
        return true;
      }
      await post(channel, job.slack_thread_ts, AWC_NUDGES.awc_await_content!);
      return true;
    }
    case "awc_variations": {
      const keep = /^\s*keep\s+(\d)\s*(?:name\s+(.+))?$/i.exec(text);
      if (keep) {
        await keepVariation(job, channel, parseInt(keep[1], 10), keep[2]);
        return true;
      }
      if (/^\s*more\s*$/i.test(text)) {
        await post(channel, job.slack_thread_ts, "Designing 3 fresh variations...");
        waitUntil(generateAndPostVariations(job, channel));
        return true;
      }
      const redo = /^\s*variation\s+(\d)\s+([\s\S]+)$/i.exec(text);
      if (redo) {
        await post(channel, job.slack_thread_ts, `Redoing all 3 with your note on variation ${redo[1]}...`);
        waitUntil(generateAndPostVariations(job, channel, `About variation ${redo[1]}: ${redo[2]}`));
        return true;
      }
      await post(channel, job.slack_thread_ts, AWC_NUDGES.awc_variations!);
      return true;
    }
    default:
      return false;
  }
}

/** Files dropped in the agent channel (top level or thread). */
export async function handleAgentFileDrop(args: {
  channel: string;
  threadTs?: string;
  files: DroppedFile[];
  text?: string;
}): Promise<boolean> {
  const job = await getAgentJob(args.channel, args.threadTs);
  if (!job) return false;
  if (job.stage === "awc_avatar") {
    await post(args.channel, job.slack_thread_ts, "Pick the avatar number first, then send the content.");
    return true;
  }
  if (job.stage !== "awc_await_content") {
    await post(args.channel, job.slack_thread_ts, AWC_NUDGES[job.stage] ?? "Session is past the content step.");
    return true;
  }
  // Copy can ride along in the same message as the files.
  const lines = (args.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    await updateJob(job, { data: { ...job.data, agent_copy: lines.map(stripEmDashes) } });
  }
  const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
  await intakeFiles(fresh, args.channel, args.files);
  return true;
}

/** ✅ on the variations card = keep 1; 🚫 cancels. */
export async function handleAgentReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const approve = APPROVE.has(args.reaction);
  const cancel = CANCEL.has(args.reaction);
  if (!approve && !cancel) return false;
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.format_id !== AGENT_FORMAT_ID || job.status !== "active") return false;
  if (cancel) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(args.channel, job.slack_thread_ts, "Session cancelled. `go` starts a fresh one.");
    return true;
  }
  if (job.stage === "awc_variations") await keepVariation(job, args.channel, 1);
  return true;
}
