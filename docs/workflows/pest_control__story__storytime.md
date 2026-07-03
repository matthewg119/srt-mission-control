# Storytime

| | |
|---|---|
| id | `pest_control__story__storytime` |
| avatar | pest_control |
| category | story |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2 direct) @ 9:16 — portrait renders 1024x1536 (2:3) |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_control__story__storytime |

## What this is

13s 3-shot storytime: job b-roll carries a first-person story with a twist payoff.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Cinematic documentary b-roll of a real pest job; shots support a spoken story, faces avoided.
2. The three shots escalate: setup, complication, payoff.
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

### Shot 1 — story setup
- image_prompt: Documentary b-roll of a service truck parking at dusk outside a suburban home, porch light on, homeowner silhouette at the door
- animation: Slow roll past the truck toward the porch.
- duration: 4s

### Shot 2 — the complication
- image_prompt: Close documentary b-roll of a flashlight beam over a crawlspace entry with signs of activity, tools laid out on a drop cloth
- animation: Beam settles on the entry, slow creep in.
- duration: 4s

### Shot 3 — the payoff
- image_prompt: Documentary b-roll of the tech's gloved fist bump with the homeowner at the door, evening, job done, bagged debris by the step
- animation: Gentle rise from the bag up to the handshake.
- duration: 4s

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #storytime + #pestcontrol, #contractorstorytime, "the call we almost skipped" trade storytimes
- YouTube: "pest control storytime", "exterminator crazy call story", "crawlspace inspection found" (b-roll style)
- Reddit: r/pestcontrol "worst call" threads (often with clips)

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make documentary b-roll content for a pest control brand. I need REAL reference clips of:
13s 3-shot storytime: job b-roll carries a first-person story with a twist payoff.

My piece has exactly 3 shots. Find footage that covers each:
1. story setup
2. the complication
3. the payoff

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_control__story__storytime.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
