// Swappable still -> MP4 motion engine for the multi-shot reel pipeline (Phase 2).
//
//   const adapter = getMotionAdapter();          // selected by MOTION_ENGINE
//   const mp4: Buffer = await adapter.animate(imageUrl, motionPrompt, refFrames);
//
// MOTION_ENGINE = veo (default) | seedance | fal
//   veo      — ElevenLabs veo-3-lite via generateVideo/pollVideo. Proven, live default.
//   seedance — Higgsfield seedance-v2.0-i2v via HF_CREDENTIALS. Native multi-shot cuts +
//              character consistency from up to 9 reference frames. Endpoint/field shape
//              not yet confirmed, so the whole request is kept in ONE block (SEEDANCE_REQUEST)
//              and a wrong field is a one-file fix.
//   fal      — fal.ai bytedance/seedance-2.0/image-to-video. Tertiary fallback, same
//              one-block isolation (FAL_REQUEST).
//
// Returns raw MP4 bytes (Buffer) so downstream stitching/upload stays engine-agnostic.

import { generateVideo, pollVideo } from "@/lib/elevenlabs-media";
import { HIGGSFIELD_HOST } from "@/config/reel-style";
import { stripEmDashes } from "@/lib/reel/text";

export interface MotionAdapter {
  /**
   * Animate a single still into a short MP4 clip.
   * @param imageUrl       the source still (HTTPS or data: URL)
   * @param motionPrompt   how it should move (passed through stripEmDashes)
   * @param referenceFrames optional extra frames for engines that support multi-image
   *                        consistency (Seedance, up to 9). Ignored by single-image engines.
   */
  animate(imageUrl: string, motionPrompt: string, referenceFrames?: string[]): Promise<Buffer>;
}

export type MotionEngine = "veo" | "seedance" | "fal";

// ---- shared helpers --------------------------------------------------------------

