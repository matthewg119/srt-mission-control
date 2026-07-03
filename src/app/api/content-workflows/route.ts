export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorkflows, resolveSong, type Workflow } from "@/config/workflows";

// GET — every content workflow (active + draft), flattened for the board. The app READS the same
// `workflows` table Slack writes, so the two stay in sync. Grouping (avatar -> category) is done
// client-side from these fields.
export async function GET() {
  try {
    const workflows = await listWorkflows(undefined, { status: "all" });
    const rows = workflows
      .filter((w) => w.status !== "archived")
      .map(toCard);
    return NextResponse.json({ workflows: rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function toCard(w: Workflow) {
  const shots = w.render_spec?.shots?.length || w.copy_structure?.length || w.scenes.length || 0;
  return {
    id: w.id,
    vertical_id: w.vertical_id,
    name: w.name,
    category: String(w.category),
    subcategory: w.subcategory ?? null,
    status: w.status,
    configured: w.status === "active" && (w.copy_structure?.length ?? 0) > 0,
    shots,
    mode: w.render_spec?.mode ?? null,
    song: resolveSong(w.song_ref ?? w.render_spec?.song_ref).label,
    description: w.description ?? null,
    production_status: w.production_status ?? "building",
    refs: w.reference_media?.length ?? 0,
    approved_count: w.approved_variations?.length ?? 0,
  };
}
