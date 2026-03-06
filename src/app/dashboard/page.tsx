import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { formatRelativeTime } from "@/lib/utils";
import { BrainHeartCommandCenter } from "@/components/brainheart-command-center";

export const metadata = { title: "BrainHeart | SRT Mission Control" };

export default async function DashboardPage() {
  const session = await auth();
  const userName = session?.user?.name || undefined;

  const { data: logs } = await supabaseAdmin
    .from("system_logs")
    .select("event_type, description, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const recentActivity = (logs || []).map((l) => ({
    event_type: l.event_type as string,
    description: l.description as string,
    relativeTime: formatRelativeTime(l.created_at as string),
  }));

  return <BrainHeartCommandCenter userName={userName} recentActivity={recentActivity} />;
}
