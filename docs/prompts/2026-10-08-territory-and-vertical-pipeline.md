# Territory, tiers and a map: make 1,350 emails a day a supply problem we can see

## Why this exists

The lead engine works and produces about 46 sendable addresses per 500 businesses pulled. The
sending target is **30 mailboxes x 45/day = 1,350 emails a day**, and with a three-day sequence that
is **450 new contacts entering every day**.

At the measured 9-13% raw-to-sendable rate, 450 contacts a day needs **3,500 to 5,000 raw records
pulled per day**. Dallas holds about 1,765 businesses across the five med spa categories. **One
metro is half a day of supply.**

So the territory system is not reporting. It is the thing that makes the number reachable, and
right now there is no way to answer "where have we already been" except by reading run labels. The
national cell crawl was built for this on 2026-09-28 and has never been run: `scraper_cells` is
empty.

This prompt builds, in order: the unblocking, the free personalisation fields, tiering, per-vertical
pulls, and a map you can look at.

---

## Ground truth, measured 2026-10-06 and 2026-10-07

All figures from the production database, run `c74a895d-4ea0-4d1b-9904-33fb4ace00b4`
(`pull maps medspa | Dallas TX | med spa | limit 500`, pulled 2026-09-28).

### The funnel, end to end
```
500  raw
256  qualified   (101 under the old med-spa-only ICP; re-judged 2026-10-06 under the "front desk" ICP)
111  crawled
 64  produced an address      47 produced nothing, all 47 have a domain, only 4 have a name
 58  verified
 46  sendable                 every one of them found by site-scrape
```
46 of 500 = **9.2% end to end.** Exported to `C:\Users\matth\Downloads\sendable-c74a895d.csv`:
35 valid, 11 catch_all, **17 of 46 carry a first name**.

### Where the 500 stand
```
256  kept (all have websites)   155 of these are re-qualified and NOT YET ENRICHED
113  dropped, no website        the call list
 35  dropped, duplicate of an earlier overlapping pull
 31  dropped, national chain
 26  dropped, no own domain (Instagram / Facebook / Vagaro only)
 10  dropped, too big / multi-site
  2  dropped, sells TO clinics
 27  dropped, other
```

### Free listing filter vs Haiku
```
500  total
387  have a website
342  in a core category
255  pass the free filter (core category AND website)
256  Haiku kept
───
173  agree
 82  free yes, Haiku no
 83  free no, Haiku yes
```
‼️ **The counts match and the lists do not.** 165 of 500 disagree. A free filter is not a cheaper
Haiku, it is a different filter passing the same volume. Haiku costs ~4 cents a batch, so there is
no cost argument for replacing it. Use free rules to **tier**, keep Haiku for the judgement.

### Review counts
```
                   n    0 rev  1-24  25-99  100-299  300+   avg
sendable           48    0      9     22      13       4    101
re-qualified 155  155    8     50     43      30      24    144
```
(n=48 here, not 46: the distribution was taken on the raw funnel definition, which includes the
2 guessed catch-all rows that `sendableRows` excludes at export. The shippable count is 46.)
The 1-99 band is 65% of sendable and 60% of the 155. The 155 has a fat tail of 24 businesses at
300+ reviews, mostly the salons and nail bars the widened ICP admitted.

### Chains
15 domains appear at 2+ locations covering 47 rows; 5 business names at 2+ covering 13 rows.
‼️ **15 of those 47 are aggregator hosts, not chains:** `instagram.com` 9, `vagaro.com` 4,
`facebook.com` 2. A naive "same domain = chain" rule deletes nine unrelated businesses as one
franchise. Reuse `NON_IDENTIFYING_HOSTS` from `src/lib/scraper/dedup.ts`. Real multi-location rows
are about 32: `usdermatologypartners.com` 6, `handandstone.com` 4, `thefacehaus.com` 3,
`locations.massageenvy.com` 3, then pairs.

### What DataForSEO actually returns
37 fields per row, all stored in `raw_leads.raw`. Already real columns: `place_id`, `primary_type`,
`categories`, `review_count`, `rating`, `website`, `domain`, `phone`, `city`, `state`,
`postal_code`.

‼️ **There is no permanently-closed flag.** Not a column and not in the payload. Exactly 1 of 500
rows mentions "permanently closed" anywhere in its raw blob. You cannot filter on it. Do not build
a rule that assumes it.

