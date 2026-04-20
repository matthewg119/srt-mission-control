import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const [pending, upcoming] = await Promise.all([
    supabaseAdmin
      .from("pending_slack_actions")
      .select("id, created_at, payload, status, merchant_id, contacts:merchant_id(business_name, first_name, last_name)")
      .eq("action_type", "send_email")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("sequence_enrollments")
      .select("id, contact_name, next_send_at, current_step, email_sequences(name, slug)")
      .eq("status", "active")
      .lt("next_send_at", soon)
      .order("next_send_at", { ascending: true })
      .limit(100),
  ]);

  return NextResponse.json({
    pending: pending.data ?? [],
    upcoming: upcoming.data ?? [],
  });
}
