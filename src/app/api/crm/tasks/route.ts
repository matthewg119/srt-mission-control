export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { fromLeadTask, leadDisplayName, toLeadStatus, type FeedStatus } from "@/lib/task-feed";

// Every open follow-up, across all leads.
//
// `/api/crm/leads/[id]/tasks` already lists one lead's tasks and `[taskId]`
// mutates one. What was missing is the book-wide view, which is what the Tasks
// board needs — otherwise a follow-up set by logging a call is only ever
// visible on the lead it came from.

interface ContactJoin {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
}

export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "open") as FeedStatus;
  const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);

  // `contacts!inner` is safe: contact_id is NOT NULL with ON DELETE CASCADE,
  // so a task can never outlive its lead.
  const { data, error } = await supabaseAdmin
    .from("lead_tasks")
    .select(
      "id, contact_id, title, description, task_type, priority, status, due_at, snoozed_until, created_at, contacts!inner(id, first_name, last_name, business_name)"
    )
    .eq("status", toLeadStatus(status))
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("[api/crm/tasks]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const tasks = (data ?? [])
    // A snoozed follow-up is deliberately out of sight until it comes back.
    .filter((r) => {
      const s = r.snoozed_until as string | null;
      return !s || new Date(s).getTime() <= now;
    })
    .map((r) => {
      // PostgREST types an embedded row as an array; at runtime a to-one
      // embed is the object itself.
      const c = (Array.isArray(r.contacts) ? r.contacts[0] : r.contacts) as ContactJoin | null;
      return fromLeadTask({
        id: r.id as string,
        contact_id: r.contact_id as string,
        title: r.title as string,
        description: r.description as string | null,
        task_type: r.task_type as string | null,
        priority: r.priority as string | null,
        status: r.status as string | null,
        due_at: r.due_at as string | null,
        created_at: r.created_at as string | null,
        lead_name: c ? leadDisplayName(c) : null,
      });
    });

  return NextResponse.json({ ok: true, tasks });
}
