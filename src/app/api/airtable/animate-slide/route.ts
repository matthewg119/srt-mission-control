import { NextRequest, NextResponse } from "next/server";
import { generateVideo, pollVideo } from "@/lib/elevenlabs-media";
import { getRecord, updateRecord, uploadAttachment } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // veo-3-lite can take up to 4 min

const TABLE_ID = () => process.env.AIRTABLE_SLIDES_TABLE_ID ?? "";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-airtable-secret");
  if (process.env.AIRTABLE_WEBHOOK_SECRET && secret !== process.env.AIRTABLE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let recordId: string;
  try {
    const body = (await request.json()) as { recordId?: string };
    if (!body.recordId) return NextResponse.json({ error: "recordId required" }, { status: 400 });
    recordId = body.recordId;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const tableId = TABLE_ID();
  if (!tableId) return NextResponse.json({ error: "AIRTABLE_SLIDES_TABLE_ID not set" }, { status: 500 });

  let record: Record<string, unknown>;
  try {
    record = await getRecord(tableId, recordId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const fields = record.fields as Record<string, unknown>;
  const animationPrompt = fields["Animation Prompt"] as string | undefined;
  const attachments = fields["Generated Image"] as Array<{ url: string }> | undefined;

  if (!animationPrompt) {
    return NextResponse.json({ error: "Animation Prompt field is empty" }, { status: 400 });
  }
  if (!attachments || attachments.length === 0) {
    return NextResponse.json({ error: "No generated image found — generate the image first" }, { status: 400 });
  }

  const imageUrl = attachments[0].url;
  await updateRecord(tableId, recordId, { Status: "Animating" });

  let videoUrl: string;
  try {
    const jobId = await generateVideo(animationPrompt, imageUrl);
    videoUrl = await pollVideo(jobId);
  } catch (e) {
    await updateRecord(tableId, recordId, { Status: "Image Ready", "Generation Error": (e as Error).message.slice(0, 500) });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  try {
    if (videoUrl.startsWith("data:")) {
      const fieldId = process.env.AIRTABLE_VIDEO_FIELD_ID;
      if (!fieldId) throw new Error("AIRTABLE_VIDEO_FIELD_ID not set (needed for base64 uploads)");
      const [header, data] = videoUrl.split(",");
      const contentType = header.replace("data:", "").replace(";base64", "");
      await uploadAttachment(tableId, recordId, fieldId, `slide-${recordId}.mp4`, data, contentType);
    } else {
      // Fetch video bytes and re-attach — video URLs from ElevenLabs may expire
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Could not download video: ${videoRes.status}`);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const fieldId = process.env.AIRTABLE_VIDEO_FIELD_ID;
      if (fieldId) {
        await uploadAttachment(tableId, recordId, fieldId, `slide-${recordId}.mp4`, buf.toString("base64"), "video/mp4");
      } else {
        // Fallback: attach by URL (may expire but functional for immediate review)
        await updateRecord(tableId, recordId, {
          "Generated Video": [{ url: videoUrl, filename: `slide-${recordId}.mp4` }],
        });
      }
    }
    await updateRecord(tableId, recordId, { Status: "Done" });
  } catch (e) {
    await updateRecord(tableId, recordId, { Status: "Image Ready", "Generation Error": (e as Error).message.slice(0, 500) });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recordId });
}
