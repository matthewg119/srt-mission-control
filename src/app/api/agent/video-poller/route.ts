import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { generateVideo, pollVideo } from "@/lib/elevenlabs-media";
import { uploadToReels } from "@/lib/reel/pov";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { checkAndFinishAutoReel } from "@/lib/reel/auto-reel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PollerBody {
  scene_id: string;
  package_id: string;
  slide_number: number;
  animation_prompt: string;
  image_url: string;
  channel: string;
  thread_ts: string;
  /** "auto" = autonomous auto-reel shot: animate via the motion adapter, no approval gate. */
  mode?: "auto";
}

// Autonomous auto-reel shot: animate ONE shot via the swappable motion adapter, store a
// durable clip URL, and post NO per-shot approval prompt. When every shot of the package
// is terminal, checkAndFinishAutoReel stitches + posts the final reel (atomic, idempotent).
async function handleAutoShot(body: PollerBody): Promise<NextResponse> {
  const { scene_id, package_id, slide_number, animation_prompt, image_url } = body;
  console.log(`[video-poller] auto shot start scene=${scene_id} slide=${slide_number}`);

  try {
    const clip = await getMotionAdapter().animate(image_url, animation_prompt || "");
    const videoUrl = await uploadToReels(clip, "video/mp4");
    if (!videoUrl) throw new Error("clip upload to reels bucket failed");
    await supabaseAdmin
      .from("content_scenes")
      .update({ video_url: videoUrl, video_approved: true, video_error: null })
      .eq("id", scene_id);
    console.log(`[video-poller] auto shot done slide=${slide_number}`);
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[video-poller] auto shot error slide=${slide_number}:`, errMsg);
    await supabaseAdmin.from("content_scenes").update({ video_error: errMsg }).eq("id", scene_id);
  }

  // Fan-in: trigger the stitch when this was the last outstanding shot (success or fail).
  try {
    await checkAndFinishAutoReel(package_id);
  } catch (err) {
    console.error(`[video-poller] auto finish check failed pkg=${package_id}:`, (err as Error).message);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as PollerBody;

  if (body.mode === "auto") return handleAutoShot(body);

  const { scene_id, package_id, slide_number, animation_prompt, image_url, channel, thread_ts } = body;

  console.log(`[video-poller] start scene=${scene_id} slide=${slide_number}`);

  try {
    // Start video generation
    const jobId = await generateVideo(animation_prompt, image_url);
    await supabaseAdmin.from("content_scenes").update({ video_job_id: jobId }).eq("id", scene_id);

    // Poll until done (up to 4 min)
    const videoUrl = await pollVideo(jobId, 240_000);
    console.log(`[video-poller] video ready slide=${slide_number}`);

    // Download and upload to Slack so the clip lives in the thread permanently
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Failed to download video from ElevenLabs: ${videoRes.status}`);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    await slack.uploadFile(channel, `slide-${slide_number}.mp4`, videoBuffer, "video/mp4", thread_ts);

    // Post the approval prompt as a separate text message so its ts can be tracked for reactions
    const total = await getSlideCount(package_id);
    const nextLabel =
      slide_number < total ? ` and move to Slide ${slide_number + 1}` : " — all clips done";
    const approvalRes = await slack.postThreadReply(
      channel,
      thread_ts,
      `🎬 *Slide ${slide_number}/${total} clip ready.* React ✅ to approve${nextLabel}, or 🔄 to regenerate.`
    );
    const approvalTs = approvalRes.ts as string | undefined;

    await supabaseAdmin
      .from("content_scenes")
      .update({ video_url: videoUrl, slack_video_ts: approvalTs ?? null, video_error: null })
      .eq("id", scene_id);

    console.log(`[video-poller] done slide=${slide_number} approval_ts=${approvalTs}`);
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[video-poller] error slide=${slide_number}:`, errMsg);
    await supabaseAdmin
      .from("content_scenes")
      .update({ video_error: errMsg })
      .eq("id", scene_id);
    await slack.postThreadReply(
      channel,
      thread_ts,
      `⚠️ Slide ${slide_number} clip generation failed. React 🔄 to retry.\n_${errMsg.slice(0, 200)}_`
    );
  }

  return NextResponse.json({ ok: true });
}

async function getSlideCount(pkgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("content_scenes")
    .select("id", { count: "exact", head: true })
    .eq("content_package_id", pkgId);
  return count ?? 0;
}
