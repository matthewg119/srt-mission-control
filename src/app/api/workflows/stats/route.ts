import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: rejectedLeads },
    { count: rejectedApps },
    { data: sequenceEnrollments },
    { count: smsSent },
    { count: emailSent },
    { count: totalLeads },
    { count: totalApps },
  ] = await Promise.all([
    // Rejected leads (bot detected, last 7 days)
    supabaseAdmin
      .from("system_logs")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "bot_rejected")
      .gte("created_at", sevenDaysAgo),

    // Rejected application submissions
    supabaseAdmin
      .from("system_logs")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "application_bot_rejected")
      .gte("created_at", sevenDaysAgo),

    // Active sequence enrollments per sequence slug
    supabaseAdmin
      .from("sequence_enrollments")
      .select("sequence_slug")
      .eq("status", "active"),

    // SMS sent (last 7 days)
    supabaseAdmin
      .from("automation_logs")
      .select("*", { count: "exact", head: true })
      .eq("action_type", "sms")
      .gte("created_at", sevenDaysAgo),

    // Emails sent (last 7 days)
    supabaseAdmin
      .from("automation_logs")
      .select("*", { count: "exact", head: true })
      .eq("action_type", "email")
      .gte("created_at", sevenDaysAgo),

    // Total leads captured (last 7 days)
    supabaseAdmin
      .from("system_logs")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "lead_captured")
      .gte("created_at", sevenDaysAgo),

    // Total application submissions
    supabaseAdmin
      .from("system_logs")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "application_submitted")
      .gte("created_at", sevenDaysAgo),
  ]);

  // Count enrollments per sequence slug
  const enrollmentCounts: Record<string, number> = {};
  for (const row of sequenceEnrollments || []) {
    enrollmentCounts[row.sequence_slug] = (enrollmentCounts[row.sequence_slug] || 0) + 1;
  }

  return NextResponse.json({
    rejectedLeads: rejectedLeads || 0,
    rejectedApps: rejectedApps || 0,
    enrollmentCounts,
    smsSent: smsSent || 0,
    emailSent: emailSent || 0,
    totalLeads: totalLeads || 0,
    totalApps: totalApps || 0,
    totalEnrollments: (sequenceEnrollments || []).length,
  });
}
