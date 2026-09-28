# National coverage: stop guessing where the businesses are, ask

## Why this exists

The Maps door pulls a metro at a time from a hand-written list of 50 US cities. That list is
roughly 56% of the US population and it was chosen by hand, so "cover the whole country" is not
reachable from it. Two replacement designs were on the table: a ZIP queue with a rolling cursor,
and adaptive grid tiling that splits a box when it looks saturated.

**Both are obsolete, and the measurements below are why.** DataForSEO's Business Listings endpoint
returns `total_count`: the exact number of matching businesses inside a circle, for the price of one
task, before a single record is bought. Neither design uses that. The ZIP queue picks 41,700 fixed
cells with no reference to density. Adaptive tiling infers saturation from how many results came
back, which is guessing at a number the API will simply tell you.

## Ground truth, measured live on 2026-09-28

All figures from the production DataForSEO account, categories
`medical_spa, facial_spa, skin_care_clinic`. Total probe spend: about $0.50.

**Pricing** (confirmed exactly against returned cost): `$0.012 per task + $0.00036 per record`.
A `limit 1` count probe therefore costs **$0.0124** and answers "how many are here".
**A task that fails is not billed.** The five HTTP 500s below cost $0.0000.

**`total_count` is exact, radius-aware and monotonic:**

| Centre | 10km | 30km | 100km | 200km | 500km |
|---|---|---|---|---|---|
| Dallas | 416 | 1,766 | 4,439 | 5,030 | 14,302 |
| Manhattan NY | 2,862 | 5,927 | 10,139 | 13,827 | 25,474 |
| Dodge City KS | 9 | 10 | 19 | 78 | 5,367 |

**There is no radius cap.** From the geographic centre of the contiguous US:
500km = 3,311; 1,000km = 24,632; 1,500km = 56,450; 2,000km = 108,104;
**3,000km = 159,075** (about the whole country); 5,000km = 166,136 (spills into Canada and Mexico).

**Offset paginates cleanly to exhaustion, then stops.** Dallas at 30km, `total_count` 1,766:
offset 1,700 returned 20 rows, offset 2,000 returned 0. NYC at 500km, `total_count` 25,474:
offset 25,470 returned exactly 4 rows. Across 100 records sampled at six different offsets,
99 were distinct. Offsets do not overlap.

**Offset has a hard ceiling near 100,000, and gets slow long before it.** offset 100,000 on the
national circle succeeded; 110,000, 120,000, 125,000, 130,000 and 140,000 all returned HTTP 500.
That probe run took over five minutes for five requests, so deep offsets are slow as well as
capped. **A cell must hold well under 100,000, and for speed should hold a few thousand at most.**

**The index is live.** `total_count` for the national circle read 159,075 and 159,074 on two calls
seconds apart. Ordering across a multi-day paging run cannot be assumed stable.

## What to build

A count-probe-driven split. The rule in one line: **ask how many are in a circle; if it is small
enough to page quickly, page it to exhaustion; if not, split it into four and ask again.**

1. **Seed** the contiguous US with a coarse grid of circles, plus Alaska and Hawaii.
2. **Probe** each circle with `limit 1` for $0.0124 and read `total_count`.
3. **Split** any circle over the cell budget (start at 2,000) into four children and probe those.
   Stop splitting below a floor radius, because a dense downtown is legitimately dense and four
   more probes there buy nothing.
4. **Page** every leaf cell with `offset` until `offset >= total_count`. `total_count` is the stop
   condition. Do not infer completion from a short page.
5. **Report progress by state** by reverse-geocoding the cell centre. States are the wrong unit to
   *query* (the endpoint only filters by circle) but the right unit to *report*, which is what
   "finish Texas, then move to Florida" actually asks for.

### The thing already built that this replaces

`nextTarget()` in `src/lib/scraper/maps-command.ts` decides a metro is finished when a pull comes
back short of its limit. That inference was written before `total_count` was measured, and it is
strictly weaker: **a pull that errors to zero rows is indistinguishable from an exhausted cell and
gets silently skipped.** Store `total_count` on the run and the stop condition becomes exact.
Keep `nextTarget`'s offset arithmetic (depth is the deepest pull's `offset + limit`, never a sum of
rows delivered) because that part is right and there is a probe pinning the case it protects.

### The gap that will otherwise bite

`raw_leads` is unique on `(run_id, place_id)` only **within** a run. Overlapping circles are
unavoidable when you tile with circles, so the same clinic will be pulled under several runs. The
record cost is trivial, but **every duplicate goes through the Claude qualification sweep**, which
is the expensive stage. Add a cross-run `place_id` check before qualification.

