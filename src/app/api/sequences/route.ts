import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  try {
    // Get all sequences with their step count and active enrollment count
    const { data: sequences, error } = await supabaseAdmin
      .from("email_sequences")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich with stats
    const enriched = await Promise.all(
      (sequences || []).map(async (seq: Record<string, unknown>) => {
        const { count: stepCount } = await supabaseAdmin
          .from("email_sequence_steps")
          .select("*", { count: "exact", head: true })
          .eq("sequence_id", seq.id);

        const { count: activeCount } = await supabaseAdmin
          .from("sequence_enrollments")
          .select("*", { count: "exact", head: true })
          .eq("sequence_id", seq.id)
          .eq("status", "active");

        const { count: completedCount } = await supabaseAdmin
          .from("sequence_enrollments")
          .select("*", { count: "exact", head: true })
          .eq("sequence_id", seq.id)
          .eq("status", "completed");

        return {
          ...seq,
          step_count: stepCount || 0,
          active_enrollments: activeCount || 0,
          completed_enrollments: completedCount || 0,
        };
      })
    );

    return NextResponse.json({ sequences: enriched });
  } catch (error) {
    console.error("Sequences GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sequences" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, slug, trigger_tag, cancel_tag, is_active, steps } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
    }

    // Create the sequence
    const { data: sequence, error: seqError } = await supabaseAdmin
      .from("email_sequences")
      .insert({
        name,
        slug,
        trigger_tag: trigger_tag || null,
        cancel_tag: cancel_tag || null,
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (seqError) {
      return NextResponse.json({ error: seqError.message }, { status: 500 });
    }

    // Create steps if provided
    if (steps && Array.isArray(steps) && steps.length > 0) {
      const stepRows = steps.map((step: Record<string, unknown>, i: number) => ({
        sequence_id: sequence.id,
        step_number: i + 1,
        delay_minutes: step.delay_minutes || 0,
        subject: step.subject || "",
        body: step.body || "",
      }));

      const { error: stepsError } = await supabaseAdmin
        .from("email_sequence_steps")
        .insert(stepRows);

      if (stepsError) {
        console.error("Steps insert error:", stepsError);
      }
    }

    return NextResponse.json({ sequence, steps_created: steps?.length || 0 });
  } catch (error) {
    console.error("Sequences POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create sequence" },
      { status: 500 }
    );
  }
}