**Unused and valuable, already stored in `raw`:**
- `people_also_search` — ~5 nearby competitors with `title`, `rating.value`, `rating.votes_count`.
  This is the "you have 23 reviews, the clinic down the road has 310" line, free, no extra research.
- `is_claimed` — **429 true, 71 false.** An unclaimed Google listing is the strongest
  "nobody is managing this" signal in the payload.
- `latitude` / `longitude` — **present on all 500 rows.** Dallas spans 32.51 to 33.04 N,
  -97.12 to -96.52 W. Real dots on a real map are possible from data already in hand.
- `rating_distribution`, `place_topics`, `services`, `total_photos`, `work_time`, `attributes`,
  `cid`, `feature_id`, `first_seen`, `last_updated_time`, `local_business_links`.

### Vendor limits
- **1,000 results per task.** The endpoint silently clamps anything larger.
- **Offset ceiling 100,000**, measured: 100k succeeded, 110k-140k all returned HTTP 500.
- A command over 1,000 is paged internally at 1,000 a time.
- A circle over 2,000 businesses is split into four by the cell logic.
- Price $0.37 per 1,000 records plus $0.012 per task.

---

## What must NOT be re-measured

- ‼️ **NPPES is a dead end for med spas.** Measured 2026-10-06 over 75 nameless Dallas clinics: it
  named **2**, moving owner-identified from 25/101 to 27/101, and only **1** of the 2 was usable.
  Keep it for `dentist`, where a prior measurement found 20 of 20 Oklahoma practices carry an
  authorized official. See `docs/2026-10-06-nppes-coverage.md` and
  `scripts/_probe-nppes-coverage.ts`. Do not re-run it against med spas.
- ‼️ **Prospeo has 0% usable coverage for this vertical.** 12 real failures tested, every one
  `email=UNAVAILABLE`. `scripts/_probe-prospeo-coverage.ts`. Do not wire it.
- ‼️ **LeadMagic is ruled out on contract, not performance.** Its ToS bars cold email and bars
  resale. So do Dropcontact and Snov.io. See `docs/2026-09-27-owner-email-vendors.md`.
- ‼️ **`enrich_attempts` can never contain an `nppes` provider.** NPPES sits outside `PROVIDERS` and
  writes via `setOwnerName`. Checking there reads "absent" on a working rung. The real trace is
  `client_datasets where kind='nppes.owner'`.
- ‼️ **`mailProviderOf` returns null for BOTH "no MX" and "MX we don't recognise"**, which mean
  opposite things. Use `mxRecords`: `null` undetermined, `[]` genuinely no MX. On the 75 measured,
  26 had no MX at all and can never be mailed.

---

## Phase 0 — unblock what already exists. Free, do first.

