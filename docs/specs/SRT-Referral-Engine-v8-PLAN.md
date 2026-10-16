# Referral Engine v8: the review stops reading like a form

## ‼️ BUILT 2026-10-13 ON `feat/review-v8`. THIS FILE IS THE PLAN, NOT THE RECORD.

v7 was merged first (PR #42, `866d83f`) and v8 branched off main, which was his call. Six commits,
all 31 CI scripts green on each. **Read the commit messages for what was actually decided**; they
carry the arguments and the reversals. What changed from the plan below:

- **One migration is OWED and must run BEFORE the deploy**: `docs/2026-10-13-review-funnel.sql`.
  PostgREST fails a whole select on one unknown column, so a deploy landing first does not degrade,
  it silences the walk's own storage.
- **Two more of his asks arrived after this file was written** and are built: the retouched review
  is the only copyable panel with the original read-only beside it, and a **Regenerate** button
  cycling alternate carry wordings. The plan's "her version stays the selected panel" invariant is
  therefore REVERSED, recorded in `review-assemble.ts`, `virtual-agent-client.tsx` and probe
  section 5 with both positions.
- **Conversion per step of the walk, per form**, which this file did not cover at all. No new table.
- **Section 1's 24-character cap on our scaffolding rose to 48**, because three carry wordings are
  longer than that. The fence (section 1b) is the real limit and it is tighter.
- **The plan was WRONG about two things.** Reading `referral_invites.channel` / `.sent_at` does NOT
  resolve their `OWED` entries, because `_probe-dead-wires.ts` greps TypeScript and the aggregation
  is in SQL; the entries stay with corrected text. And deleting `promo` does NOT orphan `{days}`,
  because `warm` carries it too.
- **The stars are excluded from the greyed-chip work**, with the reason written beside
  `leaveStars()`: a greyed star row needs a sixth read of `rating` or an edit to one of the five
  pinned expressions, and both fail the gating probe, which is the FTC rail on that surface.
- **Three live defects were found and fixed** on the way, all the same plumbing as the dataset
  work: `attested_at` was null on every row ever written, a private note was silently dropped, and
  the claim page was uncounted. See the Part 7 commit.
- **Still out of scope, deliberately**: the launch-lane referrals panel (five `referral_invites`
  columns stay owed to it), conversion for the demo and preview surfaces (no view counter exists on
  internal hosts), and deleting `src/lib/hub/readability.ts`.

Original plan follows, unedited.

---

Written 2026-10-13, from Matthew's walkthrough of the v7 preview. v7 is on branch
`feat/review-assembler-v7` (commit `56c74aa`), pushed, CI green, not merged.

Run this in a fresh session. Branch off `origin/main` **after v7 lands**, or stack on
`feat/review-assembler-v7`.

---

## What he saw, and the one sentence that explains the whole job

He walked the preview and typed four honest answers. The walkout answer was `Great`. The joined
version gave him back:

> Got botox with sofia today. I wanted to look pretty, and I've never done botox, first time and i
> was nervous about if it would hurt my skin. **Great.** Stop waiting and get it done. You will
> never regret it.

`Great.` sits in the middle of that paragraph as a dead one-word sentence, and it is the reason the
review still reads as a form somebody filled in. v7 refused to touch it **on purpose**, and the
refusal is argued at length in `src/lib/hub/review-assemble.ts`.

**‼️ v8 REVERSES THAT REFUSAL, AND HE REVERSED IT DELIBERATELY.** The original v7 brief said of
one-word answers: *"A joiner that produces 'I started looking because of wrinkles and walked out
feeling good' has invented a sentence around two words. Decide what it does here; most likely,
leave them alone."* v7 left them alone. Having seen the result, his instruction is now the
opposite:

> "where the customer said 'great only' we can add something for that section if the customer is
> not specific we can add context from the same question, how did you feel leaving? 'great' so we
> transform that in the review to 'I felt great after leaving'"

Do not re-derive the v7 position from the comments in the file. **Update the argument, do not
ignore it** — the same discipline v7 applied to v6.

---

## ‼️ THIS IS STILL NOT A REWRITER, AND THE REASON IS LOAD BEARING

The words that turn `Great` into `I walked out feeling great` come from **the question she was
answering**. "How did you feel walking out?" is fixed, sentiment-neutral, identical for every
business, and contains no adjective about her visit. Carrying its own verb back onto her answer
asserts nothing she did not assert.

This is not a new permission. It is the transformation the v7 brief named **by example** in its
MAY ADD list, and `CARRY_WALKOUT` already does it for 2-to-6-word answers. v8 changes two
parameters and nothing about the principle:

1. the floor drops from 2 words to 1, which is the whole of his complaint, and
2. there is a carry for **each** of the four questions instead of only the walkout.

FTC 16 CFR Part 465 and Rytr still bound this. The thing being regulated is a generator producing
*material details unrelated to user input*. A verb lifted from our own fixed question is not a
material detail. An adjective is. Nothing below may add one.

---

## 1. The algorithm

### 1a. A carry template per question

Replace the single `CARRY_WALKOUT` with a table keyed by question. Each template is an exported
literal so the probe can fence it.

| key | the question | dry answer | carried |
|---|---|---|---|
| `motivation` | What made you start looking for a place like this? | `wrinkles` | **I started looking because of** wrinkles |
| `nerves` | What were you nervous about? | `bruising` | **I was nervous about** bruising |
| `walkout` | How did you feel walking out? | `great` | **I walked out feeling** great |
| `friend` | What would you tell a friend who is on the fence about coming in? | `go for it` | **If you are on the fence,** go for it |

**‼️ THE FENCE IS NEW AND IT IS THE BEST PART OF THIS DESIGN.** Every content word in a template
must appear in **that template's own question prompt**, allowing inflection (`start` → `started`,
`feel` → `feeling`), plus a closed list of function words (`I`, `was`, `because`, `of`, `if`,
`you`, `are`, `the`). Check it:

