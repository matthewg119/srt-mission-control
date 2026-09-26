# Interconnection: make the board describe itself, so the next change is wired by construction

A prompt for a fresh session. Everything in a **Ground truth** block was measured against this
worktree on **2026-09-26** and is quoted, not remembered.

**Repo:** `Desktop/Code/_wt-kwstrategy`, branch `feat/keyword-decisions` at `6d40e99` (pushed).
‼️ Do NOT read `Mission control 2.0/srt-mission-control`, it is weeks stale.
Read `CLAUDE.md`, `docs/DATA-AND-WORKFLOWS.md` and `docs/STEP-WIRING.md` before writing code.

---

## What this build is

The dead-wire work of 2026-09-25 proved a class of bug and then fixed five instances of it. What it
did NOT do is make the board **self-describing**, which is the actual ask:

> Matthew, 2026-09-26: "scan and plan out how we are going to interconnect and feed it so it can
> remember and everytime we make a change in the future it can wire it correctly."

Three separate things are wanted and they are not the same job:

1. **SCAN.** What is connected to what, today, measured rather than assumed.
2. **REMEMBER.** One generated document that says it, regenerated from the code, never hand-edited,
   and failing when it drifts.
3. **WIRE IT CORRECTLY NEXT TIME.** A new column or a new step is refused until it declares where it
   comes from and what reads it. Not a convention. A build failure.

Only 3 is worth much on its own. 1 rots the day it is written and 2 is only trustworthy because of 3.

---

## Ground truth: what already exists. DO NOT REBUILD ANY OF IT.

Five mechanisms are already in the tree and already enforce part of this. The single most expensive
mistake this session can make is building a sixth beside them.

| what | where | what it already guarantees |
|---|---|---|
| **needs** | `src/lib/clients/step-needs.ts` `STEP_NEEDS` | `Record<StepKey, StepNeed>`, so a 42nd step fails the build until somebody says what it needs. `{kind:"nothing"}` requires a sentence |
| **produces** | same file, `STEP_PRODUCES` | added 2026-09-25. Same forced Record. Declares the non-field artifacts a step records, their writer, their reader and their consumers |
| **which step fills which FIELD** | `src/lib/clients/dataset-spec.ts` `filledBy: {kind:"step", step, how, built}` | the per-field relation. `rerun-gaps.ts` already inverts it to offer the "re-run the earlier step" button |
| **the generated map** | `scripts/_step-wiring.ts` to `docs/STEP-WIRING.md` + `docs/ONBOARDING-MAP.md` | Matthew's own ask, in its header: *"make sure the MD file specified which step is wired with each step so we can read that md file before doing anything else."* `--check` fails when either drifts |
| **the column scan** | `scripts/_probe-dead-wires.ts` | gated in `checks.yml`. Two ratchets that may only go DOWN: `BOARD_BASELINE` 957 and `FUNDING_BASELINE` 116 |

‼️ **`dataset-spec.ts` OWNS "which step fills which field" AND `STEP_PRODUCES` MUST NOT RESTATE IT.**
`produces` covers only artifacts that are NOT dataset fields, which is why the curated-20 bug was
invisible: `client_keywords.selected_at` is not a field. A copy of the field relation keyed from the
step side would be two sources of truth for one fact, which is the bug this whole lane is about.

### Ground truth: the two holes in the memory layer

```
grep -c 'STEP_PRODUCES' scripts/_step-wiring.ts docs/STEP-WIRING.md docs/ONBOARDING-MAP.md
  scripts/_step-wiring.ts:0
  docs/STEP-WIRING.md:0
  docs/ONBOARDING-MAP.md:0
```

**1. The map is one-directional.** It reads `STEP_NEEDS`, `fieldsForStep` and `stepsBlockedBy`, so it
says what every step WAITS ON and nothing about what any step FEEDS. The document Matthew reads
"before doing anything else" cannot answer "if I change step 12, what breaks".

**2. The drift check is not gated.** `scripts/_probe-step-rerun.ts:102` really does run
`_step-wiring.ts --check`, and that probe is **not** in `.github/workflows/checks.yml`. The file
gates eight scripts and this is not one of them, so the map can go stale
on `main` with nothing saying so.

### Ground truth: the backlog, measured

