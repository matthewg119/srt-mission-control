import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { DashboardClient } from "@/components/dashboard-client";
import { TERMINAL_STAGES } from "@/config/pipeline";

export const metadata = { title: "Dashboard | SRT Mission Control" };

export default async function DashboardPage() {
  const session = await auth();
  const userName = session?.user?.name || "there";

  // Fetch stats from pipeline_cache — adapted for 2-pipeline setup
  const { count: activeDeals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .not("stage", "in", `(${TERMINAL_STAGES.map((s) => `"${s}"`).join(",")})`);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: thisWeek } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .gte("synced_at", weekAgo);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { count: funded } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .eq("stage", "Funded")
    .gte("synced_at", monthStart);

  // "In Underwriting" count — maps to Underwriting + Submitted stages
  const { count: pendingDocs } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*", { count: "exact", head: true })
    .in("stage", ["Underwriting", "Submitted"]);

  // Fetch recent activity
  const { data: logs } = await supabaseAdmin
    .from("system_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const stats = {
    activeDeals: activeDeals || 0,
    thisWeek: thisWeek || 0,
    funded: funded || 0,
    pendingDocs: pendingDocs || 0,
  };

  const formattedDate = formatDate(new Date());

  return (
    <DashboardClient
      userName={userName}
      formattedDate={formattedDate}
      stats={stats}
      logs={(logs || []).map((l) => ({
        ...l,
        relativeTime: formatRelativeTime(l.created_at),
      }))}
    />
  );
}
