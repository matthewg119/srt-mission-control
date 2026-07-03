# Before / After Transformation

| | |
|---|---|
| id | `pest_control__before_after__transformation` |
| avatar | pest_control |
| category | before_after / transformation |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2) @ 9:16 — hazel renders 2:3, its only portrait |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__before_after__transformation |

## What this is

13s 3-shot before/after: the visible infestation or damage, the treatment moment, then the SAME angle spotless. The evidence is the subject; the locked repeat angle sells the transformation.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Shot 1 (before) and shot 3 (after) are the SAME location from the SAME camera angle and height - a locked repeat frame; only the pest evidence changes.
2. The evidence is the subject: visible infestation, damage, droppings, nests, trails - never a person.
3. Shot 2 is the work: gloved hands and equipment mid-treatment, documentary and real.
4. Real lived-in homes, natural daylight, documentary grade; no staging, no studio light.
5. No faces or full human figures; gloved hands and forearms at most.
6. No text, captions, logos, or watermarks inside the image.

## Copy structure (the labeled boxes each session fills)

| # | slot | label | shot | in→out | position | guidance |
|---|------|-------|------|--------|----------|----------|
| 1 | `avatar` | Avatar / hook | 1 | 0s→4s | upper_middle | Name who this is for or open the hook. |
| 2 | `pain_callout` | Pain callout | 1 | 0.5s→4s | center | One-line pain/curiosity that stops the scroll. |
| 3 | `increase_pain` | Increase pain / escalate | 2 | 4s→8.5s | upper_middle | Twist the knife or raise the stakes. |
| 4 | `logical_reason` | Logical reason | 2 | 4.8s→8.5s | center | The because: why this is real. |
| 5 | `dream_outcome` | Dream outcome / payoff | 3 | 8.5s→13s | upper_middle | The desired result or the reveal. |
| 6 | `cta` | CTA | 3 | 9.5s→13s | lower | Single clear call to action. |

## Render spec

- mode: static_images · duration: 13s · shots: #1 0-4s, #2 4-8.5s, #3 8.5-13s

## Scenes (seed image prompts — sessions regenerate, these define the LOOK)

### Shot 1 — the BEFORE (locked angle)
- image_prompt: Documentary photo of a kitchen corner baseboard with a visible ant trail and scattered droppings along the caulk line, morning light, eye-level locked angle
- animation: Static hold with a slow subtle push toward the trail.
- duration: 4s

### Shot 2 — the treatment moment
- image_prompt: Gloved hands applying gel bait along the same kitchen baseboard with a precision applicator, equipment case open on the tile floor
- animation: Close working motion following the applicator tip.
- duration: 4s

### Shot 3 — the AFTER (same locked angle)
- image_prompt: The exact same kitchen corner baseboard, spotless and clean, same eye-level locked angle and morning light, no insects anywhere
- animation: Static hold mirroring shot 1, slow settle.
- duration: 4s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #beforeandafter #pestcontrolresults #satisfyingcleaning
- YouTube: "pest control before and after", "infestation cleanup before after", "wasp nest removal before after"
- Reddit: r/pestcontrol result posts (techs post before/after pairs)

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make documentary b-roll content for a pest control brand. I need REAL reference clips of:
13s 3-shot before/after: the visible infestation or damage, the treatment moment, then the SAME angle spotless. The evidence is the subject; the locked repeat angle sells the transformation.

My piece has exactly 3 shots. Find footage that covers each:
1. the BEFORE (locked angle)
2. the treatment moment
3. the AFTER (same locked angle)

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__before_after__transformation.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