async function downloadMp4(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`motion: clip download failed (${res.status}) for ${url.slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Recursively find the first http(s) URL in a response object (defensive, shape-agnostic). */
function deepFindUrl(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  // Most likely path first (Higgsfield: jobs[].results.raw.url).
  const raw = (rec.results as Record<string, unknown> | undefined)?.raw as
    | Record<string, unknown>
    | undefined;
  if (typeof raw?.url === "string") return raw.url;
  for (const key of ["video_url", "url", "rawUrl"]) {
    if (typeof rec[key] === "string" && (rec[key] as string).startsWith("http")) {
      return rec[key] as string;
    }
  }
  for (const v of Object.values(rec)) {
    const found = deepFindUrl(v);
    if (found) return found;
  }
  return null;
}

function extractJobId(json: Record<string, unknown>): string | null {
  const jobs = json.jobs as Array<Record<string, unknown>> | undefined;
  const candidates = [
    json.id,
    json.request_id,
    json.request_set_id,
    jobs?.[0]?.id,
    jobs?.[0]?.request_id,
  ];
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return null;
}

function statusOf(json: Record<string, unknown>): string {
  const jobs = json.jobs as Array<Record<string, unknown>> | undefined;
  const s = (json.status as string) || (jobs?.[0]?.status as string) || "";
  return s.toLowerCase();
}

const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_POLL_TIMEOUT_MS = 300_000;

// ---- VeoAdapter (default, proven) ------------------------------------------------

class VeoAdapter implements MotionAdapter {
  async animate(imageUrl: string, motionPrompt: string): Promise<Buffer> {
    const jobId = await generateVideo(stripEmDashes(motionPrompt), imageUrl);
    const url = await pollVideo(jobId, VIDEO_POLL_TIMEOUT_MS);
    return downloadMp4(url);
  }
}

// ---- SeedanceAdapter (Higgsfield seedance-v2.0-i2v) ------------------------------

class SeedanceAdapter implements MotionAdapter {
  async animate(imageUrl: string, motionPrompt: string, referenceFrames?: string[]): Promise<Buffer> {
    const creds = process.env.HF_CREDENTIALS;
    if (!creds) throw new Error("MOTION_ENGINE=seedance requires HF_CREDENTIALS");

    const headers = {
      Authorization: `Key ${creds}`,
      "Content-Type": "application/json",
    };
    const prompt = stripEmDashes(motionPrompt);
    const refs = (referenceFrames ?? []).slice(0, 9); // Seedance supports up to 9

    // ---- SEEDANCE_REQUEST -------------------------------------------------------
    // EVERYTHING Seedance-specific is in this block. If a live call rejects a field,
    // fix it here only. Best-guess shape mirrors the Higgsfield text2image contract.
    // Verified live against platform.higgsfield.ai (2026-06-30): model enum is
    // seedance_lite | seedance_pro; input_image is an object {type,image_url}; the
    // body below clears validation (the only failure left is account credits).
    const SUBMIT_URL = `${HIGGSFIELD_HOST}/v1/image2video/seedance`;
    const submitBody = {
      params: {
        model: process.env.SEEDANCE_MODEL || "seedance_lite", // seedance_pro for higher quality
        prompt,
        input_image: { type: "image_url", image_url: imageUrl },
        reference_image_urls: refs,
        duration: 5,
        aspect_ratio: "9:16",
      },
    };
    // -----------------------------------------------------------------------------

    const submitRes = await fetch(SUBMIT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(submitBody),
    });
    if (!submitRes.ok) {
      throw new Error(`seedance submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 300)}`);
    }
    const submitJson = (await submitRes.json()) as Record<string, unknown>;

    // Some responses come back already completed with a url; check first.
    const immediate = deepFindUrl(submitJson);
    if (immediate && statusOf(submitJson) !== "failed") return downloadMp4(immediate);

    const jobId = extractJobId(submitJson);
    if (!jobId) throw new Error(`seedance: no job id in response: ${JSON.stringify(submitJson).slice(0, 300)}`);

    const start = Date.now();
    while (Date.now() - start < VIDEO_POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
      const stRes = await fetch(`${HIGGSFIELD_HOST}/requests/${jobId}/status`, { headers });
      if (!stRes.ok) continue;
      const stJson = (await stRes.json()) as Record<string, unknown>;
      const status = statusOf(stJson);
      if (status === "completed" || status === "succeeded") {
        const url = deepFindUrl(stJson);
        if (!url) throw new Error("seedance: completed but no url found");
        return downloadMp4(url);
      }
      if (status === "failed" || status === "nsfw") {
        throw new Error(`seedance job ${jobId} ended: ${status}`);
      }
    }
    throw new Error(`seedance job ${jobId} timed out`);
  }
}

// ---- FalAdapter (tertiary, fal.ai bytedance/seedance-2.0) -------------------------

class FalAdapter implements MotionAdapter {
  async animate(imageUrl: string, motionPrompt: string): Promise<Buffer> {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("MOTION_ENGINE=fal requires FAL_KEY");

    const headers = {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    };
    const prompt = stripEmDashes(motionPrompt);

    // ---- FAL_REQUEST ------------------------------------------------------------
    // EVERYTHING fal-specific is in this block. Fix endpoint/fields here only.
    const SUBMIT_URL = "https://queue.fal.run/fal-ai/bytedance/seedance-2.0/image-to-video";
    const submitBody = { prompt, image_url: imageUrl };
    // -----------------------------------------------------------------------------

    const submitRes = await fetch(SUBMIT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(submitBody),
    });
    if (!submitRes.ok) {
      throw new Error(`fal submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 300)}`);
    }
    const submitJson = (await submitRes.json()) as Record<string, unknown>;
    const statusUrl = (submitJson.status_url as string) || "";
    const responseUrl = (submitJson.response_url as string) || "";
    if (!statusUrl || !responseUrl) {
      throw new Error(`fal: missing status/response url in response: ${JSON.stringify(submitJson).slice(0, 300)}`);
    }

    const start = Date.now();
    while (Date.now() - start < VIDEO_POLL_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL_MS));
      const stRes = await fetch(statusUrl, { headers });
      if (!stRes.ok) continue;
      const stJson = (await stRes.json()) as Record<string, unknown>;
      const status = ((stJson.status as string) || "").toUpperCase();
      if (status === "COMPLETED") {
        const finalRes = await fetch(responseUrl, { headers });
        if (!finalRes.ok) throw new Error(`fal: result fetch failed (${finalRes.status})`);
        const finalJson = (await finalRes.json()) as Record<string, unknown>;
        const url = deepFindUrl(finalJson);
        if (!url) throw new Error("fal: completed but no url found");
        return downloadMp4(url);
      }
      if (status === "FAILED" || status === "ERROR") {
        throw new Error(`fal job ended: ${status}`);
      }
    }
    throw new Error("fal job timed out");
  }
}

// ---- factory ---------------------------------------------------------------------

export function getMotionAdapter(): MotionAdapter {
  const engine = (process.env.MOTION_ENGINE || "veo").toLowerCase();
  switch (engine) {
    case "seedance":
      return new SeedanceAdapter();
    case "fal":
      return new FalAdapter();
    case "veo":
      return new VeoAdapter();
    default:
      console.warn(`[motion-adapter] unknown MOTION_ENGINE="${engine}", falling back to veo`);
      return new VeoAdapter();
  }
}
