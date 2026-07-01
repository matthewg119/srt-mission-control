// Provider-abstracted image generation for the Daily Creative Drop.
//
// interface generateImages({ prompts, soulId, aspect }) -> (ImageResult | null)[]
// (aligned to prompts; null = that image failed after one retry, so the drop can
// still post the others + the copy).
//
// Providers (IMAGE_PROVIDER env):
//   higgsfield (default) — official Higgsfield text2image/soul API. The trained
//                          Vargas Soul (soulId) gives day-to-day character consistency.
//   elevenlabs           — reuses src/lib/elevenlabs-media.ts (Seedream). No Soul /
//                          no character consistency; fallback only.
//
// Higgsfield contract follows @higgsfield/client v2: host platform.higgsfield.ai,
// auth `Authorization: Key KEY_ID:KEY_SECRET` (HF_CREDENTIALS), POST /v1/text2image/soul,
// poll /requests/{id}/status, result url at jobs[0].results.raw.url. Response parsing
// is defensive (several shapes) since the raw JSON isn't formally published; if a live
// call shows a different field, adjust extractJobId/extractUrl below.

import {
  HIGGSFIELD_HOST,
  SOUL_SIZE,
  SOUL_QUALITY,
  SOUL_REFERENCE_STRENGTH,
} from "@/config/reel-style";
import { POV_IMAGE_SIZE } from "@/config/pov-style";
import { generateImage as elevenLabsImage } from "@/lib/elevenlabs-media";

export type ImageProvider = "higgsfield" | "elevenlabs" | "openai";

export interface ImageResult {
  buffer: Buffer;
  mimetype: string;
  sourceUrl?: string;
}

export interface GenerateImagesOpts {
  prompts: string[];
  soulId?: string;
  /** "reel" (9:16) — reserved for future sizing variants; sizing currently from config. */
  aspect?: string;
  /**
   * Override the provider for this call only (the global IMAGE_PROVIDER default is
   * unchanged). The Meta Glasses POV drop passes "openai" to use gpt-image-2 while
   * the rest of the system stays on Higgsfield.
   */
  provider?: ImageProvider;
  /**
   * Higgsfield width_and_height override (e.g. "1536x2048" for true 3:4). Defaults to
   * SOUL_SIZE. The POV drop passes 3:4 so the Meta-glasses look matches the studio.
   */
  size?: string;
}

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 120_000;

function provider(): ImageProvider {
  return (process.env.IMAGE_PROVIDER || "higgsfield").toLowerCase() as ImageProvider;
}

async function downloadToBuffer(url: string): Promise<ImageResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url.slice(0, 120)}`);
  const arrayBuf = await res.arrayBuffer();
  const mimetype = res.headers.get("content-type") || "image/png";
  return { buffer: Buffer.from(arrayBuf), mimetype, sourceUrl: url };
}

// ---- Higgsfield helpers (defensive shape parsing) --------------------------------

function deepFindUrl(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  // Most likely path first.
  const raw = (rec.results as Record<string, unknown> | undefined)?.raw as
    | Record<string, unknown>
    | undefined;
  if (typeof raw?.url === "string") return raw.url;
  for (const key of ["url", "image_url", "rawUrl"]) {
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

async function higgsfieldGenerateOne(
  prompt: string,
  soulId?: string,
  size?: string
): Promise<ImageResult> {
  const creds = process.env.HF_CREDENTIALS;
  if (!creds) throw new Error("HF_CREDENTIALS not set");
  // A Soul id (custom reference) is OPTIONAL. When one is passed we bind the trained
  // character for consistency; when it's omitted we run plain Soul text2image (no
  // character). The POV drop uses the no-character path so it never depends on a Soul
  // living under this API key (a missing/foreign Soul returns character_not_found).
  const sid = soulId ?? undefined;

  const headers = {
    Authorization: `Key ${creds}`,
    "Content-Type": "application/json",
  };

  const submitRes = await fetch(`${HIGGSFIELD_HOST}/v1/text2image/soul`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      params: {
        prompt,
        ...(sid ? { custom_reference_id: sid, custom_reference_strength: SOUL_REFERENCE_STRENGTH } : {}),
        width_and_height: size ?? SOUL_SIZE,
        quality: SOUL_QUALITY,
        batch_size: 1,
      },
    }),
  });

  if (!submitRes.ok) {
    throw new Error(`higgsfield submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 300)}`);
  }

  const submitJson = (await submitRes.json()) as Record<string, unknown>;

  // Some responses come back already completed with a url; check first.
  const immediate = deepFindUrl(submitJson);
  if (immediate && statusOf(submitJson) !== "failed") return downloadToBuffer(immediate);

  const jobId = extractJobId(submitJson);
  if (!jobId) throw new Error(`higgsfield: no job id in response: ${JSON.stringify(submitJson).slice(0, 300)}`);

  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const stRes = await fetch(`${HIGGSFIELD_HOST}/requests/${jobId}/status`, { headers });
    if (!stRes.ok) continue;
    const stJson = (await stRes.json()) as Record<string, unknown>;
    const status = statusOf(stJson);
    if (status === "completed" || status === "succeeded") {
      const url = deepFindUrl(stJson);
      if (!url) throw new Error("higgsfield: completed but no url found");
      return downloadToBuffer(url);
    }
    if (status === "failed" || status === "nsfw") {
      throw new Error(`higgsfield job ${jobId} ended: ${status}`);
    }
  }
  throw new Error(`higgsfield job ${jobId} timed out`);
}

async function elevenLabsGenerateOne(prompt: string): Promise<ImageResult> {
  const out = await elevenLabsImage(prompt);
  if (out.startsWith("data:")) {
    const base64 = out.split(",")[1] ?? "";
    const mime = out.slice(5, out.indexOf(";")) || "image/png";
    return { buffer: Buffer.from(base64, "base64"), mimetype: mime };
  }
  return downloadToBuffer(out);
}

// ---- OpenAI gpt-image-2 (the Meta Glasses POV format's auto-generated image) ------
// Synchronous images endpoint — no Soul, no polling. gpt-image-2 returns base64 in
// data[0].b64_json (there is no URL response_format for this model); a url is handled
// defensively in case the account returns one.
async function openaiGenerateOne(prompt: string): Promise<ImageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size: POV_IMAGE_SIZE,
      n: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`openai gpt-image-2 failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (first?.b64_json) {
    return { buffer: Buffer.from(first.b64_json, "base64"), mimetype: "image/png" };
  }
  if (first?.url) return downloadToBuffer(first.url);
  throw new Error(`openai gpt-image-2: no image in response: ${JSON.stringify(json).slice(0, 200)}`);
}

