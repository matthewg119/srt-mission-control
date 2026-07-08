// Interactive workflow for the SRT Reel Studio (#content-full).
//
// Flow (all inside one #content-full thread, scoped by the reel_studio_jobs table):
//   1. operator posts an image + copy   -> handleStudioImage()    status=awaiting_pick
//      (Claude vision reads the photo, posts 4 full reel-copy variations)
//   2a. operator reacts 1/2/3/4         -> handleStudioReaction()  -> render that variation
//   2b. operator replies with 4 boxes   -> handleStudioReply()     -> render the typed boxes
//      (renders the branded MP4 via api/render-reel.py, posts it + a caption)
//
// All handlers self-route by DB lookup and return false when the event is not a
// studio event, so the Slack events route can fall through to its other handlers.

import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import type { ClaudeImageInput } from "@/lib/claude-calls";
import { generateStudioVariations, cleanScript, type ReelScript } from "@/lib/reel/studio-variations";
import { generateCaptionForScript } from "@/lib/reel/captions";

interface SlackFileLike {
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

interface StudioJobRow {
  id: string;
  slack_channel: string;
  slack_thread_ts: string;
  options_msg_ts: string | null;
  image_url: string | null;
  image_mimetype: string | null;
  variations: ReelScript[] | null;
  status: "awaiting_pick" | "rendering" | "done" | "error";
}

// Reactions 1-4 map to the four variation slots.
const KEYCAP_TO_INDEX: Record<string, number> = { one: 0, two: 1, three: 2, four: 3 };

const JOB_COLS =
  "id,slack_channel,slack_thread_ts,options_msg_ts,image_url,image_mimetype,variations,status";

async function downloadImage(url: string, mimetypeHint?: string): Promise<ClaudeImageInput | null> {
  try {
    const botToken = process.env.SLACK_BOT_TOKEN || "";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const media_type = (mimetypeHint || res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { media_type, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

function formatVariations(vs: ReelScript[]): string {
  const caps = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
  const out = ["🎬 *4 reel variations* — react 1️⃣ 2️⃣ 3️⃣ 4️⃣ to render one as-is,", "or reply with your exact 4 boxes (one per line: label, hook, payoff, cta).", ""];
  vs.forEach((v, i) => {
    out.push(
      `${caps[i] ?? `${i + 1}.`}  *${v.label}*\n      ${v.line1}\n      ${v.line2}\n      _${v.cta}_`
    );
  });
  return out.join("\n");
}

/**
 * Parse a free-form reply into a reel script. Accepts:
 *   - 4 non-empty lines        -> label, hook, payoff, cta
 *   - 2 or 3 non-empty lines   -> hooks/cta, reusing `base` for missing boxes
 *   - labeled lines            -> label:/hook:|line:/payoff:/cta:
 * Exact characters are preserved (only the leading label token is stripped).
 * Returns null if fewer than 2 usable boxes are found.
 */
export function parseBoxes(text: string, base?: ReelScript | null): ReelScript | null {
  const raw = (text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (raw.length === 0) return null;

  const labeled: Partial<ReelScript> = {};
  const plain: string[] = [];
  for (const line of raw) {
    const m = line.match(/^(label|hook|line\s*1|line1|line\s*2|line2|payoff|cta)\s*[:\-]\s*(.+)$/i);
    if (m) {
      const key = m[1].toLowerCase().replace(/\s+/g, "");
      const val = m[2].trim();
      if (key === "label") labeled.label = val;
      else if (key === "cta") labeled.cta = val;
      else if (key === "hook" || key === "line1") labeled.line1 = val;
      else if (key === "payoff" || key === "line2") labeled.line2 = val;
    } else {
      plain.push(line);
    }
  }

  let script: ReelScript;
  if (Object.keys(labeled).length > 0) {
    script = {
      label: labeled.label ?? base?.label ?? "",
      line1: labeled.line1 ?? base?.line1 ?? "",
      line2: labeled.line2 ?? base?.line2 ?? "",
      cta: labeled.cta ?? base?.cta ?? "",
    };
  } else if (plain.length >= 4) {
    script = { label: plain[0], line1: plain[1], line2: plain[2], cta: plain[3] };
  } else if (plain.length === 3) {
    // hook, payoff, cta — reuse the base label
    script = { label: base?.label ?? "", line1: plain[0], line2: plain[1], cta: plain[2] };
  } else if (plain.length === 2) {
    // two hooks — reuse base label + cta
    script = { label: base?.label ?? "", line1: plain[0], line2: plain[1], cta: base?.cta ?? "" };
  } else {
    return null;
  }

  // Need at least the two hook lines to make a reel.
  if (!script.line1 && !script.line2) return null;
  return cleanScript(script);
}

async function getJobByThread(threadTs: string): Promise<StudioJobRow | null> {
  const { data } = await supabaseAdmin
    .from("reel_studio_jobs")
    .select(JOB_COLS)
    .eq("slack_thread_ts", threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as StudioJobRow | null) ?? null;
}

async function getJobByOptionsMsg(ts: string): Promise<StudioJobRow | null> {
  const { data } = await supabaseAdmin
    .from("reel_studio_jobs")
    .select(JOB_COLS)
    .eq("options_msg_ts", ts)
    .limit(1)
    .maybeSingle();
  return (data as StudioJobRow | null) ?? null;
}

/**
 * Top-level image post in #content-full. Generate 4 reel-copy variations, record
 * the job, post the options. Returns true if this was handled as a studio event.
 */
export async function handleStudioImage(args: {
  channel: string;
  threadTs: string; // the original message ts (becomes the thread)
  files: SlackFileLike[];
  brief: string;
}): Promise<boolean> {
  const imageFile = args.files.find((f) => (f.mimetype ?? "").startsWith("image/"));
  if (!imageFile) return false;

  // Instant ack so the operator gets feedback before the multi-second vision call.
  await slack.postThreadReply(args.channel, args.threadTs, "🎬 Reading your photo, building 4 headline options…");

  const url = imageFile.url_private ?? imageFile.url_private_download ?? null;
  const img = url ? await downloadImage(url, imageFile.mimetype) : null;

  // If the operator posted the FULL copy (title + hook + payoff + cta), render it
  // right away — skip the variation step. Anything less falls through to suggestions.
  const directScript = parseBoxes(args.brief);
  const isComplete = !!(
    directScript &&
    directScript.label &&
    directScript.line1 &&
    directScript.line2 &&
    directScript.cta
  );
  if (isComplete && directScript) {
    const { data: jobRow } = await supabaseAdmin
      .from("reel_studio_jobs")
      .insert({
        slack_channel: args.channel,
        slack_thread_ts: args.threadTs,
        options_msg_ts: null,
        brief: args.brief || null,
        image_url: url,
        image_mimetype: imageFile.mimetype ?? null,
        variations: null,
        status: "rendering",
      })
      .select(JOB_COLS)
      .single();
    if (jobRow) {
      waitUntil(
        finalizeStudio(jobRow as StudioJobRow, directScript).catch((e) =>
          console.error("[studio] finalize (direct) error:", (e as Error).message)
        )
      );
    }
    return true;
  }

  let variations: ReelScript[];
  try {
    variations = await generateStudioVariations({ brief: args.brief, image: img ?? undefined });
  } catch (e) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `⚠️ Could not generate variations (${(e as Error).message.slice(0, 120)}). Reply with your 4 boxes (label, hook, payoff, cta) and I will render it.`
    );
    variations = [];
  }

  const msg = variations.length
    ? formatVariations(variations)
    : "Reply with your 4 boxes (one per line: label, hook, payoff, cta) and I will render the reel.";
  const res = (await slack.postThreadReply(args.channel, args.threadTs, msg)) as { ts?: string };

  await supabaseAdmin.from("reel_studio_jobs").insert({
    slack_channel: args.channel,
    slack_thread_ts: args.threadTs,
    options_msg_ts: res?.ts ?? null,
    brief: args.brief || null,
    image_url: url,
    image_mimetype: imageFile.mimetype ?? null,
    variations: variations.length ? variations : null,
    status: "awaiting_pick",
  });

  return true;
}

/**
 * Operator reacted 1/2/3/4 on the variations message. Render that variation as-is.
 * Returns true if this was a studio reaction.
 */
export async function handleStudioReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const idx = KEYCAP_TO_INDEX[args.reaction];
  if (idx === undefined) return false;

  const job = await getJobByOptionsMsg(args.slackTs);
  if (!job || job.status !== "awaiting_pick") return false;

  const chosen = (job.variations ?? [])[idx];
  if (!chosen) return false;

  waitUntil(
    finalizeStudio(job, chosen).catch((e) =>
      console.error("[studio] finalize (reaction) error:", (e as Error).message)
    )
  );
  return true;
}

/**
 * Thread reply in a studio thread. Treat the text as the operator's final 4 boxes,
 * render it. Returns true if this thread belongs to a studio job (claims the event).
 */
export async function handleStudioReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getJobByThread(args.threadTs);
  if (!job || job.status !== "awaiting_pick") return false;

  const base = (job.variations ?? [])[0] ?? null;
  const script = parseBoxes(args.text, base);
  if (!script) {
    await slack.postThreadReply(
      args.channel,
      job.slack_thread_ts,
      "Send your 4 boxes, one per line: line 1 = label, line 2 = hook, line 3 = payoff, line 4 = cta. (Or react 1-4 to use a variation.)"
    );
    return true; // claimed: this is a studio thread, don't fall through to other handlers
  }

  waitUntil(
    finalizeStudio(job, script).catch((e) =>
      console.error("[studio] finalize (reply) error:", (e as Error).message)
    )
  );
  return true;
}

/** Render the MP4 for a final script, post it + a caption, mark the job done. */
async function finalizeStudio(job: StudioJobRow, script: ReelScript): Promise<void> {
  await supabaseAdmin
    .from("reel_studio_jobs")
    .update({ status: "rendering", final_script: script, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🎬 Rendering your reel...");

  try {
    const img = job.image_url ? await downloadImage(job.image_url, job.image_mimetype ?? undefined) : null;
    if (!img) throw new Error("could not read the source image");

    const { mp4, url } = await renderReel(script, img);

    const up = (await slack.uploadFile(
      job.slack_channel,
      "reel.mp4",
      mp4,
      "video/mp4",
      job.slack_thread_ts
    )) as { ok?: boolean; error?: string };
    if (up.ok === false) {
      console.error("[studio] reel upload failed:", JSON.stringify(up));
      await slack.postThreadReply(
        job.slack_channel,
        job.slack_thread_ts,
        url
          ? `⚠️ Couldn't attach the video to Slack (${up.error ?? "unknown"}). Download it here: ${url}`
          : `🚫 Reel rendered but the Slack upload failed (${up.error ?? "unknown"}).`
      );
    }

    let caption = "";
    try {
      caption = await generateCaptionForScript(script, img);
    } catch (e) {
      // The shared Claude helper already retries transient overloads, but the
      // render has succeeded by now so one more explicit attempt after a short
      // pause is cheap insurance against a busy moment dropping the caption.
      console.error("[studio] caption failed, retrying once:", (e as Error).message);
      try {
        await new Promise((r) => setTimeout(r, 1500));
        caption = await generateCaptionForScript(script, img);
      } catch (e2) {
        console.error("[studio] caption retry failed:", (e2 as Error).message);
      }
    }

    await slack.postThreadReply(
      job.slack_channel,
      job.slack_thread_ts,
      caption ? `📝 *Caption*\n${caption}` : "✅ Reel ready. (Caption generation failed, write it manually.)"
    );

    await supabaseAdmin
      .from("reel_studio_jobs")
      .update({ status: "done", caption: caption || null, updated_at: new Date().toISOString() })
      .eq("id", job.id);
  } catch (e) {
    await supabaseAdmin
      .from("reel_studio_jobs")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    await slack.postThreadReply(
      job.slack_channel,
      job.slack_thread_ts,
      `🚫 Render failed (${(e as Error).message.slice(0, 160)}). Reply with your boxes to retry.`
    );
    // reopen so a retry reply is accepted
    await supabaseAdmin
      .from("reel_studio_jobs")
      .update({ status: "awaiting_pick" })
      .eq("id", job.id);
  }
}

/** Call the Python render service and return the MP4 bytes + its public URL (when stored).
 *  Exported: render-dispatch.ts routes `render_options.build === "render_reel"` workflows here. */
export async function renderReel(
  script: ReelScript,
  img: ClaudeImageInput
): Promise<{ mp4: Buffer; url: string | null }> {
  // The renderer runs as its OWN Vercel project (render-service/) because a
  // Next.js app cannot host a root /api/*.py function — Next owns the /api
  // namespace. REEL_RENDER_URL is the full endpoint of that project, e.g.
  // https://srt-reel-render.vercel.app/api/render-reel
  const endpoint =
    process.env.REEL_RENDER_URL || `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/render-reel`;

  // Upload the source image to Supabase and send a URL — NOT inline base64.
  // Vercel serverless functions hard-cap the request body at ~4.5 MB; a high-res
  // photo (base64 inflates it ~33%) trips that limit and Vercel returns 413
  // FUNCTION_PAYLOAD_TOO_LARGE at the edge before the renderer ever runs. A URL
  // keeps the payload at a few hundred bytes. Fall back to inline b64 if the
  // upload fails so we degrade gracefully instead of hard-failing.
  let imageUrl: string | null = null;
  try {
    const ext = (img.media_type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    const key = `src/${randomUUID()}.${ext}`;
    const up = await supabaseAdmin.storage
      .from("reels")
      .upload(key, Buffer.from(img.data, "base64"), {
        contentType: img.media_type,
        upsert: true,
      });
    if (!up.error) {
      imageUrl = supabaseAdmin.storage.from("reels").getPublicUrl(key).data.publicUrl;
    } else {
      console.error("[studio] source image upload failed:", up.error.message);
    }
  } catch (e) {
    console.error("[studio] source image upload threw:", (e as Error).message);
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-reel-secret": process.env.REEL_RENDER_SECRET || "",
    },
    body: JSON.stringify({
      label: script.label || null,
      lines: [script.line1, script.line2].filter((l) => l && l.trim().length > 0),
      cta: script.cta || null,
      // Prefer the URL; only inline base64 when the upload failed (rare fallback).
      ...(imageUrl ? { image_url: imageUrl } : { image_b64: img.data }),
      image_mime: img.media_type,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`render-reel ${res.status} ${detail.slice(0, 120)}`);
  }

  const data = (await res.json()) as { url?: string; mp4_b64?: string; error?: string };
  if (data.error) throw new Error(data.error);

  if (data.url) {
    const r = await fetch(data.url);
    if (!r.ok) throw new Error(`fetch rendered mp4 ${r.status}`);
    return { mp4: Buffer.from(await r.arrayBuffer()), url: data.url };
  }
  if (data.mp4_b64) return { mp4: Buffer.from(data.mp4_b64, "base64"), url: null };
  throw new Error("render-reel returned no url or mp4");
}
