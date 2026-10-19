# v9 handoff: make the review read like a person wrote it, with a model inside the fence

Written 2026-10-19 for a fresh Claude Code session in this repo.

Branch `feat/review-v8`, PR #43, open and green and not merged. Everything below is on it.

## Read these first, in this order

1. `src/lib/hub/review-assemble.ts` — the assembler. Pure, imports nothing, and a probe asserts it.
2. `scripts/_probe-review-v7.ts` — the executable spec. 31,104 sweep cases. Read the header.
3. `docs/specs/SRT-Review-Algorithm-BRIEF.md` — the divergent-options brief, including six design
   directions. This file is the convergent version of it.

## ‼️ THE ARCHITECTURE DECISION, AND IT REVERSES SOMETHING I SAID TWICE

Earlier in this project I wrote, more than once, that a language model may **never** run at the
moment a patient is looking at the screen. That was too absolute, and acting on it as written would
block the thing Matthew is now asking for. The accurate rule is narrower:

> A model may not be the **last** thing that touches her review.

The danger was never "a model was involved". It is "nobody checked what it produced". We already
own a deterministic checker, and it is the thing the legal posture actually rests on:

- every word in the output is hers, or is in a literal whose every content word appears in the
  question she was answering
- every answer survives as one unbroken run of her words
- nothing she typed is dropped
- a complaint is never carried, softened or absorbed

So the shape to build is **propose, then verify, then fall back**:

```
her answers ──> model proposes a review ──> THE SAME FENCE, run at runtime
                                               │
                                     passes ───┴─── fails
                                        │             │
                                   show it     retry once, then
                                               assembleJoined()
```

If the model's output passes the fence, it is provably no less constrained than the rule table's
output, because it passed the identical test. If it fails, she gets today's review and never knows
a model was involved. The promise under the box stays true either way, and it stays true because a
machine enforces it rather than because a prompt asked nicely.

**This is the only shape that is acceptable.** A model whose output is shown without passing the
fence is the Rytr fact pattern and is not to be built, whatever the prompt says.

### What the model is for

Not variety. Variety is solved: 324 shapes, and the sentence count varies since 2026-10-18. The
model is for **grammar**, which is the thing a word-count heuristic cannot do. See the two defects.

## The two defects to fix, both reproduced

```
bun --no-env-file run scripts/_probe-review-v7.ts     # must stay green throughout
```

### 1. `It hurting` never gets a frame

Her answer to "What were you nervous about?" was `It hurting`. Measured across all 324 shapes it
renders as the bare fragment `It hurting.` every time. With the frame it reads `I was nervous about
it hurting.`, which is correct and is obviously what she meant.

Cause: `canCarry()` refuses any answer whose first word is in `CLAUSE_OPENERS`, and `it` is on that
list. The list exists to stop a double subject (`I walked out feeling I felt fine`), which is real.
But `motivation` and `nerves` end in a preposition and take a noun phrase, where `it hurting` is
exactly right. This is the same class as the `the food` fix already in the file: **a first-word
blacklist is standing in for "is this a finite clause or a phrase?"**

`It hurting` is not a finite clause. `It hurt` would be. The difference is a participle versus a
finite verb, and no list of first words can see it.

### 2. The lead line never changes

`Got {service} with {provider} today.` is byte-identical across all 324 shapes. That was a
deliberate call of mine on the grounds that the two panels must agree on their first sentence; he
has now asked for it to vary, which overrides it.

‼️ **The lead is fenced separately and harder than the carries.** `_probe-review-gating.ts` section
10c holds `LEAD_WITH_PROVIDER` and `LEAD_SERVICE_ONLY` behind a judgement-word list AND a
20-character scaffolding cap, and pins an exact string:

```ts
assembleLead({ service: "lip filler" }) === "Got lip filler today."
```

So variant 0 must stay exactly that. Additional wordings go after it, and each must clear the same
word list and cap. Decide explicitly whether `assemblePlain` (the "What you typed" panel) uses the
varied lead or always variant 0, and write the reason down either way.

## The invariants that must survive, and what enforces them

