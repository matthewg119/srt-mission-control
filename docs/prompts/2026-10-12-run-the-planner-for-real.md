# Run the planner for real, and stop reading numbers that are only stamps

## Why this exists

`pull 2000 medspa` shipped on 2026-10-11 and was fixed on 2026-10-12 after it answered the wrong
question in the channel. Everything in it is now proved OFFLINE by 101 checks. **Not one line of it
has ever run against the vendor.** No plan has been approved, no circle has been measured by a
measure step, no reservation has been expanded, and no leftover has cascaded. The arithmetic is
right; the walk is a theory.

This prompt is about turning the theory into a measurement, and about three numbers that are stamps
pretending to be readings.

---

## Ground truth, measured 2026-10-12. Do not re-derive any of it.

Production is `main`. Everything below is live and already backfilled.

### Where the data stands
```
1,750  raw leads, all medspa, all Dallas
  970  route = email
  423  route = call
  357  route = drop
  556  sendable_leads rows
  332  shippable (valid or catch_all, not suppressed)
  406  contacts under "Med Spa Scrape - No Website"
    0  tiered          <- every row judged under the OLD boolean prompt
    0  judged_vertical <- same reason
    1  scraper_metro_circles  (Dallas only)
    0  scraper_cells   <- the national crawl has never been run
    0  scraper_pull_plans <- THE PLANNER HAS NEVER RUN
```

### The Dallas circle
```
1,990  businesses in the 30km circle, five med spa categories (read 2026-10-08)
1,750  pulled
  240  LEFT
```
‼️ **One 300-row chunk at `offset 1750` finishes Dallas.** The next metro is Houston, and its circle
has never been counted.

### What the planner will do, dry-run against production on 2026-10-12
```
Dallas-Fort Worth   240 records     1 chunk   left after: 0
Houston             measure the circle first, then up to 1,760 records
  Cost: about $0.11  ($0.10 of records, $0.0124 to measure 1 circle)
```

---

## What must NOT be re-measured or re-litigated

- ‼️ **A metro with no measured circle may not be allocated a budget.** `remaining` is null, not
  zero, for 15 of the 16 metros. The planner measures first for $0.0124, RESERVES the rest of the
  budget, and expands into real chunks after the count lands. `scripts/_probe-pull-plan.ts` builds
  the guessing version and asserts the real one disagrees with it. Do not loosen this.
- ‼️ **Pulls are serialised and that gate is about CREDITS, not cron budget.** A batch at `verifying`
  is waiting on MillionVerifier's queue, so letting the walk past it looks free. It is not: a 34
  chunk plan running ahead of its own verification would upload about 4,400 of ~9,700 credits before
  the first result returned. Decided 2026-10-11. The comment beside the gate says so.
- ‼️ **MillionVerifier can take 29 hours and that is not a fault.** File 32277475 (129 addresses) sat
  `in_progress` from 2026-10-08 18:30 to 2026-10-09 23:14; the cron drained it 83 seconds later.
  `pollVerification` is correct. Do not add a timeout: a timeout cannot finish a verification, it can
  only abandon credits already spent. The alarm added on 2026-10-12 is the right shape.
- ‼️ **PostgREST caps any rpc at 1,000 rows, server side.** `.range()` can only PAGE. `territoryDots`,
  `dropRows` and `sweepCallListGap` all page. Any new rpc must too.
- ‼️ **`contacts.phone_last10` is GENERATED ALWAYS** and refuses any value you send. Set `phone`.
- ‼️ **There is no `contacts.city`.** It is `biz_city`, `biz_state`, `biz_zip`, `biz_address`.
- ‼️ **`contacts.source` is a controlled vocabulary matched with `eq`**, on the registry as
  `crmSource`. `contacts.updated_at` is now maintained by a trigger; before 2026-10-09 it was not.
- ‼️ **NPPES is a dead end for med spas** (2 names from 75) and worth running only for `dentist`.
  **Prospeo has 0% usable coverage.** **LeadMagic, Dropcontact and Snov.io are ruled out on contract.**
- ‼️ **`day_spa` and `beauty_salon` kept 0 of 35** and stay out of `DFS_CATEGORIES`. A live vertical's
  category list may NOT be edited: `scraper_cells` and `scraper_metro_circles` are keyed on it. A new
  list needs a NEW SLUG.
- ‼️ **A vendor 500 no longer kills a pull.** It parks for two more cron ticks then refuses by name.
- ‼️ **Patch scripts turn `\b` into a literal backspace byte (0x08) in this environment.** It happened
  three times on 2026-10-12 and one of them killed the guard that keeps `pull maps ...` away from the
  planner, which would have hijacked every explicit pull as a multi-thousand record plan. The probe
  now scans the six scraper files for control bytes. Use the Edit tool for anything with a regex in
  it, and re-read the bytes afterwards.

---

## Phase A — run one plan, end to end, and write down what it actually did

