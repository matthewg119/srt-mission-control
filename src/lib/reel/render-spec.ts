// Render-spec helpers (Content Engine v3) — pure logic around a workflow's RenderSpec.
//
// A RenderSpec is the baked timeline (shots + timed on-screen texts + mode) a workflow renders
// from. These helpers derive a spec from a workflow, validate it (shot lengths, contiguity,
// text-in-slot), render the human/AI-readable "video description" block, and assemble the
// ready-to-paste Claude Code prompt that builds the render in srt-reel-render. No Claude calls
// here (the fuzzy NL parse of a pasted storyboard lives in creative-director.ts).

import { resolveSong, type RenderSpec, type RenderMode, type Workflow } from "@/config/workflows";

/** Derive a RenderSpec for a workflow: its baked render_spec if present, else build one from the
 *  copy_structure (roles grouped into shots by their `shot` index + in/out seconds). */
export function specFromWorkflow(workflow: Workflow, mode?: RenderMode): RenderSpec | null {
  if (workflow.render_spec) {
    return mode ? { ...workflow.render_spec, mode } : workflow.render_spec;
  }
  const roles = workflow.copy_structure ?? [];
  if (!roles.length) return null;

  // Group roles by shot; a shot slot spans the min in / max out of its texts.
  const byShot = new Map<number, { start: number; end: number }>();
  for (const r of roles) {
    const shot = r.shot ?? 1;
    const start = r.at_second ?? 0;
    const end = r.out_second ?? start + 3;
    const cur = byShot.get(shot);
    byShot.set(shot, {
      start: cur ? Math.min(cur.start, start) : start,
      end: cur ? Math.max(cur.end, end) : end,
    });
  }
  const shots = Array.from(byShot.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([i, slot]) => ({ i, start: slot.start, end: slot.end }));
  const duration = shots.reduce((max, s) => Math.max(max, s.end), 0);
  const texts = roles.map((r, idx) => ({
    n: idx + 1,
    text: "",
    at_second: r.at_second ?? 0,
    out_second: r.out_second,
    role: r.key,
    position: r.position,
  }));
  return {
    mode: mode ?? "static_images",
    song_ref: workflow.song_ref ?? null,
    duration_seconds: duration,
    shots,
    texts,
  };
}

/** Overlay the actual copy (per role) onto a spec's text events. Falls back to the spec's own
 *  default text when a role has no override. */
export function applyCopyToSpec(
  spec: RenderSpec,
  structuredCopy?: Array<{ key: string; text: string }>
): RenderSpec {
  if (!structuredCopy?.length) return spec;
  const byRole = new Map(structuredCopy.map((c) => [c.key, c.text]));
  return {
    ...spec,
    texts: spec.texts.map((t) => (t.role && byRole.has(t.role) ? { ...t, text: byRole.get(t.role)! } : t)),
  };
}

/**
 * Validate a render spec and return a list of concrete errors (empty = ok). Never renders on a
 * problem; the caller shows these so they can be fixed.
 *   - each shot has a positive length; shots are contiguous (small 0.2s overlaps/gaps allowed);
 *   - every text sits inside the overall timeline;
 *   - animated mode only: a posted clip must be at least as long as its slot (clipLengths[i]).
 */
export function validateRenderSpec(
  spec: RenderSpec | null,
  opts: { clipLengths?: Record<number, number> } = {}
): string[] {
  const errors: string[] = [];
  if (!spec || !Array.isArray(spec.shots) || spec.shots.length === 0) {
    return ["No shots are defined for this workflow yet."];
  }
  const shots = [...spec.shots].sort((a, b) => a.i - b.i);
  for (const s of shots) {
    if (!(s.end > s.start)) errors.push(`Shot ${s.i} has a non-positive length (${s.start}s to ${s.end}s).`);
  }
  for (let i = 1; i < shots.length; i++) {
    const gap = shots[i].start - shots[i - 1].end;
    if (Math.abs(gap) > 0.2) {
      errors.push(
        `Timeline gap: shot ${shots[i - 1].i} ends at ${shots[i - 1].end}s but shot ${shots[i].i} starts at ${shots[i].start}s (${gap.toFixed(1)}s off).`
      );
    }
  }
  const duration = spec.duration_seconds || Math.max(...shots.map((s) => s.end));
  for (const t of spec.texts ?? []) {
    const out = t.out_second ?? duration;
    if (t.at_second < 0 || out > duration + 0.05 || out <= t.at_second) {
      errors.push(`Text "${t.text || t.role || "?"}" has bad timing (${t.at_second}s to ${out}s in an ${duration}s video).`);
    }
  }
  // Animated mode: a posted clip must cover its whole slot, or the cut looks wrong (the "video 2
  // was too short" failure). Static images always fill the slot so they never fail on length.
  if (spec.mode === "animated" && opts.clipLengths) {
    for (const s of shots) {
      const slot = s.end - s.start;
      const clip = opts.clipLengths[s.i];
      if (typeof clip === "number" && clip + 0.05 < slot) {
        errors.push(
          `Shot ${s.i} slot is ${slot.toFixed(1)}s (${s.start}s to ${s.end}s) but the clip you posted is ${clip.toFixed(1)}s. Post a clip at least ${slot.toFixed(1)}s or trim the timeline.`
        );
      }
    }
  }
  return errors;
}

