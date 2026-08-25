import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";

const BASE = "https://api.elevenlabs.io/v1";
const key = () => process.env.ELEVENLABS_API_KEY ?? "";
export const SOFIA_VOICE_ID = () => process.env.SOFIA_VOICE_ID ?? "";

function sanitizePrompt(prompt: string): string {
  return prompt.replace(/\b(woman|man|person|girl|boy|female|male|she|he|her|his)\b/gi, "figure");
}

export async function generateImage(prompt: string, retry = false): Promise<string> {
  const res = await fetch(`${BASE}/image-generation`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: retry ? sanitizePrompt(prompt) : prompt,
      aspect_ratio: "9:16",
      model: "seedream-3-0",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (!retry && (errText.includes("content_policy") || errText.includes("tos") || res.status === 422)) {
      console.log("[elevenlabs-media] ToS violation on image gen — retrying with sanitized prompt");
      return generateImage(prompt, true);
    }
    throw new Error(`ElevenLabs image generation failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { image_url?: string; image_base64?: string };
  if (data.image_url) return data.image_url;
  if (data.image_base64) return `data:image/png;base64,${data.image_base64}`;
  throw new Error("ElevenLabs image generation returned no image_url or image_base64");
}

export async function generateVideo(prompt: string, imageUrl: string): Promise<string> {
  const res = await fetch(`${BASE}/video-generation`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model: "veo-3-lite",
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: 4,
      image_url: imageUrl,
    }),
    // Bounded: pollVideo's deadline only applies BETWEEN requests, so an unbounded socket
    // here would hang past it and take the caller's whole function budget with it.
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs video generation failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as { job_id?: string; id?: string };
  const jobId = data.job_id ?? data.id;
  if (!jobId) throw new Error("ElevenLabs video generation returned no job_id");
  console.log(`[elevenlabs-media] video job started: ${jobId}`);
  return jobId;
}

export async function pollVideo(jobId: string, maxWaitMs = 240_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${BASE}/video-generation/${jobId}`, {
      headers: { "xi-api-key": key() },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ElevenLabs video poll failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as { status: string; video_url?: string };
    console.log(`[elevenlabs-media] poll ${jobId}: ${data.status}`);

    if (data.status === "completed" && data.video_url) return data.video_url;
    if (data.status === "failed" || data.status === "error") {
      throw new Error(`ElevenLabs video job ${jobId} failed`);
    }

    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`ElevenLabs video job ${jobId} timed out after ${maxWaitMs / 1000}s`);
}

// Strip silence from audio using ffmpeg before voice conversion,
// so Sofia's pacing doesn't inherit gaps from the raw recording.
export async function stripSilence(audioBuffer: Buffer): Promise<Buffer> {
  let ffmpegPath: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require("ffmpeg-static") as string;
  } catch {
    ffmpegPath = "ffmpeg";
  }

  const id = randomUUID();
  const inFile = `/tmp/voice-in-${id}.mp3`;
  const outFile = `/tmp/voice-out-${id}.mp3`;

  try {
    writeFileSync(inFile, audioBuffer);
    const result = spawnSync(
      ffmpegPath,
      [
        "-y", "-i", inFile,
        "-af", "silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-30dB",
        "-c:a", "libmp3lame",
        outFile,
      ],
      { timeout: 60_000 }
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";
      console.warn("[elevenlabs-media] ffmpeg silence strip failed — using original:", stderr.slice(0, 400));
      return audioBuffer;
    }

    console.log("[elevenlabs-media] silence strip complete");
    return readFileSync(outFile);
  } finally {
    if (existsSync(inFile)) unlinkSync(inFile);
    if (existsSync(outFile)) unlinkSync(outFile);
  }
}

export async function sofiaVoiceConvert(audioBuffer: Buffer): Promise<Buffer> {
  const voiceId = SOFIA_VOICE_ID();
  if (!voiceId) throw new Error("SOFIA_VOICE_ID env var not set");

  const formData = new FormData();
  const audioArrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
  formData.append("audio", new Blob([audioArrayBuffer], { type: "audio/mpeg" }), "voicenote.mp3");
  formData.append("output_format", "mp3_44100_128");

  const res = await fetch(`${BASE}/speech-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": key() },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs speech-to-speech failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  console.log("[elevenlabs-media] Sofia voice conversion complete");
  return Buffer.from(await res.arrayBuffer());
}

// ---- text to speech ----------------------------------------------------------------------

export const BROLL_VOICE_ID = () => process.env.BROLL_VOICE_ID ?? process.env.SOFIA_VOICE_ID ?? "";

/**
 * Render one line of voiceover to MP3 bytes. `[pause]` markers are the writing convention in
 * the B-roll deck; the API has no pause token, so they become commas, which is what actually
 * makes the voice breathe.
 */
export async function speak(text: string, voiceId?: string): Promise<Buffer> {
  const key_ = key();
  if (!key_) throw new Error("ELEVENLABS_API_KEY not set");
  const voice = voiceId || BROLL_VOICE_ID();
  if (!voice) throw new Error("no voice id set (BROLL_VOICE_ID)");

  const spoken = text.replace(/\s*\[pause\]\s*/gi, ", ").replace(/\s+/g, " ").trim();
  const res = await fetch(`${BASE}/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": key_, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: spoken,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
