# 3 B-roll META POV Pest Control

| | |
|---|---|
| id | `pest_owner_ai__pov__local_owner_pain_to_cta_hook` |
| avatar | pest_owner_ai |
| category | pov / callout |
| status | active · building · refs 0/3 · approved 0/4 |
| image model | higgsfield-gpt (gpt-image-2) @ 3:4 — hazel renders 2:3, its only portrait |
| song | (none — session asks) |
| editor | https://mission.srtagency.com/dashboard/content-workflows/pest_owner_ai__pov__local_owner_pain_to_cta_hook |

## What this is

13s 3-shot first-person Meta-glasses POV b-roll of real pest-control WORK: three different angles of the job (baseboard treatment, eave/nest work, perimeter barrier) carrying the timed pain-to-CTA copy. The work is the subject - never a person.

## Visual rules (the law — every hook, idea, and image prompt must comply)

1. Every frame is first-person POV through Ray-Ban Meta glasses DOING pest-control work; the camera is the technician's eyes on the job.
2. The subject is always the WORK itself: gloved hands, sprayer wand, baseboards, attic corners, eaves, foundation/perimeter lines, bait stations, visible treatment.
3. Each of the 3 shots is a DIFFERENT angle or job area (low at a baseboard, looking up at an eave, walking the perimeter) - vary the angle and the job, never the subject matter.
4. No faces and no full human figures anywhere; at most gloved hands and forearms entering the frame.
5. BANNED subjects: truck drivers, vehicle interiors or cabs, steering wheels, dashboards, offices, desks, phones, customers, or any non-pest-control subject.
6. No text, captions, logos, or watermarks inside the image.
7. Real suburban job-site settings, natural daylight, handheld documentary look; no studio lighting.
8. Frame like the native Ray-Ban Meta 3:4 portrait capture: eye-height, gaze-centered, subject filling a tall frame.

## Copy structure (the labeled boxes each session fills)

| # | slot | label | shot | in→out | position | guidance |
|---|------|-------|------|--------|----------|----------|
| 1 | `avatar` | Avatar | 1 | 0s→4s | upper_middle | Name who this is for (the owner/operator persona). |
| 2 | `callout` | Hard truth / callout | 1 | 0.5s→4s | center | One-line pain that stops the scroll. |
| 3 | `pain_callout` | Pain callout | 2 | 4s→8.5s | upper_middle | One-line pain that stops the scroll. |
| 4 | `logical_reason` | Logical reason | 2 | 4.8s→8.5s | center | The because: why the pain is real. |
| 5 | `dream_outcome` | Dream outcome | 3 | 8.5s→13s | upper_middle | The desired result in one line. |
| 6 | `cta` | CTA | 3 | 9.5s→13s | lower | Single clear call to action (link in bio). |

## Render spec

- mode: static_images · duration: 13s · shots: #1 0-4s, #2 4-8.5s, #3 8.5-13s

## Scenes (seed image prompts — sessions regenerate, these define the LOOK)

### Shot 1 — baseboard treatment, low indoor angle
- image_prompt: Crouched eye-level POV at a suburban kitchen baseboard in early morning, a latex-gloved right hand guides a slim metal wand tip along the painted white quarter-round molding where it meets worn vinyl tile, a thin steady bead of treatment liquid tracing the seam past a dusty corner joint, scuffed baseboard paint and faint grout lines filling the tall portrait frame, pale warm light filtering from a window off to the left casting soft shadows under the molding.
- animation: The wand tip slowly tracks left along the baseboard while a faint mist drifts upward and settles along the quarter-round molding.
- duration: 2s · [last render](https://gvsborqpkyvhcfrpgagp.supabase.co/storage/v1/object/public/reels/pov/c9cf11d8-a656-4ad7-8303-b290db1e83dd.png)

### Shot 2 — eave nest work, looking up outdoors
- image_prompt: Eye-level gaze tilted sharply upward toward a weathered suburban fascia board, a gloved hand and forearm in a tan nitrile work glove entering the upper portion of the tall portrait frame as the crack-and-crevice extension tip of a compressed-air aerosol wand is pressed firmly into the gap between the fascia and soffit where a papery gray-yellow jacket nest bulges from the shadow, the rough-sawn wood overhang showing peeling white paint and old water stains, a pale early-morning sky fading from soft blue to white filling the background behind the roofline, natural diffused dawn light casting faint shadows across the nest texture, handheld slight camera tilt giving the shot a working documentary feel.
- animation: The gloved hand steadies the crack-and-crevice tip against the nest opening while loose papery nest fibers flutter slightly in the breeze.
- duration: 2s · [last render](https://gvsborqpkyvhcfrpgagp.supabase.co/storage/v1/object/public/reels/pov/0f90d089-7216-4d6b-9452-af514cf8bdeb.png)

### Shot 3 — perimeter barrier, walking angle
- image_prompt: Eye-level POV walking slowly along a weathered concrete slab foundation, a gloved right hand gripping a handheld granule spreader held low and angled against the slab edge, a thin even line of white granules settling into the dew-damp soil, scattered brown oak leaves and sparse crabgrass pressed against the foundation, soft early-morning sidelight raking long shadows across the rough concrete surface and exposing the texture of the treatment line, the suburban lawn and a wood fence panel visible in the shallow background.
- animation: The granule spreader glides steadily forward along the slab edge as granules scatter onto the damp soil in a continuous arc.
- duration: 2s · [last render](https://gvsborqpkyvhcfrpgagp.supabase.co/storage/v1/object/public/reels/pov/d73c8dbf-3a0e-4682-a01f-2d241fbcbd71.png)

## Sourcing (fill this workflow's reference library)

Where to look:
- TikTok/IG: #pestcontrolpov #bluecollartok (work-only b-roll, different angles per clip)
- YouTube: "pest control POV", "exterminator glove cam", "pest tech treating baseboards"
- Reddit: r/pestcontrol raw job clips
- IG/TikTok: #metaglasses #raybanmeta #povglasses (the authentic drift + hand entry, any subject)
- Reddit: r/RayBanMeta raw samples

Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.

Research prompt (paste into Claude/ChatGPT):

```
You are a short-form content researcher. I make first-person Ray-Ban Meta smart-glasses POV content for a pest control brand. I need REAL reference clips of:
13s 3-shot first-person Meta-glasses POV b-roll of real pest-control WORK: three different angles of the job (baseboard treatment, eave/nest work, perimeter barrier) carrying the timed pain-to-CTA copy. The work is the subject - never a person.

My piece has exactly 3 shots. Find footage that covers each:
1. baseboard treatment, low indoor angle
2. eave nest work, looking up outdoors
3. perimeter barrier, walking angle

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

Edit name / description / visual rules / scene prompts / image settings at https://mission.srtagency.com/dashboard/content-workflows/pest_owner_ai__pov__local_owner_pain_to_cta_hook.
When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.
After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).
