# Headlines that know the shape, an emotional layer that is this client's, and the field map that ties it together

A build prompt for a fresh session, written 2026-09-18 on branch `feat/north-star-2`, measured
against production the same day. It follows `docs/prompts/2026-09-20-post-formats-and-magnets.md`,
which is **built and committed** (`187e33d`) and whose migration **has been run** (verified: five
columns and two indexes live, `_probe-post-formats.ts --live` 120/120).

**Read first:** `CLAUDE.md`, `docs/DATA-AND-WORKFLOWS.md`, then
`docs/prompts/2026-09-20-post-formats-and-magnets.md`.

**The ask, verbatim:** *"lets make sure we can introduce this to the drafting workflow in a way where
we can select the headlines and draft headlines with our current headline generator model but we can
inject the prompt for that specific comparission subject / context based on the client, offer, stage
of awareness, etc all of the context neccesary to build headlines based on the system we have with
this prompt. Remember if we dont have emotional language of a certain degree for any offer/ avatar,
remember to ask for this, it can be a deep research prompt that I can run online to give it context
extracting the emotional language of that specific client. Exactly I want the deep research prompt to
be generated based on missing fields we want for the whole infrastructure of the data of the avatar
that holds so we can use those datasets throughout our workflow / context database. lets map out all
of this fields and interconnect them throughout the onboarding process for them to have full context
on all the data we need to onboard someone with as much context as possible."*

---

## ‼️ Almost all of this exists. Read this section before building anything.

Three separate machines are already built and already do most of the work. The gaps are small and
specific. **Do not build a second headline engine, a second gap system or a second research lane.**

| The ask | Status | Where |
|---|---|---|
| "draft headlines with our current headline generator model" | **BUILT** | `precall-headlines.ts` writes 33 to a rung; `headlines pick 4, 9, 12, ...` keeps seven |
| "inject the prompt for that specific comparison subject" | **MISSING, and it is one block** | Neither headline file imports `@/config/post-formats`. See W1 |
| "context based on the client, offer, stage of awareness" | **MOSTLY BUILT** | `headlineContext()` already carries business, treatment, positioning, avatar label, voc quotes, approved numbers, beliefs, framework, the rung and the picked angles |
| "if we dont have emotional language ... ask for this" | **BUILT, and it asks the wrong question** | `emotionalLayer()` / `emotionalAskLines()` / `EMOTIONAL_FLOOR = 20`. See W2 |
| "a deep research prompt that I can run online" | **BUILT** | `buildGapPrompt()`, delivered by `prompts` in any thread, answered with `research:` |
| "generated based on missing fields" | **BUILT** | `DATASET_FIELDS` is 71 declared fields; `gapsFrom()` says which are absent; `promptsFromGaps()` turns them into prompts |
| "map out all of these fields and interconnect them" | **BUILT, with holes** | `dataset-spec.ts` + `step-needs.ts`. **24 of 41 steps declare `{kind: "nothing"}`.** See W3 |

---

## What is measured, on `srt-agency-llc`, 2026-09-18

```
offer         treatment ✓   outcome_promise NULL   positioning NULL   guarantee NULL   anchor_stage 4   locked ✓
ladder        5 rungs, beliefs on every one, no riskReversal (correct, there is no guarantee)
audience      vocabulary {} , vocabulary_source 'preset', vocabulary_confirmed_at NULL
keywords      385 approved, 0 with a role
headlines     33
angles        0        page_plan 0        client_pages 0        page_dataset 0
documents     audience_documents: deep_research (pasted, 16,272 chars, parsed {"answered": 9}),
              awareness_ladder (approved)
emotional     question_bank for 'aeo-agency-med-spa': 47 objection_phrase rows
              page_sources CUSTOMER_REVIEW for this client: 0
```

### ‼️ The one finding that matters most

**The emotional gate passes on 47 phrases that are not this client's, while this client's own voice is
entirely absent, and nothing says so.**

