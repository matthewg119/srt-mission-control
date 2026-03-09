import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// POST /api/deals/notes — add a note to a deal
export async function POST(request: NextRequest) {
  try {
    const { deal_id, contact_id, content } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("deal_notes")
      .insert({
        deal_id: deal_id || null,
        contact_id: contact_id || null,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ note: data });
  } catch (error) {
    console.error("Note POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add note" },
      { status: 500 }
    );
  }
}
