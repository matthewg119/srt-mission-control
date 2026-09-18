# Post formats, a magnet per post, and the dataset each format leaves behind

A build prompt for a fresh session, written 2026-09-18 on branch `feat/north-star-2`, measured against
production the same day. This is the W3a workstream from
`docs/prompts/2026-09-19-content-engine-and-rerun.md`, rewritten now that the angle lane underneath it
has been read properly and most of it turns out to exist.

**Read first:** `CLAUDE.md`, `docs/DATA-AND-WORKFLOWS.md`, then
`docs/prompts/2026-09-19-content-engine-and-rerun.md` (W3 in particular).

**The ask, verbatim:** *"for those posts that are more like lists comparision (and other divergent
angles, make sure you always give me a list of new angles before making the actual post) those also
need to have a lead magnet for each post that we are creating so the avatar of the page in my case
the little cat can actually recomend those lead magnets. this is like a new category for the types of
posts we create but I always want a list of divergent angles for new variations (and if we select one
make sure we craft the path for systemizing that type of post by extracting the neccesary dataset from
that specific angle, post, type of content."*

---

## Most of this already exists. Read this section before building anything.

Four of the five things in that ask are built, probe-covered, and have simply never been run. Measured
2026-09-18 on `srt-agency-llc` (`4cc5c683-8feb-4f17-8ff5-28d6cc50887a`): `page_plan` 0 rows,
`page_angles` 0, `page_dataset` 0, `page_plan_runs` 0, `client_pages` 0. Step 21 `pre_call_pages` is
`awaiting_me` and has never been walked.

| The ask | Status | Where |
|---|---|---|
| "always give me a list of new angles before making the actual post" | **BUILT** | `angles auto` writes three ideas per page, `angle 3 more` rewrites them, `angle 3 pick 2` keeps one. `page-angles.ts:341` |
| "those also need to have a lead magnet for each post" | **BUILT** | `magnets` / `magnet 3 pick 2`, `offer` a synonym. Magnets mint from the picked ANGLE before the body, so the widget has an offer on first render |
| "the little cat can actually recomend those lead magnets" | **BUILT, but see gap 2** | `rungOf` in `concierge/magnets.ts:121` scores audience, client, vertical, treatment, category. A client magnet scores 8 and outranks every library row |
| "divergent angles for new variations" | **BUILT** | three angles are refused above 0.6 Jaccard overlap with each other and with any page already planned (`MAX_OVERLAP`, `page-angles.ts:128`) |
| "extracting the neccesary dataset from that specific angle, post, type of content" | **HALF BUILT** | `page_dataset` captures the angle, narrative, indoctrination, awareness pair, magnet and the magnets that lost. It captures nothing per FORMAT, because a format does not exist |

‼️ **Do not build a second angle lane, a second magnet lane or a second content model.** The build
prompt already says this about the page plan and it is more true here: the gap is one axis missing from
a working pipeline, not a missing pipeline.

---

## The six gaps, measured

### 1. An angle has no format, so "list" and "comparison" are not things the system can be asked for

`DraftedAngle` (`page-angles.ts:46`) is `idea, promise, narrative, indoctrination, awarenessEntry,
awarenessTarget, proofNeeded, rationale`. There is no format, kind or template field anywhere on the
page side: no `post_type`, `page_kind`, `angle_kind` or `page_format` column on `page_plan`,
`page_angles`, `page_dataset`, `client_pages` or `client_headlines`.

So the three angles offered for a page are three free-form ideas. Nobody can ask for three comparison
angles, and nothing guarantees a spread of shapes across seven pages.

‼️ **`src/config/format-registry.ts` already exists and is NOT this.** It is the Reels axis:
`FormatKind` is `single_shot | reference_remake | script_render | multi_shot_render`, its two rows are
pest-control POV drops, and it keys `content_jobs.format_id`. It is imported nowhere under
`src/lib/clients/` or `src/lib/hub/`. **Name the new one differently** (`post-formats.ts`) or the next
reader will think one file serves both and wire a page through a scene pool.

### 2. ‼️ The magnet category axis is DEAD on a client page, and four library magnets are unreachable

This is the specific reason the cat cannot recommend a per-post magnet today.

- Four library rows carry a category: `Comparison`, `Neighbourhood`, `Guide`, `Objection`
  (`lead_magnets.category`, measured).
- `rungOf` refuses a categorised row when the query has no category
  (`concierge/magnets.ts:131-136`): `if (queryValue === null) return false; // unknown on the query
  never matches a named row`. That rule is correct and must stay.
- `MagnetQuery.category` is fed from `ctx.session.pageCategory` (`concierge/engine.ts:469`, `:493`),
  which is only ever set from the widget's start-call body (`api/concierge/start/route.ts:96`,
  `pageCategory: str(body.category, 40)`).
- **No page ever sends it.** There is no category or format column on `client_pages` or `page_plan`
  to send, and `concierge/for-client.ts:118` and `magnets.ts:408` both pass `category: null` outright.

