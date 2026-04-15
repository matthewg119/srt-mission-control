import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET a single session with its full transcript. This is the dashboard-auth
// version of /api/call-coach/transcript (which requires a Call Coach API key
// and is only used by the Chrome extension).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("call_coach_sessions")
      .select(
        `
        *,
        call_coach_users ( name )
      `
      )
      .eq("id", id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: sessionError?.message || "Session not found" },
        { status: 404 }
      );
    }

    const { data: transcript, error: transcriptError } = await supabaseAdmin
      .from("call_coach_transcripts")
      .select("id, speaker, text, timestamp_ms, sequence_num, created_at")
      .eq("session_id", id)
      .order("sequence_num", { ascending: true });

    if (transcriptError) {
      return NextResponse.json(
        { error: transcriptError.message },
        { status: 500 }
      );
    }

    const userRel = (session as { call_coach_users?: unknown }).call_coach_users;
    const rep_name = Array.isArray(userRel)
      ? (userRel[0] as { name?: string })?.name
      : (userRel as { name?: string } | null | undefined)?.name;

    return NextResponse.json({
      session: { ...session, rep_name: rep_name || null },
      transcript: transcript || [],
    });
  } catch (error) {
    console.error("Coaching session GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch session",
      },
      { status: 500 }
    );
  }
}

// PUT updates the coaching-studio-owned fields on a session (title, contact
// name, business name, outcome, notes). The extension-owned columns
// (started_at, ended_at, counters, etc.) are untouched.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const body = await request.json();
    const { title, contact_name, business_name, outcome, notes } = body;

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (contact_name !== undefined) updates.contact_name = contact_name;
    if (business_name !== undefined) updates.business_name = business_name;
    if (outcome !== undefined) updates.outcome = outcome;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("call_coach_sessions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Coaching session PUT error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update session",
      },
      { status: 500 }
    );
  }
}
