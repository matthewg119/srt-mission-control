import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET — list all custom workflows
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("custom_workflows")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// POST — create a new workflow
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, nodes, edges } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("custom_workflows")
    .insert({
      name,
      description: description || null,
      nodes: nodes || [],
      edges: edges || [],
      enabled: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
