// TEMP probe (safe to delete). Runs the REAL one-shot pipeline:
//   Higgsfield Soul still -> upload to Supabase reels bucket -> Seedance i2v -> mp4.
// This replicates exactly what runAutoReel feeds the motion adapter, so it proves
// whether the "Invalid image url" 400 was just a picsum/unsplash artifact.
//
//   MOTION_ENGINE=seedance bun run scripts/_probe-pov-clip.ts
import { generateImages } from "@/lib/providers/image-gen";
import { uploadToReels } from "@/lib/reel/pov";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { writeFileSync } from "fs";

const SOUL = process.env.HIGGSFIELD_SOUL_ID;
const STYLE_TOKEN =
  "First-person POV as if recorded on Ray-Ban Meta smart glasses: eye-level head-mounted camera, the wearer's own gloved hands and forearms visible in the lower frame doing the task, mild wide-angle lens, realistic natural daylight, candid authentic real captured footage.";

const imagePrompt =
  "POV crouched at a baseboard, the wearer's gloved hand misting one even line of pest treatment along the wall-floor seam. " +
  STYLE_TOKEN;
const animationPrompt = "Slow natural head drift; the gloved hand moves the sprayer steadily along the baseboard.";

console.log("1) generating Soul still… soul:", SOUL || "(none)");
const stills = await generateImages({
  prompts: [imagePrompt],
  provider: "higgsfield",
  soulId: SOUL ?? undefined,
  aspect: "reel",
});
const img = stills[0];
if (!img) throw new Error("still generation returned nothing");
console.log("   got still:", img.mimetype, img.buffer.length, "bytes; sourceUrl:", img.sourceUrl?.slice(0, 80));

console.log("2) uploading still to reels bucket…");
const reelsUrl = (await uploadToReels(img.buffer, img.mimetype)) ?? img.sourceUrl ?? null;
if (!reelsUrl) throw new Error("uploadToReels returned null");
console.log("   reels url:", reelsUrl);

console.log("3) animating via", process.env.MOTION_ENGINE, "…");
const adapter = getMotionAdapter();
const mp4 = await adapter.animate(reelsUrl, animationPrompt);
const out = "C:/Users/matth/Desktop/pov-clip-1.mp4";
writeFileSync(out, mp4);
console.log("   ✅ wrote", out, mp4.length, "bytes");
