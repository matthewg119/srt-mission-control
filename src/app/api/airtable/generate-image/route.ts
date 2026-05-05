import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/elevenlabs-media";
import { getRecord, updateRecord, uploadAttachment } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const imagePrompt = fields["Image Prompt"] as string | undefined;
  if (!imagePrompt) {
    return NextResponse.json({ error: "Image Prompt field is empty" }, { status: 400 });
  }

  await updateRecord(tableId, recordId, { Status: "Generating" });

  let imageResult: string;
  try {
    imageResult = await generateImage(imagePrompt);
  } catch (e) {
    await updateRecord(tableId, recordId, { Status: "Draft", "Generation Error": (e as Error).message.slice(0, 500) });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  try {
    if (imageResult.startsWith("data:")) {
      // base64 path — requires AIRTABLE_IMAGE_FIELD_ID
      const fieldId = process.env.AIRTABLE_IMAGE_FIELD_ID;
      if (!fieldId) throw new Error("AIRTABLE_IMAGE_FIELD_ID not set (needed for base64 uploads)");
      const [header, data] = imageResult.split(",");
      const contentType = header.replace("data:", "").replace(";base64", "");
      await uploadAttachment(tableId, recordId, fieldId, `slide-${recordId}.png`, data, contentType);
    } else {
      // URL path — attach by URL, Airtable downloads it
      await updateRecord(tableId, recordId, {
        "Generated Image": [{ url: imageResult, filename: `slide-${recordId}.png` }],
      });
    }
    await updateRecord(tableId, recordId, { Status: "Image Ready" });
  } catch (e) {
    await updateRecord(tableId, recordId, { Status: "Draft", "Generation Error": (e as Error).message.slice(0, 500) });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recordId });
}
