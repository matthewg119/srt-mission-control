import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// List call sessions for the Call Library tab. Joins call_coach_sessions with
// call_coach_users (rep name). Transcript count and suggestions_shown already
// live on the session row so no extra query is needed.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const outcome = searchParams.get("outcome");
    const userId = searchParams.get("user_id");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("call_coach_sessions")
      .select(
        `
        id,
        user_id,
        started_at,
        ended_at,
        duration_seconds,
        suggestions_shown,
        suggestions_clicked,
        total_entries,
        title,
        contact_name,
        business_name,
        outcome,
        analysis_status,
        score,
        notes,
        call_coach_users ( name )
      `
      )
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      // Contact name / business name / title all searchable.
      query = query.or(
        `contact_name.ilike.%${search}%,business_name.ilike.%${search}%,title.ilike.%${search}%`
      );
    }

    if (outcome && outcome !== "all") {
      query = query.eq("outcome", outcome);
    }

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Row = {
      id: string;
      user_id: string;
      started_at: string;
      ended_at: string | null;
      duration_seconds: number | null;
      suggestions_shown: number | null;
      suggestions_clicked: number | null;
      total_entries: number | null;
      title: string | null;
      contact_name: string | null;
      business_name: string | null;
      outcome: string | null;
      analysis_status: string | null;
      score: number | null;
      notes: string | null;
      call_coach_users: { name: string } | { name: string }[] | null;
    };

    const sessions = ((data as Row[] | null) || []).map((row) => {
      const userRel = row.call_coach_users;
      const rep_name = Array.isArray(userRel)
        ? userRel[0]?.name
        : userRel?.name;
      return {
        id: row.id,
        user_id: row.user_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        duration_seconds: row.duration_seconds,
        suggestions_shown: row.suggestions_shown,
        suggestions_clicked: row.suggestions_clicked,
        total_entries: row.total_entries,
        title: row.title,
        contact_name: row.contact_name,
        business_name: row.business_name,
        outcome: row.outcome,
        analysis_status: row.analysis_status || "pending",
        score: row.score,
        notes: row.notes,
        rep_name: rep_name || null,
        transcript_count: row.total_entries || 0,
      };
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Coaching sessions GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch sessions",
      },
      { status: 500 }
    );
  }
}
