// Recover animated clips that reached the reels bucket but never got written onto their
// content_jobs row (the 2026-07-27 hook-studio stall: the lambda was killed before
// mode_videos was saved, so finished clips were orphaned).
//
//   bun run scripts/_recover-hook-clips.ts list --job=<id> [--from=ISO] [--to=ISO]
//   bun run scripts/_recover-hook-clips.ts apply --job=<id> --scene2=<url> --scene3=<url>
//
// TWO STEPS ON PURPOSE. Bucket objects are pov/<uuid>.mp4 and carry no scene number, so the
// scene mapping can only be INFERRED from upload order. A wrong guess silently renders the
// wrong shot in the wrong slot, so `list` only suggests and `apply` only takes explicit URLs.
import { supabaseAdmin } from "../src/lib/db";

type Args = Record<string, string>;
const argv = process.argv.slice(2);
const cmd = argv[0];
const args: Args = Object.fromEntries(
  argv.slice(1).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  })
);

const BUCKET = "reels";
const PREFIX = "pov";

function publicUrl(name: string): string {
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${PREFIX}/${name}`).data.publicUrl;
}

async function loadJob(id: string) {
  const { data, error } = await supabaseAdmin
    .from("content_jobs")
    .select("id,stage,status,slack_thread_ts,data")
    .eq("id", id)
    .single();
  if (error) throw new Error(`job ${id}: ${error.message}`);
  return data as { id: string; stage: string; status: string; slack_thread_ts: string; data: Record<string, unknown> };
}

async function list() {
  const job = await loadJob(args.job);
  const slots = (job.data.prompt_slots ?? []) as Array<{ scene: number; image_url: string | null }>;
  const videos = (job.data.mode_videos ?? null) as Array<string | null> | null;
  console.log(`job ${job.id}  stage=${job.stage}  status=${job.status}  thread=${job.slack_thread_ts}`);
  console.log(`scenes: ${slots.length}`);
  console.log(`mode_videos: ${videos ? JSON.stringify(videos.map(Boolean)) : "ABSENT"}\n`);

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(PREFIX, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw new Error(`bucket list: ${error.message}`);

  const from = args.from ? Date.parse(args.from) : 0;
  const to = args.to ? Date.parse(args.to) : Number.MAX_SAFE_INTEGER;
  const clips = (data ?? [])
    .filter((f) => f.name.toLowerCase().endsWith(".mp4"))
    .map((f) => ({ name: f.name, created: f.created_at ?? "" }))
    .filter((f) => {
      const t = Date.parse(f.created);
      return Number.isFinite(t) && t >= from && t <= to;
    });

  if (!clips.length) {
    console.log("No mp4s in that window. Widen --from/--to, or drop them to see everything.");
    return;
  }

  console.log(`${clips.length} mp4(s) in window:\n`);
  clips.forEach((c, i) => {
    console.log(`  [${i + 1}] ${c.created}`);
    console.log(`      ${publicUrl(c.name)}\n`);
  });

  // Slack receives the clip immediately before the bucket upload, so the bucket's ascending
  // creation order matches the order the scenes FINISHED, not their scene number.
  console.log("SUGGESTION ONLY - open each URL and confirm before applying.");
  console.log("Upload order = completion order, which is NOT scene order.");
  console.log(`\nExample once you have identified them:`);
  console.log(
    `  bun run scripts/_recover-hook-clips.ts apply --job=${job.id} --scene2=<url> --scene3=<url>`
  );
}

async function apply() {
  const job = await loadJob(args.job);
  const slots = (job.data.prompt_slots ?? []) as Array<{ scene: number }>;
  const total = slots.length || 3;

  const videos: Array<string | null> = Array.from({ length: total }, (_, i) => {
    const supplied = args[`scene${i + 1}`];
    if (supplied) return supplied;
    const current = (job.data.mode_videos ?? []) as Array<string | null>;
    return current[i] ?? null;
  });

  const named = Object.keys(args).filter((k) => /^scene\d+$/.test(k));
  if (!named.length) throw new Error("nothing to apply: pass at least one --sceneN=<url>");
  for (const k of named) {
    const n = parseInt(k.replace("scene", ""), 10);
    if (n < 1 || n > total) throw new Error(`--${k}: this job has ${total} scene(s)`);
    if (!/^https?:\/\//.test(args[k])) throw new Error(`--${k} must be a full http(s) URL`);
  }

  const { error } = await supabaseAdmin
    .from("content_jobs")
    .update({ data: { ...job.data, mode_videos: videos } })
    .eq("id", job.id);
  if (error) throw new Error(`update failed: ${error.message}`);

  console.log(`job ${job.id} mode_videos ->`);
  videos.forEach((v, i) => console.log(`  scene ${i + 1}: ${v ?? "(none, will animate or render as still)"}`));
  console.log(`\nStage left at "${job.stage}". Reply \`animate\` in the thread to fill the rest.`);
}

async function main() {
  if (!args.job) throw new Error("--job=<content_jobs id> is required");
  if (cmd === "list") return list();
  if (cmd === "apply") return apply();
  throw new Error("usage: _recover-hook-clips.ts list|apply --job=<id> [...]");
}

main().catch((e) => {
  console.error("ERROR:", (e as Error).message);
  process.exit(1);
});
