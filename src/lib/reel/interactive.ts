// Interactive workflow for the Daily Creative Drop.
//
// Flow (all inside one #content-full thread, scoped by the reel_drops table):
//   1. cron posts the prompt           -> recordDrop()           status=awaiting_image
//   2. operator uploads the picture    -> handleReelImage()      status=awaiting_pick
//      (Claude vision reads the photo, posts 3 headline options)
//   3. operator reacts 1/2/3           -> handleReelReaction()   status=done
//      (writes the single caption for the chosen headline)
//
// Both handlers self-route by DB lookup and return false when the event is not a
// reel event, so the existing Slack events route can fall through to its other
// handlers untouched.

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import type { ClaudeImageInput } from "@/lib/claude-calls";
import { loadBeliefs, type Belief } from "@/lib/reel/beliefs";
import { generateHeadlinesFromImage, fallbackHeadlines, type HeadlinePair } from "@/lib/reel/headlines";
import { generateCaptionForHeadline } from "@/lib/reel/captions";

interface SlackFileLike {
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

interface ReelDropRow {
  id: string;
  slack_channel: string;
  slack_thread_ts: string;
  belief_number: number;
  status: "awaiting_image" | "awaiting_pick" | "done";
  headline_options: HeadlinePair[] | null;
  image_url: string | null;
  image_mimetype: string | null;
}

const KEYCAP_TO_INDEX: Record<string, number> = { one: 0, two: 1, three: 2 };

function beliefByNumber(n: number): Belief | undefined {
  return loadBeliefs().find((b) => b.number === n);
}

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

function formatOptions(options: HeadlinePair[]): string {
  const lines = ["✏️ *3 headline options* (react 1️⃣ 2️⃣ 3️⃣ to pick):", ""];
  const caps = ["1️⃣", "2️⃣", "3️⃣"];
  options.forEach((o, i) => {
    lines.push(`${caps[i] ?? `${i + 1}.`}  TOP: ${o.hook}\n      BOTTOM: ${o.payoff}`);
  });
  return lines.join("\n");
}

/** Called by the cron after it posts the prompt message. Records the thread. */
export async function recordDrop(args: {
  channel: string;
  threadTs: string;
  slot: string;
  belief: Belief;
  scene: string;
  imagePrompt: string;
}): Promise<void> {
  await supabaseAdmin.from("reel_drops").insert({
    slack_channel: args.channel,
    slack_thread_ts: args.threadTs,
    slot: args.slot,
    belief_number: args.belief.number,
    belief_title: args.belief.title,
    scene: args.scene,
    image_prompt: args.imagePrompt,
    status: "awaiting_image",
  });
}

async function getDropByThread(threadTs: string): Promise<ReelDropRow | null> {
  const { data } = await supabaseAdmin
    .from("reel_drops")
    .select("id,slack_channel,slack_thread_ts,belief_number,status,headline_options,image_url,image_mimetype")
    .eq("slack_thread_ts", threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ReelDropRow | null) ?? null;
}

async function getDropByHeadlineMsg(ts: string): Promise<ReelDropRow | null> {
  const { data } = await supabaseAdmin
    .from("reel_drops")
    .select("id,slack_channel,slack_thread_ts,belief_number,status,headline_options,image_url,image_mimetype")
    .eq("headline_msg_ts", ts)
    .limit(1)
    .maybeSingle();
  return (data as ReelDropRow | null) ?? null;
}

/**
 * Operator uploaded the picture into a reel thread. Read it, post 3 headline
 * options, advance to awaiting_pick. Returns true if this was a reel event.
 */
export async function handleReelImage(args: {
  channel: string;
  threadTs: string;
  files: SlackFileLike[];
}): Promise<boolean> {
  const drop = await getDropByThread(args.threadTs);
  if (!drop || drop.status !== "awaiting_image") return false;

  const imageFile = args.files.find((f) => (f.mimetype ?? "").startsWith("image/"));
  if (!imageFile) return false;

  const url = imageFile.url_private ?? imageFile.url_private_download;
  const img = url ? await downloadImage(url, imageFile.mimetype) : null;
  const belief = beliefByNumber(drop.belief_number);
  if (!belief) return false;

  let options: HeadlinePair[];
  if (img) {
    try {
      options = await generateHeadlinesFromImage(belief, img);
    } catch (e) {
      console.error("[reel] vision headlines failed, using fallback:", (e as Error).message);
      options = fallbackHeadlines(belief);
    }
  } else {
    await slack.postThreadReply(args.channel, args.threadTs, "⚠️ Could not read that image, using belief-based headlines.");
    options = fallbackHeadlines(belief);
  }

  const res = (await slack.postThreadReply(args.channel, args.threadTs, formatOptions(options))) as { ts?: string };

  await supabaseAdmin
    .from("reel_drops")
    .update({
      status: "awaiting_pick",
      headline_msg_ts: res?.ts ?? null,
      headline_options: options,
      image_url: url ?? null,
      image_mimetype: imageFile.mimetype ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", drop.id);

  return true;
}

/**
 * Operator reacted 1/2/3 on the headline-options message. Write the caption for the
 * chosen headline. Returns true if this was a reel reaction.
 */
export async function handleReelReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const idx = KEYCAP_TO_INDEX[args.reaction];
  if (idx === undefined) return false;

  const drop = await getDropByHeadlineMsg(args.slackTs);
  if (!drop || drop.status !== "awaiting_pick") return false;

  const options = drop.headline_options ?? [];
  const chosen = options[idx];
  if (!chosen) return false;

  const belief = beliefByNumber(drop.belief_number);
  if (!belief) return false;

  const img = drop.image_url
    ? await downloadImage(drop.image_url, drop.image_mimetype ?? undefined)
    : undefined;

  let caption: string;
  try {
    caption = await generateCaptionForHeadline(belief, chosen, img ?? undefined);
  } catch (e) {
    await slack.postThreadReply(
      args.channel,
      drop.slack_thread_ts,
      `Caption generation failed (${(e as Error).message.slice(0, 120)}). Pick again or retry.`
    );
    return true;
  }

  await slack.postThreadReply(
    args.channel,
    drop.slack_thread_ts,
    `✅ Headline ${idx + 1} chosen.\n\nTOP: ${chosen.hook}\nBOTTOM: ${chosen.payoff}\n\n📝 *Caption*\n${caption}`
  );

  await supabaseAdmin
    .from("reel_drops")
    .update({ status: "done", chosen_index: idx, caption, updated_at: new Date().toISOString() })
    .eq("id", drop.id);

  return true;
}
