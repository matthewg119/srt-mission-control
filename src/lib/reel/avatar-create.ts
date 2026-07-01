// New-avatar creation flow (Content Engine v3).
//
// Creating a new avatar mirrors the other formats: Vektor asks for the three deliverables
// (deep market research / avatar, a short offer, and the 6 fundamental beliefs), the operator
// drops the kit in #content-analyzer, and the EXISTING /api/content/ingest-avatar distills it
// into a `verticals` row + builds its format calendar.
//
// Safety: a kit drop must be tied to a NAMED new avatar id first, so a stray PDF never
// overwrites an existing avatar (the ingest endpoint defaults to pest_control otherwise).

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { insertJob } from "@/lib/reel/jobs";

const CHECKLIST = [
  "*Create a new avatar.* Deliver these three, same as our other avatars:",
  "1. *Deep market research* (the Avatar: who they are, pains, desires, beliefs, voice).",
  "2. *A short offer* (UMP / UMS / big idea / objections / headline options).",
  "3. *The 6 fundamental beliefs* (in order).",
  "",
  "Reply `new avatar <id> <Name>` to name it (id lowercase, e.g. `hvac Air Comfort Pros`),",
  "then drop the kit as a PDF/DOCX (or paste the text) in #content-analyzer and I will build it.",
].join("\n");

/** Parse `new avatar <id> <name...>`. Returns {} for a bare `new avatar`, null if not a match. */
export function parseNewAvatar(text: string): { id?: string; name?: string } | null {
  const t = text.trim();
  if (/^\s*new\s+avatar\s*$/i.test(t)) return {};
  const m = /^\s*new\s+avatar\s+([a-z][a-z0-9_]{1,40})\s*(.*)$/i.exec(t);
  if (!m) return null;
  return { id: m[1].toLowerCase(), name: (m[2] || "").trim() || undefined };
}

/**
 * Start the new-avatar flow. With no id, posts the checklist. With an id, records a pending
 * new-avatar job (scoped to #content-analyzer, where the kit lands) and tells the operator to
 * drop the kit. Returns true when it handled the message.
 */
export async function startNewAvatar(args: {
  channel: string;
  id?: string;
  name?: string;
}): Promise<boolean> {
  if (!args.id) {
    await slack.postMessage(args.channel, CHECKLIST);
    return true;
  }
  const analyzer = VEKTOR_CHANNELS.contentAnalyzer || args.channel;
  const name = args.name || args.id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const res = await slack.postMessage(
    args.channel,
    [
      `Creating avatar \`${args.id}\` (*${name}*).`,
      "Now drop its kit in #content-analyzer: a PDF/DOCX (or pasted text) with the deep market",
      "research, the short offer, and the 6 fundamental beliefs. I will distill it and build the",
      "format calendar, then it shows up in `go` / `vektor` and `map`.",
    ].join("\n")
  );
  const ts = (res as { ts?: string }).ts || `${Date.now()}`;
  await insertJob({
    formatId: "new_avatar",
    verticalId: args.id,
    channel: analyzer, // scope to the analyzer channel so the kit-drop lookup finds it
    threadTs: ts,
    pickerTs: ts,
    stage: "await_kit",
    sourceKind: "new_avatar",
    data: { new_vertical_id: args.id, new_vertical_name: name },
  });
  return true;
}

/** The most recent pending new-avatar in a channel (the kit-drop target). */
export async function pendingNewAvatar(
  channel: string
): Promise<{ jobId: string; id: string; name: string } | null> {
  try {
    const { data } = await supabaseAdmin
      .from("content_jobs")
      .select("id,data,status")
      .eq("slack_channel", channel)
      .eq("format_id", "new_avatar")
      .eq("stage", "await_kit")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: { new_vertical_id?: string; new_vertical_name?: string } };
    if (!row.data?.new_vertical_id) return null;
    return {
      jobId: row.id,
      id: row.data.new_vertical_id,
      name: row.data.new_vertical_name || row.data.new_vertical_id,
    };
  } catch {
    return null;
  }
}

/** Mark a pending new-avatar job consumed once its kit has been dispatched. */
export async function consumePendingNewAvatar(jobId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("content_jobs")
      .update({ stage: "done", status: "done", updated_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch {
    /* best-effort */
  }
}
