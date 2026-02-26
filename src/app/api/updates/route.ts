import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = supabaseAdmin
      .from("updates")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: updates, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch tasks for each update
    const updatesWithTasks = await Promise.all(
      (updates || []).map(async (update) => {
        const { data: tasks } = await supabaseAdmin
          .from("update_tasks")
          .select("*")
          .eq("update_id", update.id)
          .order("sort_order", { ascending: true });

        return { ...update, tasks: tasks || [] };
      })
    );

    return NextResponse.json(updatesWithTasks);
  } catch (error) {
    console.error("Updates GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch updates" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { version, title, description, status, target_date, created_by } = body;

    if (!version || !title) {
      return NextResponse.json(
        { error: "Version and title are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("updates")
      .insert({
        version,
        title,
        description: description || null,
        status: status || "planned",
        target_date: target_date || null,
        created_by: created_by || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Updates POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create update" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Update id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      ...fields,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("updates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Updates PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Update id is required" },
        { status: 400 }
      );
    }

    // Tasks will cascade delete via FK constraint
    const { error } = await supabaseAdmin
      .from("updates")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Updates DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete update" },
      { status: 500 }
    );
  }
}