`emotionalLayer()` (`precall-headlines.ts:64`) counts `question_bank` rows where
`objection_phrase = true`, filtered **on `vertical` alone**. SRT's vertical carries 47, the floor is
20, so `ok: true` and the headline engine proceeds. Meanwhile:

- `page_sources` with `source_type = 'CUSTOMER_REVIEW'` for this client: **0**, so
  `clientVocQuotes()` (`client-headlines.ts:218`) returns nothing and falls through to the shared bank.
- `client_audiences.vocabulary`: **`{}`**, source `preset`, never confirmed.
- `question_bank` **has no `client_id` and three migration comments defend that**, so it can never
  hold one client's words.
- `ingestEmotional()` writes `avatar: null`, so even a paste lands un-attributed.

So a headline written today for SRT is written against a med-spa-owner objection set harvested for
the vertical, and the prompt's `vocBlock(quotes)` renders empty. The engine's own ask says why this
matters: *"Without them it writes competent copy about the service and nothing in the output says it
was generic."* That sentence is currently true **while the gate reports green**.

> ‼️ A CORRECTION TO CARRY: `ingestEmotional` is NOT an uncalled writer. It is routed at
> `precall-headlines.ts:650` inside `handlePreCallHeadlineReply`, reached from
> `api/slack/events/route.ts:1209`, gated on `stepKey === "pre_call_pages"`, and `isHeadlineCommand`
> covers the `EMOTIONAL` regex. The `emotional:` paste works. What is wrong with it is WHAT IT COUNTS
> and WHERE IT FILES, not that it is unreachable.

---

## W1. The headline generator learns the shape

Today the headline lane knows the rung, the keyword and the angle's `idea` + `indoctrination`. It does
not know whether the page under the headline is a comparison, a list or a teardown, so a comparison
page gets a headline written for a generic answer page and the two argue past each other.

`renderAskedAs(option, format)` (`page-angles.ts:308`) already exists and already renders a shape for
a prompt. **Reuse it.** The angle lane, the outline lane and the magnet lane all inject the shape this
way; the headline lane is the only one of the four that does not.

### The four edits

1. **`pickedAnglesFor()` (`precall-headlines.ts:229`) selects `post_format`.**
   ‼️ **As a SEPARATE, TOLERANT select**, the pattern `page-angles.ts:withPostFormats` and
   `page-plan.ts:withPostFormat` both use. One unknown column fails a whole PostgREST select and the
   existing `try/catch` degrades to `[]`, which would silently drop every angle from the prompt.
2. **Widen the arg.** `generatePreCallHeadlines`'s
   `angles?: Array<{ keyword; idea; indoctrination }>` (`:274`) gains `postFormat`.
3. **Inject.** The angles block (`:318-332`) prints, under each lettered option, the shape's
   `askedAs.shape` and a line about what a headline for that shape has to do. A comparison headline
   names the two subjects or the choice between them; a list headline carries the N and what ranked
   them; a teardown headline quotes the claim being taken apart.
4. **The per-page lane too.** `writeHeadlinesFor` (`page-batch.ts:306`) already holds `row.postFormat`
   and discards it; `generateKeywordHeadlines` (`client-headlines.ts:529`) already appends a per-batch
   block, which is where it goes.

### Rules that bind

- ‼️ **Every string in `post-formats.ts` is digit-free, and the headline validator is why it has to
  stay that way.** `unbackedNumbers` (`client-headlines.ts:105`) refuses any figure of two or more
  digits not present in `numberHaystack`. A "7" in an `askedAs` line is a number the model is invited
  to echo and is then refused for echoing. `_probe-post-formats.ts` asserts this; do not weaken it.
- ‼️ **`isQueryShaped` (`client-headlines.ts:126`) is not negotiable and a shape does not exempt a
  headline from it.** A headline must end in `?` or open in the first person. "Lip filler vs Botox"
  is not a headline in this system however well it reads, and a comparison shape must not be allowed
  to argue its way past that rule.
