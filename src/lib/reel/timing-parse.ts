// Timing paste grammar (Workflow Builder v2) — parse Matthew's handwritten phone-edit
// timestamps into a RenderSpec. Pure logic, no I/O, unit-testable.
//
// One SCENE per line, optional inline TEXT cues after `|` (repeatable), plus standalone
// text lines. Forgiving: `scene N` prefixes optional, `0:02.1` and comma decimals accepted,
// blank lines and `#` comments ignored.
//
//   0-2.1 spraying baseboards | "they hide HERE" 0.4-2.0 top
//   2.1-4.3 pulling the fridge back | "look what was living here" 2.3-4.0 center
//   4.3-6.5 the reveal
//   text "call before it spreads" 4.5-6.0 bottom pink

import type { RenderShot, RenderSpec, RenderTextEvent } from "@/config/workflows";

export interface ParsedTiming {
  shots: Array<RenderShot & { action: string }>;
  texts: RenderTextEvent[];
  duration: number;
  errors: string[];
  warnings: string[];
}

const POSITION_SYNONYMS: Record<string, string> = {
  top: "top",
  upper: "upper_middle",
  upper_middle: "upper_middle",
  middle: "center",
  side: "upper_side",
  upper_side: "upper_side",
  center: "center",
  centre: "center",
  low: "lower",
  lower: "lower",
  bottom: "bottom",
};

const COLORS = new Set(["white", "pink", "purple", "orange", "green", "blue", "red"]);
const SIZES = new Set(["small", "medium", "large"]);

