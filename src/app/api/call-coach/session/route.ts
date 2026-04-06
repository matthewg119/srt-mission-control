import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";

/**
 * POST /api/call-coach/session
 *
 * Creates or updates a call coaching session log.
 * Used for analytics: how many calls, suggestions shown/clicked, etc.
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
    const { action } = body;

    if (action === "start") {
      // Create a new session
      const { data, error } = await supabaseAdmin
        .from("call_coach_sessions")
        .insert({
          user_id: user.id,
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error) throw error;

      // Increment total calls for the user
      await supabaseAdmin.rpc("increment_call_coach_calls", {
        user_uuid: user.id,
      }).catch(() => {});

      return NextResponse.json({ sessionId: data.id });
    }

    if (action === "end") {
      const { sessionId, duration_seconds, suggestions_shown, suggestions_clicked } = body;

      if (!sessionId) {
        return NextResponse.json(
          { error: "sessionId is required" },
          { status: 400 }
        );
      }

      const { error } = await supabaseAdmin
        .from("call_coach_sessions")
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: duration_seconds || 0,
          suggestions_shown: suggestions_shown || 0,
          suggestions_clicked: suggestions_clicked || 0,
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);

      if (error) throw error;

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "action must be 'start' or 'end'" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to log session",
      },
      { status: 500 }
    );
  }
}
