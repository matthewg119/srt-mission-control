export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET — active/recent content sessions for observability. The board polls this to light up a live
// badge on the workflow a session is currently building. Reads the same content_jobs table the
// Slack pipeline drives.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_jobs")
      .select("id,format_id,vertical_id,slack_channel,stage,status,data,updated_at")
      .in("format_id", ["avatar_pick", "workflow"])
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const runs = (data ?? []).map((r) => {
      const d = (r.data ?? {}) as { workflow_id?: string };
      return {
        id: r.id,
        vertical_id: r.vertical_id,
        workflow_id: d.workflow_id ?? null,
        stage: r.stage,
        status: r.status,
        updated_at: r.updated_at,
      };
    });
    // A workflow is "live" when it has an active (not done/skipped/error) session.
    const liveWorkflowIds = Array.from(
      new Set(runs.filter((r) => r.status === "active" && r.workflow_id).map((r) => r.workflow_id as string))
    );
    return NextResponse.json({ runs, liveWorkflowIds });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
