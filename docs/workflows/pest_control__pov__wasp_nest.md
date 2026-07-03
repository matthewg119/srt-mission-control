# Wasp / Hornet Nest Removal (POV)

| | |
|---|---|
| id | `pest_control__pov__wasp_nest` |
| avatar | pest_control |
| category | pov / roof |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2 direct) @ 3:4 — portrait renders 1024x1536 (2:3) |
| song | song_master |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__pov__wasp_nest |

## What this is

(no description yet — set it; it grounds every generation)

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Every frame is first-person POV through Ray-Ban Meta glasses; gloved hands may enter frame, never a face.
2. Real suburban job-site settings, natural daylight, documentary look; no studio lighting.
3. No text, captions, logos, or watermarks inside the image.
4. Frame like the native Ray-Ban Meta 3:4 portrait capture: eye-height, gaze-centered, subject filling a tall frame.

## Scenes (seed image prompts — sessions regenerate, these define the LOOK)

### Shot 1 — reveal the nest (open loop)
- image_prompt: First-person POV through Ray-Ban Meta glasses looking up at a large grey paper wasp nest tucked under a home's roof eave, wasps crawling over it in the afternoon sun, gloved hand entering frame from below
- animation: Slow tilt up the eave to settle on the nest as a few wasps lift off.
- duration: 2s

### Shot 2 — climb the ladder
- image_prompt: First-person POV climbing an aluminium extension ladder toward the roofline of an older suburban home, gloved hands on the rails, nest visible ahead near the gutter
- animation: Hands pull up rung by rung, the nest growing closer in frame.
- duration: 2s

### Shot 3 — bag and remove the nest
- image_prompt: First-person POV sliding a thick contractor bag up and over the wasp nest at the eave, gloved hands sealing it off, wasps scattering
- animation: The bag sweeps up over the nest and cinches closed in one motion.
- duration: 2s

### Shot 4 — clean result
- image_prompt: First-person POV of the now-bare eave where the nest was, clean stucco, sealed bag held up in a gloved hand against a blue sky
- animation: Camera settles on the clean eave, then the bagged nest lifts into frame.
- duration: 2s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #wasptok #waspnestremoval #pestcontrolpov
- YouTube: "wasp nest removal POV", "hornet nest removal glove cam", "wasp nest under eave removal no commentary"
- Reddit: r/pestcontrol wasp posts (techs post raw phone/GoPro clips)
- IG/TikTok: #metaglasses #raybanmeta #povglasses (the authentic drift + hand entry, any subject)
- Reddit: r/RayBanMeta raw samples

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make first-person Ray-Ban Meta smart-glasses POV content for a pest control brand. I need REAL reference clips of:
Wasp / Hornet Nest Removal (POV)

My piece has exactly 3 shots. Find footage that covers each:
1. reveal the nest (open loop)
2. climb the ladder
3. bag and remove the nest

Give me 15-20 specific places to look: exact hashtags, exact YouTube search strings,
exact subreddits or creator accounts. For each, say what I should expect to find and
which shot it covers.

Before I save any clip, score it 1-5 on each point of this visual checklist:
1. True eye-height first-person camera (not chest/body-cam, not hand-level phone, not helmet-high)
2. Portrait 3:4 framing (the native 3024x4032 capture), or cleanly croppable to it — NOT 9:16
3. Micro head-sway: EIS-smoothed organic drift/bob, not locked gimbal, not shaky-cam
4. Hands enter from the BOTTOM of frame naturally when gesturing or working
5. No visible camera, rig, phone, or mirror reveal anywhere in frame
6. Mild edge softness / barrel distortion on wide scenes, sharpest in the center third
7. Flat, slightly desaturated grade; highlights wash slightly in bright light
8. Mixed ambient lighting (never studio-lit); can look flat/HDR-compressed indoors
9. Gaze-centered framing: the subject sits center-frame because the wearer is LOOKING at it
Keep only clips scoring 4+ on at least 7 points (b-roll: 3+ of the 4 applied points).

Return a table: source | link or exact search | shot covered | expected content | score notes.
```

## Tuning

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__pov__wasp_nest.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