- "I **started looking** because of" ← "What made you **start looking** for a place like this?"
- "I was **nervous about**" ← "What were you **nervous about**?"
- "I **walked out feeling**" ← "How did you **feel walking out**?"
- "If you are **on the fence**," ← "a friend who is **on the fence** about coming in?"

Make that a probe assertion. It means nobody can add `I absolutely loved that {x}` without the
question itself containing "absolutely loved", which it never will. This is strictly tighter than
v7's hand-written banned-word list, and it should sit **beside** that list, not replace it.

The `friend` template is the "If you are on the fence," prefix from his original target output
that v7 declined to build. It is in scope now, by this rule.

### 1b. When a carry fires

Fires when **all** hold:

- 1 to 6 words (was 2 to 6; the floor is the change)
- the whole answer is one sentence (no internal `.`, `!`, `?`)
- the first word is not in `CLAUSE_OPENERS` (she has not already started a clause)
- the answer contains no word in `CONJUNCTIONS`

Otherwise emit her sentence exactly as v7 does. **The conservative default stays the design.**

**‼️ THE CONJUNCTION REFUSAL IS WHAT PROTECTS THE COMPLAINT AND MUST NOT BE RELAXED.** `a bit sore
and the wait was long` contains `and`, so no carry. Without that rule it becomes "I walked out
feeling a bit sore and the wait was long", which routes a fact about the clinic through "feeling"
and recasts it as a mood. Fixture 4 in `scripts/_probe-review-v7.ts` must stay green **unchanged**.
It is the regression guard for this entire feature.

### 1c. The `i` typo

He typed `i was nervous about if it would hurt my skin` and the review printed the lowercase `i`.
MAY ADD covers "obvious typos". Add one narrow rule: a standalone lowercase `i` token becomes `I`.
Only that token, only standalone. It is a visible symmetry win for one line of code.

### 1d. What stays exactly as it is

- The merge of `motivation` + `nerves` with `", and "`, and **only** `and` of the five conjunctions
  the brief allowed. The other four assert contrast or causation she did not assert.
- The lead line.
- Her version is the default panel. The joined one is the option, at every rating.
- Both probe invariants: **nothing invented** and **nothing dropped or moved**.

### 1e. The probe changes this forces

`scripts/_probe-review-v7.ts` is the deliverable, same as last time. Changes:

- **Vocabulary becomes per-key.** A sentence derived from key `K` may use her answer for `K`, plus
  `CARRY[K]`, plus the connectives. Today the pool is global. Per-key is tighter and is the honest
  statement of the rule.
- **New section: each template's content words ⊆ its own prompt's words** (1a above).
- **Fixture 2 inverts.** It currently asserts one-word answers come out *byte for byte what v6
  produced*. It must now assert they come out **expanded**, with the pinned expected string. This
  assertion is the one that proves his complaint is fixed; write it first and watch it fail.
- **Fixture 4 does not change.** If a diff touches it, something is wrong.
- **The panel slice breaks.** Line ~479 uses `className="rev2-rail"` as the end marker and the rail
  is being deleted (section 4). Pick a new end marker.
- **The promise check moves** with the promise (section 4).

---

## 2. The invite flow

### 2a. "Select message style", and two options not four

`INVITE_TEMPLATES` in `src/lib/hub/referral-invite.ts:162` holds four: `promo` (Limited time),
`warm` (Warm), `short` (Short), `intro` (Introduction).

**His call: keep `warm` and `short`. Delete `promo` and `intro`.**

Add a line of copy immediately above the chips reading **"Select message style"**. It is currently
four unlabelled chips with no heading, which is why he could not tell what they were.

**‼️ TRIPWIRE.** `scripts/_probe-referral-invite.ts:251` asserts
`INVITE_TEMPLATES.length >= 3`. Cutting to two fails CI. Loosen it to `>= 2` **and write the reason
beside it**, the way the two assertions loosened on 2026-10-10 were. A silently loosened probe is
worse than no probe.

Deleting `promo` also removes the only template using `{days}`. Check whether the expiry-wording
logic and its probe assertions become dead.

### 2b. The hand-off screen

Today, "Copy the message" copies and the step ends. He wants her held in the frame:

> Copy the message → stays in the same frame →
> "Open your texting app and paste the copied message into your friend's chat. Come back when you
> are finished." → **[ Done ]**

Add a phase to `invitePhase` in `src/app/hub/[host]/reviews/virtual-agent-client.tsx:281`, which is
`"instruct" | "confirm" | "enter" | "send"` today. Add `"handoff"`. `Done` advances the walk.

### 2c. The second friend is gone

**His call: drop the second ask entirely.** One friend per visit.

Removing "That is enough" without this would trap her, because that button is the only exit from
round two. Removing the whole round is the clean version.

Consequences to handle rather than discover:

- `inviteRound` state and every `round === 2` branch come out.
- `codes` mints two codes up front; it needs one.
- `defaultPairOffer` / `clients.review_workflow.referral_offer.default_pair_offer` stops being
  read. **Leave the config key and the column alone**; just stop reading it. Ripping out a config
  key that a clinic may already have set is a separate decision.
- `_probe-referral-invite.ts` has round-two assertions. Expect to edit them.
- The `round` field riding in `offer_snapshot` becomes constant. Fine, but note it.

---

## 3. The chips stay in the transcript, greyed

> "you remove the whole texting buttons after we finish it, make them part as the conversation but
> gray out the options that they didnt pick leaving the button dead but visible in the history"

Today `awaiting` renders the live control set and it vanishes when the step completes, so the
transcript loses the fact that she was ever asked. Change: on answering, push a transcript entry
recording the control set **and which option she picked**, rendered disabled, chosen one solid and
the rest greyed.

Applies to the Yes/No gates, the stars, the message-style chips, and the send buttons.

**‼️ TRIPWIRE, AND IT IS THE FTC RAIL.** `scripts/_probe-review-gating.ts:292` reads `answerGate()`
as a whole function and fails if any of `rev-private`, `privateNote`, `setRevealed`,
`destinations`, `rating`, `store(`, `setAnswers` appears inside it. A transcript push added to
`answerGate` must not reach for `setAnswers`. There is an identical list for `answerRefer()` at
line 388. Keep the push in its own function, outside both.

The underlying rule has not moved: **a chip's text must never become review text.** A greyed chip
in the transcript is display, not an answer. Nothing about this may make a `Yes` assignable to
`ReviewAnswers`.

---

## 4. Delete the readability rail

> "Get rid of the grammaryl tab"

