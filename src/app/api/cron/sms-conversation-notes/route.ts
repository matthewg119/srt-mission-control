export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { summarizeIdleConversations } from "@/lib/sms-conversation-notes";

// Sweeps idle SMS conversations and posts bullet-point notes to Slack + Zoho.
// Schedule in vercel.json: { "path": "/api/cron/sms-conversation-notes", "schedule": "*/5 * * * *" }
export async function GET() {
  try {
    const res = await summarizeIdleConversations();
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    console.error("[cron sms-conversation-notes] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