/** Parse one time token: `2.1`, `2`, `2,1`, `0:02.1` -> seconds (or null). */
function parseTime(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  const clock = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (clock) {
    const mins = parseInt(clock[1], 10);
    const secs = parseFloat(clock[2]);
    return Number.isFinite(secs) ? mins * 60 + secs : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// A time range like `0-2.1`, `0:02.1 - 0:04`, `2.1-` (open end), or a single `2.1`.
const RANGE_RE = /^(\d+(?::\d{1,2})?(?:[.,]\d+)?)\s*(?:-\s*(\d+(?::\d{1,2})?(?:[.,]\d+)?)?)?/;

function parseRange(raw: string): { start: number | null; end: number | null; rest: string } {
  const m = raw.trim().match(RANGE_RE);
  if (!m || m[0].trim() === "") return { start: null, end: null, rest: raw.trim() };
  const start = parseTime(m[1]);
  const end = m[2] !== undefined && m[2] !== "" ? parseTime(m[2]) : null;
  return { start, end, rest: raw.trim().slice(m[0].length).trim() };
}

interface ParsedText {
  text: string;
  at: number | null;
  out: number | null;
  position?: string;
  color?: string;
  size?: string;
  error?: string;
}

/** Parse one text cue: `"they hide HERE" 0.4-2.0 top pink` (quotes optional when timed). */
function parseTextCue(raw: string): ParsedText | null {
  let body = raw.trim().replace(/^text\s+/i, "");
  if (!body) return null;

  let text = "";
  const quoted = body.match(/^["'“‘]([\s\S]+?)["'”’]\s*([\s\S]*)$/);
  if (quoted) {
    text = quoted[1].trim();
    body = quoted[2].trim();
  } else {
    // Unquoted: the trailing range + modifiers are peeled off the end.
    const tail = body.match(
      /(\d+(?::\d{1,2})?(?:[.,]\d+)?\s*(?:-\s*(?:\d+(?::\d{1,2})?(?:[.,]\d+)?)?)?(?:\s+[a-z_]+)*)$/i
    );
    if (tail && tail.index !== undefined && tail.index > 0) {
      text = body.slice(0, tail.index).trim();
      body = tail[1].trim();
    } else {
      text = body;
      body = "";
    }
  }
  if (!text) return { text: "", at: null, out: null, error: "empty text" };

  const { start, end, rest } = parseRange(body);
  const out: ParsedText = { text, at: start, out: end };
  for (const word of rest.split(/\s+/).filter(Boolean)) {
    const w = word.toLowerCase();
    if (POSITION_SYNONYMS[w]) out.position = POSITION_SYNONYMS[w];
    else if (COLORS.has(w)) out.color = w;
    else if (SIZES.has(w)) out.size = w;
    else out.error = `unknown word "${word}" (expected a position, color, or size)`;
  }
  return out;
}

/**
 * Parse a full timing paste into shots + texts. Scenes sort by start; sub-0.3s gaps close
 * (each shot's start pulls to the previous end); duration = the last shot's end. Text cues
 * with no out time default to their scene's end (standalone: +2s).
 */
export function parseTimingPaste(input: string): ParsedTiming {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shots: Array<RenderShot & { action: string }> = [];
  const rawTexts: Array<ParsedText & { sceneIdx: number | null; line: number }> = [];

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const parts = line.split("|").map((p) => p.trim());
    const head = parts[0];

    // Standalone text line: `text "..."` or a quoted line.
    if (/^text\s/i.test(head) || /^["'“‘]/.test(head)) {
      for (const part of parts) {
        const t = parseTextCue(part);
        if (!t) continue;
        if (t.error) errors.push(`line ${li + 1}: ${t.error}`);
        else rawTexts.push({ ...t, sceneIdx: null, line: li + 1 });
      }
      continue;
    }

    // Scene line: optional `scene N` prefix, then `start-end action`.
    const noPrefix = head.replace(/^scene\s+\d+\s*[:.]?\s*/i, "");
    const { start, end, rest } = parseRange(noPrefix);
    if (start === null || end === null) {
      errors.push(
        `line ${li + 1}: could not read a start-end range from "${head}" (expected like "0-2.1 spraying baseboards")`
      );
      continue;
    }
    if (end <= start) {
      errors.push(`line ${li + 1}: end (${end}s) must be after start (${start}s)`);
      continue;
    }
    const action = rest.replace(/^[:.]\s*/, "").trim();
    if (!action) warnings.push(`line ${li + 1}: scene ${shots.length + 1} has no action description yet`);
    shots.push({ i: shots.length + 1, start, end, action });
    const sceneIdx = shots.length - 1;

    for (const part of parts.slice(1)) {
      const t = parseTextCue(part);
      if (!t) continue;
      if (t.error) errors.push(`line ${li + 1}: ${t.error}`);
      else rawTexts.push({ ...t, sceneIdx, line: li + 1 });
    }
  }

  if (shots.length === 0) {
    errors.push('no scene lines found (each scene needs a "start-end action" line)');
    return { shots: [], texts: [], duration: 0, errors, warnings };
  }

  // Sort by start, renumber, close small gaps (< 0.3s) by pulling starts to the previous end.
  shots.sort((a, b) => a.start - b.start);
  for (let i = 0; i < shots.length; i++) {
    shots[i].i = i + 1;
    if (i > 0) {
      const gap = shots[i].start - shots[i - 1].end;
      if (gap > 0 && gap < 0.3) shots[i].start = shots[i - 1].end;
      else if (Math.abs(gap) > 0.3) {
        warnings.push(
          `shot ${i} ends at ${shots[i - 1].end}s but shot ${i + 1} starts at ${shots[i].start}s (${gap.toFixed(1)}s ${gap > 0 ? "gap" : "overlap"})`
        );
      }
    }
  }
  const duration = shots[shots.length - 1].end;

  const texts: RenderTextEvent[] = [];
  for (const t of rawTexts) {
    if (t.at === null) {
      errors.push(`line ${t.line}: text "${t.text}" has no start time`);
      continue;
    }
    let out = t.out;
    if (out === null) {
      // Default the out time: the owning scene's end, or +2s for standalone cues.
      const scene =
        t.sceneIdx !== null
          ? shots[t.sceneIdx]
          : shots.find((s) => t.at! >= s.start && t.at! < s.end) ?? null;
      out = scene ? scene.end : Math.min(t.at + 2, duration);
    }
    out = Math.min(out, duration);
    if (out <= t.at) {
      errors.push(`line ${t.line}: text "${t.text}" ends (${out}s) before it starts (${t.at}s)`);
      continue;
    }
    texts.push({
      n: texts.length + 1,
      text: t.text,
      at_second: t.at,
      out_second: out,
      position: t.position ?? "center",
      ...(t.color ? { color: t.color } : {}),
      ...(t.size ? { size: t.size } : {}),
    });
  }
  texts.sort((a, b) => a.at_second - b.at_second);
  texts.forEach((t, i) => (t.n = i + 1));

  return { shots, texts, duration, errors, warnings };
}

/** Build the RenderSpec a parsed timing bakes into (static images; song set by the session). */
export function timingToSpec(parsed: ParsedTiming, songRef?: string | null): RenderSpec {
  return {
    mode: "static_images",
    song_ref: songRef ?? null,
    duration_seconds: parsed.duration,
    shots: parsed.shots.map((s) => ({ i: s.i, start: s.start, end: s.end })),
    texts: parsed.texts,
  };
}

/** The confirmation timeline posted to Slack after every paste/edit. */
export function renderTimelineEcho(parsed: ParsedTiming): string {
  const lines: string[] = [`*Timeline* (${parsed.duration.toFixed(1)}s total):`];
  for (const s of parsed.shots) {
    lines.push(`Shot ${s.i}  ${s.start}s to ${s.end}s  ${s.action || "(no action yet)"}`);
    for (const t of parsed.texts) {
      if (t.at_second >= s.start - 0.05 && t.at_second < s.end) {
        const mods = [t.position, t.color, t.size].filter(Boolean).join(" ");
        lines.push(`    ${t.at_second}s to ${t.out_second}s  "${t.text}"${mods ? `  (${mods})` : ""}`);
      }
    }
  }
  if (parsed.warnings.length) lines.push("", ...parsed.warnings.map((w) => `warning: ${w}`));
  if (parsed.errors.length) lines.push("", ...parsed.errors.map((e) => `error: ${e}`));
  return lines.join("\n");
}

/** The paste cheat sheet the bot posts at the timings step. */
export const TIMING_CHEAT_SHEET = [
  "Paste your timings, one scene per line. Example:",
  "```",
  '0-2.1 spraying baseboards | "they hide HERE" 0.4-2.0 top',
  '2.1-4.3 pulling the fridge back | "look what was living here" 2.3-4.0 center',
  "4.3-6.5 the reveal",
  'text "call before it spreads" 4.5-6.0 bottom',
  "```",
  'Format: start-end action | "on-screen text" in-out position',
  "Positions: top, upper, side, center, lower, bottom. Colors (optional): pink purple orange green blue red. Sizes (optional): small medium large.",
  "After pasting: `sync auto` snaps everything to the song's beats, `sync manual` keeps your numbers exactly. React with a checkmark when the timeline looks right.",
].join("\n");