**The taxonomies already agree, which makes this cheap.** `themeOf()`
(`artifacts/page-candidates.ts:147-169`) already classifies every page candidate into `Objection`,
`Comparison`, `Tool`, `Guide`, `Price`, `Neighbourhood`, `Booking`, `General` and stores it on
`page_plan.theme` (NOT NULL). Three of those strings are exactly three of the four magnet categories.
**Wire `page_plan.theme` through to `pageCategory` and the existing ladder starts working with no new
matching logic.** A format axis then rides the same rail.

### 3. `narrative` and `indoctrination` are captured and archived but never reach the drafter

`page_angles` stores both, `page_dataset` copies both, and `draft-page.ts` receives neither. Grep for
either name in `draft-page.ts` returns nothing. The angle reaches the prompt as **one line**
(`draft-page.ts:1120`): `What this page gives the reader: ${ctx.angle}`, where `ctx.angle` is
`page_plan.angle`, the single sentence `pickAngle` copied over.

So the story spine and the belief the page has to install are decided, stored, snapshotted, and thrown
away at the moment the page is written. Fixing this is independent of the format work and is probably
the largest quality win in the lane.

### 4. Every page is drafted from ONE shape

`OutlineContext` (`draft-page.ts:801`) is `workingTitle, targetKeyword, angle, headline` and has no
format parameter. `OUTLINE_LIMITS` (`:825`) fixes 6 to 14 sections, `minDivergent: 5`, an answer-first
opening and 3 to 8 gaps for every page ever drafted. A list post and a comparison post are the same
document with different words.

### 5. `page_dataset` cannot record what it was told to record

Two defects, both measured:

- **`batch_id` and `vertical_slug` have no writer.** `CaptureInput` declares both
  (`page-dataset.ts:27-36`) and no caller passes either. `attachResearchPrompt` filters
  `.eq("batch_id", args.batchId)`, so **`research_prompt` can never be filled**.
- **`edited` and `published` captures pass no `planRowId`** (`page-studio.ts:1369`,
  `api/clients/[id]/hub/route.ts:344`), so those rows get null for `angle_id`, `angle`, `narrative`,
  `indoctrination`, `audience_id`, `offer_id`, `magnet_candidates` and every keyword field. The corpus
  records the draft and then forgets what the published page argued.

### 6. Two tables are dropped by an archive

`page_angles` and `page_plan_runs` are absent from `ARCHIVE_TABLES` (`archive.ts:25-37`, which does
list `page_dataset`, `page_plan`, `page_candidates`, `page_magnet_candidates`, `page_gate_runs`,
`page_sources`). A client archive or delete loses every angle ever generated and every plan snapshot.
Given SRT was archived and restarted once already, this has probably already cost real data.

---

## The build, in order

### B1. `src/config/post-formats.ts`, the written-post format axis

Pure data, the shape `format-registry.ts` got right, for pages instead of Reels. One row per format:

- `id` (`list`, `comparison`, `decision_guide`, `teardown`, `answer_first`)
- `label`, and the `theme` / magnet `category` it maps onto, so gap 2's rail is reused rather than
  forked
- `askedAs`: how an angle for this format is requested of the model (a list needs an N and a ranking
  basis; a comparison needs exactly two subjects and the axes they are compared on)
- `dataset`: **the fields this format must extract**, which is the "systemizing" half of the ask.
  A comparison's dataset is the two subjects, the axes, and the verdict per axis. A list's is N, the
  items, and what ranked them. This is what makes a format a repeatable path instead of a label.
- `outline`: the per-format overrides for `OUTLINE_LIMITS` (gap 4)

‼️ **Drive it from the pillars, not a fresh brainstorm**, which the original W3a already insists on.
`client_keywords` carries `role` (pillar/support) and an awareness stage; `client_headlines` holds 33.
A format takes a pillar keyword and emits candidate angles per format, so the resources plan and the
client page plan argue from one source.

### B2. The format reaches an angle, and a person picks it

- Add `format` to `page_angles` and to `page_plan` (SQL below).
- `DraftedAngle` gains `format`, validated against the registry in `angleFaults` so an invented format
  is a fault like an orphan number already is.
- `generateAnglesForPlan` asks for a **spread**: three angles of different formats for the same
  keyword, which is a better use of the three options than three ideas of the same shape. The 0.6
  Jaccard rule stays exactly as it is.
- The grammar extends rather than changing: `angles auto` still works, and `angle 3 pick 2` still
  picks. Add `angles list` / `angles comparison` to ask one format of every page, reusing
  `parseAngleCommand`'s existing `what` discriminant pattern. ‼️ `AUTO` is tested before `LIST` and
  the comment at `page-angles.ts:333` says why; a new verb goes in that order deliberately.

### B3. The magnet and the cat

- `pickAngle` already copies the idea to `page_plan`. It also writes `page_plan.format` now.
- `draftMagnetsForPlan` sets the new magnet's `category` from the format's mapped category, so the
  minted client magnet is reachable by a categorised query.
