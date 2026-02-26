import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET — List all templates, optionally filter by type or category
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // SMS or Email
    const category = searchParams.get("category");

    let query = supabaseAdmin
      .from("message_templates")
      .select("*")
      .order("category")
      .order("name");

    if (type) query = query.eq("type", type);
    if (category) query = query.eq("category", category);

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ templates: data || [] });
  } catch (error) {
    console.error("Templates GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

// POST — Create a new template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, slug, type, category, subject, body: templateBody, variables } = body;

    if (!name || !slug || !type || !category || !templateBody) {
      return NextResponse.json(
        { error: "Missing required fields: name, slug, type, category, body" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("message_templates")
      .insert({
        name,
        slug,
        type,
        category,
        subject: subject || null,
        body: templateBody,
        variables: variables || [],
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: data });
  } catch (error) {
    console.error("Templates POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create template" },
      { status: 500 }
    );
  }
}

// PUT — Update a template
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing template ID" }, { status: 400 });
    }

    // Rename body field to avoid conflict
    if (updates.body !== undefined) {
      updates.body = updates.body;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("message_templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: data });
  } catch (error) {
    console.error("Templates PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update template" },
      { status: 500 }
    );
  }
}

// DELETE — Delete a template
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing template ID" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("message_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Templates DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete template" },
      { status: 500 }
    );
  }
}
