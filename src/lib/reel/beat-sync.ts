// Beat-sync foundation — analyze an uploaded song's beat grid (render-service sibling endpoint)
// and snap a workflow's render spec to it, so shot transitions and text drops land on the beat.
//
// `sync manual` keeps the operator's typed timings (today's behavior). `sync auto` calls
// /api/analyze-song (ffmpeg decode + energy-envelope onset detection), snaps every shot boundary
// and text in/out to the nearest beat within a small tolerance, and re-validates. The fixed
// song_master bed keeps its measured beat grid inside the render engine; auto-sync is for songs
// Matthew attaches in Slack (public URLs).

import type { RenderSpec } from "@/config/workflows";

export interface BeatGrid {
  bpm: number | null;
  beats: number[]; // beat times in seconds, ascending
  duration: number | null;
}

/** Ask the render service for a song's beat grid. Returns null when the endpoint/env is missing
 *  or the analysis fails (caller falls back to manual timings). */
export async function analyzeSong(audioUrl: string): Promise<BeatGrid | null> {
  const base = process.env.REEL_RENDER_URL || "";
  const secret = process.env.REEL_RENDER_SECRET || "";
  if (!base || !secret) return null;
  const endpoint = base.replace(/render-reel\/?$/, "analyze-song");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-reel-secret": secret },
      body: JSON.stringify({ audio_url: audioUrl }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      console.error("[beat-sync] analyze-song failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as Partial<BeatGrid>;
    if (!Array.isArray(data.beats) || data.beats.length < 4) return null;
    return {
      bpm: typeof data.bpm === "number" ? data.bpm : null,
      beats: data.beats.filter((b) => typeof b === "number" && b >= 0).sort((a, b) => a - b),
      duration: typeof data.duration === "number" ? data.duration : null,
    };
  } catch (e) {
    console.error("[beat-sync] analyze-song threw:", (e as Error).message);
    return null;
  }
}

function nearestBeat(t: number, beats: number[], tolerance: number): number {
  let best = t;
  let bestDist = tolerance + 1e-9;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
    if (b > t + tolerance) break;
  }
  return Math.round(best * 100) / 100;
}

export interface SnapResult {
  spec: RenderSpec;
  moved: number; // how many timings actually changed
}

/**
 * Snap a spec's shot boundaries and text in/out seconds to the nearest beats (within tolerance).
 * Second 0 stays fixed; shots stay contiguous (each shot's start is the previous shot's snapped
 * end); the total duration follows the last shot. Pure — returns a new spec.
 */
export function snapSpecToBeats(spec: RenderSpec, beats: number[], tolerance = 0.45): SnapResult {
  let moved = 0;
  const snap = (t: number): number => {
    const s = nearestBeat(t, beats, tolerance);
    if (Math.abs(s - t) > 0.01) moved++;
    return s;
  };

  const shots = [...spec.shots].sort((a, b) => a.i - b.i);
  const snapped: typeof shots = [];
  let cursor = shots[0]?.start ?? 0; // keep the opening second (usually 0) fixed
  for (const s of shots) {
    const end = Math.max(snap(s.end), cursor + 0.5); // never collapse a shot below 0.5s
    snapped.push({ i: s.i, start: cursor, end });
    cursor = end;
  }
  const duration = snapped.length ? snapped[snapped.length - 1].end : spec.duration_seconds;

  const texts = (spec.texts ?? []).map((t) => {
    const at = t.at_second <= 0.05 ? t.at_second : Math.min(snap(t.at_second), duration - 0.2);
    let out = t.out_second == null ? undefined : Math.min(snap(t.out_second), duration);
    if (out != null && out <= at) out = Math.min(at + 1, duration);
    return { ...t, at_second: Math.max(0, at), out_second: out };
  });

  return { spec: { ...spec, shots: snapped, duration_seconds: duration, texts }, moved };
}
