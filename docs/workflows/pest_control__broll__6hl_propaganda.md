# B roll 6 headlines propaganda

| | |
|---|---|
| id | `pest_control__broll__6hl_propaganda` |
| avatar | pest_control |
| category | broll / 6hl_propaganda |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2) @ 9:16 — hazel renders 2:3, its only portrait |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__6hl_propaganda |

## What this is

An 11-second, 3-shot vertical b-roll video using static images that cycles through six headline overlays in a propaganda poster style, moving from pain callout to dream outcome to CTA for a pest control audience.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Shoot every image from a grounded, eye-level or slight low-angle perspective to give scenes weight and authority.
2. Set all scenes in recognizable suburban residential environments during daylight with overcast or flat natural light.
3. Show pest control context in every frame through uniforms, equipment, or visible home exteriors, never abstract or generic settings.
4. Keep the color palette muted and realistic, avoiding stylized filters or heavy post-processing.
5. Never include any text, captions, logos, watermarks, or graphic overlays inside the image.

## Copy structure (the labeled boxes each session fills)

| # | slot | label | shot | in→out | position | guidance |
|---|------|-------|------|--------|----------|----------|
| 1 | `avatar` | Avatar | 1 | 0s→3.5s | upper_side | Name who this is for. |
| 2 | `pain_callout` | Pain callout | 1 | 0.3s→3.5s | upper_middle | One-line pain that stops the scroll. |
| 3 | `increase_pain` | Increase pain / category | 2 | 3.4s→8.3s | center | Twist the knife, make it personal. |
| 4 | `logical_reason` | Logical reason | 2 | 6.4s→8.3s | center | The because: why the pain is real. |
| 5 | `dream_outcome` | Dream outcome | 3 | 8.3s→11.3s | center | The desired result in one line. |
| 6 | `cta` | CTA | 3 | 10.2s→11.3s | lower | Single clear call to action. |

## Render spec

- mode: static_images · duration: 11.3s · shots: #1 0-3.5s, #2 3.4-8.3s, #3 8.3-11.3s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #pestcontrolmarketing #localbusiness b-roll compilations
- YouTube: "pest control b-roll", "home service brand b-roll pack"

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make documentary b-roll content for a pest control brand. I need REAL reference clips of:
An 11-second, 3-shot vertical b-roll video using static images that cycles through six headline overlays in a propaganda poster style, moving from pain callout to dream outcome to CTA for a pest control audience.

My piece has exactly 3 shots. Find footage that covers each:
1. the setup shot
2. the work/complication shot
3. the payoff shot

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__6hl_propaganda.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
