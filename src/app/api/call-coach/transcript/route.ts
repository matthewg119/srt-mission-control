export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";

/**
 * POST /api/call-coach/transcript
 *
 * Batch-saves transcript entries for a call session.
 * Called during the call (periodic flush) and at call end.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Authorization header required" },
        { status: 401 }
      );
    }

    const user = await validateCallCoachKey(apiKey);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or inactive API key" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { sessionId, entries } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "entries must be a non-empty array" },
        { status: 400 }
      );
    }

    // Verify session belongs to this user
    const { data: session } = await supabaseAdmin
      .from("call_coach_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (!session) {
      return NextResponse.json(
        { error: "Session not found or unauthorized" },
        { status: 404 }
      );
    }

    // Batch insert transcript entries
    const rows = entries.map(
      (e: { speaker: string; text: string; timestamp: number; sequenceNum: number }) => ({
        session_id: sessionId,
        user_id: user.id,
        speaker: e.speaker,
        text: e.text,
        timestamp_ms: e.timestamp,
        sequence_num: e.sequenceNum,
      })
    );

    const { error: insertError } = await supabaseAdmin
      .from("call_coach_transcripts")
      .insert(rows);

    if (insertError) throw insertError;

    // Update entry count on the session via raw SQL increment for accuracy
    try {
      await supabaseAdmin.rpc("increment_transcript_count", {
        session_uuid: sessionId,
        entry_count: entries.length,
      });
    } catch {
      // Non-critical analytics — function may not exist yet
    }

    return NextResponse.json({ success: true, count: entries.length });
  } catch (error) {
    console.error("Transcript save error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save transcript",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/call-coach/transcript?sessionId=UUID
 *
 * Retrieves the full transcript for a given session, ordered by sequence.
 */
export async function GET(request: NextRequest) {
  try {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Authorization header required" },
        { status: 401 }
      );
    }

    const user = await validateCallCoachKey(apiKey);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or inactive API key" },
        { status: 401 }
      );
    }

    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query param is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("call_coach_transcripts")
      .select("speaker, text, timestamp_ms, sequence_num")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .order("sequence_num", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ entries: data || [] });
  } catch (error) {
    console.error("Transcript fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 500 }
    );
  }
}
