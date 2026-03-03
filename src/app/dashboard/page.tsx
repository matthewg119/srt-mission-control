import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { DashboardClient } from "@/components/dashboard-client";
import { TERMINAL_STAGES } from "@/config/pipeline";

export const metadata = { title: "Dashboard | SRT Mission Control" };

export default async function DashboardPage() {
  const session = await auth();
  const userName = session?.user?.name || "there";

  // Stat 1: Active deals (non-terminal stages)
  const { count: activeDeals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .not("stage", "in", `(${TERMINAL_STAGES.map((s) => `"${s}"`).join(",")})`);

  // Stat 2: Pending email drafts awaiting review
  let pendingDrafts = 0;
  try {
    const { count } = await supabaseAdmin
      .from("email_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "draft");
    pendingDrafts = count || 0;
  } catch {
    // Table may not exist yet
  }

  // Stat 3: In underwriting (Underwriting + Submitted stages)
  const { count: inUnderwriting } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .in("stage", ["Underwriting", "Submitted"]);

  // Stat 4: Funded this month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { count: funded } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .eq("stage", "Funded")
    .gte("updated_at", monthStart);

  // Needs Attention: stale deals (>3 days no activity, non-terminal)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleDeals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("contact_name, business_name, stage, updated_at")
    .not("stage", "in", `(${TERMINAL_STAGES.map((s) => `"${s}"`).join(",")})`)
    .lt("updated_at", threeDaysAgo)
    .order("updated_at", { ascending: true })
    .limit(5);

  // Needs Attention: new leads in last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: newLeads } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .eq("stage", "New Lead")
    .gte("updated_at", oneDayAgo);

  // Recent activity feed
  const { data: logs } = await supabaseAdmin
    .from("system_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const stats = {
    activeDeals: activeDeals || 0,
    pendingDrafts,
    inUnderwriting: inUnderwriting || 0,
    funded: funded || 0,
  };

  const formattedDate = formatDate(new Date());

  return (
    <DashboardClient
      userName={userName}
      formattedDate={formattedDate}
      stats={stats}
      staleDeals={(staleDeals || []).map((d) => ({
        ...d,
        relativeTime: formatRelativeTime(d.updated_at),
      }))}
      newLeads={newLeads || 0}
      logs={(logs || []).map((l) => ({
        ...l,
        relativeTime: formatRelativeTime(l.created_at),
      }))}
    />
  );
}
