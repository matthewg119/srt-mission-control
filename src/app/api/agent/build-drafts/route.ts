export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { handleStatementDrop } from "@/lib/ai-intel/build-draft";

export const runtime = "nodejs";
export const maxDuration = 300; // statement analysis + BTF fill + drafts can run long

// Internal endpoint: the Slack events route fires a non-blocking POST here on a #srt-sub
// statement drop so the heavy work (analyze → report → BTF fill → 2 Outlook drafts) runs in
// its own invocation/timeout instead of the short-lived events function.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.channel || !body.threadTs || !Array.isArray(body.files)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    await handleStatementDrop({
      channel: body.channel,
      threadTs: body.threadTs,
      userId: body.userId ?? "",
      files: body.files,
      text: body.text,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
