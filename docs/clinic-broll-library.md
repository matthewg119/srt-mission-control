# Clinic B-roll Library — the `broll_suggestions` drop

Reference + few-shot anchor for the daily B-roll drop that runs for any vertical wired with
`drop_mode = "broll_suggestions"` (today: `trt_clinic_ai`). The generator lives in
`src/lib/reel/broll-suggestions.ts`; this doc is the human-readable source of the buckets,
the napkin format, and the example prompts. The narrative is always the same: **when a man
in his city asks AI where to get treated, the local clinic is not in the answer — national
$99/month telehealth is.**

## Cadence
- The `prompt-drop` cron fires 3×/day (13:30 / 16:30 / 21:30 UTC → morning / midday / evening).
- Each drop posts **3 ideas**. Two are always cinematic (buckets *invisible* + *machine*); the
  third is *patient* on the morning/evening slots and the **napkin explainer** on the midday slot.
- Rotation is logged in `broll_drops` so hooks/beliefs don't repeat drop-to-drop.

## The three cinematic mood buckets
Every idea ships as `{ on_screen_hook (≤8 words), image_prompt, motion_prompt }`. Image prompts
render in the clinic style token: *photorealistic cinematic 9:16, muted desaturated grade,
shallow depth of field, 35mm film look, soft natural / cool clinical light, restrained.* Drop
them into Higgsfield/Seedance. `motion_prompt` = one Seedance line, camera/subject motion only,
under 20 words, no em dashes.

**No people, ever.** Not a face, a body, a pair of hands, or a silhouette. The clinic avatar
carries this as `visual_rules` + `image_negative` in `src/config/verticals.ts`, and it is
injected into every image-prompt system prompt. Generated clinic-owner portraits read as stock
and never get used; the empty room and the lit screen carry the point harder. If a human would
be the subject, shoot the object or the room instead. (The napkin explainer below is the one
exception, and only because it is footage the operator shoots himself.)

### 1. "You're invisible" consequence
The cost of not being in the answer. Empty, still, missed-opportunity mood.
- *Empty waiting room* — "Cinematic wide shot of an empty modern medical clinic waiting room, rows of empty chairs, soft afternoon light through blinds, dust particles floating, no people, still and quiet, muted color grade, shallow depth of field, 35mm film look."
- *Aging front-desk phone* — "An empty front desk at a medical practice, a silent telephone sitting on the counter, warm overhead lighting, nobody around, sense of stillness and missed opportunity, cinematic, shallow focus."
- *Exam room, lit and unused* — "An exam room lit and ready with nobody in it, paper on the table unwrinkled, cool clinical light, wide shot holding the emptiness, moody cinematic tone, no people in the image."
- *Reports going cold* — "Close-up of a stack of printed SEO reports on a clinical desk, slightly out of focus, a cold blue monitor glow behind them with nothing legible on screen, no people in the image."

### 2. "The machine decides" abstraction
The AI making the choice; the local clinic stays dark.
- *AI answer streaming* — "Abstract visualization of an AI answering a question, glowing text streaming across a dark screen, clean futuristic UI, blue and white light, one clinic name illuminating brighter than the others in a list, cinematic depth, high detail."
- *Directory of cards* — "A digital directory of medical clinics displayed as floating cards in dark space, most cards dim and grey, a single card lighting up gold and rising forward, sleek modern interface, cinematic lighting."
- *The connection web* — "Close-up of a tangled web of thin white threads on a dark matte surface, each thread connecting small printed index cards face-down, one card in the centre face-up and blank, cool blue-grey light raking from the side, clinical and cold."
- *One dot lit* — "Macro shot of a dense black LED dot grid receding into shadow, a single dot lit warm amber near the centre, everything else dark, cinematic and cold."

### 3. Patient-side wrapper
The moment of intent, told through the device and the room rather than the person.
- *Stoplight search* — "POV from inside a car stopped at a light, a phone in a windshield mount showing a search result, wet street and tail lights blurred beyond the glass, soft daylight, no people in the image."
- *Phone on the empty chair* — "Close-up of a phone lying face-up on an empty waiting-room chair, screen lit, rows of empty chairs blurred behind it, natural window light, cinematic shallow depth of field, no people in the image."
- *Answer outside the door* — "A glowing chat interface panel floating outside a darkened clinic storefront at night, wet pavement reflecting the light, the clinic interior dim behind the glass, no people in the image."

## The napkin explainer (film it yourself)
The cheapest B-roll there is: phone on a tripod pointing straight **down** at a desk, all the
viewer sees is a sheet of paper and your hands with a marker. Narrate while you draw. Ships as
`{ on_screen_hook, sketch_script, voiceover_line }` — no Higgsfield, no actors, no clinic.
- Canonical example: write **"10 blue links"** in a column, cross the whole thing out with one
  stroke, draw a single box next to it and write **"1 AI answer."** The whole point lands in ~8
  seconds with a Sharpie, and the moving hand holds attention.
- Other seeds: "45%" written big with "→ 6% a year ago" struck through beside it; a stick-figure
  clinic with an arrow, then the arrow redrawn to a phone that says "ChatGPT"; the number
  "1.2%" boxed alone on the page.

## Guardrails (enforced in the generator's system prompt)
- **Promise ban:** never patients, appointments, bookings, revenue, or growth. Only claim
  measurable, self-verifiable visibility in AI answers.
- **No jargon:** never "AEO", "GEO", or "AI SEO" in a hook — say "showing up in ChatGPT" /
  "when a man in your city asks AI where to get treated."
- **Register:** cold, dry, operator voice. No hype words, no emojis. Hooks ≤ 8 words.
- **Approved numbers only:** 45% vs 6%; 230M health questions/week; 1.2% (vs 35.9% Google local
  pack); ~85% off-site citations; $99 vs $169+; ~$876M raised by Ro; one clinic per market; the
  2005 Google Maps window (42% click the local pack). No other statistics.
- **Beliefs a hook may open:** 1–5 and 7 (see the 9-belief ladder in the `trt_clinic_ai` seed).
  Belief 9 (urgency) is warm/retargeting only — not in cold B-roll.
