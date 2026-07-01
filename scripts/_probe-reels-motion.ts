// TEMP probe (safe to delete). Isolates ONE question: does Seedance accept a
// Supabase reels-bucket URL (what runAutoReel actually feeds it)? No Soul involved.
//   fetch a plain image -> uploadToReels -> Seedance animate -> mp4
//   MOTION_ENGINE=seedance bun run scripts/_probe-reels-motion.ts
import { uploadToReels } from "@/lib/reel/pov";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { writeFileSync } from "fs";

console.log("1) fetching a plain test image…");
const srcRes = await fetch("https://picsum.photos/720/1280");
if (!srcRes.ok) throw new Error(`source fetch ${srcRes.status}`);
const buf = Buffer.from(await srcRes.arrayBuffer());
console.log("   bytes:", buf.length);

console.log("2) uploading to reels bucket…");
const reelsUrl = await uploadToReels(buf, "image/jpeg");
if (!reelsUrl) throw new Error("uploadToReels returned null");
console.log("   reels url:", reelsUrl);

console.log("3) animating via", process.env.MOTION_ENGINE, "…");
const adapter = getMotionAdapter();
const mp4 = await adapter.animate(reelsUrl, "Slow cinematic drift, subtle natural handheld motion.");
const out = "C:/Users/matth/Desktop/reels-motion-test.mp4";
writeFileSync(out, mp4);
console.log("   ✅ wrote", out, mp4.length, "bytes");