| invariant | enforced by |
|---|---|
| nothing invented | `_probe-review-v7.ts` vocabulary check + the 31,104 sweep |
| every content word of a frame comes from its own question | section 1b, with a negative control |
| each answer contiguous, nothing dropped | `assertInvariants` |
| a complaint survives at every shape | fixture 4, 324 iterations |
| no behaviour varies by star rating | `_probe-review-gating.ts` sections 1, 1b, 4 |
| the original panel exists and is read-only | section 5 |
| the on-screen promise matches the feature | section 6 |

**If a model is added, every one of these runs on its output at runtime.** The probe then tests the
validator rather than the generator, which is the correct place for it.

## Probe tripwires this work will hit

- `assembleJoined`'s required arity is pinned at 1 with the optional parameter pinned **by name** as
  `variant`. A model path needs a different entry point, not a third parameter.
- `review-assemble.ts` must import nothing, asserted by `scripts/test-onboarding-artifacts.ts`,
  which is the FIRST script in CI. **A model call cannot live in that file.** Put the proposer in a
  new module and keep the assembler pure as the fallback.
- A fourth entry in `HUB_API` (`src/lib/hub/hub-paths.ts`) is needed if the browser calls a new
  route. Read the paragraph above that set before adding one: every addition is a new public
  surface on dozens of domains SRT does not control. Calling from the existing submit route, or
  server-side during render, avoids it.
- `_probe-dead-wires.ts` treats `review_tool_submissions` as zero tolerance. A new column needs a
  reader shipping with it.

## Order of work

1. **Fix defect 1 without a model first.** A small shape test (finite clause versus phrase) fixes
   `It hurting`, `the food` and `too expensive` together, and it is the fallback the model path
   needs anyway. Do not skip it because the model would mask it.
2. **Fix defect 2.** Lead wordings, variant 0 unchanged.
3. **Then the model**, as proposer only, behind the fence, with the rule assembler as fallback.
4. Run the whole CI list after each step, not at the end:
   `grep -oE "scripts/[a-zA-Z0-9_.-]+\.ts" .github/workflows/checks.yml | sort -u`

## What must not change

- No deliberate misspellings, no invented typos, no "make her look like she cannot type". Inserting
  errors she did not make is fabricating her words, and doing it to make the output harder to
  identify as ours is the exact thing the FTC rule and Google's fake-review policy target. Asked
  for on 2026-10-18 and declined.
- Nothing she typed may be dropped, shortened or summarised. The answer dropped could be the
  complaint.
- No connective that asserts a relationship she did not state. `and` asserts addition, which the
  question order already implies. `but`, `so` and `because` assert contrast or causation. If
  contrast is ever wanted, it is a deliberate decision with its own argument, not a widened list.
- One table for every client. No per-clinic wording.
- `docs/2026-10-13-review-funnel.sql` has been run in production. Do not run it again.

---

## COPY THIS INTO THE NEW SESSION

I am continuing work on the AI Referral Engine in this repo, on branch `feat/review-v8` (PR #43,
green, unmerged).

Read `docs/specs/SRT-Review-v9-HANDOFF.md` first, then `src/lib/hub/review-assemble.ts` and
`scripts/_probe-review-v7.ts`.

Two defects, both reproduced and documented in that file:

1. An answer like `It hurting` to "What were you nervous about?" renders as the bare fragment
   `It hurting.` in all 324 shapes, because the first-word blacklist that prevents a double subject
   also blocks the noun-phrase frames. It should read `I was nervous about it hurting.`
2. The opening line `Got {service} with {provider} today.` is identical in all 324 shapes and
   should vary. Variant 0 must stay `Got lip filler today.` exactly, because a probe pins it.

Then add a language model as a PROPOSER ONLY, behind the existing deterministic fence, with the
current rule-based assembler as the fallback when its output fails. The fence is non-negotiable:
every word hers or from her own question, each answer contiguous, nothing dropped, a complaint never
softened. The handoff file explains why this shape is acceptable where shipping raw model output is
not.

Do the non-model grammar fix first; it is the fallback the model path depends on.

All 31 CI scripts must stay green. Run the full list after each step.