1. **The 155 re-qualified leads.** The drop-review card was re-armed on 2026-10-08 by setting
   `list_pipeline_runs.drop_review_ts = null`; the cron re-posts a fresh card within 5 minutes.
   React ✅ on the **new** card (the old one's timestamp is gone and reacting to it does nothing).
   Then react ✅ on the MillionVerifier card that follows. Export with
   `bun run scripts/export-sendable.ts --run=c74a895d-4ea0-4d1b-9904-33fb4ace00b4 --held`.

2. **Re-run the dead 3k as chunks.** Batch `7a472c40-0ef8-40ce-ac57-88950642a8df` died on
   `DataForSEO returned HTTP 500` with `cost_usd 0` and `raw_count 0`, and `error` is not in
   `ACTIVE_STATUSES` so the cron will never retry it. `limit 3000` also asked for roughly twice
   the businesses Dallas contains. Four chunks finish the metro:
   ```
   pull maps medspa | Dallas TX | med spa | limit 300 | offset 500
   pull maps medspa | Dallas TX | med spa | limit 300 | offset 800
   pull maps medspa | Dallas TX | med spa | limit 300 | offset 1100
   pull maps medspa | Dallas TX | med spa | limit 300 | offset 1400
   ```
   Run them one at a time: a pull is serialised on purpose, and two in flight means two crawls
   competing for one cron tick.

3. **Bounded retry on a failed pull.** A single transient vendor 500 should park the batch and
   resume, not kill it. This is the same open issue already flagged in the picker work: `fail()`
   moves the row out of `ACTIVE_STATUSES`, so the retry arm that exists for exactly this can never
   run. Give it a bounded attempt counter and a terminal refusal that names the attempts used.

---

## Phase 1 — personalisation from data already in hand. Cheapest win, no prompt changes.

Lift out of `raw` into real columns on `raw_leads`, at pull time in `storeRawLeads`:

- `is_claimed boolean`
- `latitude numeric` / `longitude numeric` — **required by Phase 4's map**
- `competitor_top jsonb` or three flat columns: top competitor name, rating, review count, chosen
  as the highest `votes_count` from `people_also_search`

Backfill the existing 500 and the 50 from the older run from their stored `raw`, so the map and the
first campaign are not empty. This is a migration plus a mapper change. It buys the competitor line,
the unclaimed-listing signal and the map coordinates in one pass, and nothing downstream has to
change to benefit.

---

## Phase 2 — tiers instead of keep/drop

Change Haiku's job from a boolean to `{ vertical, tier, reason }`.

```
Tier A   med spa, aesthetics, TRT / men's health, weight loss, IV therapy, cosmetic dental
Tier B   high-end salon, lash and brow, chiropractor, wellness
Tier C   nail bar, barber, budget salon, tattoo          never emailed
```

Free rules run first and cheaply, before the model:
- no website → call list, not a drop
- aggregator-only domain (`NON_IDENTIFYING_HOSTS`) → call list
- shared domain at 2+ locations, excluding aggregator hosts → chain, drop
- review band → a tier hint, not a verdict

‼️ **Tier C is stored, not deleted.** Your own rule: do not throw away leads without an email.
No-website and no-MX businesses go to a phone or DM list, because for a three-person clinic a call
often beats a cold email. `scripts/export-cold-call-leads.ts` already produces that CSV.

Needs: one migration (`tier`, `vertical` columns on `raw_leads`), a rewrite of the qualify prompt,
and an update to `dropReviewLines` so the card reports tiers rather than kept/dropped.

---

## Phase 3 — one vertical at a time, with provenance

`raw_leads.source_query` and `source_metro` already exist and are already written on every row, so
half the tracking is built.

What is needed is a per-vertical registry: its own `DFS_CATEGORIES` entry, its own search strings,
its own ICP in `src/lib/scraper/icp.ts`, and its own ReachInbox campaign name. Start with med spa
only. Off-vertical results are **stored and tagged, never emailed**, and feed later runs rather
than being re-pulled.

Separate searches beat one broad query: "med spa", "testosterone clinic", "men's health clinic",
"weight loss clinic", "IV therapy" give cleaner lists and less waste at qualification. The five
current med spa categories and their measured keep rates are documented in `DFS_CATEGORIES` in
`src/lib/scraper/maps-command.ts`; `day_spa` and `beauty_salon` are deliberately absent because they
kept 0 of 35.

---

## Phase 4 — the territory system and the map

**This is the deliverable the whole prompt is named for. Build it so it can be looked at.**

A page in Mission Control at `/dashboard/territory`, reading live from the database. No new source
of truth: it reads `raw_leads`, `sendable_leads`, `outreach_prospects` and `scraper_cells`.

**The map itself**
- Real dots, not a choropleth alone. Every business has `latitude`/`longitude` once Phase 1 lands.
- Colour by furthest stage reached: pulled → qualified → sendable → emailed.
- Zoom from national down to a metro, because the decision at national level is "which city next"
  and at metro level it is "which part of this city is unworked".
- A state layer for the at-a-glance view. ‼️ Drive it from `raw_leads.state`, which holds **"Texas"**
  not "TX" (520 rows "Texas", 10 rows "TX", 20 blank) — canonicalise with `canonicalStateName` from
  `src/lib/scraper/geo.ts`. **Do not use `zip_centroids`**: it has 33,791 points but its `state`
  column is **100% NULL**.

**The table under the map**, one row per (metro, vertical):
pulled, qualified, Tier A, sendable, emailed, last pulled, estimated remaining.

**The plan view**, which is what makes it a territory system rather than a dashboard:
- days of supply left in each worked metro at the current burn rate
- the next metros in priority order — `METROS` in `src/lib/trt.ts` already holds 16 Sun Belt-first
  metros with city/state anchors (DFW, Houston, Phoenix, Tampa, Miami, San Diego, Austin,
  San Antonio, Atlanta, Orlando, Jacksonville, Las Vegas, Charlotte, Nashville, Denver, LA)
- a "do not pull" marker for anything already worked, so overlap is prevented before the spend
  rather than caught after it

‼️ **Overlap is already caught, so do not rebuild it.** `place_id` is uniquely indexed per run,
there is a cross-run `raw_leads_place_created` index, and `scraper_seen` dedupes on domain. 35 of
the 500 were already dropped as "already pulled under an earlier run (overlapping cell)". The map's
job is to stop you *buying* the overlap, not to detect it afterwards.

‼️ **Wire the map to `scraper_cells` as well.** The cell system already models national coverage
properly and has a `coverage <vertical>` command. It is empty because it has never been run. When
it is run, the map should read it rather than growing a second geography.

---

## Phase 5 — the paid rung, deferred on purpose

Decided: **one pipeline, paid step off by default**, firing only on leads the free rungs failed.
The slot already exists — `domain-people` in `PROVIDERS` in `src/lib/scraper/enrich.ts`, dark until
`DOMAIN_PEOPLE_API_KEY` is set. No second workflow.

‼️ **Do not measure a vendor until Phases 2 and 3 land.** The Prospeo mistake was measuring against
the wrong cohort. Today's "47 failures per 500" is a mix of med spas, salons and nail bars. After
tiering and per-vertical pulls it becomes Tier A med spas only: smaller, richer, different.
Measuring Hunter.io against today's 47 would describe a population we are about to stop emailing.

When the time comes: Hunter.io Starter annual (~$17 per 1,000 found, bills only on success, no
resale clause, ToS permits cold email) and Anymailfinder (100 free credits) both have free tiers.
Point `scripts/_probe-prospeo-coverage.ts` at them and measure before signing anything.

---

## The arithmetic this is all for

```
30 mailboxes x 45/day      = 1,350 sends/day
3-day sequence              =   450 new contacts/day
at 9-13% raw to sendable    = 3,500-5,000 raw records/day
Dallas total                = ~1,765 businesses
                            => one metro is about half a day of supply
16 metros in trt.ts         => roughly 6 days of supply if each is Dallas-sized
```

Cost at 4,000 records/day: about **$1.53/day** in DataForSEO ($0.37/1,000 plus task fees) and
roughly $0.30/day in Haiku. Negligible.

**MillionVerifier is the real budget constraint.** 10,500 bulk credits at ~500 addresses/day is
about 21 days. Buy more before scaling, not during.

---

## Definition of done

- The 155 are enriched and exported.
- Dallas is finished in 300-row chunks and a vendor 500 no longer kills a batch.
- `is_claimed`, `latitude`, `longitude` and the top competitor are real columns, backfilled.
- Qualification returns a tier; Tier C is stored and never emailed; no-website rows reach the call
  list rather than the bin.
- Med spa runs as its own vertical with its own ICP, categories, queries and campaign name.
- `/dashboard/territory` renders a US map with real dots coloured by stage, a per-metro table, and
  a next-metros plan. Someone can open it and point at where to go next.
- `./node_modules/.bin/tsc --noEmit` clean. `npx tsc` is a decoy.

## Then: the daily operating procedure

Once the above is live, do not jump to 4,000 a day. The tiered keep rate is unmeasured and it
changes every number below.

1. **Week 1, 1,000 records/day.** One metro at a time, in 300-row chunks. Measure the new Tier A
   sendable rate. At today's 9-13% that is 90-130 sendable a day, which supports roughly 300-390
   sends a day on a 3-day sequence: about 7-9 mailboxes.
2. **Read the map before every pull.** Pick the next metro from the plan view, never from memory.
3. **Week 2, scale the pull to whatever 450 contacts/day actually requires** at the measured tiered
   rate, rather than at the 9-13% measured on a mixed list. If tiering lifts the rate to 20%, 450
   contacts needs 2,250 records/day, not 5,000.
4. **Add mailboxes only as supply allows.** A mailbox with nothing to send hurts deliverability.
5. **Buy MillionVerifier credits before week 3.**

## Conventions

`bun run`, never `bunx tsx`, for anything needing `.env.local`. Migrations are
`docs/YYYY-MM-DD-name.sql`, applied with `bun run scripts/db.ts --file=... --dry` then for real,
and pasted in full in chat rather than referenced by path. `./node_modules/.bin/tsc --noEmit` is the
real typecheck. Probes are `scripts/_probe-*.ts`; offline ones end in a summary plus `process.exit`,
live ones end in `await sql.end()`. Prove a check can fail before trusting that it passed. No em
dashes in any copy the system generates.

Repo: `C:\Users\matth\Desktop\Code\_wt-kwstrategy`, a worktree of
`Mission control 2.0/srt-mission-control`, branch `feat/keyword-decisions`. Production builds `main`.
The worktree is shared, so never `git add -A`.
