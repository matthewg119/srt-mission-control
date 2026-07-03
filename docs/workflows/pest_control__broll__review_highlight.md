# Review Highlight

| | |
|---|---|
| id | `pest_control__broll__review_highlight` |
| avatar | pest_control |
| category | broll / review_highlight |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2) @ 9:16 — hazel renders 2:3, its only portrait |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__review_highlight |

## What this is

13s 3-shot customer-review reel: the review quote leads over warm job b-roll - arrival context, the careful detail work, the happy result at the door.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Warm, authentic job b-roll that a real customer's words sit on top of - trust, not drama.
2. Shot 1 sets context: service truck arriving, tech walking up, morning suburban street.
3. Shot 2 is the care: close detail work done carefully (dusting an eave, sealing a gap), gloved hands ok.
4. Shot 3 is the happy ending: the clean result at the front door, welcoming light, job done.
5. No faces (framing crops at shoulders or shoots from behind); warm natural grade.
6. No text, captions, logos, or watermarks inside the image.

## Copy structure (the labeled boxes each session fills)

| # | slot | label | shot | in→out | position | guidance |
|---|------|-------|------|--------|----------|----------|
| 1 | `avatar` | Review quote (verbatim) | 1 | 0s→4s | upper_middle | The customer's line, word for word, quotes on. |
| 2 | `pain_callout` | Their problem | 1 | 0.5s→4s | center | What they were dealing with before the call. |
| 3 | `increase_pain` | What we found | 2 | 4s→8.5s | upper_middle | The real cause, in one plain line. |
| 4 | `logical_reason` | What we did | 2 | 4.8s→8.5s | center | The fix, no jargon. |
| 5 | `dream_outcome` | The result | 3 | 8.5s→13s | upper_middle | Their outcome in their words if possible. |
| 6 | `cta` | CTA | 3 | 9.5s→13s | lower | Single clear call to action. |

## Render spec

- mode: static_images · duration: 13s · shots: #1 0-4s, #2 4-8.5s, #3 8.5-13s

## Scenes (seed image prompts — sessions regenerate, these define the LOOK)

### Shot 1 — arrival context
- image_prompt: Warm b-roll of a clean service truck parked at the curb of a suburban home, technician walking up the driveway carrying a kit, framed from behind, morning light
- animation: Slow follow up the driveway.
- duration: 4s

### Shot 2 — the careful detail work
- image_prompt: Close warm b-roll of gloved hands carefully sealing a small gap at a home's foundation with precision tools, unhurried and thorough
- animation: Steady close-in on the careful hand work.
- duration: 4s

### Shot 3 — the happy result
- image_prompt: Warm b-roll of a spotless front porch and door at soft evening light, welcome mat neat, house calm and protected
- animation: Gentle push toward the glowing doorway.
- duration: 4s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #customerreview #testimonialvideo #5starreview (home-service reels)
- YouTube: "customer review reel home service", "5 star review video b-roll"
- Your own Google/Yelp reviews - screenshot the QUOTES; the b-roll is arrival/care/result

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make documentary b-roll content for a pest control brand. I need REAL reference clips of:
13s 3-shot customer-review reel: the review quote leads over warm job b-roll - arrival context, the careful detail work, the happy result at the door.

My piece has exactly 3 shots. Find footage that covers each:
1. arrival context
2. the careful detail work
3. the happy result

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__broll__review_highlight.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
