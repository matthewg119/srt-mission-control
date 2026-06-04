export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { handleStatementDrop } from "@/lib/ai-intel/build-draft";

export const runtime = "nodejs";
export const maxDuration = 300; // statement analysis + BTF fill + drafts can run long

// Internal endpoint: the Slack events route POSTs here on a #srt-sub statement drop. We respond
// immediately and run the heavy work (analyze → report → BTF fill → 2 Outlook drafts) via
// waitUntil so Vercel keeps the function alive to completion instead of freezing after the 200.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  await supabaseAdmin.from("system_logs").insert({
    event_type: "build_drafts_received",
    description: "[build-drafts] POST received",
    metadata: { files: Array.isArray(body?.files) ? body.files.length : 0, channel: body?.channel ?? null },
  }).then(() => {}, () => {});
  if (!body || !body.channel || !body.threadTs || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  waitUntil(
    handleStatementDrop({
      channel: body.channel,
      threadTs: body.threadTs,
      userId: body.userId ?? "",
      files: body.files,
      text: body.text,
    }).catch((e) => console.error("[build-drafts] handleStatementDrop error:", (e as Error).message))
  );
  return NextResponse.json({ ok: true }); // respond fast; work continues via waitUntil
}
