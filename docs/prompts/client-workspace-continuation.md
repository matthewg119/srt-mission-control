# Continuation: the client workspace build, second half

A build prompt for a fresh session. Everything in a **Ground truth** block was measured in the repo
or against production on **2026-09-08** and is quoted, not remembered. Line numbers drift; symbol
names are right.

**Repo:** `Mission control 2.0/srt-mission-control`.
**Branch:** `feat/client-workspace`, in the worktree at `C:/Users/matth/Desktop/Code/_wt-workspace`.
It is **9 commits ahead of `main`** and nothing is pushed or deployed. Run
`git branch --show-current` before every commit.

Read `docs/lanes/CONTRACT.md`, `CLAUDE.md`, and `docs/prompts/client-workspace-and-drafting.md`
before writing code. The first half of that prompt is built; this is the rest of it.

---

## What is already done, so you do not rebuild it

Nine commits, oldest first. Each one is worth `git show`ing before touching the area it covers.

| Commit | What it did |
|---|---|
| `a7ea14a` | The page studio could not hear you. The bot was not a member of `#aeo-seo-page-drafting`, so Slack never delivered the events; and backticked commands did not match. Both fixed, `scripts/_probe-page-studio.ts` checks both. |
| `781f230` | The review tool is a chat. Stars, mic priming, one question at a time, Hemingway word marks, three looks. |
| `ac0b965` | The six review destinations live in one table. SRT chose Trustpilot and there was no box for its link. |
| `a3a4c57` | A screenshot offers three designs; `pick n` stores one and confirms the theme. |
| `c34d508` | `offer_proposed` and `offer_locked`, steps 10 and 23. `clients.offer`. |
| `d30f098` | Two thirds of `question_bank` is extraction debris. `phrase-quality.ts` filters on read. |
| `3e45d42` | `"any"` is not a service. `usableTreatment()` guards the proposal, the lock and the chain. |
| `2691709` | The page studio asks for the offer and the avatar before it asks for a page. |
| `d0a7441` | `scripts/_probe-step-numbers.ts`. Inserting a step moved 54 sentences off by one. |

**Both migrations have been run against production.** `clients.offer` and
`clients.hub_skin_candidates` exist. Do not re-run them; do not write new ones unless a requirement
below needs one.

---

## Ground truth: the step numbers moved, and 49 sentences still say the old ones

`offer_proposed` was inserted at position 10 and `offer_locked` before `call_held`, so
**everything after position 10 shifted by one**. Measured by running `stepNumber()`, not by reading
the array:

```
10 offer_proposed      NEW        13 custom_question_set   was 12
11 avatar_harvest      was 10     14 page_candidates       was 13
                                  15 citation_cleanup_list was 14
16 hub_preview         was 15     19 site_replica          was 18
22 call_booked         was 21     23 offer_locked          NEW
24 call_held           was 22     32 first_page            was 30
                                  41 steps total           was 39
```

> ‼️ **Matthew says he is "parked on step 15". That is now `citation_cleanup_list`.** The step he
> means is `hub_preview`, which is **16**. Talk to him in step KEYS or check the number before you
> use one.

### The task this creates, and it is the first thing to do

```
bun run scripts/_probe-step-numbers.ts --list
```

**49 strings in 12 files name a step by a literal number.** Not comments: strings, in cards, panels
and PDFs. Each one now names a different step than it means, and nothing errors.

```
lib/clients/step-engine.ts                        17
lib/clients/step-verify.ts                          7
lib/reel/workflow-builder.ts                        5   (unrelated lane, check before touching)
app/dashboard/clients/[id]/review-workflow-form.tsx 4
lib/clients/artifacts/call-questions.ts             3
lib/clients/artifacts/custom-question-set.ts        3
lib/clients/artifacts/page-candidates.ts            3
lib/clients/artifacts/call-sheet.ts                 2
lib/clients/hub-setup.ts                            2
app/dashboard/clients/[id]/page.tsx                 1
app/dashboard/clients/[id]/payment-form.tsx         1
lib/clients/listing-read.ts                         1
```

Every fix is the same shape: `` `step ${stepNumber("the_key")}` `` instead of a digit. The probe is
the acceptance criterion; it exits 0 when none is left. **Check `lib/reel/workflow-builder.ts`
first**, because that is the content lane and its "step 3" may be a workflow step rather than a
delivery step, in which case it belongs in the probe's exemption list beside the intake numbering.

---

## What is left to build

### 1. `review` in the page studio: draft a post from a real review

**Decided with Matthew, 2026-09-08: screenshot first, our own tool second.**

Matthew: *"an option within the drafter to create a new post or create from a review where we can
send a screenshot of the review and highlight it in a post."*

> ‼️ **THIS IS LEGAL AND THE DIRECTION OF TRAVEL IS WHY.** FTC 16 CFR Part 465 regulates a tool that
> GENERATES review content a customer did not write. Quoting a review a customer already published,
> verbatim, in the client's own marketing, is ordinary. Build it with the rails this repo already
> uses and say so in the header, because the next person to read it will assume it is the forbidden
> thing.

