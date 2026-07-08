export const dynamic = "force-dynamic";
export const maxDuration = 180;

import { NextRequest, NextResponse } from "next/server";
import { loadWorkflow } from "@/config/workflows";
import { specFromWorkflow, validateRenderSpec } from "@/lib/reel/render-spec";
import { buildRenderPayload, renderSpecVideo } from "@/lib/reel/render-client";

// POST — render this workflow's baked render_spec through the render-service
// `render-spec` endpoint (its own song, its scene images, its text timings) and
// return the MP4 URL. Used by the dashboard editor's Test render button.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const wf = await loadWorkflow(params.id);
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });

    const spec = specFromWorkflow(wf);
    if (!spec) {
      return NextResponse.json({ error: "this workflow has no render spec yet" }, { status: 400 });
    }
    const problems = validateRenderSpec(spec);
    if (problems.length) {
      return NextResponse.json({ error: "invalid render spec", problems }, { status: 400 });
    }

    const payload = buildRenderPayload(wf, spec);
    const result = await renderSpecVideo(payload);
    return NextResponse.json({ ok: true, url: result.url, duration: result.duration });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
