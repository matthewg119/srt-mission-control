// Probe the Higgsfield platform API for the gpt_image_2 text2image endpoint and
// the seedance_2_0 image2video model, so image-gen.ts (HF_GPT_REQUEST) and
// motion-adapter.ts (SEEDANCE_REQUEST) can be pointed at verified contracts.
//
// FINDINGS (verified live 2026-07-03):
//   - The key API is model-slug routed: POST https://platform.higgsfield.ai/{model_id}
//     (e.g. higgsfield-ai/soul/standard). Old /v1/text2image/soul still works too.
//   - OpenAI image model slug: **openai/hazel** (this is the GPT Image model on the
//     key API; the gpt_image_2 name only exists on the Clerk-authed consumer CLI/API).
//     Body: { prompt, aspect_ratio: '1:1'|'3:2'|'2:3'|'auto', quality: 'low'|'medium'|'high' }.
//     No 3:4 / 9:16 - portrait = '2:3'. Unknown fields are ignored (submits!).
//     Response: {status:'queued', request_id, status_url}; poll /requests/{id}/status;
//     completed shape: { status:'completed', images:[{url}] }.
//   - Seedance 2.0 is NOT on the key API yet: /v1/image2video/seedance model enum is
//     hard-locked to 'seedance_pro'|'seedance_lite'; no slug-style seedance v2 route
//     exists. Re-run this probe periodically; when 2.0 lands, set SEEDANCE_MODEL /
//     SEEDANCE_ENDPOINT in Vercel - no code change needed.
//
// Run:  bunx tsx scripts/probe-higgsfield-gpt.ts            (text2image probes only)
//       bunx tsx scripts/probe-higgsfield-gpt.ts --seedance (also probe seedance 2.0 — costs a video credit)
//       bunx tsx scripts/probe-higgsfield-gpt.ts --submit   (poll the first accepted gpt job to completion)
//
// Reads HF_CREDENTIALS from env or .env.local. Probes are cheapest-possible
// (quality low, resolution 1k, batch 1). Interpretation:
//   404             wrong path
//   400/422 + text  RIGHT path, wrong fields — the validation message names the real fields
//   200/201/202     accepted; job id in response
//
// If every candidate 404s: download the official CLI (github.com/higgsfield-ai/cli),
// then `grep -a -o 'v1/[a-z0-9_/-]*' higgsfield.exe | sort -u`, or run the CLI through
// a local mitmproxy (HTTPS_PROXY) to capture the real path.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  if (process.env.HF_CREDENTIALS) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env.local — rely on the shell env
  }
}

const HOST = "https://platform.higgsfield.ai";

async function probe(label: string, url: string, body: unknown): Promise<string | null> {
  const creds = process.env.HF_CREDENTIALS;
  if (!creds) throw new Error("HF_CREDENTIALS not set");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Key ${creds}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.log(`  ${label}: network error ${(e as Error).message}`);
    return null;
  }
  const text = (await res.text()).slice(0, 500);
  console.log(`  ${label}: HTTP ${res.status}`);
  if (res.status !== 404) console.log(`    ${text.replace(/\n/g, " ")}`);
  if (res.ok) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const jobs = json.jobs as Array<Record<string, unknown>> | undefined;
      const id = (json.id ?? json.request_id ?? json.request_set_id ?? jobs?.[0]?.id) as string | undefined;
      if (id) return id;
    } catch {
      // non-JSON success body — surfaced above
    }
  }
  return null;
}

async function pollJob(jobId: string) {
  const creds = process.env.HF_CREDENTIALS!;
  console.log(`\nPolling ${jobId} ...`);
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    await new Promise((r) => setTimeout(r, 5_000));
    const res = await fetch(`${HOST}/requests/${jobId}/status`, {
      headers: { Authorization: `Key ${creds}` },
    });
    const text = (await res.text()).slice(0, 800);
    console.log(`  status ${res.status}: ${text.replace(/\n/g, " ")}`);
    if (/completed|succeeded|failed|nsfw/i.test(text)) return;
  }
  console.log("  poll timed out (180s)");
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const prompt = "a single red apple on a white table, photo";

  console.log("== gpt_image_2 text2image candidates ==");
  const gptParamsA = { prompt, aspect_ratio: "3:4", quality: "low", resolution: "1k", batch_size: 1 };
  const paths = ["/v1/text2image/gpt_image_2", "/v1/text2image/gpt-image-2", "/v1/text2image/gpt", "/v1/text2image/gpt_image"];
  let acceptedJob: string | null = null;
  for (const p of paths) {
    // shape A: params wrapper (matches the soul + seedance contracts)
    const a = await probe(`${p} (params-wrapped)`, `${HOST}${p}`, { params: gptParamsA });
    if (a && !acceptedJob) acceptedJob = a;
    if (a) continue;
    // shape B: bare fields
    const b = await probe(`${p} (bare)`, `${HOST}${p}`, gptParamsA);
    if (b && !acceptedJob) acceptedJob = b;
  }

  if (acceptedJob && args.includes("--submit")) await pollJob(acceptedJob);

  if (args.includes("--seedance")) {
    console.log("\n== seedance 2.0 candidates (image2video — costs a video credit) ==");
    const img = "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/640px-Red_Apple.jpg";
    // Candidate 1: existing endpoint, new model enum
    const s1 = await probe(
      "/v1/image2video/seedance model=seedance_2_0",
      `${HOST}/v1/image2video/seedance`,
      { params: { model: "seedance_2_0", prompt: "subtle camera push in", input_image: { type: "image_url", image_url: img }, duration: 5 } }
    );
    if (s1) await pollJob(s1);
    // Candidate 2/3: dedicated paths with CLI field names
    for (const p of ["/v1/image2video/seedance_2_0", "/v1/image2video/seedance2"]) {
      const s = await probe(p, `${HOST}${p}`, {
        params: { prompt: "subtle camera push in", aspect_ratio: "3:4", resolution: "720p", duration: 5, mode: "std", start_image: { type: "image_url", image_url: img } },
      });
      if (s) {
        await pollJob(s);
        break;
      }
    }
  }

  console.log("\nDone. 400/422 responses name the real field contract; 404 means wrong path.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