async function generateOne(
  prompt: string,
  soulId: string | undefined,
  prov: ImageProvider,
  size?: string
): Promise<ImageResult> {
  if (prov === "openai") return openaiGenerateOne(prompt);
  if (prov === "elevenlabs") return elevenLabsGenerateOne(prompt);
  return higgsfieldGenerateOne(prompt, soulId, size);
}

// ---- OpenAI gpt-image-2 EDIT (image + prompt -> edited image) ---------------------
// Used by the Bug-Reveal format to add the swarm onto the CHOSEN "before" frame so the
// two frames line up for a before->after animation. gpt-image-2's edits endpoint also
// accepts a `mask` (a selected region), which is the hook for the future region-select
// app ("select an area, do XYZ here"). Returns base64 in data[0].b64_json.
export async function editImageOpenAI(
  image: Buffer,
  mimetype: string,
  prompt: string,
  size?: string
): Promise<ImageResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const ext = (mimetype.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", size ?? POV_IMAGE_SIZE);
  form.append("n", "1");
  form.append("image", new Blob([new Uint8Array(image)], { type: mimetype || "image/png" }), `source.${ext}`);

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`openai gpt-image-2 edit failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (first?.b64_json) return { buffer: Buffer.from(first.b64_json, "base64"), mimetype: "image/png" };
  if (first?.url) return downloadToBuffer(first.url);
  throw new Error(`openai gpt-image-2 edit: no image in response: ${JSON.stringify(json).slice(0, 200)}`);
}

/**
 * Edit an existing image (add/replace content) via gpt-image-2. Returns null on any failure
 * so the caller can fall back to a fresh text2image "after" frame. Only the openai provider
 * supports edits today; other providers return null.
 */
export async function editImage(opts: {
  image: Buffer;
  mimetype: string;
  prompt: string;
  size?: string;
}): Promise<ImageResult | null> {
  try {
    return await editImageOpenAI(opts.image, opts.mimetype, opts.prompt, opts.size);
  } catch (e) {
    console.error("[image-gen] editImage failed:", (e as Error).message);
    return null;
  }
}

/**
 * Generate one image per prompt. Each image gets one retry; a persistent failure
 * yields null at that index so the drop continues with whatever succeeded.
 */
export async function generateImages(opts: GenerateImagesOpts): Promise<(ImageResult | null)[]> {
  const prov = opts.provider ?? provider();
  const results: (ImageResult | null)[] = [];
  for (let i = 0; i < opts.prompts.length; i++) {
    const prompt = opts.prompts[i];
    let result: ImageResult | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await generateOne(prompt, opts.soulId, prov, opts.size);
      } catch (e) {
        console.error(
          `[reel] image ${i + 1} attempt ${attempt + 1} failed (${prov}):`,
          (e as Error).message
        );
      }
    }
    results.push(result);
  }
  return results;
}