- **Thread `page_plan.theme`/`format` through to the widget** so `pageCategory` is no longer always
  null: the page render passes its category into the concierge start call, and `for-client.ts:118`
  stops hard-coding `category: null`. This is gap 2 and it is the difference between the cat
  recommending the right magnet and the cat recommending the ladder's default on every page.
- ‼️ Do not touch `rungOf`'s null rule. A named row must keep refusing an unknown query, or every
  categorised magnet becomes reachable from every page and the axis stops meaning anything.

### B4. The drafter, per format

`OutlineContext` gains `format`, `narrative` and `indoctrination` (gaps 3 and 4). `OUTLINE_LIMITS`
becomes per-format with the current values as the `answer_first` default, so nothing already working
changes shape.

### B5. The dataset each format leaves behind

- Fix gap 5 first, or the corpus records the new axis as badly as it records the current one: pass
  `planRowId` from the `edited` and `published` captures, and either write `batch_id` or delete it and
  `research_prompt`'s dependency on it.
- Add `format` and a `format_dataset jsonb` to `page_dataset`, filled from the registry's `dataset`
  declaration for the picked format.
- Add `page_angles` and `page_plan_runs` to `ARCHIVE_TABLES` (gap 6).

### B6. `/resources` in `srt-agwb` (separate repo, do last)

`srtagency.com/resources` has 4 live guides and 3 categories in use (`ai-tools`, `crm-sales`,
`payroll-hr`), and one guide is already a list (`small-business-ai-stack-7-tools`). Once B1 exists, the
resources plan is the same registry applied to SRT's own pillars. Do not start here: the engine belongs
in `srt-mission-control` and the site consumes it.

---

## The SQL

‼️ **Verify every column against the live shape before running it**, because `page_dataset` was found
in production with 26 columns and no `CREATE TABLE` under `docs/` anywhere. Run
`bunx tsx --env-file=.env.local scripts/_probe-migration-state.ts` first and paste the whole migration
to Matthew in a fenced `sql` block, never a file path. It needs to run **before** the deploy that reads
it.

```sql
-- Post formats: the axis, on the three tables that carry a page's decisions.
-- Nullable everywhere on purpose: every existing row predates the axis and must stay readable.

alter table public.page_angles   add column if not exists format text;
alter table public.page_plan     add column if not exists format text;
alter table public.page_dataset  add column if not exists format text;
alter table public.page_dataset  add column if not exists format_dataset jsonb not null default '{}'::jsonb;

-- ‼️ NO CHECK CONSTRAINT ON format. The registry in src/config/post-formats.ts is the authority, and a
-- database check would mean a migration every time a format is added, which is exactly the per-format
-- island the format registry pattern exists to avoid. angleFaults() validates it on the way in.

create index if not exists page_angles_format_idx  on public.page_angles (client_id, format);
create index if not exists page_dataset_format_idx on public.page_dataset (format, captured_at desc);

-- Verification, and it must be run and read rather than assumed.
select 'page_angles.format'  as col, count(*) from information_schema.columns
  where table_name = 'page_angles' and column_name = 'format'
union all select 'page_plan.format', count(*) from information_schema.columns
  where table_name = 'page_plan' and column_name = 'format'
union all select 'page_dataset.format', count(*) from information_schema.columns
  where table_name = 'page_dataset' and column_name = 'format'
union all select 'page_dataset.format_dataset', count(*) from information_schema.columns
  where table_name = 'page_dataset' and column_name = 'format_dataset';
```

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts && bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx --env-file=.env.local scripts/_probe-page-angles.ts
bunx tsx --env-file=.env.local scripts/_probe-page-datasets.ts
bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts
bunx tsx scripts/_probe-step-rerun.ts
```

> A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

`_probe-page-gate.ts` fails **two** checks today (`no evidence at all blocks`, `an evidenced page
passes`) and both are pre-existing. Confirm the same two rather than assuming.

A new format needs a probe that asserts the registry and the database agree, in the shape
`_probe-declared`-style checks already use: every format id the angle generator can emit is in the
registry, every registry row declares a `dataset`, and no format maps to a magnet category that no
`lead_magnets` row carries.

---

## Rules that have already cost a day each

- **One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather than
  throwing.** Hit again while measuring for this prompt: a `clients.name` in a select made
  `srt-agency-llc` look as though it did not exist. Any lane that reads a table needs a live probe
  running the real select.
- **A killed lambda wedges a delivery step in `running` for ever.** Single writer,
  `step-engine.ts:2835`, and there is no reaper. Step 20 was found wedged on 2026-09-18. `rerun 20`
  recovers it because a re-run writes `pending` first.
- Write TypeScript containing regexes or escapes with the Write tool; heredocs and `sed` mangle escapes.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything through `bodySections()`.
- Slack rejects a message whose buttons share an `action_id`; suffix `#1`, `#2` and let the dispatcher
  strip it.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