- **The shape is a CONSTRAINT on the headline, never a template for it.** Do not add a per-shape
  headline pattern with slots. The measured failure this whole lane exists to fix (2026-09-17) is 33
  candidates that all argued the same thing; a per-shape template reproduces it one level down.
- `client_headlines` has **no `post_format` column** and probably does not need one: the shape belongs
  to the page, and the headline reaches the page through `keyword_id`. Add one only if a real reader
  appears, and if you do, use the guarded-spread pattern at `storePreCall` (`:437`).

---

## W2. The emotional layer becomes this client's, and research answers it

Two changes, and the first is four lines.

### W2a. The gate counts the right rows

`emotionalLayer()` currently answers *"does this VERTICAL have twenty objections"*. It has to answer
*"do we have this CLIENT'S buyer in their own words"*. Three sources, in tiers, mirroring
`clientVocQuotes`'s existing two-tier read:

| tier | source | scope |
|---|---|---|
| 1 | `page_sources` where `source_type = 'CUSTOMER_REVIEW'` | this client |
| 2 | `question_bank` where `objection_phrase` **AND `vertical` AND `avatar = <this audience's research_avatar_slug>`** | this vertical + avatar |
| 3 | `avatar_briefs.voc_quotes` via `sharedBankFor()` | this vertical + avatar |

‼️ **Add the `avatar` filter even before you add tier 1.** Today the count is avatar-blind, so one
avatar's objections satisfy another's gate, and `ingestEmotional` writes `avatar: null` so a paste
cannot be attributed either. Both halves are one fix: filter the read, and stamp the write with
`audience.research_avatar_slug`.

‼️ **`EmotionalLayer` must report WHICH tier answered, not just a count.** "47 on file" and "47 on
file, none of them this client's" are different facts and the card has to be able to say the second.
Same doctrine as `cidSource` in the GBP lane and `score_measured` in the scraper lane.

‼️ **Keep it a WARNING, not a wall.** The comment at `:82` records that requiring both objections and
beliefs refused SRT outright and was softened on 2026-09-16 on purpose. Tightening what it counts
while it still only warns is safe; making it block is a separate decision and is Matthew's.

### W2b. The ask becomes a research prompt instead of a paste

`emotionalAskLines()` asks Matthew to type twenty objections from memory. He asked for the opposite: a
prompt he runs online that goes and finds them.

**The whole delivery mechanism exists.** `prompts` in any thread → `gapsFrom()` → `promptsFromGaps()`
→ one Slack message per prompt, each ending in its own `pasteBack` instruction → answered with
`research:` → `ingestResearch()` + `afterResearchPaste()` → filed, and the completeness card posts
back. Nothing about that changes.

**What to add:**

1. **A `SectionSpec` in `SECTIONS` (`deep-research-run.ts`) for the emotional layer.**
   ‼️ **APPEND, NEVER INSERT.** The parser maps section N to `RESEARCH_SECTION_KEYS[N-1]`, so
   inserting renumbers every stored report's sections and silently re-files old answers under new keys.
2. **A `FieldSpec` in `DATASET_FIELDS`** whose `filledBy` is
   `{ kind: "research", sectionKey: "<the new key>", asked: true }` and whose `present()` reads a
   **count** off the snapshot.
   ‼️ **This is the first count-with-a-threshold in the dataset layer.** Every `present()` today is a
   boolean, and the only count-based ones are `> 0`. `EMOTIONAL_FLOOR = 20` currently lives outside
   the registry, in the headline engine. Move the floor into the field, or state in the field's
   comment why it stays where it is; do not leave two floors.
3. **A `GapPromptKey` branch** in `gap-prompts.ts` (`research | avatar_sheet | short_offer |
   necessary_beliefs` today, all four hard-coded at `:188-193`).
4. **`DatasetSnapshot.avatar` gains the count**, filled in `dataset-completeness.ts`'s `avatarState()`,
   scoped by vertical AND avatar, plus the client's own `CUSTOMER_REVIEW` rows.

### The one decision the machinery cannot make for you

**Is the emotional layer per-(vertical, avatar) or per-client?** They are both defensible and the
answer changes where the write goes:

