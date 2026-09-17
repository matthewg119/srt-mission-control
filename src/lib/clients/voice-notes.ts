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

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";

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

/** Thrown to decline keeping a transcript we did not get. getOrFetch writes nothing on a throw. */
class TranscriptFailed extends Error {
  constructor(readonly result: TranscriptResult) {
    super(result.error ?? "the transcription failed");
    this.name = "TranscriptFailed";
  }
}

/**
 * How long a transcript stays true: for ever.
 *
 * ‼️ THE AUDIO IS THE KEY, SO THERE IS NOTHING TO EXPIRE. The same bytes say the same words on
 * any day, and different bytes are a different key. An expiry here could only ever cause a second
 * payment for an answer that cannot have changed.
 */
const TRANSCRIPT_TTL_DAYS = null;

/**
 * Speech to text, through the cache, keyed on the AUDIO rather than on the file.
 *
 * ‼️ THE BYTES, NOT THE FILENAME OR THE SLACK FILE ID. The same note re-uploaded, forwarded into
 * a second thread, or re-read after a step re-run is the same question and must not be paid for
 * twice. A filename is not identity: two clients both send "audio_message.m4a".
 *
 * client_id is null for the same reason. The transcript is a fact about a recording, and keying
 * it to whoever happened to drop it would re-buy the identical file in the next thread.
 *
 * A failure is never kept: an empty transcript, a 429 with no credits and a timeout are all
 * states this file already takes care to report verbatim, and caching any of them would answer
 * every later upload of that recording with our own outage, permanently, since nothing expires.
 */
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

  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  const audioHash = createHash("sha256").update(buf).digest("hex");

  try {
    const { payload } = await getOrFetch<TranscriptResult>({
      clientId: null,
      kind: "openai.whisper",
      cacheKey: cacheKeyOf({ audio: audioHash, model }),
      ttlDays: TRANSCRIPT_TTL_DAYS,
      provider: "openai whisper",
      params: { model, bytes: buf.byteLength, mimetype },
      fetch: async () => {
        const fresh = await askWhisper(buf, filename, mimetype, model, key);
        if (!fresh.ok) throw new TranscriptFailed(fresh);
        // Billed per minute of audio, and no per-minute rate is on file here, so this zero is
        // UNPRICED rather than free. Same known gap the OpenAI rows in this ledger carry.
        return { payload: fresh, costUsd: 0 };
      },
    });
    return payload;
  } catch (e) {
    if (e instanceof TranscriptFailed) return e.result;
    return { ok: false, error: (e as Error).message };
  }
}

async function askWhisper(
  buf: Buffer,
  filename: string,
  mimetype: string,
  model: string,
  key: string
): Promise<TranscriptResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mimetype || "audio/mpeg" }), filename);
  form.append("model", model);
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
