# The Maps source, the spend ledger, and lead coverage

A build prompt for a fresh session, written 2026-09-21 after Workflow C was wired and its
migrations applied. Its predecessor is the plan at
`C:\Users\matth\.claude\plans\what-is-our-current-polymorphic-acorn.md`, which has the full map of
how the scraper lane got here and is worth reading once.

**Read what is already built before writing anything.** Three of the four things this prompt asks
for are extensions of layers that already exist, and the fastest way to waste this session is to
rebuild one of them.

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-workflow-c"
git fetch origin && git branch --show-current     # feat/workflow-c
git log --oneline -1                              # at or after d452a75
```

‼️ **This worktree is shared with other sessions.** Commits `b686911..d452a75` were written by a
peer while the Workflow C wiring sat here, and a rebase changed the hash of the wiring commit from
`8a94adf` to `2728d25`. Never `git add -A` blindly; stage the files you touched. See
`reference_shared_worktree_sessions` in memory.

Read `CLAUDE.md` and `docs/ONBOARDING-MAP.md` before writing code.

---

## State as of 2026-09-21, verified against production this session

**All four owed migrations are applied and verified by reading the constraint and columns back:**

| Migration | What it did | Verified |
|---|---|---|
| `2026-09-18-workflow-c-wiring.sql` | `workflow` check widened to include `listprep`; `raw_leads.enriched_at` + `enrich_attempts` | 3/3 |
| `2026-09-19-vertical-per-drop.sql` | `list_pipeline_runs.vertical_slug` + index | 2/2 |
| `2026-09-19-handoff-record.sql` | `sendable_leads.sent_at`, `pg_trgm`, prospects website trigram index | 3/3 |
| `2026-09-19-referral-engine-rename.sql` | was **already applied** (0 old rows, 1 new) | confirmed |

`tsc --noEmit` clean, `_probe-scraper` 107/107, `_probe-list-prep` all pass.

**The branch is pushed and is 7 ahead / 8 behind `origin/main`.** It has not been merged. Rebase
onto main and re-run both probes before doing anything else, because main moved underneath it.

---

## 1. Replace Outscraper with a local Maps scraper

**Matthew's decision, 2026-09-18 and reconfirmed 2026-09-21:** gosom/google-maps-scraper.

‼️ **THERE IS NO CODE SWAP TO MAKE, AND THAT IS THE FIRST THING TO UNDERSTAND.** Outscraper is not
"currently the source" in any live sense. Verified: `api/cron/pull-medspa` and `api/cron/pull-trt`
are absent from `vercel.json`'s 17 crons AND hard-gated on `MAPS_PULL_ENABLED !== "1"`, with the
header `"Maps prospecting is PAUSED (2026-07-31)."` Both webhooks carry the same gate. They write
to `med_spa_leads` / `trt_leads` and have never fed `#srt-scraper`.

So the Maps source today is **a human dropping a CSV**, and gosom changes what produces that CSV,
not what consumes it. The lane's front door is already right.

**What to actually build:**

- `scripts/pull-maps.ts` — drives the local gosom binary over a metro x query list, normalises its
  output headers to what `rules.ts` resolves (`company`, `website`, `city`, `state`, `phone`,
  plus `rating` / `reviews` / `categories` / `place_id` when present), and writes one CSV ready to
  drop. Dry by default, `--write` to emit, the same posture as `seed-scraper-seen.ts`.
- ‼️ **Check gosom's real column names first and write them down in the script header.** The
  `fromCsv` mapper in `pull.ts` already reads Maps-shaped extras through a `pick([...])` list of
  candidate spellings; extend that list rather than renaming gosom's output, so a file exported by
  hand from a different tool still lands.
- `qualify.ts`'s `describe()` feeds **category and review count** to the model. A file without them
  is judged on less, which is a verdict-quality loss, not an error. If gosom omits either, say so on
  the qualifying card rather than silently degrading.
- gosom has an `-email` flag that crawls each site. Our own `email-scrape.ts` rung does the same
  job with a 4-tier ranking and Cloudflare de-obfuscation. **Run gosom WITHOUT `-email`** and let
  the lane's rung do it: one implementation, one place the role-address rule lives, and the
  attempt trail lands in `enrich_attempts` where the funnel can read it. If you turn `-email` on
  instead, the address arrives in the CSV and the `file` rung picks it up for free, which is also
  correct but records nothing about where it came from.