- **The screenshot lands in a `proposed_*` slot.** The precedent is `src/lib/clients/review-read.ts`,
  which reads review screenshots into `review_audit_rows.proposed` and never into `review_count`.
  A person confirms the quote before it is usable.
- **The quote is filed as evidence, verbatim.** `SourceType` in `src/lib/clients/page-evidence.ts:20-26`
  is `CLIENT_VOICE | CLIENT_DOCUMENT | CLIENT_WEBSITE | FIRST_PARTY_DATA | EXTERNAL_RESEARCH |
  AI_DERIVED`. Add `CUSTOMER_REVIEW`, count it first-party in `isFirstParty()`, so `numberEvidence()`
  gives it an `S`-ref and the gate can check a quoted sentence rests on it.
- **No model edits the review text, ever.** It is quoted or it is not used. `draft-page.ts:1-8`
  forbids folding `review-assemble.ts` into it; nothing here does, and `review-assemble.ts` stays
  un-imported.
- **The second source is `review_tool_submissions.answers`**, once a client's tool is collecting.
  `page-candidates.ts:230-241` already reads them for the `inOwnReviews` signal.

The command goes in `handlePageStudioEvent` above the body-append fall-through, with the same
exactness the offer and avatar commands were forced into (see the warning below).

> ‼️ **A COMMAND ONE CHARACTER TOO LOOSE EATS A SENTENCE AND SAYS NOTHING.** In a studio thread
> anything that is not a command is appended to the page VERBATIM. Two patterns were caught doing
> this on 2026-09-08: `"avatars are hard to write"` matched and captured `"s are hard to write"`,
> and after a lookahead fixed that, `"avatar research takes a while"` captured `"research takes a
> while"`. The argument form needs a colon, and `new` is the one named keyword exception.
> `scripts/_probe-page-studio.ts` holds copies of all three patterns; add yours to it.

### 2. Every button offers its next step

Acceptance criteria, not a nice-to-have, and it is the thing most likely to be skipped.

**The precedent is step 16's card** (`step-engine.ts`, `case "hub_preview"`), which prints the four
`template <name>` options, the screenshot lane, the design preview link, the client preview link and
the confirm link in one card. `designSection()` in `hub-skin.ts` is the newer example of the same
idea: the wording lives in ONE function so the two steps that print it cannot drift.

Done so far: step 34's card, the Review handover panel, the design preview banner, the skin pick
reply, the offer lock reply, the studio's opening card. **Still bare:** most of the other
`instructionsFor` arms, every confirmation in `src/app/api/slack/actions/route.ts` including
`resolveStepCard`, and the refusal renderers `refusalText` / `confirmationText` in
`step-verify.ts`.

Write one helper rather than repeating the shape, and remember a card body over 3,000 characters
fails the whole Slack message, so everything goes through `bodySections()`.

### 3. A channel per client

**Not started.** The full design is in `docs/prompts/client-workspace-and-drafting.md` section 7 and
in the approved plan. The short version, with Matthew's answer:

> *"let us move the board but also let us run manual workflows using onboarding if we want to but
> ideally then after they complete onboarding2 funnel we should create a channel for them"*

- Migration: `clients.ops_channel_id`, `clients.ops_channel_name`. **Not** `slack_channel_id`, which
  is kept deliberately to hold the one channel created before the 2026-08-20 reversal and is
  rendered as "legacy Slack".
- `channelId()` in `step-board.ts` becomes `channelFor(clientId)` returning
  `ops_channel_id ?? SLACK_CLIENT_ONBOARDING_CHANNEL`. That fallback is the "run it in onboarding if
  we want to" half, and it means every existing client keeps working untouched.
- Creation hangs off provisioning in `provision.ts`, private, bot only. A failure is not fatal.
- **Routing must widen with it.** `clientForThread` (`onboarding-docs.ts:47-94`) returns `null` for
  any channel that is not `SLACK_CLIENT_ONBOARDING_CHANNEL`, and `events/route.ts` gates on the same
  constant. Missing this is the failure mode where every step thread in every new channel silently
  stops answering.
- The index is ONE pinned re-rendered message, the `refreshHeader` pattern, never a wall of posts.
- **There is no Slack rate-limit handling anywhere in this repo.** Zero hits for `429`,
  `retry_after`, `ratelimited`. `slackFetch` (`slack-bot.ts:45-69`) needs a `Retry-After` retry that
  still returns `{ok:false}` and still never throws.

### 4. Step 15's card, simplified

**Decided: keep the step and the gating, simplify the card.** No new blocker.

`citation_cleanup_list` printed "0 to correct, 19 not checked" because step 5's manual sweep was
never done. It is empty, not broken. The card should lead with the plain sentence, "nobody has
looked at any of these yet", with a link to step 5, rather than a table whose top line reads as a
clean bill of health. The nineteen-platform breakdown collapses to one line per state; the per-item
detail stays in the PDF.

### 5. Optional, and priced: DataForSEO volume as a column

