# The dead-wire scan: every column the onboarding writes and never reads

> ## ‼️ BUILT 2026-09-25. FIVE CLAIMS BELOW ARE WRONG, and three of them change the work.
>
> Verified against the code while building it. Read this before acting on anything below.
>
> | below says | actually |
> |---|---|
> | `avatar_briefs.keyword_categories` is write-only, "seeded by the migration's own `update`" | it has **no writer either**. Pure dead DDL, every row NULL. The seeding `update` seeds `voc_quotes`, `approved_numbers`, `preset_key`, `default_stance`, not this. A fix aimed at "find who writes it" finds nobody |
> | `client_headlines.emotional_source` | the table is **`client_audiences`**. `client_headlines` exists and has no emotional column |
> | written by `rejectClusterCommand` | the function is **`rejectClusterAction`** |
> | `strategyLines` "already prints the approval", so mirror it | it prints **neither**. `approved_at` / `approved_by` were write-only too, and its only approval signal is a `locked` boolean from a different table. Scope grew by one pair |
> | the device-column precedent | is **not** a `drop column`. It is `_probe-serp-gate.ts` asserting the string `device` never appears in the SQL |
> | `preset_key` / `default_stance` seeded so "every row has a confident-looking value" | the seeding is scoped `where vertical = 'aeo-agency-med-spa' and avatar_slug = 'med-spa-owner'`. **One row** |
>
> Also: the table of siblings "read 4 to 15 times" counts reads of those column NAMES on
> **`client_audiences`**, not on `avatar_briefs`. None of them is ever read from `avatar_briefs`, which
> is why the probe built for this had to be table-scoped.
>
> **What shipped:** `scripts/_probe-dead-wires.ts` (gated in `checks.yml`), A to E fixed, `produces`
> added beside `needs`. `preset_key` and `missing_pictures` dropped, SQL in
> `docs/2026-09-25-drop-preset-key.sql` and `-drop-missing-pictures.sql`.
> `default_stance` was WIRED, not dropped: it feeds `proposeAudience`'s reason as a suggestion a person
> confirms, which is Matthew's call from 2026-09-25 and preserves the documented refusal to default a
> stance.

Written 2026-09-25 on `feat/keyword-decisions` at `b743fa1`, after the curated-20 bug turned out to
be one instance of a class rather than a one-off.

---

## The bug class, named

The curated-20 bug was not "somebody forgot a line". It was:

> A decision is recorded in a column. Nothing ever reads that column back. The data looks correct
> the entire time, the feature appears to work, and the judgement it captured reaches nothing.

It is invisible by construction: the write succeeds, the card renders, the row is there if you go
looking. The only thing missing is a consumer, and nothing in a type system or a test suite notices
an absence.

`scripts/_probe-serp-gate.ts` §6b already enforces the rule **for one migration**: every
`add column if not exists` must be named in some select list under `src/` or `scripts/`. It caught
five write-only columns in this build alone. It has never been pointed at the rest of the board.

I pointed it at the rest of the board. Below is what came back, verified by hand.

---

## Verified findings, onboarding lane

### ‼️ A. `avatar_briefs.keyword_categories` — the same bug as the curated 20

`avatar_briefs` carries the per-vertical vocabulary: what to call the offer, the business, the visit,
the lane. Every sibling is read:

| column | references in `src/` |
|---|---|
| `voc_quotes` | 15 |
| `presence_platform_keys` | 6 |
| `lane_name` | 5 |
| `hard_lines` | 5 |
| `offer_noun_singular` | 4 |
| `business_noun` | 4 |
| `question_set_preset` | 4 |
| **`keyword_categories`** | **0** |

Keyword categories decide how step 12 sorts every phrase it writes, what the card counts against its
targets, and what `keywords more <category>` takes. They come from
`categoriesForAudience(aud)` → `categoriesFor({ seededFrom, vocabulary })`
(`client-keywords.ts:154-160`), which derives them from the AUDIENCE. The per-vertical override was
migrated, seeded by the migration's own `update`, and never wired.

This matters now rather than in the abstract: dentists are queued as vertical #2, and a dentist's
keyword categories are not a med spa's.

**Fix.** `categoriesForAudience` prefers `avatar_briefs.keyword_categories` for this client's
vertical and avatar when the row has one, and falls back to `categoriesFor(...)` when it does not.
Tolerant read, fallback announced on the step 12 card the same way `poolLine` announces its own.

### B. `keyword_clusters.rejected_at` / `rejected_by` — write-only

Written by `rejectClusterCommand` (`keyword-strategy.ts:1938`). Read by nothing.

The migration's own comment is the indictment: *"'rejected' is not 'dropped'. Dropped is what a merge
does to a cluster that moved under another one; rejected is a person looking at the pictures and
saying no. **Keeping them apart is what lets the card say which happened**."* The card cannot say
which happened. Both columns exist so that it could, and nothing reads either.

**Fix.** `strategyLines` prints the rejection and who made it, beside the cluster, the way it already
prints the approval. One line, and the column earns its place.

### C. `keyword_clusters.missing_pictures` — write-only

