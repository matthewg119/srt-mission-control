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

### The idea, the belief and the problem, per headline

‼️ **Two of the three already exist and are already stored.** `page_angles` carries, per page:
`idea`, `promise`, `narrative`, `indoctrination`, `awareness_entry`, `awareness_target`,
`proof_needed`, `rationale`, `post_format`. So:

- "a main idea" is `page_angles.idea` ✓
- "what beliefs it wants to install" is `page_angles.indoctrination` ✓, and `page-angles.ts` already
  states it is ONE belief, written as a sentence she would have to accept
- **"what problem the page is focused on" has no column.** The nearest is `narrative`. Decide
  whether that IS the problem statement or whether a `problem` column is owed, and say which. Do not
  add a column with no reader: that is the mistake this repo has recorded six times, most recently
  `client_offers.guarantee`, which had a writer, a reader and no declared field until 2026-09-19.

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

## W2. One research prompt for the twenty

`batch approve` already "builds the one research prompt" (`page-batch.ts:285`) for a BATCH, which is
a pillar and six supports. Twenty pages is three batches.

Decide, and say which: does the twenty-page research prompt replace the per-batch one, or sit above
it? ‼️ **`buildGapPrompt` keeps each section's ORIGINAL number** and says in the prompt that the
numbers are deliberately non-sequential, because a subset renumbered from 1 files section twelve's
answer under section one, silently and permanently. Whatever this emits must keep that discipline.

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
`isQueryShaped` and `unbackedNumbers`; and that twenty locked headlines do not change
`PRE_CALL_PAGES` or `PRE_CALL_HEADLINES`.

**The end-to-end test** is `srt-agency-llc` once step 11 is cleared: `plan` proposes twenty with
awareness stages, `plan swap 4` changes a subject, `plan approve` locks them, headlines are written
and locked to twenty, one research prompt covers all of them, and each `draft` posts a preview link
in the thread without being asked.

---

## Rules that have already cost a day each

- **A field is declared in `dataset-spec.ts` or it does not exist.** `guarantee` had a column, a
  command and a reader and could not be asked for.
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
