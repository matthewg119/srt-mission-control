// Render client (Workflow Builder v2) — call the render-service `render-spec` endpoint:
// custom song, N still-image shots with start/end times, text chips at arbitrary timestamps.
// Endpoint derives from REEL_RENDER_URL the same way analyzeSong does (beat-sync.ts).

import { resolveSong, type RenderSpec, type Workflow } from "@/config/workflows";

export interface SpecRenderShot {
  image_url: string; // still background (used when video_url is absent)
  video_url?: string; // animated clip background; rendered in place of the still, trimmed to the shot
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
  pop?: boolean; // false = first line of its shot: appears with the cut, no pop-in
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
    const image = scene?.image_url ?? "";
    const video = scene?.video_url ?? "";
    // A shot is renderable with a still OR a video background.
    if (!image && !video) missing.push(s.i);
    return {
      image_url: image,
      start: s.start,
      end: s.end,
      ...(video ? { video_url: video } : {}),
    };
  });
  if (missing.length) {
    throw new Error(
      `Scenes ${missing.join(", ")} have no image or video yet. Paste the scene media first, then render.`
    );
  }
  const duration =
    spec.duration_seconds || Math.max(...shots.map((s) => s.end));
  const song = resolveSong(spec.song_ref ?? workflow.song_ref);

  // The first line of each shot appears with the cut (no pop); later lines in the
  // same shot animate in. Map each text to the shot whose slot contains its
  // at_second (fall back to the last shot that started before it), then the
  // earliest text in each shot is static. An explicit `pop` on the spec wins.
  const shotsByStart = [...shots].sort((a, b) => a.start - b.start);
  const shotIndexFor = (at: number): number => {
    let idx = 0;
    for (let k = 0; k < shotsByStart.length; k++) {
      const s = shotsByStart[k];
      if (at >= s.start && at < s.end) return k;
      if (at >= s.start) idx = k;
    }
    return idx;
  };
  const specTexts = spec.texts ?? [];
  const minAtByShot = new Map<number, number>();
  for (const t of specTexts) {
    const si = shotIndexFor(t.at_second);
    const cur = minAtByShot.get(si);
    if (cur === undefined || t.at_second < cur) minAtByShot.set(si, t.at_second);
  }

  return {
    song_url: song.url ?? null,
    duration,
    shots: payloadShots,
    texts: specTexts.map((t) => {
      const isFirstInShot = minAtByShot.get(shotIndexFor(t.at_second)) === t.at_second;
      const pop = typeof t.pop === "boolean" ? t.pop : !isFirstInShot;
      return {
        text: t.text,
        at_second: t.at_second,
        out_second: t.out_second ?? duration,
        pop,
        ...(t.position ? { position: t.position } : {}),
        ...(t.color ? { color: t.color } : {}),
        ...(t.size ? { size: t.size } : {}),
      };
    }),
  };
}

export interface SpecRenderResult {
  url: string;
  duration: number;
  engineVersion?: string;
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
  let body: {
    url?: string;
    duration?: number;
    engine_version?: string;
    error?: string;
    problems?: string[];
  } = {};
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
  // Proves which renderer build actually ran (guards against a stale srt-reel-render deploy).
  console.log(`[render-spec] rendered by engine=${body.engine_version ?? "unknown"}`);
  return {
    url: body.url,
    duration: body.duration ?? payload.duration,
    engineVersion: body.engine_version,
  };
}
