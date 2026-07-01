// TEMP probe (safe to delete). Generates a FEW real POV pest clips end-to-end,
// bypassing the (currently invalid) Higgsfield Soul by using OpenAI gpt-image-2 stills.
//   gpt-image-2 still -> reels bucket -> seedance_pro animate -> mp4
//   MOTION_ENGINE=seedance bun run scripts/_probe-pov-batch.ts
import { generateImages } from "@/lib/providers/image-gen";
import { uploadToReels } from "@/lib/reel/pov";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { writeFileSync } from "fs";

const STYLE =
  " First-person POV as if recorded on Ray-Ban Meta smart glasses: eye-level head-mounted camera, the wearer's own gloved hands and forearms visible in the lower frame doing the task, mild wide-angle lens, realistic natural daylight, candid authentic real captured footage, not cinematic.";

const SHOTS = [
  {
    name: "baseboard-mist",
    image: "POV crouched at an indoor baseboard, the wearer's gloved hand misting one even line of pest treatment along the wall-floor seam." + STYLE,
    motion: "Steady slow pan along the baseboard as the gloved hand draws the sprayer line; subtle natural head drift.",
  },
  {
    name: "lawn-fogger",
    image: "POV walking across a green suburban lawn at golden hour, the wearer's gloved hand raising a backpack fogger wand as a soft fog rolls out across the grass." + STYLE,
    motion: "Walk forward across the lawn, fog rolling out, gentle handheld bob.",
  },
  {
    name: "porch-webs",
    image: "POV reaching up with a power-duster toward a porch ceiling corner, the wearer's gloved hand clearing thick spider webs away." + STYLE,
    motion: "Reach the duster up to the corner and sweep the webs; slight upward head tilt.",
  },
];

console.log("1) generating", SHOTS.length, "gpt-image-2 stills…");
const stills = await generateImages({
  prompts: SHOTS.map((s) => s.image),
  provider: (process.env.STILL_PROVIDER as "openai" | "elevenlabs" | "higgsfield") || "openai",
  aspect: "reel",
});

const adapter = getMotionAdapter();
const results = await Promise.all(
  SHOTS.map(async (shot, i) => {
    const img = stills[i];
    if (!img) return `${shot.name}: NO STILL`;
    const url = (await uploadToReels(img.buffer, img.mimetype)) ?? img.sourceUrl;
    if (!url) return `${shot.name}: upload failed`;
    console.log(`   [${shot.name}] still -> ${url.slice(0, 70)}… animating`);
    try {
      const mp4 = await adapter.animate(url, shot.motion);
      const out = `C:/Users/matth/Desktop/pov-${i + 1}-${shot.name}.mp4`;
      writeFileSync(out, mp4);
      return `${shot.name}: ✅ ${out} (${mp4.length} bytes)`;
    } catch (e) {
      return `${shot.name}: ❌ ${(e as Error).message.slice(0, 120)}`;
    }
  })
);
console.log("\nRESULTS:\n" + results.join("\n"));
