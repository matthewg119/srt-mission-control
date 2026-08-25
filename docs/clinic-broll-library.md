# B-roll Library — the `broll_suggestions` drop

Reference for the daily B-roll drop that runs for any vertical wired with
`drop_mode = "broll_suggestions"` (today: `medspa_owner_ai`). The generator lives in `src/lib/reel/broll-suggestions.ts`; the shot vocabulary lives
in `src/config/shot-grammar.ts`. The narrative is always the same: **when someone in her city
asks AI where to go, this local clinic is not in the answer — the chains are.**

## Cadence
- The `prompt-drop` cron fires 3×/day (13:30 / 16:30 / 21:30 UTC → morning / midday / evening).
- The `reference-ask` cron fires once at 13:00 UTC, 30 min ahead of the morning drop.
- Each drop posts **3 ideas**. Two or three are shot ideas; the midday slot swaps the third
  for the **napkin explainer**.
- Rotation is logged in `broll_drops` so hooks, angles, and every shot axis avoid repeating.

## How a prompt is built (this changed on 2026-08-25)

It used to be three hardcoded mood buckets whose briefs listed the same dozen scenes, with
`vertical.style_token` prepended verbatim to every prompt. Every drop came back as the same
photo: an empty waiting room, muted 35mm, nobody in frame.

Now the **shot is dealt in code** and the model only writes the words:

1. `pickAngles` chooses the narrative angles that have been cold the longest (8 available).
2. `dealShots` deals one combination per idea from six axes — subject, capture format, light,
   grade, framing, presence — refusing anything inside that axis's recent window and never
   repeating a value inside one drop.
3. Claude gets the dealt shot as a fixed constraint and returns only `scene_detail` (one
   sentence), the hook, the motion line and the voiceover line. It is told explicitly not to
   write camera, lens, grade or mood words.
4. `assemblePrompt` puts it together: dealt shot → scene detail → guards. The look cannot be
   flattened back into "cinematic muted 35mm" by a helpful model.

That is 120 subjects × 14 capture formats × 12 lights × 10 grades × 8 framings × 7 presences.

### The axes
| Axis | Count | What it controls |
|---|---|---|
| `SUBJECTS` | 120 | what is in frame, split into the `owner` and `treatment` lanes |
| `CAPTURE` | 14 | how it was shot: phone snapshot, flash, security cam, dashcam, off-screen monitor, long lens, flat lay, disposable |
| `LIGHT` | 12 | overcast, hard noon, sodium lot, one fluorescent tube, screen-only, headlights, mixed white balance |
| `GRADE` | 10 | uncorrected phone color, clinical white, sodium orange, green fluorescent cast. Muted 35mm is now one of ten, not the law |
| `FRAMING` | 8 | macro through ultra-wide, overhead, low angle |
| `PRESENCE` | 7 | nobody (weighted 3×) plus six anonymous fragments |

### The two lanes
- **`owner`** — the B2B metaphors: counters, back rooms, parking lots, paperwork, storefronts,
  a laptop on a kitchen island at 11pm, a competitor's billboard through a car window.
- **`treatment`** — the room itself: trays, handpieces, chairs, towels, carts, a massage from
  above, a client reclined seen from the doorway. Used only by the `competitor` and `identity`
  angles. **Never default to injection footage** — it reads as consumer advertising and misses
  the owner entirely.

## People (the rule that changed)

The old law was **no people, ever** — not a face, a body, a pair of hands, a silhouette. It was
meant to stop stock-looking portraits, and it worked, but it left every frame an empty,
perfectly composed room. That is both the sadness the operator flagged and the single clearest
tell that an image was generated.

Now: **no identifiable faces, ever.** People appear as anonymous fragments the PRESENCE axis
deals — a cropped hand, the back of a head out of focus, a motion-blurred body crossing frame,
legs at the frame edge, a silhouette behind frosted glass, a reflection. Never a portrait,
never eye contact, never a posed subject. Roughly a third of shots still have nobody in them.

## Realism guards

Every prompt closes with `shotGuards()`:
- **REALISM_TAIL** — imperfect framing, subject off-center, something cut off by the edge, real
  clutter and wear, sensor noise in the shadows, mixed white balance, no perfect symmetry.
- **AI_TELL_BAN** — no dust motes in a light beam, no god rays, no teal-and-orange, no glowing
  UI floating in dark space, no lens flares, no glossy stock polish, no cinematic haze, no
  flawlessly tidy symmetrical room. These are named because a model produces every one of them
  by default when asked for "cinematic".
- **FACE_BAN** plus the avatar's own `image_negative`.

## Grounding on real photos

The `reference-ask` cron asks the operator each morning for 3-5 real reference photos. Anything
dropped in that thread is filed through `saveContentExample` under `broll/owner` or
`broll/treatment` (30 per section, oldest archived past the cap), and `loadReferenceFrames`
feeds them straight back into the next drop's generation call as vision input. Typed
corrections in the same thread become pending `style_rules` behind the usual checkmark.

Grounding beats instructions. The grammar can describe a look; only a real photo tells the
model what real looks like.

## The napkin explainer (film it yourself)
The cheapest B-roll there is: phone on a tripod pointing straight **down** at a desk, all the
viewer sees is a sheet of paper and your hands with a marker. Narrate while you draw. Ships as
`{ on_screen_hook, sketch_script, voiceover_line }` — no generation, no actors, no clinic.
- Canonical example: write **"10 blue links"** in a column, cross the whole thing out with one
  stroke, draw a single box next to it and write **"1 AI answer."** The whole point lands in ~8
  seconds with a Sharpie, and the moving hand holds attention.

## Voiceover

Every idea ships a `voiceover_line` (12-22 words, `[pause]` where the voice should breathe).
Reply **`vo`** in the drop thread and the bot prints the exact lines and the voice id and
stops. Reply **`yes`** and it renders them through ElevenLabs (`eleven_multilingual_v2`) and
uploads `broll_1_vo.mp3` … into the thread. Nothing is spent before the confirmation.
Envs: `ELEVENLABS_API_KEY`, `BROLL_VOICE_ID`.

## Guardrails (enforced in the generator's system prompt)
- **Promise ban:** never patients, appointments, bookings, revenue, or growth. Only claim
  measurable, self-verifiable visibility in AI answers. The inquiry-count guarantee lives in
  the offer for grounding and never in a cold hook.
- **No jargon:** never "AEO", "GEO", or "AI SEO" in a hook — say "showing up in ChatGPT" /
  "when someone in your city asks AI where to go."
- **Register:** cold, dry, operator voice. No hype words, no emojis. Hooks ≤ 8 words.
- **Approved numbers only:** the list lives on the avatar as `approved_numbers` in
  `src/config/verticals.ts`. Every entry carries its source. Med-spa industry figures are
  deliberately absent until one is sourced — never invent a statistic.
- **Beliefs a hook may open:** 1–5 and 7. Belief 9 (urgency) is warm/retargeting only.

## Probes
- `bun run scripts/_probe-shot-variety.ts` — offline. Simulates 40 drops and asserts no axis
  repeats inside its window and no two look lines are identical. The objective test.
- `bun run scripts/_probe-clinic-prompts.ts` — live. Prints every prompt from both lanes for
  the eyeball check and fails on identifiable-person words.
