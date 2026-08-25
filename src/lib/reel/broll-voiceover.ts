// `vo` in a B-roll drop thread - render the three voiceover lines through ElevenLabs.
//
// Gated on purpose (the BrainHeart protocol): the first `vo` prints the exact lines and the
// voice it would use and stops. Nothing is spent until the operator confirms. Credits and a
// wrong voice are both expensive to discover after the fact.

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { speak, BROLL_VOICE_ID } from "@/lib/elevenlabs-media";
import { loadVoiceoverLines } from "@/lib/reel/broll-suggestions";

const ASK_RE = /^\s*(vo|render\s+vo|voice\s+this|render\s+brainheart)\s*$/i;
const CONFIRM_RE = /^\s*(yes|y|go|confirm|do\s+it|render\s+it)\s*$/i;

async function markAsked(threadTs: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("broll_voiceovers")
      .update({ asked_at: new Date().toISOString() })
      .eq("thread_ts", threadTs);
  } catch (e) {
    console.error("[broll-vo] could not mark the gate:", (e as Error).message);
  }
}

async function wasAsked(threadTs: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("broll_voiceovers")
      .select("asked_at")
      .eq("thread_ts", threadTs)
      .maybeSingle();
    return Boolean((data as { asked_at?: string | null } | null)?.asked_at);
  } catch {
    return false;
  }
}

/**
 * Claim `vo` and its confirmation inside a B-roll drop thread. Returns false for every other
 * thread and every other word, so the existing routers keep their own replies.
 */
export async function handleBrollVoiceoverReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const { channel, threadTs, text } = args;
  const isAsk = ASK_RE.test(text);
  const isConfirm = CONFIRM_RE.test(text);
  if (!isAsk && !isConfirm) return false;

  const lines = await loadVoiceoverLines(channel, threadTs);
  if (!lines.length) return false; // not a drop thread with parked lines

  if (isAsk) {
    const voice = BROLL_VOICE_ID();
    const body = [
      "*Voiceover, before anything is spent.* These are the exact lines:",
      ...lines.map((l, i) => `${i + 1}. ${l}`),
      "",
      voice ? `Voice: \`${voice}\`` : "*No voice set.* Set `BROLL_VOICE_ID` in Vercel before rendering.",
      "Reply `yes` to render them.",
    ].join("\n");
    await slack.postThreadReply(channel, threadTs, body);
    await markAsked(threadTs);
    return true;
  }

  // Confirmation only counts after the gate has actually been shown in this thread.
  if (!(await wasAsked(threadTs))) return false;

  if (!process.env.ELEVENLABS_API_KEY) {
    await slack.postThreadReply(channel, threadTs, "Missing ELEVENLABS_API_KEY - add it to the env before render.");
    return true;
  }
  if (!BROLL_VOICE_ID()) {
    await slack.postThreadReply(channel, threadTs, "No voice id set. Add `BROLL_VOICE_ID` in Vercel and try again.");
    return true;
  }

  await slack.postThreadReply(channel, threadTs, `Rendering ${lines.length} voiceover${lines.length === 1 ? "" : "s"}...`);
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const mp3 = await speak(lines[i]);
      await slack.uploadFile(channel, `broll_${i + 1}_vo.mp3`, mp3, "audio/mpeg", threadTs);
    } catch (e) {
      failures.push(`${i + 1}: ${(e as Error).message}`);
    }
  }
  if (failures.length) {
    await slack.postThreadReply(channel, threadTs, `Some lines did not render:\n${failures.join("\n")}`);
  }
  return true;
}
