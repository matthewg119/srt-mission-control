export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { loadWorkflow, resolveSong } from "@/config/workflows";
import { specFromWorkflow, buildVideoDescription, buildRenderClaudePrompt } from "@/lib/reel/render-spec";

// GET — one workflow's full detail for the drawer: labeled copy boxes, the render-spec timeline,
// generated stills, song, plus the machine-readable video description + the render Claude prompt.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const wf = await loadWorkflow(params.id);
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });

    const spec = specFromWorkflow(wf);
    return NextResponse.json({
      id: wf.id,
      vertical_id: wf.vertical_id,
      name: wf.name,
      category: String(wf.category),
      subcategory: wf.subcategory ?? null,
      status: wf.status,
      configured: wf.status === "active" && (wf.copy_structure?.length ?? 0) > 0,
      song: resolveSong(wf.song_ref ?? wf.render_spec?.song_ref).label,
      copy_structure: wf.copy_structure ?? [],
      render_spec: spec,
      shot_screenshots: wf.shot_screenshots ?? [],
      video_description: spec ? buildVideoDescription(wf, spec) : null,
      render_prompt: spec ? buildRenderClaudePrompt(wf, spec) : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
