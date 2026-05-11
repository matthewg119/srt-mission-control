export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Bulk-import playbook entries. Accepts the same JSON array shape that the
// legacy POST /api/call-coach/playbook endpoint (the Python pipeline) expects,
// so any existing exports can be pasted straight in.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entries = Array.isArray(body?.entries)
      ? body.entries
      : Array.isArray(body?.playbook)
      ? body.playbook
      : Array.isArray(body)
      ? body
      : null;

    if (!entries) {
      return NextResponse.json(
        { error: "Expected an array of entries" },
        { status: 400 }
      );
    }

    const rows = entries
      .filter(
        (e: { trigger?: unknown; category?: unknown }) =>
          typeof e?.trigger === "string" && typeof e?.category === "string"
      )
      .map(
        (e: {
          trigger: string;
          category: string;
          suggestions?: unknown;
          context?: unknown;
          source?: unknown;
        }) => ({
          trigger: e.trigger,
          category: e.category,
          suggestions: Array.isArray(e.suggestions) ? e.suggestions : [],
          context: typeof e.context === "string" ? e.context : null,
          source: typeof e.source === "string" ? e.source : "import",
          is_active: true,
        })
      );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid entries found" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("coaching_playbook_entries")
      .insert(rows)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.rpc("sync_playbook_to_legacy");

    return NextResponse.json(
      { imported: data?.length || 0, entries: data },
      { status: 201 }
    );
  } catch (error) {
    console.error("Coaching playbook bulk-import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import entries",
      },
      { status: 500 }
    );
  }
}
