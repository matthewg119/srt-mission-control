// Proactive format suggestion for a bare media drop.
//
// When the operator drops a bare image/video in #content-full, the workflow picker still
// posts; on top of that, this reads the frame with Claude vision and suggests 2-3 matching
// `vertical_formats` from the active vertical's calendar, so the bot proposes ideas instead
// of asking for a brief. It DEGRADES GRACEFULLY: if no formats are seeded yet (the calendar
// is built in the format-generator chat), it returns silently and only the picker stands.
// Best-effort throughout — never throws into the caller.

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { getActiveVertical } from "@/config/verticals";

interface VerticalFormatRow {
  id: string;
  format_group: string | null;
  scene: string;
  hook: string | null;
  difficulty: string | null;
}

interface FormatPicks {
  picks: Array<{ id: string; why: string }>;
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

async function downloadImage(url: string, mimetypeHint?: string): Promise<ClaudeImageInput | null> {
  try {
    const botToken = process.env.SLACK_BOT_TOKEN || "";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const media_type = (mimetypeHint || res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { media_type, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

function isFormatPicks(v: unknown): v is FormatPicks {
  if (typeof v !== "object" || v === null) return false;
  const p = v as FormatPicks;
  return (
    Array.isArray(p.picks) &&
    p.picks.every((x) => x && typeof x.id === "string" && typeof x.why === "string")
  );
}

/**
 * Look at a dropped frame and suggest 2-3 matching formats from the active vertical's
 * calendar. Posts a Slack message in-thread when there are matches; silent no-op when the
 * `vertical_formats` calendar is empty/absent or the frame can't be read.
 */
export async function suggestFormatsForFrame(args: {
  channel: string;
  threadTs: string;
  frameUrl: string;
  mimetype?: string;
}): Promise<void> {
  try {
    const vertical = await getActiveVertical();

    // Candidate formats: unused first (rotation), capped so the prompt stays small.
    const { data, error } = await supabaseAdmin
      .from("vertical_formats")
      .select("id,format_group,scene,hook,difficulty")
      .eq("vertical_id", vertical.id)
      .is("used_at", null)
      .limit(40);
    const candidates = (!error && Array.isArray(data) ? (data as VerticalFormatRow[]) : []).filter(
      (c) => c && typeof c.id === "string" && typeof c.scene === "string"
    );
    if (candidates.length === 0) return; // graceful degrade — picker already posted

    const img = await downloadImage(args.frameUrl, args.mimetype);
    if (!img) return;

    const list = candidates
      .map((c) => `${c.id} | ${c.format_group ?? "format"} | [${c.difficulty ?? "medium"}] ${c.scene}${c.hook ? ` (hook: ${c.hook})` : ""}`)
      .join("\n");

    const { data: picksData } = await callClaudeJSON<FormatPicks>({
      model: model(),
      system: [
        `You are the content engine for a ${vertical.business_descriptor}. You are shown ONE frame the`,
        "operator just dropped. Below is a list of our available content FORMATS (id | group | [difficulty] scene).",
        "Pick the 2-3 formats that best fit what is actually visible in this frame (subject, action, setting).",
        "Return JSON { picks: [{ id, why }] } using ONLY ids from the list, 2-3 entries, ordered best first;",
        "each `why` is one short clause tying the frame to that format. If nothing fits, return an empty picks array.",
        "Never use em dashes or en dashes.",
        "",
        "AVAILABLE FORMATS:",
        list,
      ].join("\n"),
      user: "Look at the attached frame and return the best-matching formats as JSON.",
      images: [img],
      maxTokens: 600,
      temperature: 0.4,
      schemaHint: '{ "picks": [ { "id": string, "why": string } ] }',
      validate: isFormatPicks,
    });

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const chosen = picksData.picks
      .map((p) => ({ fmt: byId.get(p.id), why: p.why }))
      .filter((x): x is { fmt: VerticalFormatRow; why: string } => Boolean(x.fmt))
      .slice(0, 3);
    if (chosen.length === 0) return;

    const lines = [
      "🎯 *Based on what I see, these formats fit:*",
      "",
      ...chosen.map(
        (x, i) =>
          `${i + 1}. *${stripEmDashes(x.fmt.scene)}* _(${x.fmt.difficulty ?? "medium"})_\n   ${stripEmDashes(x.why)}`
      ),
      "",
      "_Or pick a workflow above._",
    ];
    await slack.postThreadReply(args.channel, args.threadTs, lines.join("\n"));
  } catch (e) {
    console.error("[format-suggest] suggestFormatsForFrame failed:", (e as Error).message);
  }
}
