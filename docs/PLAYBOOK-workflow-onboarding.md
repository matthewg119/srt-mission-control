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
   it skips hooks and slots your exact words into the boxes.)*
5. The **labeled copy card** posts. Edit with `line N <text>` if needed, then react ✅.
6. **IDEAS GATE** — 3 visual directions post (title + one b-roll gist per shot, matched
   to your copy):
   - `idea 2` (or react ✅ for idea 1) -> locks the direction, paints the picture
   - `more ideas` -> 3 fresh directions
   - `more hooks` -> back up: new hook options for this workflow
7. The **picture card** posts (per-shot image prompts + your text timings). React ✅ ->
   the 3 shot images generate (GPT image model, 3:4). Fix any with `redo N <new prompt>`.
8. **References (once per workflow):** drop 3 files in the thread — screenshots of
   reference reels you like, a competitor example video, and/or the song file all count.
   Then type `finish workflow` -> IN PRODUCTION.
9. `song song_master` (or paste a URL / attach the audio file). Confirm card posts ->
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