- **Per-(vertical, avatar)** means `question_bank`, which is shared forever and cannot be unpicked.
  It is how the system already thinks, and it means the second med spa inherits the first one's work.
- **Per-client** means `page_sources` (`CUSTOMER_REVIEW`, or a new `collected_via`), which is where
  this client's actual reviews already live and where the first-party floor already counts them.

‼️ **Recommendation: BOTH, in the tiers above, and the research prompt writes to the per-client one.**
The vertical bank is the floor a new client starts from; the client's own words are what makes a page
theirs. Writing research output into `question_bank` would file one client's discovered language under
a key every future client in that vertical reads, which is the exact poisoned-corpus failure
`adoptAuditClassification` was built to prevent.

> ‼️ A research answer filed to `page_sources` is `EXTERNAL_RESEARCH`, which `isFirstParty()`
> deliberately excludes. That is CORRECT and must not be "fixed": research about the buyer is
> evidence, and it is not the client's own voice. If the research surfaces real customer quotes with
> URLs, those are `CUSTOMER_REVIEW` with a `source_url`; the analysis around them is not.

---

## W3. The field map, and the 24 steps that declare nothing

`dataset-spec.ts` is the map and it is good: 71 fields, each with `usedFor`, a `filledBy` that names
what fills it, and an optional `blocks`. `STEP_NEEDS` (`step-needs.ts:142`) is
`Record<StepKey, StepNeed>` so a 42nd step fails the build.

**The hole is that 24 of 41 steps declare `{ kind: "nothing" }`.** That constant requires a sentence
saying why, and the probe prints them, so the backlog is visible rather than hidden. But it means the
gap lane, the rerun-gaps block and the final prompt all have nothing to say about more than half the
board.

**The work here is a census, not a rewrite.** For each of the 24, decide one of:

- it genuinely owes no dataset field (presence screenshots, DNS records, the Day 0 archive), keep
  `{kind:"nothing"}` and sharpen the sentence; or
- it owes fields nobody declared, and those fields are why the later steps guess.

‼️ **Four steps to look at first**, because each is upstream of something that currently guesses:

| step | what it plausibly owes |
|---|---|
| `offer_proposed` | the proposal's own reasoning, which `offer_locked` then overwrites with no record |
| `competitor_shortlist` | who the two subjects of a `comparison` page may be, which W1 needs |
| `review_audit` | the review counts that back a claim, and the client's own review TEXT |
| `presence_sweep_manual` | nothing, probably. Say so properly |

‼️ **The three fields SRT is missing that the headline engine wants and nothing declares as blocking:**
`offer.outcome_promise` is NULL on a LOCKED offer, `offer.positioning` is NULL, and the audience
`vocabulary` is `{}` with source `preset`. `STEP_NEEDS.offer_locked.needs` does list
`offer.outcome_promise`, so the gap lane knows; the lock verifier does not refuse on it. Decide whether
a lock without an outcome promise should be refusable, and say which, because right now the board
reports step 10 complete and the headline engine has no promise to write toward.

### The interconnection, stated once

```
audit ──► clients.vertical_slug / business_type        (adoptAuditClassification, step 2)
          │
          ▼
client_audiences  ◄── avatar_briefs (per vertical+avatar)      (step 8, avatar_confirmed)
   │  vocabulary, buyer nouns, hard lines, research_avatar_slug
   ├──► client_offers (audience_id NOT NULL)                   (steps 9, 10)
   │       treatment, terms, outcome_promise, price, guarantee, positioning, anchor_stage
   │       └──► audience_documents  kind sales_letter | short_offer | necessary_beliefs
   │
   ├──► audience_documents  kind deep_research | avatar_sheet   (step 11, avatar_harvest)
   │       └──► avatar_briefs.research_text / voc_quotes / approved_numbers   (shared bank)
   │
   ├──► question_bank (vertical + avatar, NO client_id)         (step 11)
   │
   ├──► client_keywords (role, awareness stage)                 (step 12, keyword_set)
   │       └──► client_headlines (keyword_id, awareness pair)   (step 21)
   │
   └──► audience_documents  kind awareness_ladder               (step 21)
            └──► page_plan (angle, headline, post_format, theme, role)
                   └──► page_angles (narrative, indoctrination, post_format)
                          ├──► page_magnet_candidates ──► lead_magnets
                          ├──► client_pages ──► page_sources, page_gate_runs
                          └──► page_dataset (the corpus: what it was written FROM)
```

