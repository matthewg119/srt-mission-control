# B-roll Library — the `broll_suggestions` drop

Reference for the daily B-roll drop that runs for any vertical wired with
`drop_mode = "broll_suggestions"` (today: `medspa_owner_ai`). The generator lives in `src/lib/reel/broll-suggestions.ts`; the shot vocabulary lives
in `src/config/shot-grammar.ts`. The narrative is always the same: **when someone in her city
asks AI where to go, this local clinic is not in the answer — the chains are.**

## Cadence
- The `prompt-drop` cron fires 3×/day (13:30 / 16:30 / 21:30 UTC → morning / midday / evening).
- The `reference-ask` cron fires once at 13:00 UTC, 30 min ahead of the morning drop.
- Each drop posts **3 ideas**. Idea 1 is always the **hero** (her client mid-treatment); the
  rest are documentary clinic shots, and the midday slot swaps the last one for the
  **napkin explainer**.
- Rotation is logged in `broll_drops` so hooks, angles, and every shot axis avoid repeating.

## How a prompt is built (this changed on 2026-08-25)

It used to be three hardcoded mood buckets whose briefs listed the same dozen scenes, with
`vertical.style_token` prepended verbatim to every prompt. Every drop came back as the same
photo: an empty waiting room, muted 35mm, nobody in frame.

Now the **shot is dealt in code** and the model only writes the words:

1. `pickAngles` chooses the narrative angles that have been cold the longest (8 available).
2. `dealHookShot` deals **idea 1**: a treatment or spa ritual from the hook library, assembled
   with `renderHookBrief` and closed with `hookGuards()`. See "The hero frame" below.
3. `dealShots` deals one combination per remaining idea from six axes — subject, capture format,
   light, grade, framing, presence — refusing anything inside that axis's recent window and never
   repeating a value inside one drop.
4. Claude gets the dealt shot as a fixed constraint and returns only `scene_detail` (one
   sentence), the hook, the motion line and the voiceover line. It is told explicitly not to
   write camera, lens, grade or mood words.
5. `assemblePrompt` puts it together: dealt shot → scene detail → guards (`assembleHero` for
   idea 1). The look cannot be flattened back into "cinematic muted 35mm" by a helpful model.

### The axes
| Axis | Count | What it controls |
|---|---|---|
| `SUBJECTS` | 114 | what is in frame, split into the `owner` (54) and `treatment` (60) lanes |
| `CAPTURE` | 11 | how it was shot: phone snapshot, counter edge, off-screen monitor, through glass, long lens, flat lay, doorway, mirror |
| `LIGHT` | 11 | every value is a **lit room**: overcast through the front glass, midday sun, a window wall, bounce off white walls, mirror bulbs, morning sun, LED panel |
| `GRADE` | 9 | uncorrected phone color, clinical white, airy high-key, soft warm-neutral, neutral daylight, sand-and-cream. Muted 35mm is one of nine, not the law |
| `FRAMING` | 8 | macro through ultra-wide, overhead, low angle |
| `PRESENCE` | 9 | nine ways a person is working in frame. There is no "nobody" value |
| `HOOK_TREATMENT_SUBJECTS` | 28 | the hero library: botox, filler, HIFU, laser hair removal, plus twelve spa rituals |
| `HOOK_GRADE` | 3 | muted warm-neutral, muted cool clinical, clean bright airy |

## The hero frame (idea 1, and Hook Studio scene 1)

Added to Hook Studio on 2026-08-26 and to the daily drop on 2026-08-27. Idea 1's job is to say
**who the video is for** before a word of copy is read, and a metaphor cannot do that — a badge
on a back door says nothing about a med spa. It is her own client, mid-treatment: a needle or
laser family (botox, filler, HIFU, LHR) or one of the spa rituals (a clay mask setting, cucumber
slices over closed eyes, a hot towel, a facial massage, an LED mask, gua sha, dermaplaning).

It is the one frame that is **aspirational rather than documentary**, and it carries
`hookGuards()` instead of `shotGuards()`: no `CAMERA_AWARE_BAN`, no `PERSON_LAW`, no
`REALISM_TAIL`, no `AI_TELL_BAN`, no setting law, not the avatar's `image_negative`. Those guards
exist to make a room read as photographed and they actively fight a clean patient portrait.
**Do not put the realism tail back on it.** What it does carry is `NOT_GRAPHIC_BAN`: the syringe
and the handpiece are the point and are never banned; blood, bruising, swelling and
before-and-after splits are.

