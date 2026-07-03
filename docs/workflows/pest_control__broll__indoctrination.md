# B-roll caption indoctrination

| | |
|---|---|
| id | `pest_control__broll__indoctrination` |
| avatar | pest_control |
| category | broll / indoctrination |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2 direct) @ 9:16 — portrait renders 1024x1536 (2:3) |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__indoctrination |

## What this is

13s 3-shot b-roll belief-shift: six timed captions reframe how homeowners think about pests.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Clean 9:16 b-roll of homes and pest evidence; shots leave clear space for the timed captions.
2. Muted cinematic grade, no faces, no branding.
3. No text, captions, logos, or watermarks inside the image.

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

### Shot 1 — the comfortable lie
- image_prompt: B-roll of a pristine suburban kitchen at morning, sunlight, everything spotless and still
- animation: Slow dolly across the spotless counter.
- duration: 4s

### Shot 2 — the hidden truth
- image_prompt: Macro b-roll of ants moving single-file inside a dark wall void along a wire, dust and insulation fibers
- animation: Macro track along the trail inside the void.
- duration: 4s

### Shot 3 — the reframe
- image_prompt: B-roll of a technician's treated foundation line at golden hour, visible clean barrier band, house glowing behind
- animation: Rise from the barrier band up the facade.
- duration: 4s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #hiddenpests #whatsinyourwalls #macrovideo
- YouTube: "ants inside wall macro", "termite damage behind drywall", "pest evidence homeowners miss"

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make documentary b-roll content for a pest control brand. I need REAL reference clips of:
13s 3-shot b-roll belief-shift: six timed captions reframe how homeowners think about pests.

My piece has exactly 3 shots. Find footage that covers each:
1. the comfortable lie
2. the hidden truth
3. the reframe

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
(For this format the clips must be third-person documentary b-roll with a muted grade — apply points 6-9 only.)
Keep only clips scoring 4+ on at least 7 points (b-roll: 3+ of the 4 applied points).

Return a table: source | link or exact search | shot covered | expected content | score notes.
```

## Tuning

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__indoctrination.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
