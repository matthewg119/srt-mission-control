# Twenty pages you can see while you write them, and an offer the system can actually ask about

A build prompt for a fresh session, written 2026-09-19 on branch `feat/north-star-2`, measured
against production the same day. Everything below the line marked BUILT was run, not assumed.

**Read first, in this order:**

1. `CLAUDE.md` and `docs/DATA-AND-WORKFLOWS.md`
2. `docs/prompts/2026-09-22-compliance-gate-context-database-and-learning.md`: **BUILT and
   DEPLOYED** (`c5f42d2..9dc9e70`, on `main`). All five migrations applied. The compliance checks,
   `policy_documents`, the Thursday passengers, `publishPage()` and the Approve button are live.
3. `docs/2026-09-22-TESTING.md`, which is how each of those is re-proved.

---

## The ask, verbatim

*"I WANT TO BUILD A DRAFT AND SEE THE PREVIEW INMEDIATELY [THIS DONE 20 TIMES IF WE ARE BUILDING THE
20 PAGES (IDEALLY GET THE 20 HEADLINES FIRST we can get breakdowns per stage of awareness or we can
pick between the subject options from our drafting workflow (PLEASE MAKE SURE THIS ACTUALLY HAPPENS)
once we pick the subjects it generates headlines until we lock 20 of them and then we do the deep
research prompt for all of those 20 headlines (EACH HEADLINE needs to have a main idea, and needs to
know what beliefs it wants to install and what problem the post/page is going to be focused on
(depending on the variables of each post for example a list post vs a comparison post can be
different but we always want to provide value with that and the what the why and the how"*

And: *"auto-post the preview after every draft/edit instead of on demand, route the existing skin
commands into the drafting thread so you can change theme conversationally where you're already
working, and make sure step 21's card carries a preview for every page before the audit."*

---

## ‼️ MOST OF THE SUBJECT-PICKING ALREADY EXISTS. Measure before building a second one.

Matthew wrote "PLEASE MAKE SURE THIS ACTUALLY HAPPENS", which reads as a suspicion that it does
not. Measured 2026-09-19, **it does**, and building a second subject picker is the main risk in
this prompt.

`plan` (`page-plan.ts`, `PLAN_COMMAND`) already proposes **twenty** pages (`PLAN_SIZE = 20`,
`MAX_PER_THEME = 5`), and `formatPlan` already prints, per row: the working title, the target
keyword, the theme, **the awareness entry and target** (`awarenessLine`), the angle, and the magnet
pill. The adjustments already exist and are exact-anchored:

```
plan          propose twenty
plan approve  lock the proposed ones in
plan drop 4   remove one
plan swap 4   replace it with the next best page IN THE SAME THEME
plan edit 4: <title>
plan new      re-propose everything not yet approved
```

So "breakdowns per stage of awareness" and "pick between the subject options" are **built**. What is
missing is everything downstream of the pick.

‼️ **BUILD ORDER: W0 FIRST, THEN W2b, THEN THE REST.** W0 is what makes the research mean anything,
W2b is what lets the gate see it, and together they are the reason twenty pages stop blocking. The
previews and the skin routing are the smallest and can land any time; the headline lock depends on
nothing here. W5 is already mostly done.

---

## ‼️ What is measured, on `srt-agency-llc`, 2026-09-19

```
board         step 10 offer_locked COMPLETE. The cursor is stuck at step 11 avatar_harvest
              (awaiting_me). Step 21 pre_call_pages also awaiting_me. Step 20 review_card_pdf
              is 'running' and may be stuck; check it.
step 11 needs avatar sheet: (20 fields), short offer: (14 fields), beliefs:
step 21 needs beliefs: and NOTHING ELSE at block tier. 6 warnings.
keywords      376 approved and live. Stage 2: 30, stage 3: 340, stage 4: 6.
anchor        stage 4. NOTE: only SIX approved keywords sit at the anchored rung.
headlines     33 written. page_plan 0. page_angles 0. client_pages 0.
emotional     tier vertical_avatar, 22 of the vertical's 47 are med-spa-owner scoped. ok: true.
evidence      7 page_sources, ALL source_type CLIENT_WEBSITE and ALL page_id NULL
              (the client library, which grounds every page).
offer         locked, treatment set, outcome_promise NULL, guarantee NULL, positioning NULL.
fields        73 declared: avatar 43, audience 8, offer 22.
```

‼️ **`headlineKeywordPool` is `[...here, ...rest]`**, so the anchored rung goes FIRST and the other
370 keywords are still in the pool. The six-at-stage-four count does **not** refuse the headline
run. Do not "fix" it.

‼️ **Seven client-library sources is the real throughput limit on twenty pages**, not the drafting.
`no_evidence` passes (library rows ground every page), but `unsupported` and the new
`experience_claims` are **block tier** and compare the draft against those seven rows. A page that
asserts anything specific will block. `ask` in the studio walks `EVIDENCE_TOPICS` and files answers
as sources; dictation into the body is also filed, as `CLIENT_VOICE`. Budget that, or twenty pages
becomes twenty refusals.

---

## W1. Twenty headlines, locked, before any page is drafted

### What exists

Two headline lanes, and they are different on purpose:

| lane | where | what it does |
|---|---|---|
| `headlines` | step 21's thread | 33 candidates at the anchored rung, `headlines pick 4, 9, 12, ...` keeps **seven** |
| `headline N pick K` | the studio / batch | **three** options for ONE planned page (`writeHeadlinesFor`) |

`PRE_CALL_PAGES = 7` (one pillar, six supports) and `PLAN_SIZE = 20`. **That mismatch is the whole
of W1.** The pre-call seven is the subset shown before a call; the plan is twenty.

### What to build

A lock that counts to twenty against the PLAN, not against the pre-call seven.

- After `plan approve`, every approved plan row needs a chosen headline. `writeHeadlinesFor` already
  writes three per row and `used_page_id` already marks them claimed for that row.
- The missing piece is a **card that says how many of the twenty are locked**, and a command that
  walks the unlocked ones. Something like `headlines all` writing three per unlocked row, and the
  existing `headline N pick K` locking each.
- ‼️ **Do NOT change `PRE_CALL_HEADLINES` (33) or `PRE_CALL_PAGES` (7).** Step 21's card and
  `shortlistLines` are built on them, `_probe-headline-first.ts` pins both, and the pre-call seven
  is a real product surface. Twenty is a plan-level count that sits BESIDE it.
- ‼️ **`isQueryShaped` and `unbackedNumbers` still apply to every one of the twenty.** A headline
  lock is not an exemption from the validators, and `client-headlines.ts:105` refuses any figure of
  two or more digits not present in `numberHaystack`.

### ‼️ The idea, the narrative, the indoctrination and the problem. FOUR things, and the code
### currently models three of them wrongly.

**Matthew's model, stated 2026-09-20 and authoritative:**

> *"narrative and indoctrination are 2 different things, narrative comes from the whole angle we are
> using to actually install the beliefs so indoctrination is the stories we use to indoctrinate based
> on the angle of the narrative of the problem and how the problem is corelated with our offer and or
> our services"*

So, in his terms:

| thing | what it is |
|---|---|
| `idea` | the main idea the page argues |
| **`narrative`** | **the whole ANGLE used to install the beliefs.** It comes from the problem |
| **`indoctrination`** | **the STORIES used to indoctrinate**, written from that narrative angle, and they are what correlate the problem to the offer or the service |
| **`problem`** | **what problem this page is focused on.** Its own thing, and the narrative is an angle ON it |

**What the code says today, and it does not match:**

- `page-angles.ts:270` tells the model `"narrative": "the story spine the page runs on"`
- `page-angles.ts:271` tells it `"indoctrination": "the one belief this page has to install to move
  her a stage"`, and `RULES` item 6 repeats that it is **ONE belief, one sentence**
- `angleFaults` enforces `BELIEF_MAX` on it, which is a length that assumes one sentence

‼️ **So the code has the two roughly INVERTED against Matthew's model.** Its `narrative` is the
story (his indoctrination) and its `indoctrination` is a single belief (which in his model is the
OUTCOME of the stories, not the stories). And there is no `problem` anywhere.

### ‼️ DO NOT SILENTLY REPURPOSE THE STORED COLUMNS

`page_angles` rows already exist carrying the OLD meanings, and `capturePage` has snapshotted
them into `page_dataset`. Changing what a stored column means, in place, re-files every existing
answer under a new definition, silently and permanently. That is the same hazard
`RESEARCH_SECTION_KEYS` carries and the reason the emotional section was appended rather than
inserted.

**Three options. Pick one and say which:**

1. **Add `problem` and leave the other two alone.** Smallest, honest, and the prompt wording for
   `narrative` and `indoctrination` stays wrong.
2. **Add `problem`, and re-word the PROMPT for the other two without renaming the columns**, so new
   rows carry Matthew's meaning while old rows keep theirs. ‼️ Then a reader cannot tell which
   meaning a row holds, which is worse than either meaning being wrong.
3. **Add `problem`, add `stories`, and retire `indoctrination` to "the one belief"**, which is what
   the code already enforces and what `RULES` item 6 describes. Matthew's "stories" become their own
   field, his "narrative" stays the angle, and nothing stored changes meaning.

**Recommendation: option 3.** It is the only one where no existing row changes meaning, it keeps
`BELIEF_MAX` meaningful, and it gives the stories the length they actually need. It costs one
migration and a wider `DraftedAngle`.

Whatever is chosen, `problem` needs a reader before it needs a column: the drafter and the headline
brief are the two candidates. Do not add a column with no reader. That is the mistake this repo has
recorded six times, most recently `client_offers.guarantee`, which had a writer, a reader and no
declared field until 2026-09-19.

### The what, the why and the how, per shape

`src/config/post-formats.ts` already declares, per shape, a `dataset` of the fields that shape must
extract, and `format-dataset.ts` records which of them nobody answered. A `comparison` requires
`subjectA`, `subjectB`, `axes`, `verdictPerAxis`, `overallVerdict`, `whenTheOtherWins`; a `list`
requires `n`, `rankingBasis`, `items`.

**That IS the per-shape "what/why/how" and it is already collected.** What is missing is that
nothing reads `format_dataset.missing` back to the person BEFORE the draft. `page-corpus.ts`
(2026-09-22) aggregates it after the fact. Surface it at draft time instead.

‼️ **Every string in `post-formats.ts` is digit-free and must stay so.** Say "an N", never a numeral.

---

## W2. ONE research prompt for all twenty, and ONE file back

Matthew, 2026-09-20:

> *"the deep research is for all of the posts we are going to create so im sure this can be bundled
> up into one so i Can just drop one file with all the results of all of the main questions we need
> for X specific post, also one answer from another question, might help another question or post
> that has nothing to do with that."*

`batch approve` already "builds the one research prompt" (`page-batch.ts:285`) for a BATCH, which is
a pillar and six supports. Twenty pages is three batches, so today it is three prompts and three
files. He wants one of each.

### ‼️ THE POOLING CONSTRAINT IS THE DESIGN, NOT A NICE-TO-HAVE

*"one answer from another question might help another question or post that has nothing to do with
that."* That sentence rules out the obvious implementation.

**The obvious wrong build** is a prompt sectioned per page, whose answers are filed against the page
whose section they appeared under. That silos every answer to one page, and the answer that would
have carried a different page is unreachable from it. Per-page sections are fine as a way to ASK;
they must not be how the answers are STORED.

**So: the answers are a POOL for the client, and a page draws from the pool.** One file in, many
pages out. The same answer can back page 3 and page 17 and must not be duplicated into both, because
two copies drift and `numberEvidence` would give the same fact two different refs.

‼️ **`page_sources` already has exactly this shape and it is already in use.** A row with
`page_id IS NULL` is the CLIENT LIBRARY, and `page-gate.ts` records that those rows "ground every
later page" and that nothing may clean them up. Measured on `srt-agency-llc`: all seven of its
sources are library rows. **The pool is the client library. It exists. Use it.**

### Numbering, and the trap under it

‼️ **`buildGapPrompt` keeps each section's ORIGINAL number** and tells the reader the numbers are
deliberately non-sequential, because a subset renumbered from 1 files section twelve's answer under
section one, silently and permanently. A twenty-page bundle multiplies that risk: it will want to
number questions per page. **Whatever numbering it emits, the parser that reads the file back must
map every answer to the same key the asker used**, and the probe should prove one round trip.

Decide and say which: does the twenty-page prompt REPLACE the per-batch one, or sit above it? A
second research lane that files to a different place is the thing to avoid.

---

## W0. ‼️ THE RESEARCH ARRIVES AND DIES AS A BLOB. This is the most valuable thing in this prompt.

Matthew, 2026-09-20:

> *"once we paste the deep research the intelligence from my onboarding should read the data and fill
> all of the datasets it has missing as much as possible and for what is not sure simply ask the
> question, before locking it in, it should give me the datasets that is looking to save so i can
> confirm the fears are ok, the offer etc ... allow it to tell me what we are going to fill and if it
> has any suggestion for understanding avatar or the business better to add a new dataset, all of this
> after we paste the deep research prompt to lock in the missing fields"*

### ‼️ What "present" means today, measured

`dataset-spec.ts`'s `section()` resolves a research field to:

```ts
return n > 0 && sectionAnswered(ctx.sections.get(n));
```

and `avatar-profile.ts:169`:

```ts
export function sectionAnswered(section) {
  const body = section.body.replace(/could not verify\.?/gi, "").replace(/\s+/g, " ").trim();
  return body.length >= SECTION_MIN_CHARS;
}
```

**So a research-filled field is "present" when enough CHARACTERS sit under its heading. Nothing
extracts a value, and no value is ever stored per field.**

The consequence is the whole of W0: **the completeness card can report `fears` as filled while
nobody, human or machine, can say what the fears ARE.** Measured on `srt-agency-llc`: one
`deep_research` document, 16,272 characters, `parsed {"answered": 9}`. Nine sections "answered", zero
field values anywhere. `buildFinalPrompt` works around it by pasting whole documents back.

This is why the research feels like it does nothing: it is a character count wearing a dataset's name.

### What to build: propose, confirm, then commit

A paste-time extraction pass, and **nothing writes until a person confirms**. D7 is not decoration
here: this writes into the avatar and offer datasets that every later page argues from.

1. **Extract.** After `research:` parses into sections, run ONE model call that maps sections to the
   declared fields in `DATASET_FIELDS`, returning, per field: the proposed value, the section number
   it came from, and a confidence.
   - ‼️ **ONE call, and the extraction is live code, never stored.** Same rule `harvest.ts` states:
     "What the page SAID is a fact and keeps; what we make of it is recomputed every run." The
     document is already kept in `audience_documents`; re-extracting is cheap and a stored extraction
     freezes the answers to whichever ruleset was current that day.
   - ‼️ **Only fields that are MISSING.** `step-gaps.ts:150`'s "if we already hold it, do not ask for
     it" is the contract, and it applies to filling as much as to asking.

2. **Propose, in a card, before writing anything.** One line per field: the field's label, the value
   it wants to save, and which section it read. Grouped by dataset so he can confirm "the fears are
   ok, the offer is ok" the way he described.
   - ‼️ **A card body over 3,000 characters fails the WHOLE message.** Twenty-plus proposed fields
     will exceed it. Split under 2,900 on line boundaries, the way `rerun-gaps.ts` does.

3. **Ask about what it is not sure of, rather than filling it.** A low-confidence extraction becomes
   a QUESTION on the card, never a value in the proposal.
   - ‼️ **AN ABSENCE AND A GUESS ARE DIFFERENT FACTS, and this is the one place the whole system
     could be poisoned in a single paste.** A field filled with a plausible invention is worse than
     an empty one, because every later page argues from it and nothing downstream can tell it was
     never really answered. When in doubt the answer is the question, not the value.

4. **Commit on confirm.** A button or a typed verb. Only then are the field values written.
   - Per-client values go to the client's own rows. ‼️ **Nothing extracted from one client's research
     may be written into `question_bank` or `avatar_briefs` under a key every other client in the
     vertical reads.** That is the poisoned-corpus failure those tables have no `client_id` to unpick.
   - The same confirm files the research as evidence: see W2b.

5. **Suggest new fields.** He asked for it explicitly, and the mechanism shipped 2026-09-22:
   `dataset_suggestions` proposes a field, argued from a count, and never declares one. When the
   extraction sees something recurring that no `FieldSpec` covers, file a proposal and show it on the
   same card. `dataset-spec.ts` stays the only authority on what exists.

### Where the values live

‼️ **This is the decision W0 turns on, and it must be made before any of it is built.** Today there
is no per-field storage for research answers at all: the document is the storage and `present()` is a
character count.

- **Do NOT add 43 columns to a table.** The registry is a registry; the storage should be one
  append-only place keyed by `(client_id, audience_id, field_key)` carrying the value, the section it
  came from, who confirmed it and when.
- Then `present()` for a research field becomes "a confirmed value exists", which is a real answer,
  and the character count can stay as the weaker fallback for documents pasted before this existed.
- ‼️ **Do not silently change what `present()` means for rows that predate it**, for the same reason
  W1 refuses to repurpose `narrative`: every stored report would be re-read under a new definition.

---

## W2b. ‼️ THE RESEARCH IS INVISIBLE TO THE GATE, AND THAT IS THE REAL BUG

Matthew, 2026-09-20:

> *"this is why we do the deep research prompt to make sure we can verify the data we have but If I
> want to approve the data without gating let me bypass this"*

He is right about what the research is FOR, and the system does not currently let it do that job.

**Measured 2026-09-20: `src/lib/clients/research-intake.ts` contains ZERO references to
`page_sources` or `recordSource`.** A pasted deep-research report is written to
`audience_documents` (the client's own copy) and to `avatar_briefs.research_text` (the shared bank),
and **nowhere that the page gate reads.**

Meanwhile `page-evidence.ts:37` already declares `EXTERNAL_RESEARCH` as a `SourceType`, and
`:99` says in writing: *"EXTERNAL_RESEARCH is real evidence and may support a claim, but it is not
the business's own"* voice. **The slot exists, it is documented, and nothing fills it.**

So today: you run the research precisely to verify what you are about to publish, you paste it back,
and then `unsupported` and `experience_claims` block the page because the gate never saw it. The
seven-sources-against-twenty-pages problem is not really about volume. It is this.

### What to build

**File research answers into `page_sources` as `EXTERNAL_RESEARCH`, `page_id IS NULL`** (the client
library pool from W2), with the `source_url` the research cited.

‼️ **ON CONFIRM, NOT ON PASTE. W0 changes this and the order matters.** An earlier draft of this
prompt had the paste file evidence automatically. That contradicts what W0 is for: if a paste writes
evidence before a person has confirmed it, the gate is then verifying pages against text nobody
approved, and the confirmation card is theatre. The same press that commits the field values in W0
step 4 files the evidence. One confirmation, both writes.

- ‼️ **`isFirstParty()` deliberately EXCLUDES `EXTERNAL_RESEARCH`, and that must not be "fixed".**
  Research about the buyer is evidence; it is not the client's own voice. `first_party_ratio` is a
  WARN check and is allowed to notice a page leaning on research. What changes is that
  `no_evidence`, `unsupported` and `experience_claims` can finally SEE it.
- ‼️ **A real customer quote with a URL is `CUSTOMER_REVIEW`, not `EXTERNAL_RESEARCH`.** The analysis
  around it is not. The 2026-09-21 prompt states this and it is the line that keeps
  `first_party_ratio` meaningful.
- ‼️ **A claim with no `source_url` is not evidence.** Do not file a model's unsourced assertion as a
  source: that launders an invention into a citation, which is the exact failure a dangling `S9` ref
  is refused for.

### And the bypass he asked for

`waive: <reason>` already exists (shipped 2026-09-22): it records a verdict row carrying the hash of
the text being waived, appends one `waived` check, posts to `#alerts-infra`, and goes stale the
moment the page is edited. **One press waives every block-tier check.** That IS the bypass, and it
is the right shape: a door with a signature on it, not a switch.

What is missing is that **nothing tells him it exists at the moment he needs it**, and that it is
per page. Two options, and W2b's real fix makes both less necessary:

1. Say so on the refusal (partly done: `page_approve` already offers it when `waivable`).
2. A **client-level "I have approved this data"** stamp, so twenty pages do not need twenty waivers.
   ‼️ Think hard before building this. A blanket per-client bypass is a rail everybody steps over,
   which `page-gate.ts` says is worse than no rail. If it is built, it must carry a reason, a person,
   a timestamp, and it must EXPIRE or go stale on new evidence, exactly as a waiver does.

**Recommendation: build W2b properly first.** If the research reaches the gate, most of the twenty
pages stop blocking because they are genuinely backed, which is better than any bypass.

---

## W3. The preview, immediately, every time

### What exists

- `preview` in a page thread returns `${appUrl()}/dashboard/clients/<id>/preview/<slug>` plus
  whether the page is a draft (`page-studio.ts`, `previewCommand`). **It is manual.**
- Step 21's draft summary already posts a preview URL per page (`pre-call-pages.ts:748`).
- `src/lib/hub/page-preview.ts` exists and its header says `page_publish` is untouched and it never
  calls `setPublished`. **Keep that true.**

### What to build

1. **Auto-post the preview after every write to a page body**: `draft`, `add:`, `replace:`, a voice
   note, and the `polish` apply path. Not after `check`, which already posts a card.
2. ‼️ **ONE preview line per write, not one per message.** The studio appends dictation verbatim and
   a person dictates in bursts; a link under every sentence is how a thread becomes unreadable.
   Debounce, or post it only when the body actually changed length.
3. ‼️ **`appUrl()` NOT a literal.** `page-studio.ts:1425` says a localhost link has already reached a
   production channel once.
4. **Step 21's card carries a preview for every page before the audit**, which is the half
   `pre-call-pages.ts:748` already does for its own summary. Confirm it covers all rows.

### ‼️ CLIENT_LINK_SECRET is UNSET, and that decides which link you can post

`clientPreviewUrl` returns null without it, so cards print "No shareable link could be minted".
The `/dashboard/clients/<id>/preview/<slug>` link above is the INTERNAL board preview and works
today because it sits behind auth. **Client-shareable links need the env var set.** Say which link
each surface posts, and never post an internal link to a client-facing surface.

---

## W4. Changing the theme conversationally, in the drafting thread

### What exists, and it is more than it looks

`src/lib/clients/hub-skin.ts` already owns `template`, `template <name>`, `skin`, `skin reset`, and
**accepts a pasted reference image** to copy a design from (the screenshot lane, live since
2026-09-16: face keys, shape traits, and a pick that writes accent and font to the theme).

‼️ **It is wired to a DESIGN STEP's thread** (`hub-skin.ts:506`), not to the page studio.

### What to build

Route the existing grammar into `handlePageStudioEvent`. **Import it; do not restate it.** A second
copy of `template <name>` in the studio is how the two start disagreeing about what a template is.

- ‼️ **Anchored at both ends, above the body append.** `skin` and `template` are both ordinary words
  in a channel about writing pages: "skin tightening" and "template for the intake form" must reach
  the page verbatim. `_probe-page-studio.ts` holds dictation fixtures for exactly this class and a
  new verb must add its own.
- ‼️ **The theme is per CLIENT, the session is per PAGE.** Changing the skin from a page thread
  changes every page on that client's hub. Say so in the reply, or somebody will think they restyled
  one page.

---

## W5. The offer context, and what is already declared

‼️ **Most of Matthew's list was already declared. Check before adding.** Measured against the 73
fields on 2026-09-19:

| asked for | status |
|---|---|
| guarantees | **DECLARED 2026-09-19** (`offer.guarantee`). It had a column, a `guarantee:` command and a reader, and no field, so nothing ever asked |
| the pain / problem we solve | `avatar.pain_points` ✓, `avatar.cost_of_inaction` ✓ |
| ideal outcome | `offer.outcome_promise` ✓, `avatar.desires` ✓, `avatar.long_term_aspirations` ✓ |
| fears | `avatar.fears` ✓, `avatar.emotional_drivers` ✓ |
| objections | `offer.objections` ✓, `offer.belief_chains` ✓ |
| "suggest important variables if it finds any" | **`dataset_suggestions` shipped 2026-09-22.** It proposes a field, argued from a row count, and never declares one |

**So W5 is mostly wiring, not schema.** The real work:

1. `dataset_suggestions` currently argues only from `format_dataset.missing` per shape. Widen what it
   argues from, carefully, and keep every claim tied to a row count. D9 binds hardest here.
2. ‼️ **A field is declared in `dataset-spec.ts` or it does not exist.** The `guarantee` bug is the
   cautionary case and it is worth reading the commit: the system USED the field and could not ASK
   for it, which is worse than not having it, because the page prompt took the empty case as an
   answer and said nothing.
3. Before adding any field, grep for the column. Six of these already exist with writers.

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts && bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-policy-scan.ts
bunx tsx scripts/_probe-page-studio.ts
bunx tsx scripts/_probe-datasets.ts
bunx tsx scripts/_probe-headline-first.ts
bunx tsx scripts/_probe-post-formats.ts
bunx tsx scripts/_probe-step-rerun.ts
bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts --model
bun  run --env-file=.env.local scripts/_probe-page-datasets.ts
```

> A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

‼️ `_probe-page-gate.ts` fails **two** checks and both are pre-existing. Confirm the same two.

**The new probe** asserts offline: that `skin` and `template` typed in a page thread are commands
while "skin tightening" and "template for the intake form" are body text; that the preview line is
emitted once per body change and not once per message; that a locked headline still passes
`isQueryShaped` and `unbackedNumbers`; that twenty locked headlines do not change `PRE_CALL_PAGES`
or `PRE_CALL_HEADLINES`; that a research answer with no `source_url` is REFUSED as a source; that a
research answer files as `EXTERNAL_RESEARCH` and is therefore NOT counted by `isFirstParty()`; and
that one answer in the pool can back two different pages without being duplicated; that a
low-confidence extraction is rendered as a QUESTION and never as a proposed value; that nothing is
written before the confirm; and that no extracted per-client value reaches `question_bank` or
`avatar_briefs`.

**The end-to-end test** is `srt-agency-llc` once step 11 is cleared: `plan` proposes twenty with
awareness stages, `plan swap 4` changes a subject, `plan approve` locks them, headlines are written
and locked to twenty, one research prompt covers all of them, and each `draft` posts a preview link
in the thread without being asked.

---

## Rules that have already cost a day each

- **A field is declared in `dataset-spec.ts` or it does not exist.** `guarantee` had a column, a
  command and a reader and could not be asked for.
- **A stored column's MEANING is as load-bearing as its name.** Repurposing `narrative` or
  `indoctrination` in place re-files every existing row under a new definition, silently.
- **Research that the gate cannot see cannot verify anything.** `EXTERNAL_RESEARCH` exists as a
  source type and nothing fills it, which is why backed pages still block.
- **"Present" for a research field is a CHARACTER COUNT**, not a value. A field can read filled
  while nobody can say what is in it.
- **An absence and a guess are different facts.** A field filled with a plausible invention is worse
  than an empty one: every later page argues from it and nothing can tell it was never answered.
- **Nothing extracted from one client's research may reach `question_bank` or `avatar_briefs`.**
  Those have no `client_id` and a wrong write there is not correctable.
- **Never add a column with no reader**, and never a reader with no writer. Six instances recorded.
- One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error. Every new
  read is its own tolerant select.
- **`assertGatePassed` reads ONE row**, and `setPublished` / `assertGatePassed` must each keep
  exactly one caller, both inside `publish-page.ts`. **Do not write either call out in full in a
  comment**: the hole checks grep source as text and a quoting comment counts as a second call site.
- Anchor every new Slack verb at both ends. In the page studio unmatched text is appended verbatim.
- A card body over 3,000 characters fails the WHOLE message. Split under 2,900 on line boundaries.
- Slack rejects a message whose buttons share an `action_id`. Suffix them.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- Write TypeScript containing regexes with the Write tool; heredocs and `sed` mangle escapes, and an
  Edit once wrote a literal NUL byte into `page-gate.ts` as a hash separator.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
