// A client's voice note, turned into text.
//
// The twice-weekly content ask (content-digest.ts) tells the client to answer by voice
// note, because a business owner between appointments will not type three paragraphs and
// asking them to is how the rhythm goes quiet in week two. Matthew forwards the note into
// that client's ops thread, and this turns it into something a page can be written from.
//
// ─── IT NEVER WRITES THE PAGE ────────────────────────────────────────────────────────
//
// Transcription only. The words are the client's, the page is written from them by a
// person, and it still faces the Day-0 wall and a human pressing Publish. A model that
// "cleaned up" or expanded an owner's answer would be putting sentences they never said on
// their own domain under their own name.
//
// ─── PASTE-BACK IS THE GUARANTEED PATH ───────────────────────────────────────────────
//
// OPENAI_API_KEY has run out of credits before and took the audit engine down with it. So
// a failure here is stated plainly in the thread and asks for a paste, exactly like the
// Loom transcript, which has always been pasted rather than fetched. It never returns a
// partial or invented transcript, and it never fails silently: an empty thread would read
// as "the voice note was not worth anything".

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

/** Slack's own marker for a voice note, plus the mimetypes the phone apps actually send. */
export function isVoiceNote(file: {
  mimetype?: string;
  filetype?: string;
  subtype?: string;
}): boolean {
  const mime = file.mimetype ?? "";
  return (
    mime.startsWith("audio/") ||
    mime === "video/mp4a-latm" ||
    file.filetype === "mp4a" ||
    file.filetype === "voice-message" ||
    file.subtype === "slack_audio"
  );
}

/** 25 MB is the transcription API's hard limit. A longer note has to be split by hand. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface TranscriptResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function transcribeAudio(
  buf: Buffer,
  filename: string,
  mimetype: string
): Promise<TranscriptResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY is not set" };
  if (buf.byteLength > MAX_BYTES) {
    return { ok: false, error: `the file is ${(buf.byteLength / 1e6).toFixed(1)} MB, over the 25 MB limit` };
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mimetype || "audio/mpeg" }), filename);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1");
  // No language hint. Matthew's clients answer in English and in Spanish and a forced
  // language turns the other one into confident nonsense rather than into an error.

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Quote the cause verbatim. "no credits remaining" and "invalid key" are different
      // problems with different fixes, and collapsing them into "transcription failed" is
      // what made the audit outage take a day to diagnose.
      return { ok: false, error: `${res.status} ${body.slice(0, 300)}` };
    }

    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? "").trim();
    if (!text) return { ok: false, error: "the transcript came back empty" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Transcribe a voice note that has just been filed against a client, and say so in the
 * thread. Never throws: it is called from the Slack events handler, which has already
 * answered.
 */
export async function handleClientVoiceNote(args: {
  clientId: string;
  channelId: string;
  threadTs: string;
  file: { id: string; name?: string; mimetype?: string; url_private_download?: string };
}): Promise<void> {
  const { channelId, threadTs, file } = args;
  const name = file.name ?? "voice note";

  const say = (text: string) =>
    slack.postThreadReply(channelId, threadTs, text).catch(() => {});

  if (!file.url_private_download) {
    await say(`:warning: *${name}* was filed but has no download URL, so it could not be transcribed. Paste the transcript here and I will use that.`);
    return;
  }

  let buf: Buffer;
  try {
    buf = await slack.downloadFile(file.url_private_download);
  } catch (e) {
    await say(`:warning: *${name}* was filed but could not be downloaded for transcription: ${(e as Error).message}. Paste the transcript here instead.`);
    return;
  }

  const result = await transcribeAudio(buf, name, file.mimetype ?? "audio/mpeg");

  if (!result.ok || !result.text) {
    await say(
      `:warning: *${name}* is filed, but transcription failed: ${result.error}.\n\n` +
        `The audio is saved either way. Paste the transcript in this thread and it will be used as if it had come from here.`
    );
    return;
  }

  // Stored on the doc row so the page can be written from it later without re-spending a
  // transcription, and so "what did they actually say" outlives the Slack retention plan.
  const { error } = await supabaseAdmin
    .from("client_docs")
    .update({ transcript: result.text })
    .eq("slack_file_id", file.id);

  if (error) console.error("[voice-notes] transcript store failed:", error.message);

  // Posted as a quote block, whole. Not summarised: the phrasing an owner uses about their
  // own trade is the entire reason to ask them rather than write it ourselves, and a
  // summary would throw away the only part a page cannot invent.
  const quoted = result.text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

  await say(`:studio_microphone: *${name}*, transcribed:\n\n${quoted}`);
}
