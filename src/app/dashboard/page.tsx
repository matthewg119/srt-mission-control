import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { formatRelativeTime } from "@/lib/utils";
import { CommandCenter } from "@/components/command-center";

export const metadata = { title: "Command Center | SRT Mission Control" };

export default async function DashboardPage() {
  const session = await auth();
  const userName = session?.user?.name || undefined;

  const { data: logs } = await supabaseAdmin
    .from("system_logs")
    .select("event_type, description, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const recentActivity = (logs || []).map((l) => ({
    event_type: l.event_type as string,
    description: l.description as string,
    relativeTime: formatRelativeTime(l.created_at as string),
  }));

  return <CommandCenter userName={userName} recentActivity={recentActivity} />;
}