The hero still carries a narrative angle — the angle steers the on-screen hook and the
voiceover, not the picture. It logs into the same `subject_key` / `grade_key` columns as a
documentary shot (`hookKeys`), and `hookHistoryFrom` reads the two lanes apart again by key
membership, which is why the lane needed no migration.

### The two documentary lanes (ideas 2+)
- **`owner`** — the B2B metaphors, all inside her own building: the front desk, the lobby, the
  doors and the lot directly outside, the back office, the back of house. The test applied to
  every entry: *if it could be photographed at any small business in America, it is out.*
  Pruned again on 2026-08-27 of eight objects of decay (a plant going dry, trash bags at
  closing, mail under the door, a shredder bin, keys dropped at close, receipt tape, a loan
  statement, a cancellation text thread). The belief is *nobody can find her*, not *she has
  already failed*, and a brightly lit shredder bin is still a shredder bin.
- **`treatment`** — the room itself: trays, handpieces, chairs, towels, carts, a massage from
  above, a client reclined seen from the doorway. Reached by the `competitor` and `identity`
  angles. **Never default to injection footage after the hero** — it reads as consumer
  advertising and misses the owner entirely.

## People (the rule that changed twice)

The original law was **no people, ever** — not a face, a body, a pair of hands, a silhouette. It
was meant to stop stock-looking portraits, and it worked, but it left every frame an empty,
perfectly composed room: both the sadness the operator flagged and the clearest tell that an
image was generated.

Now, on ideas 2+: **someone is always in frame and always mid-task.** The PRESENCE axis has no
"nobody" value, and `PERSON_LAW` says it again in words. What is banned is not being visible but
**performing for the lens** (`CAMERA_AWARE_BAN`): no eye contact, no posing, no smiling for it,
no headshots, no staged team portrait. A working face may be turned away, in profile,
three-quarter, or cut by the frame edge.

On the hero, the face is the whole point and the ban is lifted. That reversal is scoped to that
one frame — see above.

## Realism and brightness guards

Every documentary prompt closes with `shotGuards()`:
- **PERSON_LAW** — someone in the frame, mid-task, never an empty room.
- **BRIGHT_LAW** (2026-08-27) — the room is bright, clean and well lit the way a real med spa is:
  white or warm-neutral walls, daylight or clean clinical light, open shadows. Never dark, dim,
  underlit, gloomy or run-down. This exists because pruning the dark values out of `LIGHT` and
  `GRADE` is necessary and not sufficient: asked for "a router on a back-office shelf", a model
  lights it like a crime scene unless it is told not to.
- **REALISM_TAIL** — imperfect framing, subject off-center, something cut off by the edge,
  lived-in detail, fine grain, no perfect symmetry. It used to ask for "clutter, wear,
  fingerprints and scuffs" and "sensor noise in the shadows", which is a request for a grimy
  underlit room dressed up as a realism note. The half that earns its place is the framing.
- **AI_TELL_BAN** — no dust motes in a light beam, no god rays, no teal-and-orange, no glowing
  UI floating in dark space, no lens flares, no glossy stock polish, no cinematic haze, no
  flawlessly tidy symmetrical room. These are named because a model produces every one of them
  by default when asked for "cinematic".
- **CAMERA_AWARE_BAN**, the avatar's `setting_law` and its `image_negative`.

`_probe-shot-variety.ts` fails the build if a dark value ever returns to `LIGHT`, `GRADE` or
`CAPTURE`, or if `shotGuards()` drops `BRIGHT_LAW`.

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
- `bun run scripts/_probe-shot-variety.ts` — offline. Simulates 40 drops (hero + 2 documentary
  each) and asserts no axis repeats inside its window, no two look lines are identical, the hook
  reversal stays scoped to the hero, and no dark value has crept back onto an axis. The
  objective test.
- `bun run scripts/_probe-clinic-prompts.ts` — live. Prints every prompt from both lanes for the
  eyeball check. Ideas 2+ must have a person, stay on the premises, avoid performing for the lens
  and carry `BRIGHT_LAW`; idea 1 must be a dealt hero, non-graphic, and carry none of the four
  documentary guards.
