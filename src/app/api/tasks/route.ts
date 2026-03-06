import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/tasks — list tasks with filters
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const assignee = searchParams.get("assignee");
    const status = searchParams.get("status");
    const department = searchParams.get("department");
    const priority = searchParams.get("priority");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabaseAdmin
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (assignee) query = query.eq("assignee", assignee);
    if (status) query = query.eq("status", status);
    if (department) query = query.eq("department", department);
    if (priority) query = query.eq("priority", priority);

    const { data, error } = await query;

    if (error) {
      console.error("Tasks fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tasks: data || [] });
  } catch (error) {
    console.error("Tasks GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks — create a task
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, title, description, assignee, department, priority, due_date, deal_reference, context, source, pulse_id } = body;

    if (!title || !type) {
      return NextResponse.json({ error: "title and type are required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .insert({
        type,
        title,
        description: description || null,
        assignee: assignee || "Matthew",
        department: department || "general",
        priority: priority || "medium",
        due_date: due_date || null,
        deal_reference: deal_reference || null,
        context: context || null,
        source: source || "manual",
        pulse_id: pulse_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Task create error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task: data });
  } catch (error) {
    console.error("Tasks POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/tasks — update task status
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, assignee, priority } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      updates.status = status;
      if (status === "completed") updates.completed_at = new Date().toISOString();
    }
    if (assignee) updates.assignee = assignee;
    if (priority) updates.priority = priority;

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Task update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ task: data });
  } catch (error) {
    console.error("Tasks PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
