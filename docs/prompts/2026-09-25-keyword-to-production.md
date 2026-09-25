# From a keyword to a published page: what is wired, what is not, and what to do before testing live

> **Status, 2026-09-25.** Items 1-5 below are BUILT, on `feat/keyword-decisions` at `fb679ba`.
> The one thing still outstanding is the migration, which is item 1 and has to be run by hand.
> Jump to "The live test, in order" at the bottom.

Written 2026-09-25, after scanning the whole chain on `feat/keyword-decisions` at `6cb3d57`.

---

## First: the order does not need rearranging

I said last night that section 7 "needs a page that does not exist yet". That was wrong in a way
worth correcting, because it made a solved problem look like a structural one.

The page **does** exist by the time it is needed. Here is the actual chain:

| when | what exists | carries the keyword? |
|---|---|---|
| step 12 `keyword_set` | `client_keywords`, `keyword_serp_reads` (scores, shape, fit, asset ideas) | it IS the keyword |
| step 13 `custom_question_set` | the Day 0 measurement set, **frozen** | reads the approved set |
| step 14 `page_candidates` | scored questions | reads the approved set |
| step 21 `pre_call_pages` | **`page_plan` rows**, each with `target_keyword_id` and `magnet_frame` | ✅ `page_plan.target_keyword_id` |
| then | `page_angles` (the idea each page argues), approved | `plan_id` |
| then | `page_magnet_candidates` **plan-scoped**, 3 per page | `plan_id` |
| `magnet N pick K` | chosen framing → `page_plan.magnet_frame` | ✅ |
| then | the body is drafted → `client_pages` row | `page_plan.page_id` |
| then | `stageFrameCandidate` → `approveMagnetCandidate` → `lead_magnets` | page-scoped, works |
| step 29 `first_page` | published | |

`page_plan` is the placeholder that exists from step 21 onward. It is created before the page and
carries the keyword the whole way. Nothing is out of order.

**And the "blocker" was a path nothing takes.** The old note said `approveMagnetCandidate` cannot
approve a plan-scoped candidate. True — `magnet-drafts.ts:1067` matches page-scoped or
client-scoped, and a plan draft is neither. But no caller ever asks it to. Plan-scoped drafts are a
**menu**: `magnet N pick K` copies the winner into `page_plan.magnet_frame`, the body is written from
it, and only then is a PAGE-scoped candidate staged and minted, which is the branch that works. The
comment at `page-angles.ts:1099` says so out loud: *"Nothing new mints here, deliberately:
approveMagnetCandidate stays the one and only route into lead_magnets."*

**Section 7 is now built** (`6cb3d57`). `gather()`'s plan branch resolves the step-12 reading for the
planned page's target keyword and puts it in the offer prompt as a brief: what Google already shows,
the shape, the fit, and the ideas proposed while somebody was looking at the real results page.

---

## ‼️ The real problem: the curated 20 reaches nothing

This is the harmony bug, and it is worth more than section 7 was.

Step 12 now produces a **curated set**: you screenshot each keyword, see its scores and what could be
built for it, and keep 20 with a ✅. That decision writes `client_keywords.selected_at`.

**Nothing downstream reads it.** `planKeywords()` (`client-keywords.ts:1126`) is the pool every later
step draws from, and it filters on `approved && !dropped && use === "query"` — which on a real client
is ~400 rows, most of them `expansion` proposals a model wrote. So today you can spend an hour
curating twenty keywords against their actual results pages, and step 21 will plan seven pages off a
list that does not know you did it.

`selected_at` currently has one writer and one reader, both inside the card lane.

### ‼️ But do NOT just change `planKeywords`

It has five callers and they do not want the same thing:

| caller | step | wants |
|---|---|---|
| `pre-call-pages.ts:134` | 21, the seven pages | **the curated 20** |
| `precall-headlines.ts:380` | 21, the headlines | **the curated 20** |
| `anchor-ladder.ts:230` | 21, the ladder | **the curated 20** |
| `artifacts/custom-question-set.ts:179` | 13, the Day 0 measurement set | **the broad set** |
| `photograph.ts:60` | the tracked measurement set | **the broad set** |

The last two are **measurement**. The question set is frozen as the Day 0 baseline and never edited
(a change is a new version and a new baseline). Shrinking it from ~400 questions to 20 would
permanently narrow what this client is measured on, and it is not reversible after the freeze.

So: a new accessor, not a changed one.

---

## The plan

### 1. Run the migration ‼️ everything below is inert until this happens