**Everything a page argues is reachable from the audience row.** The two things that are not, and
should be: the client's own emotional language (W2) and the shape a page takes at headline time (W1).

---

## The SQL

‼️ **Verify every column against the live shape before running it**, and run it through the runner:

```
bun run scripts/db.ts --file=docs/2026-09-21-emotional-layer.sql [--dry]
```

‼️ **NOT the Supabase SQL editor.** It runs a pasted file as one implicit transaction, so a
verification SELECT at the foot failing rolls the whole migration back and looks exactly like "the
migration did nothing". The 2026-09-18 migration was run in the editor and DID land; that was luck,
not a reason to do it again.

The shape of what is needed, to be confirmed against the decision in W2:

```sql
-- The emotional layer, recorded per AUDIENCE rather than per vertical, so one client's discovered
-- language is never filed under a key every other client in the vertical reads.
--
-- ‼️ NOTHING IS ADDED TO question_bank. It has no client_id, three migration comments defend that,
-- and a per-client column there would be read by every future client in the vertical.

alter table public.client_audiences
  add column if not exists emotional_source text
    check (emotional_source is null or emotional_source in ('research', 'pasted', 'reviews', 'preset'));
alter table public.client_audiences add column if not exists emotional_checked_at timestamptz;

-- Verify. Expect two rows.
select table_name || '.' || column_name as col, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'client_audiences'
  and column_name in ('emotional_source', 'emotional_checked_at')
order by col;
```

> A count is deliberately NOT stored. It is derived from the three tiers at read time, the same
> reasoning `presence_score` gives for having no column: there is nowhere for a stored number to
> drift away from the rows it claims to summarise.

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts && bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-post-formats.ts
bunx tsx --env-file=.env.local scripts/_probe-post-formats.ts --live
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
bunx tsx --env-file=.env.local scripts/_probe-page-angles.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bun  run --env-file=.env.local scripts/_probe-page-datasets.ts
bunx tsx scripts/_probe-step-rerun.ts
```

> A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

`_probe-page-gate.ts` fails **two** checks today and both are pre-existing (`no evidence at all
blocks`, `an evidenced page passes`). Confirm the same two rather than assuming.

**The new probe** asserts, offline: that a headline prompt built for a `comparison` angle contains
that shape's `askedAs` text and a headline prompt built without a format does not; that
`isQueryShaped` still refuses a bare "X vs Y" whatever the shape; that no string reaching the headline
prompt carries a digit; and that `emotionalLayer` reports its tier. Plus one live check: that the
count is scoped by avatar, proved on a vertical that carries rows for more than one.

**The end-to-end test** is a rerun of step 21 on `srt-agency-llc`: `angles auto` produces shapes,
`angle N pick K` keeps one, `headlines` writes 33 that know the shape, and, with the emotional tiers
in, the card says out loud that 47 phrases are the vertical's and none are this client's.

---

## Rules that have already cost a day each

- **One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather
  than throwing.** Every new read is a separate tolerant select, or it takes a card down.
- **A count that cannot say WHERE it came from is a count that lies.** `47` and `47, none of them
  this client's` are different answers.
- **APPEND to `SECTIONS`, never insert.** Section N maps to `RESEARCH_SECTION_KEYS[N-1]`.
- **`question_bank` has no `client_id` and must not get one.**
- Write TypeScript containing regexes or escapes with the Write tool; heredocs and `sed` mangle escapes.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything through `bodySections()`.
- Slack rejects a message whose buttons share an `action_id`; suffix them and let the dispatcher strip it.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
