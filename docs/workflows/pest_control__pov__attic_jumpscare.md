# Meta Glasses POV - attic removal (jumpscare)

| | |
|---|---|
| id | `pest_control__pov__attic_jumpscare` |
| avatar | pest_control |
| category | pov / attic_jumpscare |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2) @ 3:4 — hazel renders 2:3, its only portrait |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__pov__attic_jumpscare |

## What this is

13s 3-shot Meta-glasses POV attic reveal: dark climb, the jumpscare find, the cleared attic.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Every frame is first-person POV through Ray-Ban Meta glasses; gloved hands may enter frame, never a face.
2. Real suburban job-site settings, natural daylight, documentary look; no studio lighting.
3. The three shots read as ONE continuous job (same house, same time of day).
4. No text, captions, logos, or watermarks inside the image.
5. Shots 1-2 are dark flashlight-lit attic; shot 3 breaks to bright resolution.
6. Frame like the native Ray-Ban Meta 3:4 portrait capture: eye-height, gaze-centered, subject filling a tall frame.

## Copy structure (the labeled boxes each session fills)

| # | slot | label | shot | in→out | position | guidance |
|---|------|-------|------|--------|----------|----------|
| 1 | `avatar` | Avatar / POV hook | 1 | 0s→4s | upper_middle | Name who this is for or open the POV. |
| 2 | `pain_callout` | Pain callout | 1 | 0.5s→4s | center | One-line pain/curiosity that stops the scroll. |
| 3 | `increase_pain` | Increase pain / escalate | 2 | 4s→8.5s | upper_middle | Twist the knife or raise the stakes. |
| 4 | `logical_reason` | Logical reason | 2 | 4.8s→8.5s | center | The because: why this is real. |
| 5 | `dream_outcome` | Dream outcome / payoff | 3 | 8.5s→13s | upper_middle | The desired result or the reveal. |
| 6 | `cta` | CTA | 3 | 9.5s→13s | lower | Single clear call to action. |

## Render spec

- mode: static_images · duration: 13s · shots: #1 0-4s, #2 4-8.5s, #3 8.5-13s

## Scenes (seed image prompts — sessions regenerate, these define the LOOK)

### Shot 1 — climb into the dark attic
- image_prompt: First-person POV pushing open an attic hatch from a ladder, flashlight beam cutting across insulation and rafters in the dark
- animation: Beam sweeps the rafters as the camera rises through the hatch.
- duration: 4s

### Shot 2 — the find (jumpscare)
- image_prompt: First-person POV flashlight landing on a dense cluster of droppings and a chewed wire along a rafter, insulation pushed into a nest pocket
- animation: Quick whip to the nest pocket, then a slow creep closer.
- duration: 4s

### Shot 3 — cleared and sealed
- image_prompt: First-person POV of the same attic corner cleaned, new insulation batts, sealed entry point patched with metal mesh, work light on
- animation: Steady reveal pan across the cleaned corner to the sealed hole.
- duration: 4s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #atticinspection #rodentremoval #pestcontrolpov
- YouTube: "attic rodent inspection POV", "attic droppings inspection flashlight", "rodent proofing attic before after"
- Reddit: r/pestcontrol attic/rodent threads
- IG/TikTok: #metaglasses #raybanmeta #povglasses (the authentic drift + hand entry, any subject)
- Reddit: r/RayBanMeta raw samples

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make first-person Ray-Ban Meta smart-glasses POV content for a pest control brand. I need REAL reference clips of:
13s 3-shot Meta-glasses POV attic reveal: dark climb, the jumpscare find, the cleared attic.

My piece has exactly 3 shots. Find footage that covers each:
1. climb into the dark attic
2. the find (jumpscare)
3. cleared and sealed

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__pov__attic_jumpscare.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