**Decide and write down:** whether to delete the Outscraper integration or leave it dark. Leaving
it costs nothing and `_step-wiring.ts` already records it as owed; deleting it loses a working
two-phase webhook pull that a future niche might want. Recommendation: leave it, and add one line
to its header saying gosom superseded it for med spas.

‼️ Scraping Maps is against Google's ToS. Matthew has made that call. Do not re-litigate it, and do
not move the scraper onto company infrastructure without asking: it runs on his desktop on purpose.

---

## 2. Every paid pull says what it cost, in the thread

**The finding, verified 2026-09-21:** `list_pipeline_runs.cost_usd` and
`list_pipeline_runs.provider_spend` have existed since 2026-09-17 and **nothing writes either of
them.** The only spend anything records is `scraper_batches.score_cost_usd`, written by
`addScoreCost` for DataForSEO on workflow 2.

So Workflow C spends Anthropic money on qualification and MillionVerifier money on verification,
and records neither.

**Also verified, and it is the good news:** Workflow C never touches DataForSEO. A grep across all
six of its sweeps for `dataforseo|postTasks|collectTasks` returns **0**. It buys no SERPs. That is
the "do not pull from an API that has nothing to do with this" half, and it is already true —
what is missing is the part that *says so*.

**What to build:**

- Write `provider_spend` as a jsonb map (`{"anthropic": 0.42, "millionverifier": 1.10}`) and
  `cost_usd` as the total, incremented as each stage runs, never computed at the end. The stage
  that dies mid-sweep must still have banked what it spent, for the same reason verdicts are
  written per chunk.
- ‼️ **A ceiling before, an actual after, and never the same number.** `estimateCost` already
  prints a ceiling before the gate. The card after a stage must print what was actually spent, and
  the two must be visibly different things, or the estimate quietly becomes the record.
- Name the provider on every line. "Enrichment: $0.00 (site crawl, free)" is worth printing
  precisely because it is zero: it is the line that tells Matthew the free rung is doing the work.
- `hasMx` already routes through `getOrFetch`, so a repeated domain costs nothing. Say "cached" on
  the card rather than counting it as a pull.
- Extend `scripts/_step-wiring.ts`'s `PAID_PULLS` census with anything new. ‼️ It keys on
  **credentials**, so a rung that introduces no env var will NOT make `--check` fail by name. The
  site-crawl rung is already in that position and is recorded as owed by memory alone.

---

## 3. Coverage: what is missing on every lead, and label it on the way in

This is the largest piece, and **most of it already exists for clients.**

‼️ **READ `src/lib/clients/dataset-spec.ts` BEFORE WRITING ANY OF THIS.** It already has
`DatasetKey = "avatar" | "audience" | "offer"`, a `DATASET_FIELDS` spec table, `FieldGap`,
`DatasetReport`, `evaluateDatasets()`, `formatDatasetReport()`, `NOTHING_ON_FILE` and an
`EMOTIONAL_FLOOR`. Alongside it, `src/lib/clients/step-needs.ts` has `STEP_NEEDS` / `fieldsForStep`
/ `stepsBlockedBy`, and `src/lib/clients/step-gaps.ts` has `gapsFrom` / `gapLines`. The generated
`docs/ONBOARDING-MAP.md` already answers, per step, what reads a field, what writes it, and what it
refuses on.

**So the job is not "build a gap detector". It is "point the existing one at three more places".**

Matthew's ask, in his words: *save it raw, analyse what comes in, find what each client / avatar /
offer / dataset is missing, and make sure the field gets updated or at least labelled every time
data enters the system* — across **AI visibility, onboarding, and the scraper**.

**The three entry points, and what each is missing:**

| Entry point | Raw kept? | Gaps evaluated? | What to do |
|---|---|---|---|
| Scraper (`raw_leads`) | ‼️ **yes** — `raw_leads.raw` holds the whole source row | no | Evaluate per lead at `pulling`, report on the qualifying card |
| AI visibility funnel | check `onboarding2_leads` / funnel tables | no | Same evaluation at lead creation |
| Onboarding (`clients`) | partly | **yes, already** | Reuse unchanged; do not touch |

**Rules that matter, drawn from what this repo already believes:**