`src/lib/clients/keyword-set.ts` ranks by market evidence and never calls it "most searched", which
is the decision. If Matthew wants a real number beside a phrase:

`keywords_data/google_ads/search_volume` is **$0.075 per task for up to 1,000 keywords**, so 99
terms is one task, about **$68 a month at thirty onboardings a day**. Add it as a third entry in
`ENDPOINTS` in `src/lib/scraper/dataforseo.ts`, reusing that file's spend-recording discipline
(`task.cost` recorded, never estimated) and its idempotency guard. Behind `KEYWORD_VOLUME_ENABLED`,
off by default. **A term it has no data for reads "no data", never 0.**

---

## Ground truth: things measured on production that you should not re-derive

**The corpus is two thirds debris.** `question_bank` for `aeo-agency-med-spa`, SRT's vertical:

```
451 rows stored
harvest        116 of 145 usable   (80%)
deep_research   56 of 306 usable   (18%)
--------------------------------------
               172 of 451 usable   (38%)
```

`deep_research` is the polluter: URLs glued onto quotes, `【41†L65-L69】` citation markers, headline
fields from a brief, whole paragraphs of prose. `phrase-quality.ts` filters on read and prints what
it dropped. **The extractor still writes them**, so fixing `research-intake.ts` / the deep-research
extraction to apply `isUsablePhrase()` at write time is real remaining work, and when it lands the
read-time filter stays.

**Known residue the filter deliberately does not catch:** `"Brand Authority How much unique,
authoritative detail does AI have?"` and `"Reputation management 03 Do they book you?"` are nav
chrome glued in front of a real question, in a Title-Case shape that is not on the stop list.
Dropping them needs a rule that risks eating real questions; trimming them means deciding where the
market's words start, which is editing the corpus. Left alone on purpose.

**SRT's own intake is thin.** `services.primary_treatment` is **null** and
`ideal_patient.highest_margin` is the string **`"any"`**. That is why `usableTreatment()` exists.
With the guard, the proposal falls through to the services list and reads *"AEO Services for med
spas"*.

**Two probe failures that are NOT from this branch.** `_probe-concierge-lane.ts` fails on
"there is a config to check: 0 rows" and "srt-agency-llc is the owner tenant". `concierge_configs`
has zero rows in the database. Nothing in this branch touches `src/lib/concierge/`. Do not chase it
as a regression; if you fix anything, fix the data.

---

## Invariants. None of these has been loosened and none may be.

No model in the review content path and no recorded voice leaving the device ·
`review_tool_submissions` gains no identifying column · nothing branches on the star rating, and
`_probe-review-gating.ts` subtracts five exact expressions from `review-client.tsx` to prove it ·
`skin.ts` and `skin-vision.ts` carry tokens only; a variation is three token sets and never three
layouts · `verified_source` is `system` or `thread`, no third value, no override · the tool proposes
and a person confirms · ambiguity stays null and says so · one anchor at a time, Slack internal
only, edit anchors and never re-post · `slackFetch` returns `{ok:false}` and never throws · a card
body over 3,000 chars fails the whole message, so use `bodySections()` · the Day 0 wall goes before
`setPublished`, which has one caller · a step must appear LATER in `DELIVERY_STEPS` than everything
in its `blockedBy` · `STEP_VERIFIERS` stays exhaustive · a `---` markdown rule is not a dash · no em
dashes anywhere · **paste every migration as a fenced sql block in chat, never a file path.**

One reversal was made deliberately and is written down in two places: **`pick n` SETS
`theme.confirmedAt`** where every other skin write clears it. The reasoning is in
`confirmSkinPick`'s header and in `docs/2026-09-08-skin-candidates.sql`. Do not extend it to
anything else.

---

## Verification

```
bun run build
bun run scripts/test-onboarding-artifacts.ts          661 checks
bunx tsx scripts/_probe-step-verify.ts
bun run scripts/_probe-step-numbers.ts                 49 offenders, should reach 0
bunx tsx --env-file=.env.local scripts/_probe-review-gating.ts
bunx tsx --env-file=.env.local scripts/_probe-page-studio.ts
bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts    2 known failures, see above
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts
```

> ‼️ Without `--env-file=.env.local` the probes return nothing at all. Not an error. Nothing.

Then prove it on SRT resolved **by slug** (`srt-agency-llc`, never a pinned id; the client was
re-onboarded and the old id is gone):

- `bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts 871f51be-26a1-4a85-a18a-6df0ce82395f`
  currently shows `offer_proposed` green and `offer_locked` refusing. Both should stay that way.
- A review screenshot dropped in a studio thread proposes a quote, waits for a confirmation, and
  drafts a post around it verbatim.
- Every card offers its next step.
- SRT has an internal channel, its board is in it, its index is one pinned message, and
  `#onboarding-srt-aeo` still works for anything run there by hand.

`scripts/_reanchor-board.ts <clientId> [--dry]` posts a card for any step with no live anchor and
refuses a bare `--all`. **`scripts/_reset-client-board.ts` does not exist**, whatever an earlier
prompt said.