## Cost, measured not estimated

About 160,000 US med spas in these three categories. Assume leaf cells average 1,500 records, so
roughly 107 leaf cells plus interior probes, call it 150 probes.

| Line | Cost |
|---|---|
| 150 count probes | $1.86 |
| ~320 record pulls at 500/pull | $3.84 |
| 160,000 records | $57.60 |
| **Total, every med spa in America** | **~$63** |

Against the ZIP queue: 41,700 cells at $0.012 of task fee each is **$500 in fees alone**, before a
single record, to reach the same businesses.

## What was actually built, 2026-09-28, and the four places this prompt was wrong

Built and on this branch. `src/lib/scraper/cells.ts` (geometry, pure), `coverage.ts` (the walk, pure),
`cell-store.ts` (the one new table), `docs/2026-09-28-national-coverage-cells.sql` (applied),
`scripts/_probe-cells.ts` (5,611 offline checks, in CI) and `scripts/_probe-cells-live.ts` (opt-in,
about $0.06). Commands: `cells <vertical>` measures, `pull maps <vertical>` works the next measured
cell, `coverage <vertical>` reports by state.

**1. "Split it into four" leaves gaps if the children are half the radius.** The obvious rule gives a
clean 384 → 192 → 96 → 48 → 24 → 12 ladder and it is wrong: half a parent's box measured in DEGREES OF
LONGITUDE is wider than a box of half its kilometre half-side placed at the child's own latitude.
Measured for a 384km parent: **1.32km uncovered at 25N, 1.64km at 30N, 2.39km at 40N, 3.29km at 49N**,
recurring at every level and widest where the country is widest. A cell is therefore the inscribed
SQUARE and each child's radius is derived from the box it must cover, rounded up, which gives 192 for
poleward children and 195 for equatorward ones. `_probe-cells.ts` samples each parent's box and
requires every point to land in a child; the naive rule fails it by 22 of 484 points.

**2. `total_count` was already being fetched, printed, and thrown away.**
`src/lib/dataforseo-places.ts:131` has parsed it since the door was built, and `lane.ts` prints it on
every pull card. Nothing stored it. This build did not gain access to the number; it made the number
already on screen authoritative.

**3. An errored pull already advanced the frontier, which is worse than the bug this prompt names.**
This prompt says a pull that errors to zero rows is indistinguishable from an exhausted cell and gets
skipped. True, and there was a second half: depth came from the LABEL, and a label survives a failed
pull, so the queue stepped past 500 records nobody had bought. Fixed by `MapsPull.finished`
(`pull_finished_at` set and no error) in `mapsPullHistory`; depth advances over landed pulls only, and
a cell that fails three times at one offset is refused BY NAME rather than skipped or retried forever.
This reverses store.ts's old "failed batches count as claimed" rule, deliberately: that was the safer
option only while an empty cell could not be told from a broken one.

**4. The probe cost is 2 to 3 times this prompt's estimate.** About 25 of the 57 contiguous-US seed
circles are ocean, Canada or Mexico and read 0 once, forever. Seed layer: 76 circles, $0.94. With
splits expect **300 to 400 probes, $3.70 to $5.00**, not 150 and $1.86. Still 6 to 8% of the ~$63
total, and every card states its own maximum before the reaction.

Also: the cross-run dedupe keys on `place_id`, never `domain` (a twelve-location chain shares one
domain, so a domain rule drops eleven real clinics), and never on `csv:<rowIndex>` (row 17 of every
dropped file carries that key, so a naive rule would delete row 17 of every future file and look like
a working filter). `zip_centroids` looked like a free reverse geocoder and is not: 33,791 rows, and
`state` is 100% NULL because the ZCTA Gazetteer has no state field.

**Decided by Matthew, recorded here:** the 50-metro list and `nextTarget` are DELETED rather than kept
alongside; probe spend is one check mark per `cells` invocation, run by hand; and foreign rows are
KEPT rather than filtered. That last one means a Toronto med spa is kept, enriched and emailed, because
the ICP judges "is this an owner-operated med spa" and not geography. One sentence in `MED_SPA_ICP`
would change that and no code would need to.

## Definition of done

- A cell whose `total_count` is 0 is recorded as done, not retried.
- A cell over the budget splits, and the split is visible in the progress card.
- A pull that errors leaves its cell **unfinished**, which is the bug in today's short-page rule.
- Paging a cell stops exactly at `total_count`, with no request past it.
- No cell is ever paged past offset 100,000; a cell that would need to is split instead.
- A duplicate `place_id` from an overlapping cell is dropped before the qualification sweep.
- Progress reads out by state.
