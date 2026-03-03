import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("email_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ drafts: data || [] });
  } catch {
    // Table may not exist yet — return empty
    return NextResponse.json({ drafts: [] });
  }
}

export async function PATCH(req: NextRequest) {
  const { id, action, subject, body } = await req.json();

  if (action === "approve") {
    // Mark as approved — actual sending will be wired to Microsoft Graph when agents are built
    const { data, error } = await supabaseAdmin
      .from("email_drafts")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  }

  if (action === "edit") {
    const updates: Record<string, string> = {};
    if (subject) updates.subject = subject;
    if (body) updates.body = body;

    const { data, error } = await supabaseAdmin
      .from("email_drafts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