```
BOARD_BASELINE  957 unread columns outside the three cleaned tables
  audit 224 · onboarding 182 · funding 116 · scraper 115 · content 74
  medspa 74 · infra 69 · crm 48 · sequences 29 · trt 25 · sim 1

SCANNED, at zero and held:  avatar_briefs · client_audiences · keyword_clusters
OWED, real and deferred:    13, each with a sentence
dataset fields nothing fills: 6
```

The 6 are `avatar.cost_of_inaction`, `avatar.decision_influencers`, `avatar.proof_they_need`,
`avatar.price_sensitivity`, `avatar.booking_behaviour`, `audience.comparison_subjects`. All six are
`asked: false` in dataset-spec and are already `wants`, never `needs`, and `step-needs.ts` says why:
making them block a step would refuse it for an answer nobody can give.

‼️ **The sharpest of the 13 OWED, because it is a shape and not an instance.**
`keyword_clusters.rationale`, `awareness_entry` and `awareness_target` are written by
`persistClusters`, and the strategy card prints the **recomputed** values off `clusterFinalists`
instead. The information is on screen, the column is still dead, and after an offer change the two
can disagree with nothing saying which you are looking at.

---

## The work, in order

### W1 . `STEP_PRODUCES` reaches the generated map

The highest-value single wire in this build, and the smallest. `_step-wiring.ts` already imports from
`step-needs.ts`; add `STEP_PRODUCES` and `allOutputs()` and give every step a **Feeds** section
beside its existing needs section: what it records, which symbol carries it, and which steps consume
it. Then regenerate both docs and commit them.

The map becomes bidirectional, and "if I change step 12, what breaks" has a written answer.

‼️ **SYNCHRONOUS ONLY.** The generator's own header states the enforcement: the two `--check`ed docs
are produced by synchronous functions, because you cannot read a database synchronously, so no live
number can reach a checked file by accident. `--live` is the only async arm. Do not make the Feeds
section reach for a row count.

### W2 . Gate the drift check

Add `scripts/_probe-step-rerun.ts` to `.github/workflows/checks.yml`. Confirm it is offline-safe
first: every entry in that file runs `bun --no-env-file run`, and its own header explains why
(a probe needing production either fails on every run or passes vacuously against a placeholder
Supabase URL). If it needs a database, split the `--check` half into its own gated probe rather than
putting a live probe in CI.

Without this, the memory layer is a document that is correct on the day it was written.

### W3 . The rule that makes the next change wire itself

This is the item the whole build exists for. Today a new column can be added to a migration and read
by nothing, and only `_probe-dead-wires.ts`'s **baseline** catches it, as a number going up by one
with no name attached.

Make the failure name itself:
- a new `table.column` on a SCANNED table already fails, by name. Good.
- a new column anywhere else raises `BOARD_BASELINE` and the probe says only "the count grew".
  **Make it print the NEW keys**, diffing against a checked-in list rather than a bare integer, so
  the failure says which column and which migration rather than making somebody bisect.

‼️ **A LIST, NOT A LOWER NUMBER.** Replacing the integer with a checked-in set of the 957 keys is the
change. It costs one generated file and turns "the count grew" into "these two columns, added by
docs/2026-10-xx-foo.sql, are read by nothing". Do not try to fix all 957 to make the list short.

### W4 . Bring ONE lane to zero, and prove the ratchet moves

Pick **onboarding, 182**, because it is the lane every other item here is about. For each column:
read, drop, `WRITE_ONLY` with a sentence, or `OWED` with a sentence. Then move those tables into
`SCANNED` and lower `BOARD_BASELINE` by exactly what you resolved.

‼️ **DO NOT WIDEN `SCANNED` WITHOUT RESOLVING THE TABLE.** The set is a claim that somebody looked at
every unread column on it. The probe's own comment says so, and a table added to make a failure go
away is how a cleaned lane silently rots back.

Leave `audit` (224) alone this pass: its own header says several of its columns are tri-state by
design and it has its own probes.

### W5 . The 13 OWED, decided rather than carried

Each already carries a sentence. Turn each into a fix or a `WRITE_ONLY` entry. Start with the three
`keyword_clusters` columns above, since reading the stored values instead of the recomputed ones is a
real behaviour change and the one a person would notice.

### W6 . The 6 fields nothing fills

One decision, not six: either the deep-research prompt starts asking for them, or they come out of
`dataset-spec.ts`. They have been `asked: false` since they were declared. A field that no prompt
asks for and no step fills is a permanent gap on every client's completeness card.

