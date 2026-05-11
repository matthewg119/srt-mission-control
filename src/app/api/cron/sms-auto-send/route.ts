export const dynamic = "force-dynamic";
// Cron: auto-send AI drafts after their timer expires (runs every minute).
// Claims sms_pending_drafts WHERE auto_send_status='pending' AND auto_send_at <= now()
// Uses optimistic locking: UPDATE to 'sending' first to prevent concurrent double-fire.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendSMS } from "@/lib/sms-sender";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();

  // Atomic claim — set to 'sending' before reading to prevent two invocations racing
  const { data: claimed } = await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ auto_send_status: "sending" })
    .eq("auto_send_status", "pending")
    .lte("auto_send_at", now)
    .select("conversation_id, draft_body, close_stage, slack_channel_id, slack_ts");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: Array<{ conversation_id: string; ok: boolean; error?: string }> = [];

  for (const draft of claimed) {
    try {
      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("phone, assigned_sender, first_sms_sent")
        .eq("id", draft.conversation_id)
        .maybeSingle();

      if (!conv) {
        await supabaseAdmin.from("sms_pending_drafts").delete().eq("conversation_id", draft.conversation_id);
        continue;
      }

      const result = await sendSMS(
        conv.phone as string,
        draft.draft_body as string,
        draft.conversation_id as string,
        (conv.assigned_sender as string | null) ?? undefined
      );

      if (result.ok) {
        await supabaseAdmin.from("sms_messages").insert({
          conversation_id: draft.conversation_id,
          direction: "outbound",
          body: draft.draft_body,
          close_stage: draft.close_stage,
          metadata: { source: "ai_auto_send" },
        });

        if (conv.first_sms_sent === false) {
          await supabaseAdmin
            .from("sms_conversations")
            .update({ first_sms_sent: true })
            .eq("id", draft.conversation_id);
        }

        if (draft.slack_channel_id && draft.slack_ts) {
          const { slack } = await import("@/lib/slack-bot");
          const body = draft.draft_body as string;
          const preview = body.length > 50 ? body.slice(0, 50) + "…" : body;
          await slack.postThreadReply(
            draft.slack_channel_id as string,
            draft.slack_ts as string,
            `⏱ Auto-sent — "${preview}"`
          );
        }

        await supabaseAdmin.from("sms_pending_drafts").delete().eq("conversation_id", draft.conversation_id);
        results.push({ conversation_id: draft.conversation_id as string, ok: true });
      } else {
        await supabaseAdmin
          .from("sms_pending_drafts")
          .update({ auto_send_status: "failed" })
          .eq("conversation_id", draft.conversation_id);

        if (draft.slack_channel_id && draft.slack_ts) {
          const { slack } = await import("@/lib/slack-bot");
          await slack.postThreadReply(
            draft.slack_channel_id as string,
            draft.slack_ts as string,
            `❌ Auto-send failed: ${result.error ?? "unknown"}`
          );
        }

        results.push({ conversation_id: draft.conversation_id as string, ok: false, error: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[sms-auto-send] error for", draft.conversation_id, ":", msg);
      await supabaseAdmin
        .from("sms_pending_drafts")
        .update({ auto_send_status: "failed" })
        .eq("conversation_id", draft.conversation_id);
      results.push({ conversation_id: draft.conversation_id as string, ok: false, error: msg });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
