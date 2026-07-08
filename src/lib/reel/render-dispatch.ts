// Render dispatch — ONE render build per workflow.
//
// Every flow that renders a workflow (drop-and-render, prompt drops, gov2, the
// dashboard test-render) calls renderWorkflow() here; `render_options.build`
// decides HOW it renders:
//   "render_reel"  — the legacy Vargas 6s single-image build (studio.ts renderReel:
//                    label + hook + payoff + cta chips over one still, house song bed).
//   "render_spec"  — the generic spec engine (render-service api/render-spec.py):
//                    N stills on the timeline, text chips at arbitrary timestamps,
//                    the workflow's OWN song. The default.
//   anything else  — a CUSTOM render-service endpoint slug (api/<build>.py) that
//                    accepts the SAME render-spec JSON payload. These are authored
//                    via the agent channel's Claude Code prompts, which mandate
//                    this exact contract.
//
// Never mutates the shared workflow row: copy and images are overlaid on clones.

import type { StructuredCopyLine } from "@/lib/reel/creative-director";
import type { RenderSpec, Workflow, WorkflowScene } from "@/config/workflows";
import { resolveSong } from "@/config/workflows";
import { renderReel } from "@/lib/reel/studio";
import type { ReelScript } from "@/lib/reel/studio-variations";
import {
  buildRenderPayload,
  renderSpecVideo,
  type SpecRenderPayload,
  type SpecRenderResult,
} from "@/lib/reel/render-client";

export type RenderBuild = string; // "render_reel" | "render_spec" | custom endpoint slug

export function workflowRenderBuild(w: Workflow): RenderBuild {
  return w.render_options?.build || "render_spec";
}

export interface RenderWorkflowInput {
  /** Public image URLs (reels bucket), scene/shot order. render_reel uses images[0]. */
  images: string[];
  /** One line per copy_structure role, role order. */
  copy: StructuredCopyLine[];
}

export interface RenderWorkflowResult {
  url: string | null; // public MP4 URL when the service stored one
  mp4?: Buffer; // raw bytes (render_reel path) for direct Slack upload
  duration: number;
}

/** The copy mapped into the legacy 4-box ReelScript (parseBoxes key parity). */
export function copyToReelScript(copy: StructuredCopyLine[]): ReelScript {
  const byKey = new Map(copy.map((c) => [c.key.toLowerCase(), c.text]));
  const plain = copy.map((c) => c.text).filter(Boolean);
  return {
    label: byKey.get("label") ?? plain[0] ?? "",
    line1: byKey.get("hook") ?? byKey.get("line1") ?? plain[1] ?? "",
    line2: byKey.get("payoff") ?? byKey.get("line2") ?? plain[2] ?? "",
    cta: byKey.get("cta") ?? plain[3] ?? "",
  };
}

async function fetchAsImageInput(url: string): Promise<{ media_type: string; data: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download the image (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const media_type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return { media_type, data: buf.toString("base64") };
}

/** Overlay copy text onto a spec's text events by role key; unmatched events keep
 *  their baked text. Pure. */
function overlayCopyOnSpec(spec: RenderSpec, copy: StructuredCopyLine[]): RenderSpec {
  const byKey = new Map(copy.map((c) => [c.key, c.text]));
  let cursor = 0;
  const inOrder = copy.map((c) => c.text).filter(Boolean);
  return {
    ...spec,
    texts: (spec.texts ?? []).map((t) => {
      if (t.role && byKey.has(t.role)) return { ...t, text: byKey.get(t.role)! };
      // No role match: fill in order so pasted plain lines still land somewhere sane.
      if (!t.text && cursor < inOrder.length) return { ...t, text: inOrder[cursor++] };
      return t;
    }),
  };
}

/** A workflow clone whose scenes carry the input images (placeholders created when
 *  the workflow has no baked scenes, e.g. b-roll templates). */
function cloneWithImages(w: Workflow, spec: RenderSpec, images: string[]): Workflow {
  const shotCount = spec.shots.length;
  const scenes: WorkflowScene[] = [];
  for (let i = 0; i < shotCount; i++) {
    const base = w.scenes[i] ?? { role: `shot ${i + 1}`, image_prompt: "", animation_prompt: "" };
    scenes.push({ ...base, image_url: images[i] ?? base.image_url ?? null });
  }
  return { ...w, scenes };
}

async function renderViaCustomEndpoint(
  build: string,
  payload: SpecRenderPayload
): Promise<SpecRenderResult> {
  const base = process.env.REEL_RENDER_URL || "";
  const secret = process.env.REEL_RENDER_SECRET || "";
  if (!base || !secret) throw new Error("REEL_RENDER_URL / REEL_RENDER_SECRET are not configured.");
  const slug = build.replace(/[^a-z0-9_-]/gi, "");
  const endpoint = base.replace(/render-reel\/?$/, slug);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-reel-secret": secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let body: { url?: string; duration?: number; error?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !body.url) {
    throw new Error(
      `custom build "${slug}" failed: ${body.error || text.slice(0, 200) || `HTTP ${res.status}`}` +
        (res.status === 404 ? " (has the endpoint been built and deployed in srt-reel-render yet?)" : "")
    );
  }
  return { url: body.url, duration: body.duration ?? payload.duration };
}

/**
 * Render a workflow with the given images + copy through ITS one render build.
 * Throws human-readable errors ("Scene 2 has no image yet") for Slack cards.
 */
export async function renderWorkflow(
  w: Workflow,
  input: RenderWorkflowInput
): Promise<RenderWorkflowResult> {
  const build = workflowRenderBuild(w);

  if (build === "render_reel") {
    if (!input.images[0]) throw new Error("This workflow needs one image and none was provided.");
    const script = copyToReelScript(input.copy);
    if (!script.line1 && !script.line2) throw new Error("The copy needs at least a hook line.");
    const img = await fetchAsImageInput(input.images[0]);
    const { mp4, url } = await renderReel(script, img);
    return { url, mp4, duration: 6 };
  }

  const baseSpec = w.render_spec;
  if (!baseSpec || !baseSpec.shots?.length) {
    throw new Error(`Workflow "${w.name}" has no render spec yet, so it cannot render.`);
  }
  const spec = overlayCopyOnSpec(structuredClone(baseSpec), input.copy);
  const clone = cloneWithImages(w, spec, input.images);
  const payload = buildRenderPayload(clone, spec);
  // Respect the workflow's own song even when the spec carries none.
  if (!payload.song_url) payload.song_url = resolveSong(w.song_ref).url ?? null;

  if (build === "render_spec") {
    const result = await renderSpecVideo(payload);
    return { url: result.url, duration: result.duration };
  }
  const result = await renderViaCustomEndpoint(build, payload);
  return { url: result.url, duration: result.duration };
}