### W7 . Feed it, so a future session starts here

- `CLAUDE.md` gets a short section pointing at `docs/STEP-WIRING.md` as the thing to read before
  touching the board, and at the two ratchets.
- The memory files `project_dead_wires_probe` and `reference_dead_wires_doc_wrong` already exist.
  Update the first with the new baselines rather than adding a third.

---

## Traps, each already paid for once

1. ‼️ **A CONSUMER CHECK CAN BE GREEN FOR THE WRONG REASON, AND MINE WAS.** `step-needs.ts` contains
   every reader's NAME, so the declaration file counted as its own consumer and every output passed,
   including one deliberately broken. Found only by pointing an output at `selectKeyword`, which has
   zero references outside its own file, and watching it stay green. **Prove a check can FAIL before
   trusting that it passed.** `_probe-dead-wires.ts` §8 now asserts an impossible reader name is
   findable nowhere, for exactly this reason.

2. ‼️ **PostgREST RETURNS ONLY THE COLUMNS THE SELECT NAMED**, which is what makes the scan exact. A
   table read with an explicit list: that list is the complete authority, and a property access
   elsewhere is a different table's column. A table read with `select("*")`: a property access is the
   only evidence. Get this backwards and `avatar_briefs.avatar_label` reads as dead while
   `keyword_clusters.approved_at` reads as live. Both were wrong, in opposite directions.

3. ‼️ **SELECT-LIST CONSTS RESOLVE PER FILE.** Seven `const COLUMNS` exist here, plus two
   `ROW_COLUMNS`, two `SESSION_COLUMNS` and two `AUDIT_COLS`. One global map is last-writer-wins and
   produced twenty false failures on `client_audiences` alone.

4. **Column names are `[a-z_][a-z0-9_]*`.** `[a-z_]+` truncates `day_0_source` to `day_`.

5. **Strip comments before any absence check.** `docs/2026-08-17-funding-decommission.sql` has a
   whole block commented out after it was reversed. `_probe-list-prep.ts`'s `normalize()` only fixes
   CRLF and its own note records the cost: an absence check over a commented file tests the prose,
   not the program.

6. **Step numbers are array positions.** Inserting a step renumbers everything after it, so never
   write one as a literal. `day_zero_archive` is declared as a const, so `key: "` greps miscount:
   there are **41** steps, not 40.

7. **Shared worktree.** Peer sessions push the whole branch. Never bare `git stash`, and run
   `git branch --show-current` before every commit.

8. `npx tsc` runs a decoy. Use `./node_modules/.bin/tsc --noEmit -p tsconfig.json`. Probes with
   top-level await are `bun run`, never `bunx tsx`. Write TypeScript containing regexes with the
   Write tool, because heredocs mangle the escapes.

---

## Definition of done

- `docs/STEP-WIRING.md` answers "what does step N feed" for all 41 steps, regenerated and committed.
- `_step-wiring.ts --check` runs in CI.
- A new unread column fails **by name**, naming the migration that added it.
- The onboarding lane is at zero, those tables are in `SCANNED`, and `BOARD_BASELINE` is lower than
  957 by exactly the number resolved.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json`, `bun --no-env-file run
  scripts/_probe-dead-wires.ts`, `bunx tsx --env-file=.env.local scripts/_probe-step-rerun.ts` and
  `bun run build` are all green.
- Pre-existing and NOT this session's: `_probe-gaps` (3) and `_probe-step-grammar` §11 (1). Both fail
  identically at `63e134c`; verified by swapping in the pre-work `step-needs.ts`.
- Any SQL is pasted in full in a fenced ```sql block, never handed over as a file path, and never run
  from the session.

## Left for Matthew to decide, do not decide it yourself

- **Funding: archive the history and drop the eight tables, or keep them.** All eight
  (`standalone_applications`, `deal_submissions`, `statement_drops`, `lenders`, `email_submissions`,
  `email_submission_funders`, `deals`, `deal_events`) are wholly funding, so dropping their 116
  unread columns would leave eight crippled tables rather than removing funding. He has said funding
  is to be deleted on sight, and he has also deliberately restored Zoho deal history before, so the
  archive question is genuinely his.
- Whether the 6 unasked fields get asked for or deleted.
- Whether the strategy card should read the STORED rationale and awareness pair instead of the
  recomputed ones. It is a visible behaviour change on a card he reads.
