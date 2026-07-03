// Provider-abstracted image generation for the Daily Creative Drop.
//
// interface generateImages({ prompts, soulId, aspect }) -> (ImageResult | null)[]
// (aligned to prompts; null = that image failed after one retry, so the drop can
// still post the others + the copy).
//
// Providers (IMAGE_PROVIDER env):
//   higgsfield-gpt (default) — OpenAI's GPT Image model served by the Higgsfield key
//                              API (slug openai/hazel). Matthew's standing rule: ALL
//                              image generation uses the GPT image model; Soul is only
//                              for the trained-character (Vargas) path. This provider
//                              NEVER silently degrades to Soul: a hazel failure retries
//                              once (generateImages) then fails visibly (null).
//   higgsfield               — Higgsfield text2image/soul API. The trained Vargas Soul
//                              (soulId) gives day-to-day character consistency.
//   elevenlabs               — reuses src/lib/elevenlabs-media.ts (Seedream). Fallback only.
//   openai                   — gpt-image-2 straight from OpenAI (needs OPENAI_API_KEY).
//
// Higgsfield contract follows @higgsfield/client v2: host platform.higgsfield.ai,
// auth `Authorization: Key KEY_ID:KEY_SECRET` (HF_CREDENTIALS), POST /v1/text2image/soul,
// poll /requests/{id}/status, result url at jobs[0].results.raw.url. Response parsing
// is defensive (several shapes) since the raw JSON isn't formally published; if a live
// call shows a different field, adjust extractJobId/extractUrl below.
//
// The key API is also model-slug routed: POST platform.higgsfield.ai/{model_id}
// (verified live 2026-07-03 via scripts/probe-higgsfield-gpt.ts). The GPT image slug is
// openai/hazel; completed jobs return { status:'completed', images:[{url}] } which
// deepFindUrl already parses.

import {
  HIGGSFIELD_HOST,
  SOUL_SIZE,
  SOUL_QUALITY,
  SOUL_REFERENCE_STRENGTH,
} from "@/config/reel-style";
import { POV_IMAGE_SIZE } from "@/config/pov-style";
import { generateImage as elevenLabsImage } from "@/lib/elevenlabs-media";

export type ImageProvider = "higgsfield-gpt" | "higgsfield" | "elevenlabs" | "openai";

export interface ImageResult {
  buffer: Buffer;
  mimetype: string;
  sourceUrl?: string;
}

export interface GenerateImagesOpts {
  prompts: string[];
  soulId?: string;
  /**
   * Aspect ratio for the gpt image provider ("3:4" | "9:16" | "1:1" | ...). Mapped to
   * the model's supported set (hazel: 1:1 | 3:2 | 2:3 | auto) by nearestHazelAspect.
   * When omitted it is derived from `size` via sizeToAspect. Soul ignores this.
   */
  aspect?: string;
  /**
   * Override the provider for this call only (the global IMAGE_PROVIDER default is
   * unchanged). Per-workflow render_options.provider lands here; the Vargas belief
   * drop passes "higgsfield" explicitly for trained-Soul character consistency.
   */
  provider?: ImageProvider;
  /**
   * Higgsfield width_and_height override (e.g. "1536x2048" for true 3:4). Defaults to
   * SOUL_SIZE. Soul-only; for higgsfield-gpt it is mapped to the nearest aspect_ratio
   * via sizeToAspect so existing callers keep working untouched.
   */
  size?: string;
  /** gpt image quality for higgsfield-gpt/openai ("low" | "medium" | "high"). */
  quality?: string;
}

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 120_000;

function provider(): ImageProvider {
  return (process.env.IMAGE_PROVIDER || "higgsfield-gpt").toLowerCase() as ImageProvider;
}

/**
 * Map a Higgsfield width_and_height size string to an aspect ratio so callers that
 * still pass `size` (all the Soul-era call sites) get the right gpt aspect for free.
 */
export function sizeToAspect(size?: string): string | undefined {
  if (!size) return undefined;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (r < 1) return r <= 0.65 ? "9:16" : "3:4"; // 1152x2048 -> 9:16, 1536x2048 -> 3:4
  return r >= 1.55 ? "16:9" : "3:2";
}

