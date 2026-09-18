# The compliance gate, the context database, and a system that learns from every post

A build prompt for a fresh session, written 2026-09-18 on branch `feat/north-star-2`, measured
against production the same day.

**Read first, in this order:**

1. `CLAUDE.md` and `docs/DATA-AND-WORKFLOWS.md`
2. `docs/prompts/2026-09-20-post-formats-and-magnets.md`: **BUILT** (`187e33d`), **migration RUN and
   verified** (five columns, two indexes, `_probe-post-formats --live` 120/120)
3. `docs/prompts/2026-09-21-headline-shapes-and-the-emotional-layer.md`: **NOT BUILT** (`5f335b4`).
   **Its three workstreams come first.** This prompt assumes they land, and repeats the two
   corrections it carries so neither is re-derived wrongly.

---

## Carried forward from the 2026-09-21 prompt, because both were nearly lost

> ‼️ **`ingestEmotional` IS CALLED.** A report claimed it was an uncalled writer. It is routed at
> `precall-headlines.ts:650` inside `handlePreCallHeadlineReply`, reached from
> `api/slack/events/route.ts:1209`, gated on `stepKey === "pre_call_pages"`, and `isHeadlineCommand`
> covers the `EMOTIONAL` regex. A grep for the symbol across `src/app/` finds nothing and reads as
> dead. It is not. **What is wrong with it is what it COUNTS and where it FILES**, not that it is
> unreachable.

> ‼️ **`offer.outcome_promise` and `offer.positioning` are NULL on a LOCKED offer** for
> `srt-agency-llc`. `STEP_NEEDS.offer_locked.needs` lists `offer.outcome_promise`, so the gap lane
> knows, but the lock verifier does not refuse on it. **Step 10 reports complete while the headline
> engine has no promise to write toward.** Decide whether a lock without one is refusable, and say
> which. This is a decision, not a bug to silently fix.

And the emotional layer, restated because W5 below depends on it: `emotionalLayer()` counts
`question_bank` rows filtered **on `vertical` alone**. SRT's vertical carries 47 objection phrases
against a floor of 20, so the gate passes. For that client specifically: **0** `CUSTOMER_REVIEW`
sources, `vocabulary` is `{}` still marked `source: 'preset'`, and `question_bank` has no `client_id`
at all. So `vocBlock` renders empty and nothing says why. The fix is three tiers (this client's
reviews, then vertical **+ avatar**, then the shared bank) and an `EmotionalLayer` that reports
**which tier answered**, because "47 on file" and "47 on file, none of them this client's" are
different facts.

---

## The ask, verbatim

*"lets build it in a new window so we can make sure all of our stuff is compliant [Google's content
guidelines, the full pre-publish reviewer system prompt, the official source list]. How can we build
the context database and how are we going to communicate with the context database? i say ideally in
the srt aeo drafting channel that is the one that should say "scan for latest XYZ" once per week at
least... Also we need to make sure the system learns from each post we make ... so if it wants to
extract fragments of data to systemize certain "type of posts" allow it to categorize to get as much
data as possible in order to make our posts better in the future and so it understands the wants and
needs and context of each customers business (the more it understands the business the better it will
write about the business itself) so if it needs more data aswell allow our onboarding intelligence to
ask for the data or opinions and for major decisions for the drafting stuff like new datasets
recommended make sure all sugestions go directly to srt aeo drafting and always point the source of
where it got the idea from if its any other open conversation for other customers or a new page for a
new client based on what they need / suggestion but mostly for datasets to become more specific and
ways for us to get as much broad context as possible."*

---

## ‼️ What exists, and the four things that do not

