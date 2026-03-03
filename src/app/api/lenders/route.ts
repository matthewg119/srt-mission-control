import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("lenders")
    .select("*")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lenders: data || [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .from("lenders")
    .insert([body])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
}

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json();
  const { data, error } = await supabaseAdmin
    .from("lenders")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lender: data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const { error } = await supabaseAdmin.from("lenders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
