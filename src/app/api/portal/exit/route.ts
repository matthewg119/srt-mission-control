// Portal exit beacon endpoint — called by navigator.sendBeacon() when a lead leaves the portal.
// Sets first_sms_scheduled_at = now + 30s so the sms-delayed-sends cron picks it up.
// No auth: the contact's email is the identifier (lookup-only, no sensitive write exposure).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://portal.srtagency.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req: NextRequest) {
  let email: string | null = null;
  let contactId: string | null = null;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, string>;
    email = body.email ?? null;
    contactId = body.contact_id ?? null;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!email && !contactId) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    // Resolve contact
    if (!contactId && email) {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      contactId = contact?.id ?? null;
    }

    if (!contactId) {
      return new NextResponse(null, { status: 204 });
    }

    // Only schedule if not already sent and not already scheduled
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("id, first_sms_sent, first_sms_scheduled_at")
      .eq("contact_id", contactId)
      .maybeSingle();

    if (!conv || conv.first_sms_sent || conv.first_sms_scheduled_at) {
      return new NextResponse(null, { status: 204 });
    }

    // Schedule 30 seconds from now
    const scheduledAt = new Date(Date.now() + 30_000).toISOString();
    await supabaseAdmin
      .from("sms_conversations")
      .update({ first_sms_scheduled_at: scheduledAt })
      .eq("id", conv.id);
  } catch (err) {
    console.error("[portal/exit] error:", (err as Error).message);
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "https://portal.srtagency.com" },
  });
}