The rail is the `<aside className="rev2-rail">` at `virtual-agent-client.tsx:1631`. Removing it
takes with it: the `analyse` / `mergeMarks` import (line 75), `reading` (363), `highlighted` (871),
the `rail` memo (~882), the transparent-textarea-over-mirror-div trick, and the `.rev2-rail*` and
`.rev-mirror` CSS.

**This is a simplification, not just a deletion.** With no highlight mirror, both panels become
plain textareas, so the side-by-side becomes symmetric. That is the thing he asked for.

**‼️ THE PROMISE COPY LIVES IN THE RAIL AND MUST SURVIVE.** `rev2-rail-foot` carries:

> "We point at what is shaded. We tidy the grammar and join your answers up. We never add words you
> did not say."

Shipping the joiner without a true on-screen promise is a deception problem separate from the
review rule, and it is the condition v7 shipped under. Move it under the two panels, above the
attestation checkbox. Drop the first sentence (nothing is shaded any more) and keep the rest:

> "We tidy the grammar and join your answers up. We never add words you did not say."

Update the assertion in `_probe-review-v7.ts` section 6 to match. It must still fail on the old
"We never write a replacement" wording.

`src/lib/hub/readability.ts` then has no app caller, but `scripts/test-onboarding-artifacts.ts`
(first probe in CI) imports it and asserts it imports nothing and exports no rewriter. **Leave the
module and that probe alone in this commit.** Delete it separately if at all; one commit doing two
things is how the rail's removal gets blamed for an unrelated CI failure.

---

## 5. The claim link: it already works, and the real bug is different

> "what is the link we are giving in the message, we should make it so it gives it to people the
> link of the customer, so this needs to be a part of the onboarding"

**The mechanism exists end to end and the onboarding step exists too.** Do not build a new field.

- `claimUrl(host, code, fallbackOrigin)` at `src/lib/hub/referral-invite.ts:288` builds
  `https://{reviewsHost}/r/{CODE}`.
- `reviewsHost` is read in `src/lib/hub/referral-config.ts:112` from `client_hosts` where
  `kind = 'reviews'`, **and only when `vercel_attached_at` is set**.
- The launch lane already has a `reviews_live` step (`src/config/launch-steps.ts:236`) and its
  verifier at `src/lib/launch/verify.ts:703` already refuses the step until that host is attached.

The vercel.app URL he saw is the **demo** falling back, by design: `/demo/agent` passes
`reviewsHost: null` because the clinic is a literal that does not exist.

**‼️ THE REAL DEFECT IS THAT THE FALLBACK IS SILENT.** If a live clinic's reviews host is not
attached, `claimUrl` quietly falls back to the app's own origin and real patients text their
friends a `mission.srtagency.com` link, vouching for a clinic with an agency URL. Nothing warns
anybody. Two fixes, both small:

1. **Suppress rather than substitute.** With no attached reviews host, do not offer the referral
   step at all. Absent beats wrong, which is the rule this file already applies to destination
   links and to offers.
2. **Show the link on the launchpad.** Render the actual claim URL a patient will send on the
   `reviews_live` step, so it can be eyeballed once before any card is printed.

---

## Order of work

1. The algorithm and its probe (section 1). Write the inverted fixture 2 first and watch it fail.
2. The rail deletion and the promise move (section 4). It unblocks the symmetric layout.
3. The invite flow: two styles, the heading, the hand-off screen, drop round two (section 2).
4. The greyed transcript chips (section 3). Most invasive, most likely to trip the gating probe.
5. The claim-link fallback (section 5). Independent of all of the above.

Run the full CI probe list after each, not at the end:

```
grep -oE "scripts/[a-zA-Z0-9_.-]+\.ts" .github/workflows/checks.yml | sort -u
```

All 31 were green at `56c74aa`. `_probe-review-evidence.ts` is red locally for everybody; it needs
a database and is deliberately not in CI.

## What must not change

- No model, no network, no rewriter in `review-assemble.ts`. v8 is still a table of literals.
- No behaviour varies by star rating, in the joiner or in the panel that offers it.
- Her version stays the selected panel on first render.
- A complaint survives undiluted and in the same position. Fixture 4 is the proof.