/** Which texts land on a given shot (fully or mostly inside its slot). */
export function textsForShot(spec: RenderSpec, shotIndex: number): RenderSpec["texts"] {
  const shot = spec.shots.find((s) => s.i === shotIndex);
  if (!shot) return [];
  return (spec.texts ?? []).filter((t) => t.at_second >= shot.start - 0.05 && t.at_second < shot.end);
}

/** The human/AI-readable "video description" block: mode, duration, song, and per-shot the slot
 *  + its timed texts (with in/out + position). Content-analyzer + the creative director read this
 *  to make adjustments. */
/** A workflow's render aspect. 3:4 is the house standard (the Ray-Ban Meta native ratio) —
 *  rows without an explicit render_options.aspect must never regress to 9:16. */
export function workflowAspect(workflow: Workflow): string {
  return workflow.render_options?.aspect ?? "3:4";
}

export function buildVideoDescription(workflow: Workflow, spec: RenderSpec): string {
  const song = resolveSong(spec.song_ref ?? workflow.song_ref).label;
  const lines: string[] = [
    `*${workflow.name}* — ${spec.mode === "animated" ? "video (animated clips)" : "static images"}, ${spec.duration_seconds}s, ${workflowAspect(workflow)}, song: ${song}.`,
  ];
  for (const shot of [...spec.shots].sort((a, b) => a.i - b.i)) {
    lines.push(`Shot ${shot.i} (${shot.start}s to ${shot.end}s):`);
    for (const t of textsForShot(spec, shot.i)) {
      const out = t.out_second ?? shot.end;
      const pos = t.position ? ` (${t.position})` : "";
      const size = t.size ? ` [${t.size}]` : "";
      lines.push(`  ${t.at_second}s to ${out}s  "${t.text || t.role || ""}"${pos}${size}`);
    }
  }
  return lines.join("\n");
}

/** Assemble the ready-to-paste Claude Code prompt that builds this workflow's render in the
 *  srt-reel-render service. This is the escape hatch (author render code from a spec). */
export function buildRenderClaudePrompt(workflow: Workflow, spec: RenderSpec): string {
  const song = resolveSong(spec.song_ref ?? workflow.song_ref);
  return [
    "```",
    `Build a new render workflow in the srt-reel-render Vercel project for "${workflow.name}"`,
    `(workflow id: ${workflow.id}, avatar: ${workflow.vertical_id}).`,
    "",
    `Format: ${spec.mode === "animated" ? "animated video clips" : "static images held for each shot's slot"}, ` +
      `${spec.shots.length} shots, ${spec.duration_seconds}s total, ${workflowAspect(workflow)}.`,
    `Song: ${song.label}${song.url ? ` (${song.url})` : " (render-service default bed)"}.`,
    "",
    "Shots (slot seconds):",
    ...[...spec.shots].sort((a, b) => a.i - b.i).map((s) => `  Shot ${s.i}: ${s.start}s to ${s.end}s`),
    "",
    "On-screen text (timed, with position):",
    ...(spec.texts ?? []).map(
      (t) =>
        `  ${t.at_second}s to ${t.out_second ?? spec.duration_seconds}s  "${t.text}"` +
        `${t.position ? ` @ ${t.position}` : ""}${t.role ? `  [${t.role}]` : ""}`
    ),
    "",
    "Requirements: burn the on-screen text in at the exact in/out seconds and positions above; " +
      (spec.mode === "animated"
        ? "sequence the shot clips on their slots; if a clip is shorter than its slot, fail with a clear error (do not stretch or loop)."
        : "hold each shot's still for its full slot."),
    "Expose it callable the same way as the existing render endpoints (x-reel-secret).",
    "```",
  ].join("\n");
}
