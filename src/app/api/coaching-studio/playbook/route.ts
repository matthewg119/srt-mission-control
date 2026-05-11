export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Rebuild the legacy srt_playbook JSONB after any mutation so the Chrome
// extension (which still fetches from /api/call-coach/playbook) sees the
// updated entries without any code changes.
async function syncToLegacyPlaybook() {
  try {
    const { error } = await supabaseAdmin.rpc("sync_playbook_to_legacy");
    if (error) {
      console.error("sync_playbook_to_legacy RPC error:", error);
    }
  } catch (err) {
    console.error("sync_playbook_to_legacy threw:", err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const category = searchParams.get("category");
    const includeInactive = searchParams.get("includeInactive") === "true";

    let query = supabaseAdmin
      .from("coaching_playbook_entries")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    if (search) {
      query = query.or(
        `trigger.ilike.%${search}%,context.ilike.%${search}%`
      );
    }

    if (category && category !== "All") {
      query = query.eq("category", category);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ entries: data || [] });
  } catch (error) {
    console.error("Coaching playbook GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch playbook",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trigger, category, suggestions, context, source } = body;

    if (!trigger || !category) {
      return NextResponse.json(
        { error: "trigger and category are required" },
        { status: 400 }
      );
    }

    const suggestionsArr = Array.isArray(suggestions)
      ? suggestions.filter((s) => typeof s === "string" && s.trim().length > 0)
      : [];

    const { data, error } = await supabaseAdmin
      .from("coaching_playbook_entries")
      .insert({
        trigger,
        category,
        suggestions: suggestionsArr,
        context: context || null,
        source: source || "manual",
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await syncToLegacyPlaybook();
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Coaching playbook POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create entry",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, trigger, category, suggestions, context, source, is_active } =
      body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (trigger !== undefined) updates.trigger = trigger;
    if (category !== undefined) updates.category = category;
    if (suggestions !== undefined) {
      updates.suggestions = Array.isArray(suggestions)
        ? suggestions.filter(
            (s) => typeof s === "string" && s.trim().length > 0
          )
        : [];
    }
    if (context !== undefined) updates.context = context;
    if (source !== undefined) updates.source = source;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabaseAdmin
      .from("coaching_playbook_entries")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await syncToLegacyPlaybook();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Coaching playbook PUT error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update entry",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");
    const hard = searchParams.get("hard") === "true";

    if (!id) {
      try {
        const body = await request.json();
        id = body?.id;
      } catch {
        // no body — fall through to the error below
      }
    }

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    // Soft-delete by default (is_active=false). Pass ?hard=true for a real
    // DELETE — useful for cleaning up bad imports.
    if (hard) {
      const { error } = await supabaseAdmin
        .from("coaching_playbook_entries")
        .delete()
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabaseAdmin
        .from("coaching_playbook_entries")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await syncToLegacyPlaybook();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Coaching playbook DELETE error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete entry",
      },
      { status: 500 }
    );
  }
}
