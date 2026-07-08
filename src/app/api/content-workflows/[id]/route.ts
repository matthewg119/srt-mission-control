export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { loadWorkflow, resolveSong, type RenderSpec } from "@/config/workflows";
import { supabaseAdmin } from "@/lib/db";
import {
  specFromWorkflow,
  applyCopyToSpec,
  validateRenderSpec,
  buildVideoDescription,
  buildRenderClaudePrompt,
} from "@/lib/reel/render-spec";
import { buildWorkflowDetailMermaid } from "@/lib/reel/workflow-map";

// The per-scene reference boards (Workflow Builder v2): urls grouped by scene_index.
// Tolerates a missing scene_index column (migration not applied) by returning {}.
async function loadSceneRefIndex(workflowId: string): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("frame_urls,labels,scene_index")
      .eq("workflow_id", workflowId)
      .order("created_at", { ascending: false })
      .limit(120);
    if (error || !Array.isArray(data)) return {};
    const out: Record<string, string[]> = {};
    for (const row of data as Array<{ frame_urls: string[] | null; labels: string[] | null; scene_index: number | null }>) {
      if (!row.scene_index || (row.labels ?? []).includes("generated")) continue;
      const key = String(row.scene_index);
      for (const u of row.frame_urls ?? []) {
        if (typeof u === "string" && u) (out[key] ??= []).push(u);
      }
    }
    return out;
  } catch {
    return {};
  }
}

// GET — one workflow's full profile for the editor page: description + visual rules, scenes
// (image/animation prompts), copy boxes, render options (provider/aspect/quality), song,
// reference media, approved variations (the examples gallery), the production gates, the
// per-workflow mermaid, plus the machine-readable video description + render Claude prompt.
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
      song_ref: wf.song_ref ?? wf.render_spec?.song_ref ?? null,
      description: wf.description ?? null,
      visual_rules: wf.visual_rules ?? [],
      scenes: wf.scenes ?? [],
      captions: wf.captions ?? [],
      render_options: wf.render_options ?? {},
      copy_structure: wf.copy_structure ?? [],
      render_spec: spec,
      shot_screenshots: wf.shot_screenshots ?? [],
      reference_media: wf.reference_media ?? [],
      approved_variations: wf.approved_variations ?? [],
      production_status: wf.production_status ?? "building",
      style_dna: wf.style_dna ?? null,
      caption_template: wf.caption_template ?? null,
      beat_grid: wf.beat_grid ?? null,
      scene_refs: await loadSceneRefIndex(wf.id),
      detail_mermaid: buildWorkflowDetailMermaid(wf),
      video_description: spec ? buildVideoDescription(wf, spec) : null,
      render_prompt: spec ? buildRenderClaudePrompt(wf, spec) : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH — edit a workflow from the dashboard editor. Whitelisted fields only, shape-checked,
// strings trimmed. Optional `rebake_spec: true` recomputes render_spec from the (edited)
// copy_structure and returns validation warnings WITHOUT blocking the save.
// Note: the Slack pipeline writes the same row via upsertWorkflow while a session runs;
// single operator, last-writer-wins is accepted.
const STRING_FIELDS = [
  "name",
  "description",
  "song_ref",
  "status",
  "production_status",
  "style_dna",
  "caption_template",
] as const;

function cleanStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((s) => String(s ?? "").trim()).filter(Boolean);
}

function isObjArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const wf = await loadWorkflow(params.id);
    if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });

    const patch: Record<string, unknown> = {};

    for (const f of STRING_FIELDS) {
      if (body[f] !== undefined) {
        const v = String(body[f] ?? "").trim();
        if (f === "name" && !v) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
        if (f === "status" && !["draft", "active", "archived"].includes(v)) {
          return NextResponse.json({ error: "status must be draft | active | archived" }, { status: 400 });
        }
        if (f === "production_status" && !["building", "in_production", "live"].includes(v)) {
          return NextResponse.json({ error: "production_status must be building | in_production | live" }, { status: 400 });
        }
        patch[f] = v || null;
      }
    }

    if (body.visual_rules !== undefined) {
      const rules = cleanStringArray(body.visual_rules);
      if (!rules) return NextResponse.json({ error: "visual_rules must be a string array" }, { status: 400 });
      patch.visual_rules = rules;
    }

    for (const f of ["scenes", "copy_structure", "captions"] as const) {
      if (body[f] !== undefined) {
        if (!isObjArray(body[f])) return NextResponse.json({ error: `${f} must be an object array` }, { status: 400 });
        patch[f] = body[f];
      }
    }

    if (body.render_options !== undefined) {
      const ro = body.render_options;
      if (!ro || typeof ro !== "object" || Array.isArray(ro)) {
        return NextResponse.json({ error: "render_options must be an object" }, { status: 400 });
      }
      patch.render_options = { ...wf.render_options, ...(ro as Record<string, unknown>) };
    }

    if (body.render_spec !== undefined) {
      const rs = body.render_spec;
      if (rs !== null && (typeof rs !== "object" || Array.isArray(rs))) {
        return NextResponse.json({ error: "render_spec must be an object or null" }, { status: 400 });
      }
      patch.render_spec = rs;
    }

    // Rebake: recompute the timeline from the edited copy_structure, keeping the existing texts.
    let warnings: string[] = [];
    if (body.rebake_spec === true) {
      const merged = { ...wf, ...patch } as typeof wf;
      const base = specFromWorkflow(merged);
      if (base) {
        const texts = (wf.render_spec?.texts ?? []).map((t) => ({ key: t.role ?? "", label: t.role ?? "", text: t.text }));
        const rebaked: RenderSpec = applyCopyToSpec(base, texts);
        warnings = validateRenderSpec(rebaked);
        patch.render_spec = rebaked;
      } else {
        warnings = ["could not rebuild the render spec from the copy structure"];
      }
    }

    if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from("workflows").update(patch).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const fresh = await loadWorkflow(params.id);
    return NextResponse.json({
      ok: true,
      warnings,
      detail_mermaid: fresh ? buildWorkflowDetailMermaid(fresh) : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
