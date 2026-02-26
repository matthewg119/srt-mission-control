import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const category = searchParams.get("category");

    let query = supabaseAdmin
      .from("knowledge_entries")
      .select("*")
      .order("updated_at", { ascending: false });

    if (search) {
      query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ entries: data || [] });
  } catch (error) {
    console.error("Knowledge GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch knowledge entries" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, category, tags, created_by } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: "Title and content are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("knowledge_entries")
      .insert({
        title,
        content,
        category: category || null,
        tags: tags || [],
        created_by: created_by || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Knowledge POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create knowledge entry" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, title, content, category, tags } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Entry id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (category !== undefined) updates.category = category;
    if (tags !== undefined) updates.tags = tags;

    const { data, error } = await supabaseAdmin
      .from("knowledge_entries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Knowledge PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update knowledge entry" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      const body = await request.json();
      id = body.id;
    }

    if (!id) {
      return NextResponse.json(
        { error: "Entry id is required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("knowledge_entries")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Knowledge DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete knowledge entry" },
      { status: 500 }
    );
  }
}