/** Collapse any requested aspect onto hazel's supported set (1:1 | 3:2 | 2:3 | auto). */
function nearestHazelAspect(aspect?: string): string {
  const a = (aspect || "").trim();
  if (a === "1:1" || a === "3:2" || a === "2:3" || a === "auto") return a;
  // Portrait requests (3:4, 9:16, 2:3-ish) -> 2:3; landscape -> 3:2; unknown -> 2:3
  // because every reel/POV surface in this system is portrait.
  const m = a.match(/^(\d+):(\d+)$/);
  if (m && Number(m[1]) > Number(m[2])) return "3:2";
  return "2:3";
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

// ---- Higgsfield-hosted GPT Image (Matthew's default for ALL image generation) ------
// ---- HF_GPT_REQUEST ---------------------------------------------------------------
// EVERYTHING slug/body-specific is in this block, same convention as SEEDANCE_REQUEST
// in motion-adapter.ts. Verified live 2026-07-03 (scripts/probe-higgsfield-gpt.ts):
// POST platform.higgsfield.ai/openai/hazel with a FLAT body (no `params` wrapper);
// aspect_ratio enum is 1:1 | 3:2 | 2:3 | auto (no 3:4 / 9:16 - nearestHazelAspect
// collapses those); quality enum low | medium | high; unknown fields are silently
// ignored, so keep the body minimal. Completed status shape: { images: [{ url }] }.
async function higgsfieldGptGenerateOne(
  prompt: string,
  opts?: { aspect?: string; quality?: string }
): Promise<ImageResult> {
  const creds = process.env.HF_CREDENTIALS;
  if (!creds) throw new Error("HF_CREDENTIALS not set");

  const endpoint = process.env.HF_GPT_ENDPOINT || `${HIGGSFIELD_HOST}/openai/hazel`;
  const body = {
    prompt,
    aspect_ratio: nearestHazelAspect(opts?.aspect),
    quality: opts?.quality || process.env.HF_GPT_QUALITY || "high",
  };
  // ---- end HF_GPT_REQUEST ----------------------------------------------------------

  const headers = {
    Authorization: `Key ${creds}`,
    "Content-Type": "application/json",
  };

  const submitRes = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!submitRes.ok) {
    throw new Error(`higgsfield-gpt submit failed (${submitRes.status}): ${(await submitRes.text()).slice(0, 300)}`);
  }

  const submitJson = (await submitRes.json()) as Record<string, unknown>;
  const immediate = deepFindUrl(submitJson);
  if (immediate && statusOf(submitJson) !== "failed") return downloadToBuffer(immediate);

  const jobId = extractJobId(submitJson);
  if (!jobId) throw new Error(`higgsfield-gpt: no job id in response: ${JSON.stringify(submitJson).slice(0, 300)}`);

  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const stRes = await fetch(`${HIGGSFIELD_HOST}/requests/${jobId}/status`, { headers });
    if (!stRes.ok) continue;
    const stJson = (await stRes.json()) as Record<string, unknown>;
    const status = statusOf(stJson);
    if (status === "completed" || status === "succeeded") {
      const url = deepFindUrl(stJson);
      if (!url) throw new Error("higgsfield-gpt: completed but no url found");
      return downloadToBuffer(url);
    }
    if (status === "failed" || status === "nsfw") {
      throw new Error(`higgsfield-gpt job ${jobId} ended: ${status}`);
    }
  }
  throw new Error(`higgsfield-gpt job ${jobId} timed out`);
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
  size?: string,
  aspect?: string,
  quality?: string
): Promise<ImageResult> {
  if (prov === "higgsfield-gpt") {
    // NO Soul fallback: gpt-image-2 is the only allowed generator on this path. The caller's
    // retry loop (generateImages) retries once; a persistent failure yields null and the
    // Slack thread gets a visible "image failed" message instead of a silent Soul image.
    return higgsfieldGptGenerateOne(prompt, { aspect: aspect ?? sizeToAspect(size), quality });
  }
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
 * so the caller can fall back to a fresh text2image "after" frame. Only the direct OpenAI
 * API supports edits today (needs OPENAI_API_KEY) - the Higgsfield-hosted hazel slug is
 * text-to-image only (probe 2026-07-03), so without an OpenAI key callers get null and
 * regenerate the frame fresh via the gpt image model instead.
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
        result = await generateOne(prompt, opts.soulId, prov, opts.size, opts.aspect, opts.quality);
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
