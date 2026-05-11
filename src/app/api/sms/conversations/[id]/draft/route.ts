export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { postAIDraft } from "@/lib/sms-channel";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { template_name, body: customBody } = (await req.json()) as {
    template_name?: string;
    body?: string;
  };

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, slack_channel_id, close_stage, contact_id")
    .eq("id", id)
    .maybeSingle();

  if (!conv || !conv.slack_channel_id) {
    return NextResponse.json({ error: "conversation_not_found_or_no_channel" }, { status: 404 });
  }

  let displayName = conv.phone as string;
  let firstName: string | null = null;
  if (conv.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("first_name, last_name, business_name")
      .eq("id", conv.contact_id)
      .maybeSingle();
    if (contact) {
      displayName =
        (contact.business_name as string | null) ??
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ??
        displayName;
      firstName = contact.first_name as string | null;
    }
  }

  let draftBody = customBody ?? "";

  if (!draftBody && template_name) {
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("body")
      .eq("name", template_name)
      .eq("type", "sms")
      .maybeSingle();

    if (tmpl?.body) {
      draftBody = (tmpl.body as string).replace(/\{\{first_name\}\}/gi, firstName ?? "there");
    }
  }

  if (!draftBody) {
    return NextResponse.json({ error: "no_draft_body" }, { status: 400 });
  }

  const ts = await postAIDraft(
    conv.slack_channel_id as string,
    (conv.close_stage as number) ?? 1,
    displayName,
    draftBody,
    id
  );

  return NextResponse.json({ ok: true, channelId: conv.slack_channel_id, ts });
}