| The ask | Status | Where |
|---|---|---|
| A pre-publish quality gate with block/warn tiers, verdict history and staleness | **BUILT** | `page-gate.ts`, `page_gate_runs`. A model read-through already runs and yields three checks from one call |
| Anything about Google's guidelines | **NOTHING.** Zero grep hits on `e-e-a-t`, `helpful content`, `spam polic`, `search essentials`, `quality rater`, `scaled content` across `src/`, `docs/*.sql`, `scripts/` | |
| A global, versioned document store | **DOES NOT EXIST.** Everything carries `client_id`, or is keyed by `vertical`, or is `knowledge_entries` | |
| A weekly cron | **DOES NOT EXIST.** All 17 entries are hourly, daily or weekday | |
| Folding a weekly job into a daily cron | **BUILT, seven times over** | `/api/cron/followup-digest` carries seven passengers, each separately `.catch()`ed |
| A scheduled external fetch | **DOES NOT EXIST.** The only `fetch(` in any cron route is an internal self-call | |
| Fetch-and-store with politeness rules | **BUILT** | `robots-check.ts`, `harvest.ts` `fetchPageText`, `dataset-cache.ts` `getOrFetch` |
| Suggestions that cite the rows they read | **BUILT** | `suggestions.ts` `Suggestion.basis`, rendered as `_read from: ...`, asserted by `_probe-suggestions.ts` |
| Suggestions PUSHED, or landing in the drafting channel, or sourced from another client | **NONE OF THE THREE** | `suggest` is typed by a person and posts into client step threads |
| A corpus of what every page was written FROM | **BUILT and append-only** | `page_dataset` |
| Anything READING that corpus | **ZERO READERS IN `src/`.** Two writes, no selects. The only `SELECT` anywhere is a row count in a probe | |

---

## W1. The context database: a global, versioned, append-only document store

### ‼️ Three homes were considered and all three are wrong. Read this before choosing.

**`knowledge_entries` is global and is the wrong home.** `buildSystemPrompt()` (`src/lib/ai.ts:70-77`)
selects **every** row, unfiltered and unbounded, and concatenates them into the Office Manager's
system prompt. `docs/2026-09-02-knowledge-seed.sql:4` states that hazard out loud. Filing Google's
guidelines there puts the entire corpus into every CRM chat, every Telegram message and every
dashboard conversation, permanently, for a lane that has no use for it.

**`audience_documents` has exactly the right discipline and the wrong scope.** Append-only,
`superseded_at`, replacement only through the atomic `supersede_audience_document()` RPC, `source`,
`source_url`, `status`, `faults`, and *"a draft with faults cannot be approved"*. But `client_id` and
`audience_id` are both NOT NULL. Guidelines belong to no client and no audience, and inventing one
for them is how a shared thing acquires a fake owner.

**`client_datasets` is a CACHE and it REPLACES.** Its own header, corrected 2026-09-18: *"IT IS NOT AN
ARCHIVE. The write below is an upsert on (client_id, kind, cache_key), and on conflict Postgres
REPLACES the row."* A weekly scan exists to answer **what changed since last week**, which an
overwriting cache structurally cannot.

### So: a new table, modelled on `audience_documents`, keyed by nothing

`policy_documents`, or whatever it ends up called. One row per fetched-or-pasted version of one
source. Append-only. `superseded_at` rather than an update. `source_url`, `fetched_at`,
`content_hash`, `source` (`fetched` | `pasted`), and a `kind` naming which of Google's pages it is.

‼️ **`content_hash` is what makes the weekly scan cheap and honest.** Same reasoning as
`page_gate_runs.body_hash`: a version is a statement about bytes. Re-fetching an unchanged page must
write nothing and say nothing, or the channel gets a card every Thursday that nobody reads. A changed
hash is the entire trigger for the diff card in W2.

### The sources, from the ask

`creating-helpful-content`, `spam-policies`, `search-essentials`, `using-gen-ai-content`,
`search-central-blog`, and the Quality Rater Guidelines PDF.

‼️ **The rater guidelines are a ~180 page PDF and must not be fetched weekly.** Treat it as
`source: 'pasted'`, versioned by hand when Matthew replaces it. The five HTML pages are the weekly
scan's business.

### ‼️ The document is the reference. The RULES are a compiled, bounded block.

`callClaudeJSON` takes a plain `system: string` and has **no `cache_control` support** anywhere; the
only prompt caching in the repo is the Call Coach's `/suggest` route, which builds its own Anthropic
request. So a long guidelines corpus in the gate's system prompt is paid **in full on every Check
press**, uncached, and `check` is explicitly designed to be run several times while writing.

This is also the repo's own doctrine arriving from the other direction, stated four times: *"a prose
guard is not a guard."* A policy that must bind is a constant or a pure function.

**So the store holds the full text, and a compiled `GUIDELINE_RULES` block, short and bounded, is what
reaches the prompt.** When a new version lands, the card in W2 asks Matthew whether any rule changed;
editing `GUIDELINE_RULES` is a code change somebody makes on purpose. The store answers "what did
Google say in week 38"; the constant answers "what do we refuse".

---

## W2. `scan for latest` in the drafting channel, once a week

### The cron

