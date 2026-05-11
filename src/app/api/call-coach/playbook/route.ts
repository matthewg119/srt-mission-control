export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";

/**
 * GET /api/call-coach/playbook
 *
 * Returns the current playbook (objection/rebuttal pairs).
 * Requires a valid Call Coach API key.
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

    const { data, error } = await supabaseAdmin
      .from("srt_playbook")
      .select("playbook, version, updated_at")
      .order("id", { ascending: true })
      .limit(1)
      .single();

    if (error) {
      console.error("Playbook fetch error:", error);
      return NextResponse.json({ playbook: [], version: 0 });
    }

    return NextResponse.json({
      playbook: data.playbook || [],
      version: data.version,
      updated_at: data.updated_at,
    });
  } catch (error) {
    console.error("Playbook GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch playbook" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/call-coach/playbook
 *
 * Updates the playbook. Requires the playbook update secret
 * (used by the Python training pipeline).
 */
export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-playbook-secret");
    const expectedSecret = process.env.PLAYBOOK_UPDATE_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return NextResponse.json(
        { error: "Invalid playbook secret" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { playbook } = body;

    if (!Array.isArray(playbook)) {
      return NextResponse.json(
        { error: "playbook must be a JSON array" },
        { status: 400 }
      );
    }

    // Upsert: update existing row or insert if none exists
    const { data: existing } = await supabaseAdmin
      .from("srt_playbook")
      .select("id, version")
      .order("id", { ascending: true })
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("srt_playbook")
        .update({
          playbook,
          version: (existing.version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) throw error;

      return NextResponse.json({
        success: true,
        version: (existing.version || 0) + 1,
        count: playbook.length,
      });
    } else {
      const { error } = await supabaseAdmin
        .from("srt_playbook")
        .insert({
          playbook,
          version: 1,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      return NextResponse.json({
        success: true,
        version: 1,
        count: playbook.length,
      });
    }
  } catch (error) {
    console.error("Playbook POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update playbook",
      },
      { status: 500 }
    );
  }
}
