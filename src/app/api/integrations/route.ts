import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Default integration cards — merged with DB records
const DEFAULT_INTEGRATIONS = [
  { name: "GoHighLevel", type: "CRM", status: "disconnected", config: {}, icon: "📊" },
  { name: "AI Configuration", type: "AI", status: "disconnected", config: { additionalContext: "", priorities: "" }, icon: "🤖" },
  { name: "Quo Phone", type: "Phone", status: "coming_soon", config: {}, icon: "📞" },
  { name: "Microsoft Teams", type: "Communication", status: "coming_soon", config: {}, icon: "💬" },
  { name: "Microsoft 365", type: "Email", status: "disconnected", config: {}, icon: "📧" },
  { name: "Meta Pixel", type: "Analytics", status: "coming_soon", config: {}, icon: "📈" },
];

export async function GET() {
  try {
    const { data: dbIntegrations, error } = await supabaseAdmin
      .from("integrations")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ integrations: DEFAULT_INTEGRATIONS }, { status: 200 });
    }

    // Merge DB records with defaults — DB takes priority
    const dbNames = new Set((dbIntegrations || []).map((i: Record<string, string>) => i.name));
    const merged = [
      ...(dbIntegrations || []),
      ...DEFAULT_INTEGRATIONS.filter((d) => !dbNames.has(d.name)),
    ];

    return NextResponse.json({ integrations: merged });
  } catch (error) {
    console.error("Integrations GET error:", error);
    return NextResponse.json(
      { integrations: DEFAULT_INTEGRATIONS },
      { status: 200 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, config, last_sync } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Integration id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) updates.status = status;
    if (config !== undefined) updates.config = config;
    if (last_sync !== undefined) updates.last_sync = last_sync;

    const { data, error } = await supabaseAdmin
      .from("integrations")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Integrations PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update integration" },
      { status: 500 }
    );
  }
}
