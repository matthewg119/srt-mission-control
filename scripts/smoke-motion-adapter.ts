// Smoke test for the swappable motion adapter: animate ONE still into ONE MP4 Buffer.
//   MOTION_ENGINE=veo bun run scripts/smoke-motion-adapter.ts <imageUrl> [motionPrompt]
//
// Proves the still -> MP4-Buffer contract end to end. Default engine is veo (live).
// Needs the selected engine's creds in env (veo: ELEVENLABS_API_KEY).
import { writeFileSync } from "fs";
import { getMotionAdapter } from "../src/lib/reel/motion-adapter";

async function main() {
  const [imageUrl, motionPrompt] = process.argv.slice(2);
  if (!imageUrl) {
    console.error("usage: MOTION_ENGINE=veo bun run scripts/smoke-motion-adapter.ts <imageUrl> [motionPrompt]");
    process.exit(1);
  }

  const engine = process.env.MOTION_ENGINE || "veo";
  const prompt = motionPrompt || "Slow cinematic drift. Photorealistic.";
  console.log(`Motion adapter smoke`);
  console.log(`────────────────────`);
  console.log(`Engine: ${engine}`);
  console.log(`Still:  ${imageUrl}`);
  console.log(`Prompt: ${prompt}`);
  console.log("");

  const adapter = getMotionAdapter();
  const buffer = await adapter.animate(imageUrl, prompt);

  const out = "scratch-motion.mp4";
  writeFileSync(out, buffer);
  console.log(`OK engine=${engine} bytes=${buffer.length} -> ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
