export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseBusinessDate } from "@/lib/business-time";
import { supabaseAdmin } from "@/lib/db";
import { createTask } from "@/lib/crm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const openOnly = new URL(request.url).searchParams.get("open") !== "0";

  let q = supabaseAdmin
    .from("lead_tasks")
    .select("*")
    .eq("contact_id", id)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (openOnly) q = q.eq("status", "open");

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tasks: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const raw = String(body.due_at ?? body.due_date ?? "").trim();
  if (!raw) return NextResponse.json({ error: "due_at is required" }, { status: 400 });

  // parseBusinessDate, not `new Date(`${raw}T09:00:00`)`: the latter is 09:00 in
  // the SERVER's zone, i.e. 5am ET on Vercel, so tasks made here landed hours
  // earlier than the ones the call-log route creates.
  const dueAt = parseBusinessDate(raw);
  if (!dueAt) {
    return NextResponse.json({ error: "due_at is not a valid date" }, { status: 400 });
  }

  const res = await createTask({
    contactId: id,
    title,
    dueAt,
    description: body.description ? String(body.description) : undefined,
    taskType: body.task_type ? String(body.task_type) : undefined,
    priority: (body.priority as "low" | "normal" | "high") ?? "normal",
    origin: "mission_control",
    actor: session.user.email ?? "mission_control",
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "failed to create task" }, { status: 500 });
  }
  return NextResponse.json({ ...res, ok: true, dueAt: dueAt.toISOString() });
}
