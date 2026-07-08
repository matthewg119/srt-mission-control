// Render client (Workflow Builder v2) — call the render-service `render-spec` endpoint:
// custom song, N still-image shots with start/end times, text chips at arbitrary timestamps.
// Endpoint derives from REEL_RENDER_URL the same way analyzeSong does (beat-sync.ts).

import { resolveSong, type RenderSpec, type Workflow } from "@/config/workflows";

export interface SpecRenderShot {
  image_url: string;
  start: number;
  end: number;
  zoom?: number;
}

export interface SpecRenderText {
  text: string;
  at_second: number;
  out_second: number;
  position?: string;
  color?: string;
  size?: string;
}

export interface SpecRenderPayload {
  song_url: string | null; // null = the render-service default bed
  duration: number;
  shots: SpecRenderShot[];
  texts: SpecRenderText[];
}

/**
 * Zip a workflow's baked spec with its scene images into the render payload.
 * Throws with a clear message when scenes are missing images (named by shot).
 */
export function buildRenderPayload(workflow: Workflow, spec: RenderSpec): SpecRenderPayload {
  const shots = [...spec.shots].sort((a, b) => a.i - b.i);
  const missing: number[] = [];
  const payloadShots: SpecRenderShot[] = shots.map((s) => {
    const scene = workflow.scenes[s.i - 1];
    const url = scene?.image_url;
    if (!url) missing.push(s.i);
    return { image_url: url ?? "", start: s.start, end: s.end };
  });
  if (missing.length) {
    throw new Error(
      `Scenes ${missing.join(", ")} have no image yet. Paste the scene image(s) first, then render.`
    );
  }
  const duration =
    spec.duration_seconds || Math.max(...shots.map((s) => s.end));
  const song = resolveSong(spec.song_ref ?? workflow.song_ref);
  return {
    song_url: song.url ?? null,
    duration,
    shots: payloadShots,
    texts: (spec.texts ?? []).map((t) => ({
      text: t.text,
      at_second: t.at_second,
      out_second: t.out_second ?? duration,
      ...(t.position ? { position: t.position } : {}),
      ...(t.color ? { color: t.color } : {}),
      ...(t.size ? { size: t.size } : {}),
    })),
  };
}

export interface SpecRenderResult {
  url: string;
  duration: number;
}

/**
 * POST the payload to render-spec and return the MP4 URL. Throws with the service's
 * error (including per-field validation problems) so the Slack card can show it.
 */
export async function renderSpecVideo(payload: SpecRenderPayload): Promise<SpecRenderResult> {
  const base = process.env.REEL_RENDER_URL || "";
  const secret = process.env.REEL_RENDER_SECRET || "";
  if (!base || !secret) throw new Error("REEL_RENDER_URL / REEL_RENDER_SECRET are not configured.");
  const endpoint = base.replace(/render-reel\/?$/, "render-spec");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-reel-secret": secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const bodyText = await res.text();
  let body: { url?: string; duration?: number; error?: string; problems?: string[] } = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || !body.url) {
    const detail = body.problems?.length
      ? `${body.error}: ${body.problems.join("; ")}`
      : body.error || bodyText.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`render-spec failed: ${detail}`);
  }
  return { url: body.url, duration: body.duration ?? payload.duration };
}