`docs/2026-09-27-keyword-decision-cards.sql`, handed over in the last message. Until it runs:
`card_ts` does not exist, so no reaction is ever heard; `asset_ideas` does not exist, so section 7's
brief is always null. Every read and write of those columns is a separate tolerant select, so the
lane degrades quietly rather than breaking — which is correct, and also means **nothing will tell you
it has not been run**. Run it first.

### 2. `selectedKeywords()`, and three callers move onto it

New in `client-keywords.ts`, beside `planKeywords`:

```ts
export async function selectedKeywords(clientId: string): Promise<
  { ctx: KeywordContext; rows: StoredKeyword[]; vocab: string[]; curated: boolean } | { error: string }
>
```

- Returns `selected_at is not null && !dropped && use === "query"`, with `curated: true`.
- ‼️ **Falls back to the whole approved set with `curated: false` when nothing is selected.** Most of
  step 12's history predates the cards entirely, and a client who never screenshotted anything must
  keep working exactly as they do now. Same precedent `verifyKeywordSet` already sets: *"A client
  with no locked strategy passes, unchanged."*
- Its own tolerant select on `selected_at`, so a database without the migration reports `curated:
  false` rather than failing step 21.

Then `pre-call-pages.ts:134`, `precall-headlines.ts:380` and `anchor-ladder.ts:230` call it instead
of `planKeywords`. The two measurement callers are left alone, with a comment saying why, because the
next person will otherwise "fix" the inconsistency.

Each of the three says on its card which pool it used: *"Planned from the 20 you kept"* against
*"Planned from all 412 approved, because nothing has been kept yet"*. A silent fallback is how
somebody spends an hour curating and never finds out it was ignored.

### 3. Step 12's [Done] learns about the selection

`verifyKeywordSet` checks the floor, the approvals, and that no locked pillar is unpictured. It says
nothing about the curation. Add a **soft** condition: when any keyword is selected, at least
`PLAN_KEYWORDS_NEEDED` (7) must be, since that is what the plan consumes. When none are selected,
pass unchanged, for the same back-compat reason as above.

Not a hard 20: the target is a target, not a cap, and refusing Done at 19 would be the board arguing
with a person about their own market.

### 4. The body prompt learns the shape (small, high value)

`answerShapeFrom` already says whether the results page is a **task** or a **fact**. The offer prompt
now knows. The **body** prompt does not, and a task page that does not ship the deliverable loses to
the one that does. One line into the page brief: *"the results page for this keyword already hands
over a script; this page has to carry a better one."*

### 5. One number to reconcile — DONE, as a bucket

`SHORTLIST_SIZE` is 25 and `SELECTION_TARGET` is 20: screenshot 25, keep 20. Coherent. But a
variation approved by ✅ enters `shortlistOf` on the next read and is capped at 4 per category and 25
total, so keeping a 26th can push another off the numbered list.

**Resolved as a bucket.** A kept keyword that no longer fits the numbered list is printed under
*"Also kept, off the numbered list"* on the shortlist card. It is not dropped and nothing downstream
changes: `selectedKeywords()` reads `client_keywords` directly, so step 21 still plans from it. What
it loses is its NUMBER, and a number is only ever needed for the typed `keywords serp N` override
now that a screenshot finds its own keyword.

---

## The live test, in order

1. Run the migration. Verify with the two `select`s at the bottom of the file: 12 columns, 2 CHECKs.
2. In SRT's step 12 thread: `keywords delete all` → check the counts read true → press the button.
   Confirm the card redraws empty and `keyword_runs` has the snapshot.
3. `keywords pick:` with a fresh list of ~25.
4. `keywords shortlist` to see the numbers.
5. **Paste a Google screenshot with no caption.** Expect one card for that keyword, naming the search
   it read off the box, with scores, the shape, and up to three things to build.
6. Paste two screenshots in one message. Expect two cards.
7. Paste a screenshot of something not on the list. Expect a refusal naming the nearest three.
8. ✅ one, ❌ one, 🔁 one. Confirm: the count moves, the card is EDITED not replied to, ❌ on a kept
   card un-keeps it rather than dropping it, and 🔁 posts its variations as their own cards.
9. Then step 21: `rerun 21`, and confirm the seven pages come from the kept keywords and that
   `magnets auto` produces offers that reference what the SERP showed.

Steps 1-8 are testable now. Step 9 needs item 2 of the plan.

## What is deliberately not here

- **Rearranging the board.** Nothing in the scan justifies it.
- **A fourth magnet scope.** Three is already one more than most of this code expects, and
  `page_magnet_candidates` reading as page / plan / client is documented in three places.
- **Reaction-removed undo.** Needs a Slack app manifest change, not code. ❌ stepping back one is the
  undo until somebody grants that scope.