- ‼️ **Keep the raw payload forever and analyse a COPY.** `raw_leads.raw` means "what the source
  said"; `reachinbox_events.payload` keeps raw bytes for the same reason. Never write a derived
  verdict back into a raw column: it makes a re-run un-auditable against the original pull. This
  rule already cost one debate in `enrich_attempts`, which got its own column for exactly this.
- ‼️ **Missing and empty are different, and a third state is "asked and nothing was there".** The
  scraper lane learned this three times: `mx_ok` tri-state, `optimization_score` /
  `optimization_components`, and `qualify_keep` / `qualify_reason`. A coverage layer that collapses
  "not looked at" into "absent" will re-ask forever or under-report; pick the tri-state up front.
- **Label, do not block.** A lead missing a field should be recorded as missing and still flow.
  Blocking belongs to `STEP_NEEDS`, which already decides that for delivery steps.
- Report gaps **grouped and counted**, like `groupDrops` does. One lead missing a phone is noise;
  four hundred missing the same field is a source problem, and only the grouped count shows it.

**The standing rule Matthew asked to be remembered, and it belongs in `CLAUDE.md`:**

> Every time a lead, client, avatar or offer enters or is edited anywhere in this system, enumerate
> the full dataset it could carry, record which fields are present and which are missing, and
> either fill the missing ones or label them as missing. Widen the list rather than narrowing it:
> a field nobody uses yet is context for later, and the cost of carrying it is a column.

Write that into `CLAUDE.md` in this session, near the dataset-spec section, so it survives.

---

## 4. Med spas across the US, and the next niche

`icp.ts` already carries `MED_SPA_ICP`, `DENTIST_ICP`, `ICP_BY_VERTICAL`, `knownVerticals()` and
`resolveVertical()` — the peer session added the dentist arm and `list_pipeline_runs.vertical_slug`
on 2026-09-19, and the vertical is resolved **once** from the drop caption at `startRun` and read
back by every later stage rather than re-derived.

So a third niche is: one ICP constant, one entry in `ICP_BY_VERTICAL`, and nothing else. **Keep it
that way.** If adding a niche ever needs a second change, that is the bug.

For national med-spa coverage, the metro and query list is the input to `scripts/pull-maps.ts`.
`med_spa_zips` already holds a US ZIP coverage table with density states first, built for the
paused Outscraper route — read it before inventing a new one; it may be directly reusable as the
gosom work list, which would also make "which ZIPs have we harvested" answerable again.

---

## 5. The thing that must not happen

A 3️⃣ that silently runs workflow 2, inserts company rows, and buys a DataForSEO SERP for each with
no error and a plausible-looking thread.

**It is already defended, in four places, and the defences must survive every future edit:**

1. `PICK: Record<number, Workflow>` in `lane.ts` — a table, not a ternary. An unknown keycap is an
   **absent entry**, never a default branch.
2. `beginWorkflow()` — the single dispatch, an exhaustive `switch` ending in
   `const _never: never = workflow`. Adding a fourth arm is a compile error in one place.
3. `_probe-scraper.ts` greps the comment-stripped source for a surviving
   `keycap === 1 ? "filter" : "score"` and for `keycap > 2`.
4. The shared `verifying` arm branches on `batch.workflow` before it reads a row.

‼️ **The probe strips comments before those assertions**, because the comment explaining why the
ternary was removed contains the ternary. If that check ever fails, do not delete the explanation.

**Verify it live, on a 10-row file, before a real metro:** drop it, react 3️⃣, then check the Vercel
logs for any DataForSEO `task_post`. That step exists for this and nothing else.

---

## Order of work

1. Rebase onto `origin/main`, re-run both probes. Main has moved 8 commits.
2. The 10-row live test of the existing wiring. **Before building anything.** Nothing below is
   worth doing on top of a lane that does not work.
3. Spend recording (§2) — smallest, and it makes every later stage legible.
4. `scripts/pull-maps.ts` (§1).
5. Coverage (§3) — largest. Scraper first, AI visibility second, onboarding untouched.
6. `CLAUDE.md`: the standing rule, and a line in the scraper section saying gosom superseded
   Outscraper for med spas.

Run `bun run`, never `bunx tsx`: Bun auto-loads `.env.local` and Node does not.