‼️ **There is no weekly cron and you may not add one.** `vercel.json` carries 17 entries against a
Hobby plan that documents 2, and the warning is restated in five files (with the count drifting from
14 to 17, which `followup-digest/route.ts:45-50` calls out: *"a stale number in a warning is how a
warning stops working"*).

**Ride `/api/cron/followup-digest` as the eighth passenger**, gated on the weekday inside the handler.
That is how `runWeeklyReports` and `runWeeklyHeadlines` already work.

- **Thursday, UTC (`weekday === 4`)**, the same day both existing weekly jobs use.
  `weekly-headlines.ts:28-34` states why they share a day: *"Both are 'here is this week's work' and a
  person reading one is in the frame of mind for the other. Splitting them across two days means two
  separate interruptions for the same job."*
- ‼️ **Each passenger is separately `.catch()`ed** so it can never 500 the host job. Copy that shape
  exactly.
- ‼️ **The ISO week is the idempotency key and the output is its own ledger.** The digest is a DAILY
  cron so this fires seven times a week and must write once. `weekly-headlines.ts:11-14`: *"No new
  table: the rows it writes carry the stamp, so 'have I run this week' is a question the output itself
  answers."* `policy_documents.fetched_at` plus the ISO week answers it here too.
- ‼️ **Do NOT add it to `WATCHED_CRONS`.** `cron-health.ts:33`: only crons that log a success event
  **unconditionally** belong there, and a weekday-gated passenger does nothing six days in seven.

### The fetch

There is no scheduled external fetch in the repo today, but the fetch-and-store pattern is fully
built. Copy `robots-check.ts`'s shape and its rules:

- A declared `User-Agent`, a timeout (`8000ms`), a byte cap (`MAX_BYTES`), `redirect: "follow"`.
- ‼️ **A failure is NEVER stored.** `robots-check.ts:216-221`: *"`[]` is a real answer and is worth
  keeping. `null` is 'we could not check', and caching it would answer every later audit of this
  domain with our own timeout."* A failed fetch writes no version and says so on the card.
- ‼️ **Store the TEXT, never the HTML.** `harvest.ts`: *"What the page SAID is a fact and keeps; what
  we make of it is recomputed every run."* The extraction is live code; freezing it freezes a page's
  answers to whichever ruleset was current the day it was first read.
- These are Google's own public docs, not a client's site, so no SSRF boundary is needed. The URLs are
  a fixed list in code, never user-supplied. **Keep it that way**, because the moment the list is typed in
  Slack, `assertPublicHost()` becomes mandatory.

### The card, and the channel

Posts into `#aeo-seo-page-drafting` via `pageStudioChannel()`
(`SLACK_PAGE_STUDIO_CHANNEL`, default `C09QPHZGPUY`). A cron passenger can post there directly with
`slack.postThreadReply` / `postMessage`; **only inbound replies need a router branch**.

- **Nothing changed:** post nothing. Silence is the correct output six weeks in seven, and a weekly
  "no change" card is the pace card wearing a new hat.
- **Something changed:** one card naming which source, what changed (a diff of the stored text against
  the previous version), and the one question that matters: *does any of this change
  `GUIDELINE_RULES`?*
- **A typed `scan for latest`** in the channel runs it on demand. ‼️ **Anchor the regex at both ends.**
  The page studio's governing rule, stated three times in that file, is that **anything not matched is
  appended to the page verbatim**, and two live captures (`"avatars are hard to write"`,
  `"avatar research takes a while"`) were swallowed that way. A loose guidelines verb would file
  somebody's sentence into a page.
- ‼️ **The bot must be a member of the channel.** `slack-bot.ts:487` records that
  `#aeo-seo-page-drafting` *"sat dead for weeks"* on exactly this.

### Env

```
SLACK_PAGE_STUDIO_CHANNEL=   # already used, default C09QPHZGPUY, NOT in CLAUDE.md's env list.
                             # Also duplicated at ops-index.ts:168 rather than imported. Fix that.
```

---

## W3. The compliance checks, inside the gate that already exists

### ‼️ It is checks in the SAME run. Not a second gate, and not a second run.

`assertGatePassed` reads **exactly one row** (`latestGateRun`, `order created_at desc limit 1`). A
separate compliance run written to `page_gate_runs` would **become** the latest run and silently
replace the quality verdict. That is what "not a second gate" means structurally rather than
rhetorically.

**No migration.** `page_gate_runs.checks` is unconstrained `jsonb`. A new `{key, tier, status, detail}`
entry fits. The only registration point is the `checks: GateCheck[]` literal at `page-gate.ts:843`:
there is no registry, no config array, no per-check table.

### ‼️ One model call, extended. Not a second call.

`modelChecks()` already returns five fields from one call and yields **three** `GateCheck`s across two
tiers. Extend `REVIEW_SYSTEM` and `ModelVerdict` rather than adding a second call, because:

- `runGate` has three callers and `check` is designed to be pressed repeatedly while writing. A second
  call doubles the cost of every press.
- `page_gate_runs.model` is **one nullable text column**, already overloaded with the literal
  `"waiver"`. Two calls need two answers in one column.
- The catch branch collapses the three checks into a single `model_review` skip. A second call needs a
  second catch, and two skip paths disagree about what ran.

### ‼️ Where the block/warn line falls, and why most of Google's guidance is WARN

The file's own rule: *"A gate that blocks on taste gets waived out of habit within a fortnight, and a
rail everybody steps over is worse than no rail because it looks like one."*

By that definition **helpful-content signals, E-E-A-T impressions and "does this read as
mass-produced" are taste**, and belong at `warn` beside the existing `generic` check.

The narrow slice that earns `block` is the same shape as the existing `unsupported` check: **a factual
claim about experience, credentials, qualifications or first-hand use that no source carries.** That is
publishable-and-false on a domain the client controls, under their name. E-E-A-T is not one check; its
**Experience** half is a claim about the world and its **Authoritativeness** half is an impression.
Split them across the two tiers accordingly.

The pasted reviewer prompt's `APPROVED / NEEDS FIXES / REJECT` maps onto the existing
`pass / warn / block` exactly. **Use the existing vocabulary.** A third verdict word would need a SQL
CHECK change and would mean the board renders two scales.

### ‼️ `hashBody` covers `answer_md` ONLY

Not the title, not the meta description, not the slug, not the author, not the schema. A compliance
check reading any of those produces a verdict that does **not** go stale when they change, which is a
green light on unread text, which is the one failure the whole gate exists to prevent.

**Either keep every compliance check on the body, or widen `hashBody` deliberately and say so**, and
if you widen it, every stored verdict goes stale at once, which is correct but must be expected rather
than discovered.

### The rest, inherited for free

- **The skip rule.** Copy `model_review`'s catch verbatim: *"A FAILED REVIEW IS A SKIP, NOT A PASS AND
  NOT A BLOCK. Passing would let an API outage publish anything. Blocking would make every page in the
  system unpublishable while a vendor is down, on a check that never actually ran."*
- **Waivers.** `waiveGate` copies the previous checks forward and appends one `waived` entry. A new
  block-tier check inherits waivability automatically, and **there is no per-check waiver**: one press
  waives everything at block tier. Decide whether that is acceptable for a compliance refusal or
  whether this is the moment per-check waivers earn their keep.
- **The publish ordering is already correct** and must not move: Day 0 wall, then
  `assertGatePassed`, then `setPublished`. Both hole-check greps must still return exactly one caller
  each.

---

## W4. Suggestions, pushed to the drafting channel, always citing the source

### What exists

`Suggestion` carries `{ title, why, command, basis }` and the file's rule is *"a suggestion with no
basis is an opinion."* `suggestionLines()` renders `_read from: ${s.basis}_` per suggestion and closes
with *"Suggestions only. Nothing here has been run."* `_probe-suggestions.ts` asserts every basis
matches `/client_[a-z_]+|page_[a-z_]+|STEP_NEEDS/`.

> ‼️ That regex asserts a **source**, not a count. A digit was required once and reverted, correctly:
> *"'client_delivery_steps, walked in order with the blockedBy declarations' is a complete answer to
> 'where did you read that' and there is no number in it. Requiring a digit would have pushed somebody
> to invent one."* Do not put the digit back.

### What is missing: push, channel, and cross-client sourcing

1. **Push.** `suggest` is typed by a person. Nothing posts unprompted. The Thursday passenger is the
   natural carrier: same cron, same day, same frame of mind.
2. **Channel.** Suggestions land in client step threads behind `isClientChannel`. Matthew asked for
   them in `#aeo-seo-page-drafting`. ‼️ **A suggestion about client A posted into a shared drafting
   channel is a different privacy surface from one posted in client A's own thread.** Name the client
   explicitly; never post a client's verbatim words there without saying whose they are.
3. **Cross-client sourcing**, which is the hard half.

### ‼️ The cross-client doctrine, and the one line that already does this right

The rule, gathered from roughly twenty sites: **sharing is legitimate when the unit is a fact about a
vertical, an avatar, a domain or a public URL**, and those tables deliberately carry no `client_id`, and
the absence of the column is the enforcement. It is **forbidden when the unit is a measurement about
one client.** Because there is no per-client key, a wrong write is **not correctable**, so every writer
into a shared table must either refuse loudly or write only over NULL, and reads **filter rather than
delete**.

`final-prompt.ts:161-164` is the only place in the repo that tells a reader an input came from other
clients:

```ts
out.push(`This avatar's research is shared with ${brief} other client${brief === 1 ? "" : "s"} in the vertical.`);
```

**That is the model.** An idea learned from another client is a legitimate thing to surface **as a
citation**, and must never be merged into the receiving client's own record. A suggestion that says
*"another client in this vertical answered this and it worked"* is honest. One that files that answer
into this client's `page_sources` is the poisoned-corpus failure every one of those twenty comments is
about.

**Practically:** widen the probe's `SOURCE` regex to admit `avatar_briefs` and `question_bank`, and
make a cross-client basis name the **shared** table it read, never the other client's row. If a
suggestion genuinely needs to name another client, name the client and say so in the open; do not
launder it through a table name.

---

## W5. Learning from every post, and asking for what is missing

### `page_dataset` has ZERO readers, and that is the whole opportunity

Two writes in `page-dataset.ts`, no selects, in all of `src/`. The drafter never touches it. The only
`SELECT` against it anywhere is a row count in a probe. It is a write-only corpus, exactly as designed,
waiting for a reader.

The 2026-09-20 build made it worth reading: every row now carries `post_format`, `format_dataset`
(`{format, values, missing}`), the angle, the narrative, the indoctrination, the batch, the vertical
and the magnet candidates.

### ‼️ What it can honestly learn from, and what it cannot

**It cannot learn from outcomes.** There is no ranking, no traffic, no citation signal, and this is
refused deliberately in three places: `page-dataset.ts:17-20` refuses ranking and citation columns,
`weekly-report.ts` carries `ATTRIBUTION_NOT_WIRED` and tells the client so in writing, and
`suggestions.ts:154-170` says out loud to the operator that page performance is not measured. **A
learning loop that quietly implied otherwise would be the worst thing in this prompt.** The nearest
measured thing is `fanout_citations`, which `suggestions.ts:167` already names as what would measure it.

**It CAN learn from the draft-to-publish diff**, which is precisely what the append-only design exists
for: *"The value of this table is the DIFFERENCE between what the model drafted and what actually
shipped."* Three rows per page (`drafted`, `edited`, `published`) and the diff between them is a record
of what a person changed about a model's work. That is a real signal, it is already being collected,
and nothing has ever read it.

**And it can learn what each format actually extracts.** `format_dataset.missing` names the required
fields nobody answered, per page, per shape. Aggregated across pages it answers *"a comparison page
always lacks its verdict-per-axis"*, which is a fact about our process and is exactly the
"systemize a type of post" the ask describes.

### The shape of the work

- One reader module over `page_dataset`, pure where it can be, aggregating by `post_format` and by
  client.
- ‼️ **Per-client and per-vertical answers are different answers and must not merge.** "This client's
  comparison pages always lack a verdict" and "comparison pages in general always lack a verdict" send
  somebody to two different places.
- Feed the aggregate into the Thursday suggestions card with a `basis` naming `page_dataset` and the
  row count, which the existing contract already requires.
- ‼️ **Every claim cites a count of rows.** D9 binds hardest here because a suggestion is the most
  actionable thing this system emits.

### Asking for what is missing

The ask says the onboarding intelligence should ask for data and opinions when it needs them. **That
machinery is built and is the subject of the 2026-09-21 prompt**: `DATASET_FIELDS` (71 fields),
`STEP_NEEDS`, `gapsFrom`, `promptsFromGaps`, the `research:` file-back, and `buildFinalPrompt`, which
is already the "everything we know about this client" bundle and already refuses rather than degrading
when a dataset is unreadable.

**What this prompt adds is the other direction:** `format_dataset.missing` is a per-page, per-shape
record of what nobody answered, and it should feed the SAME gap lane rather than a second one. A field
that pages keep missing is a field the research prompt should start asking for.

---

## The SQL

‼️ **Run it through the runner**, not the Supabase SQL editor:

```
bun run scripts/db.ts --file=docs/2026-09-22-policy-documents.sql [--dry]
```

The editor runs a pasted file as one implicit transaction, so a verification SELECT at the foot
failing rolls the whole migration back and looks exactly like "the migration did nothing". The
2026-09-18 migration was run in the editor and did land; that was luck, not a precedent.

Shape, to be confirmed against the decisions above before running:

```sql
-- Google's published guidance, versioned. Global: this belongs to no client and no audience.
--
-- ‼️ NOT knowledge_entries. src/lib/ai.ts reads EVERY row of that table, unfiltered and unbounded,
-- into the Office Manager's system prompt on every message. A guidelines corpus there would be paid
-- for on every CRM chat forever, by a lane that has no use for it.
--
-- ‼️ NOT client_datasets. That is a CACHE and it REPLACES on conflict, so it structurally cannot
-- answer "what changed since last week", which is the entire point of the weekly scan.
--
-- APPEND ONLY, superseded rather than updated, the discipline audience_documents already keeps.

create table if not exists public.policy_documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  source_url    text,
  title         text,
  content       text not null,
  -- sha256 of the normalised text. An unchanged fetch writes NOTHING and posts NOTHING: a weekly
  -- "no change" card is a card nobody reads by week three.
  content_hash  text not null,
  source        text not null check (source in ('fetched', 'pasted')),
  fetched_at    timestamptz not null default now(),
  superseded_at timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists policy_documents_live_idx
  on public.policy_documents (kind, fetched_at desc) where superseded_at is null;
create unique index if not exists policy_documents_version_idx
  on public.policy_documents (kind, content_hash);

alter table public.policy_documents enable row level security;

comment on table public.policy_documents is
  'Published external guidance, versioned and append-only. The compiled rules that BIND live in '
  'code; this is the reference a person reads when deciding whether those rules changed.';

-- Verify. Expect one row.
select table_name, count(*) as cols
from information_schema.columns
where table_schema = 'public' and table_name = 'policy_documents'
group by table_name;
```

> No `client_id`, deliberately, and that absence is the enforcement: this is a fact about the public
> world, which is the one thing the cross-client doctrine says may be shared.

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts && bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts
bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bun  run --env-file=.env.local scripts/_probe-page-datasets.ts
bunx tsx --env-file=.env.local scripts/_probe-post-formats.ts --live
bunx tsx scripts/_probe-step-rerun.ts
```

> A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

‼️ **`_probe-page-gate.ts` fails TWO checks today and both are pre-existing** (`no evidence at all
blocks`, `an evidenced page passes`). **Confirm the same two rather than assuming**, and note the probe
runs with `skipModel` by default, so a model-backed compliance check needs `--model` to be exercised
at all.

**The new probe** asserts offline: that a compliance check at `block` tier only ever fires on a claim
no source carries; that every other compliance check is `warn`; that a failed model call yields a
`skip` and never a pass; that `verdictOf` is unchanged; that the guidelines block reaching the prompt
is bounded in length; and that an unchanged fetch writes no new `policy_documents` row.

**The end-to-end test** is one page through the studio: `check` shows the compliance checks in the same
verdict card, a page with an unbacked credential claim blocks, a merely generic page warns, and
`page_publish` refuses with `gateReason: "blocked"` and `waivable: true`.

---

## Rules that have already cost a day each

- **One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather
  than throwing.** Every new read is its own tolerant select.
- **`assertGatePassed` reads ONE row.** A second run replaces the first as far as publishing is
  concerned.
- **`hashBody` covers `answer_md` only.** A verdict about anything else does not go stale.
- **A failed model check is a SKIP.** Never a pass, never a block.
- **A failed fetch is never stored.** Caching our own timeout answers every later read with it.
- **Store the text, never the HTML.** The extraction is live code and must be recomputed.
- **No new cron.** 17 against a plan documenting 2. Ride the daily digest and gate on the weekday.
- **Anchor every new Slack verb at both ends.** In the page studio, unmatched text is appended to the
  page verbatim.
- **Shared tables hold facts about the world, never measurements about a client**, and a wrong write
  there is not correctable.
- Write TypeScript containing regexes or escapes with the Write tool; heredocs and `sed` mangle escapes.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything through `bodySections()`.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
