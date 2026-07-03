# PLAYBOOK — Take all 9 workflows LIVE with 4 examples each (one day sprint)

State when this playbook was written (2026-07-03): all 9 former drafts are already
CONFIGURED (script `scripts/configure-draft-workflows.ts` ran) — active, 3 shots / 13s /
6 timed text slots (the Local Owner Pain skeleton), Meta-glasses POV visual rules, images
locked to the GPT image model (`higgsfield-gpt`) at 3:4. What is left per workflow is the
ONBOARDING: 3 reference files -> IN PRODUCTION -> 4 approved renders -> LIVE.

The session flow now has the IDEAS GATE: after the copy is approved you always get
**3 visual directions to pick from before any image generates.**

## The loop (repeat per workflow, ~15 min each once you're warm)

Everything happens in **#content-full**, top level, then in the session thread.

1. `go` -> reply the number for **Pest Control** (or Pest Owner AI).
2. Reply `headline N`, or type your own one-liner (e.g. `wasp season is here`).
3. The **workflow library** posts (descriptions + gate badges). Reply `workflow N`
   for today's target workflow.
4. Vektor builds **hooks FOR that workflow** (grounded in its visual rules).
   Pick with `title N` / `verbal N` / `pov N`, or `hook <your text>`.
   *(Have your own copy already? Paste the whole block (3+ lines) at step 2 or here —
   it skips hooks, fits your words into the boxes, and jumps STRAIGHT to the ideas
   gate: no ✅ needed on the copy card. Bare numbers work at every picker.)*
5. The **labeled copy card** posts (every box filled — mismatched pastes get split/
   condensed to fit). Edit with `line N <text>` anytime; AI-written copy waits for ✅,
   your own pasted copy does not.
6. **IDEAS GATE** — 3 visual directions post (title + one b-roll gist per shot, matched
   to your copy):
   - `idea 2` / bare `2` (or react ✅ for idea 1) -> locks the direction, paints the picture
   - `more ideas` -> 3 fresh directions
   - `more hooks` -> back up: new hook options for this workflow
7. The **picture card** posts (per-shot image prompts + your text timings). React ✅ ->
   the **final prompts card** posts (the EXACT text gpt-image-2 gets, references + rules
   baked in). Review it: `prompt N <new text>` rewrites one, then ✅ -> the 3 shot images
   generate (GPT image model; POV = 3:4, story/b-roll = 9:16). Fix any with
   `redo N <new prompt>` — works before AND after the render card. If the workflow already
   has a song, the render-confirm card posts by itself right after the images; otherwise
   `song <key|url>`.
8. **References are OPTIONAL** — drop screenshots of reels you like / a competitor
   example / the song file in the thread whenever, to progress the `refs N/3` badge.
   `finish workflow` never blocks on them anymore.
9. `song song_master` (or paste a URL / attach the audio file) if it asked. Confirm card ->
   react ✅ -> **render prompt emitted**. That's approved variation **1/4** —
   Slack replies "Onboarding 1/4".
10. **Fast-fill the remaining 3 with remixes** (same images, new narrative — no new
    image credits):
    - `remixes` -> 16 angle previews
    - `remix 3` -> copy card for that angle -> react ✅ -> render prompt -> "Onboarding 2/4"
    - repeat twice more (`remix 7`, `remix 12`, ...) -> at 4/4 the workflow flips **LIVE**
    - want fresh visuals instead? reply `new images` on a remix card — it goes back
      through the ideas gate with the new copy.

Track progress at **mission.srtagency.com/dashboard/content-workflows** — every card
shows `refs N/3` -> `onboarding N/4` -> `★ LIVE`, and clicking a card opens the editor
(prompts, visual rules, image model, timings, galleries, the workflow's mermaid map).

## Today's order (first = your Meta-glasses B-roll request)

| # | Workflow | id (subcategory) | Notes |
|---|----------|------------------|-------|
| 1 | Meta Glasses POV - wasp nest removal | `wasp_removal` | closest to the Local Owner feel; start here |
| 2 | Meta Glasses POV - attic jumpscare | `attic_jumpscare` | dark shots 1-2, bright payoff |
| 3 | Meta Glasses POV - attic regular | `attic_regular` | inspection walkthrough |
| 4 | Meta Glasses POV - spraying indoor | `spray_indoor` | kitchen baseboard arc |
| 5 | Meta Glasses POV - spraying outdoor | `spray_outdoor` | perimeter barrier arc |
| 6 | Meta Glasses POV - vent cleaning | `vent` | blocked vent -> airflow payoff |
| 7 | Day in the Life POV | `day_in_life` | recruiting/authority angle |
| 8 | B-roll caption indoctrination | `indoctrination` | 9:16, belief-shift captions |
| 9 | Storytime | `story` | 9:16, story beats over job b-roll |

## Tuning a workflow's visual identity (do this once per workflow)

The creative director "remembers" a workflow through THREE fields on its row — every
hook, idea direction, and image prompt is generated against them, and they are marked
NON-NEGOTIABLE in the prompts. Edit them at
**mission.srtagency.com/dashboard/content-workflows/<id>** (or tell Claude Code):

1. **Description** — one sentence saying what the video IS and what the subject is
   ("...the work is the subject - never a person").
2. **Visual rules** — the ordered style law. The recipe that fixed the truck-driver
   drift on `3 B-roll META POV Pest Control`:
   - state the camera ("first-person POV through Ray-Ban Meta glasses DOING the work"),
   - state the allowed subjects ("gloved hands, sprayer wand, baseboards, attics,
     eaves, perimeter lines"),
   - demand variety the right way ("each shot a DIFFERENT angle or job area — vary the
     angle and the job, never the subject matter"),
   - **BAN the drift you saw** ("truck drivers, vehicle cabs, dashboards, offices,
     phones, customers"), plus the always-rules (no faces, no text in image, natural
     daylight documentary look).
3. **Scenes** — 3 seed image prompts as concrete examples of the look. Good POV b-roll
   prompt shape: `First-person Meta-glasses POV <angle/position>, <the work happening>,
   <2-3 grounding details>, <light>` — e.g. "First-person Meta-glasses POV crouched low
   at a kitchen baseboard, gloved hand guiding a precision spray wand along the caulk
   line, fine mist visible, tile floor and cabinet kicks in frame".

When a generated image drifts, fix the RULE (add a ban), not just the one image — the
next session inherits it. That is the whole systemization.

## Guardrails

- Images: ALWAYS the GPT image model via Higgsfield (`openai/hazel`). If a shot looks
  like Soul (plasticky/stylized), check Vercel logs for `(higgsfield-gpt)` — if it says
  `(higgsfield)`, an env is overriding the default.
- Every workflow's look lives in its **visual rules** (editor page). If a generated
  image drifts (faces visible, studio lighting, text baked in), fix the RULE, not just
  the one image — that is the systemization.
- The example copy baked into each workflow is placeholder; sessions always regenerate
  from your hooks. Fix anything structural (timings, positions, slot labels) once in the
  editor and every future run inherits it.
- `map` in #content-full any time = the full library as an image with gate states.