Written at `keyword-strategy.ts:1561`. The only other mention is a comment in `serp-gate.ts:94`
calling it *"a cache for drawing a card"*. Nothing reads it, so it is not a cache; it is a number
that is kept up to date for nobody.

**Fix.** Either read it when drawing the card (which is what it is for) or drop it. Recommend
**dropping**, and the repo's own precedent is the argument: `_probe-serp-gate.ts` asserts *"the device
column is gone rather than always null"*, because "a dead column that looks like provenance is worse
than no column". `gateClusters` recomputes this honestly every time, and `serp-gate.ts`'s header
already says re-reading beats trusting a cache here.

### D. `client_headlines.emotional_source` / `emotional_checked_at` — write-only

Written at `precall-headlines.ts:333` (`emotional_source: "pasted"`). Read by nothing.

So the emotional layer cannot tell a client's own pasted answers from borrowed ones, which is exactly
the distinction those two columns were added to record, and exactly the thing the emotional-layer
gate is supposed to refuse on.

**Fix.** The headline card and the gate read `emotional_source`, and say "borrowed from the vertical"
against "pasted by this client".

### E. `avatar_briefs.preset_key` / `default_stance` — dead, and seeded

Zero references. The migration seeds them (`update ... set preset_key = coalesce(preset_key,
'aeo_agency_owner'), default_stance = coalesce(default_stance, 'owner')`), so every row has a
confident-looking value that decides nothing.

**Fix.** Drop both, unless `default_stance` is meant to seed the audience firewall, in which case
wire it there. Needs one decision from Matthew; it is the only finding here I cannot resolve from the
code alone.

### Not findings, checked and cleared

- `page_dataset.magnet_candidates` / `variant_no` / `primary_keyword_id`: the table IS read
  (`page-corpus.ts:93`, `page-dataset.ts:428`, `dataset-suggestions.ts:176`). It is a training corpus
  and reading it in bulk is the point.
- Everything under the funding, CRM, scraper and content lanes. The raw scan returns ~140 candidates
  board-wide; most are outside the onboarding and several are on lanes that are decommissioned.

---

## ‼️ The mechanism, which is the actual deliverable

Findings rot. A scan I ran once tells you about today. What you asked for is that the onboarding
"understands everything, so a correction can be done completely" — that is a standing check, not a
list.

### `scripts/_probe-dead-wires.ts`

Generalise `_probe-serp-gate.ts` §6b to **every** migration in `docs/*.sql`:

1. Collect every `add column if not exists <col>` and every column in a `create table`.
2. Collect every select list in `src/` and `scripts/` — both inline `.select("...")` and the
   `const X_COLUMNS = "..."` shape, which `client-keywords.ts` and the rescore scripts use.
3. Collect every filter and order key (`.eq("col"`, `.order("col"`, …): a column used as a filter is
   genuinely read, just not returned.
4. Fail for any column named in neither.

‼️ **With an explicit, commented allowlist**, because some columns are honestly write-only:

```ts
/** Columns that are written and never read, ON PURPOSE. Each needs a reason, not a name. */
const WRITE_ONLY: Record<string, string> = {
  "keyword_runs.rows_snapshot": "the archive. It exists to be exported, and reading it back in app code would be the bug.",
  // ...
};
```

An allowlist entry is a sentence somebody had to write. That is the point: it converts "nobody
noticed" into "somebody decided", which is the difference between the two bugs in this document and
a deliberate design.

### And the harder half: step-to-step wiring

Dead columns are mechanically findable. The curated-20 bug had a second half that is not: the column
WAS read, by the card that wrote it, and the gap was that *the next step drew from a different pool*.

`src/lib/clients/step-needs.ts` already declares `STEP_NEEDS` — which fields each step requires — and
`_probe-step-grammar.ts` greps handler gates back out of `src/`. The missing assertion is the
mirror of it:

> For every step that DECLARES it produces a field, something downstream reads that field.

Add `produces` beside `needs` in `STEP_NEEDS`, and a probe that fails when a declared output has no
consumer. That would have caught the curated 20 the day `selected_at` was added, because step 12
would have declared it and nothing would have claimed it.

This is the piece worth building even if nothing else in this document is.

---

## Order of work

1. **`_probe-dead-wires.ts`** with the allowlist, red on A-E. The check before the fixes, so each fix
   is provably a fix.
2. **A** — `keyword_categories`, the one that changes output today and blocks the dentist vertical.
3. **D** — `emotional_source`, because a gate that cannot see its own input is a gate in name only.
4. **B** — the rejection on the card. Small.
5. **C** — drop `missing_pictures`, with the migration that drops it.
6. **E** — one decision from Matthew, then wire or drop.
7. **`produces` in `STEP_NEEDS`** and the consumer probe. The one that stops this recurring.

Items 1-6 are a day. Item 7 is the one that pays for itself.

## What this scan did NOT cover

- **Runtime wiring.** A column can be read by code that never runs. `_probe-declared.ts` and the
  `--live` mode of `_step-wiring.ts` are the tools for that, and neither was run here.
- **jsonb payload keys.** A dead key inside `client_datasets.payload` is invisible to a column scan.
  `dataset-spec.ts` is the place that knows those, and it has its own probe.
- **The non-onboarding lanes**, deliberately. The raw output is in the scan script if you want it.
