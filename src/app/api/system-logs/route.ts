import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10", 10);
    const clampedLimit = Math.min(Math.max(limit, 1), 1000);

    const { data, error } = await supabaseAdmin
      .from("system_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(clampedLimit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("System logs GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch system logs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event_type, description, metadata } = body;

    if (!event_type || !description) {
      return NextResponse.json(
        { error: "event_type and description are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("system_logs")
      .insert({
        event_type,
        description,
        metadata: metadata || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("System logs POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create log entry" },
      { status: 500 }
    );
  }
}