The whole point. Nothing below matters until this has happened once.

1. Clear the way first: batch `5ae343b6` (run `c74a895d`, the Sept 28 Dallas 500) sits at `qualified`
   waiting for a drop-review check mark since 2026-10-06, and it holds **202 emailable leads that
   have never been crawled**. `qualified` is in ACTIVE_STATUSES, so it blocks the walk. Tick it, let
   it drain, and the plan starts by itself.
2. `pull 2000 medspa`. Check the card against the dry-run above. React.
3. Watch for: the Dallas chunk running, the Houston `measure` step posting a real circle size, the
   `pull_budget` step expanding into the right number of chunks, and the leftover cascading if
   Houston turns out smaller than 1,760.
4. **Record the measured Houston circle in `docs/` the way the Dallas one is recorded.** It is the
   second data point this lane has ever had about how big a metro is, and the planner's whole supply
   model rests on it.

‼️ **The thing most likely to be wrong is the leftover cascade**, because it is the only path that
re-enters `planPull` from inside the walk and it has never run. Read `expandPlanBudget` before
trusting the first run.

## Phase B — the three stamps

- ‼️ **`SENDING.verifierCreditsLeft` is a hand-read number with a date on it**, currently 9,668 as at
  2026-10-11. The card prints the date, which is honest, but it is still a stamp. Read it from
  MillionVerifier **on the cron** and cache it; do NOT call the vendor from the card render path, or
  `/dashboard/territory` fails exactly when somebody most wants to read it.
- ‼️ **`SENDING.rawToSendableLow/High` (9% to 13%) is one metro, one vertical, and a PRE-TIERING ICP.**
  Every supply number on the page multiplies out of it. The four 2026-10-08 chunks have now landed,
  so there is a second cohort to measure it against for the first time. Measure it before planning
  anything large.
- ‼️ **Tier A reads 0 everywhere and that is correct**, not a bug: every stored row was judged under
  the boolean prompt. Nothing can be backfilled without inventing it. The FIRST TIERED PULL is what
  makes the tier columns mean anything, and until then "Tier A supply" is not a number that exists.

## Phase C — the things that shipped and have never been looked at

Phases C and D of the 2026-10-09 build are live and unexercised.

- `/dashboard/territory` now has "what the profile does not email", per metro, free rule against
  model, bucketed. 773 rows, 420 by a free rule, 353 by the model, 416 still callable. Nobody has
  read it. ‼️ Bucket on `judged_vertical` where it exists and fall back to the reason text, never the
  reverse; today it is always the reason, because a dropped row carries no vertical by construction.
- The assistant has six scraper tools (`get_territory`, `get_drop_breakdown`, `get_run`,
  `get_call_list`, `plan_pull`, `get_scraper_status`). Nobody has asked it anything. ‼️ `plan_pull`
  must return the COMMAND and never run one; that is the property to check first.

## Phase D — four files carry a control byte on main

`src/lib/onboarding2/intake-steps.ts`, `scripts/_probe-onboarding2-chat.ts`,
`scripts/_probe-referral-invite.ts` and `scripts/_probe-shot-variety.ts` each carry one backspace
byte, pre-existing and unrelated to the scraper lane. Each is probably a `\b` that was eaten the same
way. ‼️ **Check what each one was meant to be before deleting it**: in a regex a dead `\b` silently
changes what matches, and in two of those files the regex decides what a probe asserts, so a
"passing" probe may be asserting nothing.

---

## Definition of done

- One plan has run end to end and Houston's circle size is written down in `docs/`.
- The credit figure is read on the cron, not typed.
- The raw-to-sendable rate is re-measured on the 1,200 cohort.
- Somebody has read the drops page and asked the assistant one real question.
- `./node_modules/.bin/tsc --noEmit` clean. `npx tsc` is a decoy.

## Conventions

`bun run`, never `bunx tsx`, for anything needing `.env.local`. Migrations are
`docs/YYYY-MM-DD-name.sql`, applied with `bun run scripts/db.ts --file=... --dry` then for real, and
pasted in full in chat rather than referenced by path. Probes are `scripts/_probe-*.ts`; offline ones
end in a summary plus `process.exit`, live ones end in `await sql.end()`. Prove a check can fail
before trusting that it passed. No em dashes in any copy the system generates.

Repo: `C:\Users\matth\Desktop\Code\_wt-kwstrategy`, a worktree of
`Mission control 2.0/srt-mission-control`. Production builds `main`. The worktree is shared, so never
`git add -A` across the whole tree.

‼️ **A red Vercel preview on this repo is often the Google Fonts fetch, not your diff.**
`Space_Grotesk` in `universe-fonts.ts` failed with `Cannot read properties of null (reading '1')` on
2026-10-11 while main was green with identical code. `npx vercel redeploy <dpl_id>` fixed it first
try. Check whether the failing file is in your diff before debugging it.
