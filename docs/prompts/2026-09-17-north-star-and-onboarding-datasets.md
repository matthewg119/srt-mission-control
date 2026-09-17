# Build the North Star: one place that knows everything about a lead, and asks for what is missing

A build prompt for a fresh session, written 2026-09-17. **Scan first, plan second, build third.** Every
number in a **Ground truth** block was measured against the production database on 2026-09-17 and is
quoted, not remembered. Line numbers drift; symbol names and row counts do not.

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-offers"     # or your own worktree off origin/main
git fetch origin && git log --oneline -1 origin/main
```

Read `CLAUDE.md` and `docs/lanes/CONTRACT.md` before writing code. Work in your own git worktree; run
`git branch --show-current` before every commit.

**Out of scope:** finishing the scraper's Workflow C (the picker wiring and the stage walker). That is
a separate day. **In scope from that lane:** every byte it pulls gets saved the same way an audit does.
See W6.

---

## What this build is

Matthew, 2026-09-17:

> Ideally we will have our enrichment program and research so if we want to do some research about that
> specific lead we can do it right in the lead. This will give us absolute full context, this is what I
> want for my next build.

> Scan all of the data this lead currently has and it asks bulletpoint questions with the things we are
> missing in order to complete X onboarding step in the process, this way it has full context on all of
> the lead.

So: **one North Star per lead.** It holds everything known about them, it knows what each onboarding
step needs, it asks for exactly what is missing in bullets, and research and enrichment can be run from
inside it rather than somewhere else and pasted back.

### ‼️ On the name, once, then it is settled

"north star" already appears in this repo meaning something narrower: the one belief a prospect must
hold before the offer is presented (`src/config/avatar-framework.ts:251`, and
`src/config/verticals.ts:174` calls it "the hinge / north-star belief"). Matthew has read that and
asked for a NEW North Star anyway. **Build it. Do not re-litigate.**

The rule that keeps both usable: **the North Star is the whole picture of a lead; the north star BELIEF
is one node inside it.** When you touch the old term in code or copy, rename it to `hinge_belief` or
`necessary_belief` so there is exactly one North Star. Do that as a mechanical rename in its own commit,
never mixed into feature work.

---

## Ground truth, measured 2026-09-17

### The onboarding

| Table | Rows | What it means |
|---|---|---|
| `clients` | 5 | **Only `srt-agency-llc` is real.** `adsad`, `flow6/7/8-<ts>` are test rows with 0 of everything |
| `client_delivery_steps` | 41 | Exactly one client's board. Nobody else has been walked |
| `client_audiences` / `client_offers` | 1 / 1 | |
| `audience_documents` | **2** | 1 `deep_research`, 1 `awareness_ladder`. **`avatar_sheet`, `short_offer`, `necessary_beliefs` and `sales_letter` have never been written for anybody** |
| `client_keywords` | 385 | |
| `keyword_runs` / `keyword_decisions` | **0 / 0** | 385 approved keywords and no record of a single decision that produced them |
| `page_plan` / `page_angles` / `client_pages` | **0 / 0 / 0** | **No page has ever been drafted for anybody.** Step 21 has never completed |
| `page_dataset` | **0** | The training corpus. Created 2026-09-17, never written to |
| `page_gate_runs` | 0 | The quality gate has never run |
| `client_headlines` | 33 | Written, none kept |
| `client_events` | 136 | Append-only, per client, and **nothing reads it back into a reply** |

### The raw data we already bought, and what we kept

| Table | Rows | |
|---|---|---|
| `audit_runs` | **2,900** | 1,880 carry `raw_response`, 2,900 carry `citations`, 2,900 carry `recommended` |
| `fanout_citations` | **6,060** | the backfill ran |
| `fanout_runs` | 1,378 | but `fanout_queries` is **10**. The searches the engine ran are still barely captured |
| `market_mentions` | 3,279 | already a labelled extraction of who the engines name instead |
| `audit_reports` | 104 | 15 carry a `client_id` |
| `niche_briefs` | 12 | per-vertical research, cached 30 days |
| **`client_datasets`** | **0** | the paid-pull cache, correct shape, **zero inserts ever** |
| `query_index` / `client_url_inventory` | 0 / 0 | |

### ‼️ The three columns that exist and are still being thrown away

`docs/2026-09-14-audit-foundation.sql` added them. Measured across 104 reports:

```
site_crawl        1 of 104
identity          0 of 104        <- the most expensive generation in the pipeline
classification    1 of 104
site_signals     91 of 104        (this one works)
```

`run-audit-pipeline.ts` computes all three and lets two of them die as locals when the function
returns. `claude-research.ts` calls `BusinessIdentity` *"the most expensive generation in the
pipeline"* and it is stored **zero times out of 104**. `identity.services[]` is the closest thing we
have to "what this business actually sells" and `identity.competitors[]` is the only list of REAL
competitors a source named. Both are bought and discarded on every single audit, today.

**This is the single cheapest win in the build.** No new fetch, no new spend: three columns that exist,
filled from values already in memory.

---

## W0. The scan. First session's only deliverable.

Produce `docs/ONBOARDING-MAP.md`, generated by a script so it cannot rot. Extend
`scripts/_step-wiring.ts` (which already produces `docs/STEP-WIRING.md`) rather than writing a second
generator. Per step:

1. **What it reads** (tables and columns), **what it writes**, **what it refuses on**.
2. **Which dataset fields** it needs, and which of them are empty in production right now.
3. **Whether anything downstream reads what it writes.** A step whose output nothing reads is either
   dead or a gap; both are findings.
4. **Every question the step would have to ask a human** to become completable.

Also inventory, in the same pass: every place the system pulls data from the web (the audit engine,
the crawler, DataForSEO, the GBP audit, Outscraper, MillionVerifier, the concierge scan), what it costs,
where the response lands, and **whether the raw response survives**. That table is the input to W6.

**Do not start building until the map exists and Matthew has read it.**

---

## W1. `leadContext(clientId)`: one read model that knows everything

Everything else in this build sits on this. Build it first, build it once.

```ts
leadContext(clientId) -> {
  identity      // clients row, domain, vertical, business type
  audiences[]   // client_audiences, each with vocabulary and stance
  avatar        // avatar_briefs: research, voc quotes, approved numbers, times reused
  offers[]      // client_offers per audience, with terms, outcome, price, guarantee
  documents     // audience_documents by kind, each present | missing | stale
  beliefs       // necessary_beliefs, parsed
  ladder        // awareness_ladder + the anchored rung
  keywords      // client_keywords by awareness stage and role
  pages[]       // page_plan -> client_pages, with angle, headline, magnet, gate verdict
  research      // every raw pull we hold for this lead (W6)
  audits        // audit_reports + audit_runs + fanout_citations for their domain
  board         // client_delivery_steps, the cursor, what is blocked
  history       // last N client_events
  gaps          // W2: what is missing, per step, as questions
}
```

Rules:

- **One function, cached per request.** Every thread handler, the assistant and the dashboard read it.
  Three different assemblies of "what we know about this lead" is how two of them go stale.
- ‼️ **Every field is `present | missing | stale`, never silently absent.** A null that means "never
  asked" and a null that means "asked and empty" are different facts and the difference is the whole
  product here.
- ‼️ **Resolve the lead's audits by DOMAIN as well as by `client_id`.** Only 15 of 104 reports carry a
  client link, so a client-id-only read hides 89 reports, some of which are about this lead. Fix the
  link at provisioning time too (`provision.ts`, `adoptAuditClassification`) so the count stops
  drifting.

---

## W2. The data scanner: bullet questions for exactly what is missing

Matthew: *"it asks bulletpoint questions with the things we are missing in order to complete X
onboarding step."*

Build `gapsFor(clientId, stepKey)` on top of `leadContext`. For each step it returns the fields that are
missing, and for each one: **what it is, what it blocks, and the exact command or paste that fills it.**

- The hook already exists: `readinessFor()` in `src/lib/clients/do-this-now.ts`, which today handles
  `avatar_harvest` only and returns null for everything else. Extend it; do not build a parallel one.
- The field declarations already exist: `DATASET_FIELDS` in `src/lib/clients/dataset-spec.ts`, three
  datasets (`avatar`, `audience`, `offer`), each field naming what fills it and what it blocks. **Add a
  fourth, `PAGE`**, covering audience, offer, awareness entry and target, angle, narrative,
  indoctrination, headline, keywords, outline, magnet, evidence, body. Most of those columns now exist
  (`docs/2026-09-17-page-datasets-and-angles.sql`) and the spec does not know about them.

**The question format, and this is the deliverable Matthew will judge:**

```
Step 11 needs 3 more things before it can complete.

• The avatar sheet. Nothing has been pasted, so every headline is written
  without knowing who it is for.
  → run `prompt`, paste the answer back as `avatar sheet:`

• The necessary beliefs. This is what every page is supposed to install and
  there is no belief on file to install.
  → `beliefs:` in this thread, up to 6, each starting "I believe that"

• The short offer. The ladder can be written without it but every rung will
  argue from the treatment rather than from the offer.
  → `short offer:` in this thread
```

Rules:

- ‼️ **Every command named must exist.** `_probe-do-this-now.ts` already greps backticked commands back
  out of `src/` and fails on any that does not. Keep that and extend it to these.
- ‼️ **If we already hold it, do not ask for it.** That is the point of scanning first. A deep research
  report already on file means the scanner asks only for the sections that report did not answer, not
  for the report. Parse what is there, diff against what the step needs, ask for the difference.
- ‼️ **Report, never invent.** A missing field stays missing. `clientAvatarVerticalId` returns null
  rather than a wrong default and that rule holds: *a wrong quote bank is worse than an empty one,
  because an empty one is visible.*

### The question bank this needs

The scanner can only ask for what somebody has declared. Write down, per onboarding step, the complete
question set. Sources that already exist and should be mined rather than rewritten:

- `src/config/avatar-framework.ts`: `AVATAR_SHEET` and `SHORT_OFFER` are `TemplateSection[]` with the
  real field lists; `RESEARCH_METHOD`, `BELIEFS_TRANSCRIPT`, `BELIEF_OPENING = "I believe that"`,
  `MAX_NECESSARY_BELIEFS = 6`.
- `src/lib/clients/dataset-spec.ts`: 19 fields only the step-11 script asks for
  (`hopes_and_dreams`, `fears`, `emotional_journey`, ...) plus 5 declared and never asked
  (`cost_of_inaction`, `decision_influencers`, `proof_they_need`, `price_sensitivity`,
  `booking_behaviour`). **Those 5 are unasked questions with a home already built.**
- `src/config/client-intake.ts`: `INTAKE_STEPS`.

---

## W3. Research and enrichment, run from inside the lead

Matthew: *"if we want to do some research about that specific lead we can do it right in the lead."*

Today research is a manual paste-back in a Slack thread and enrichment lives in the scraper. Neither is
reachable from the lead.

**Build a research console on the client page and in the client's channel:**

- `research <topic>` in any of the client's threads: runs a scoped pull about THIS lead, stores the raw
  response under W6, and posts a summary.
- A panel on `/dashboard/clients/<id>` listing every pull held for this lead, what it cost, when it was
  fetched and when it expires, with a button to re-run one.
- **The paste-back path stays.** D1 (research is manual, both passes) was chosen deliberately on
  2026-09-14 and is not being reversed here. This adds a second door for ad-hoc research about one
  lead; it does not replace the two structured passes.

‼️ **Everything paid goes through one door.** `src/lib/data/dataset-cache.ts` exists with `getOrFetch()`
and `cacheKeyOf()`: read `client_datasets` first, call the provider only on a miss or an expiry, record
`cost_usd`. **It has zero inserts, ever.** Make it the one door for every paid pull in the repo, and
then `select kind, sum(cost_usd) from client_datasets group by 1` is a real number.

---

## W4. Every thread reply answers with the lead's full context

Matthew: *"each answer we get in every thread has context on everything so it can make direct
suggestions based on the context of the specific lead (very useful for step reruns)."*

- `client_events` holds 136 rows, append-only, per client, and **nothing reads it back**. It exists
  precisely so this is answerable.
- Feed `leadContext` into every thread handler and into the assistant. On a rerun the card should be
  able to say what changed since last time and what is still missing, rather than re-asking.
- ‼️ **A paste must never reach the wrong client.** `api/slack/events/route.ts` resolves `clientId`
  from the channel and every client has its own ops channel. Do not refactor that door onto a global
  listener.
- ‼️ **Context makes suggestions, never decisions.** The board's standing rule is that the tool
  proposes and a person confirms.

---

## W5. The North Star model and the mind map

Matthew: *"all of the data of the offer, avatar, content, stages of awareness, lead magnets, funnels,
workflows etc ALL of it, labeled and stored correctly ... and make a mind map with all of the outbound
strategies labeled by keywords and pillars with the data of the views in each one."*

Every node already has a table:

```
client
 └── audience (client_audiences)          who buys, and in what words
      └── avatar (avatar_briefs)          shared research, voc quotes, approved numbers
      └── offer (client_offers)           what is sold, outcome, price, guarantee
           ├── hinge belief               audience_documents kind=necessary_beliefs   ← EMPTY TODAY
           └── awareness ladder           audience_documents kind=awareness_ladder
                └── rung (1..5)           reader state, angle, claim, risk reversal
                     └── keyword          client_keywords, awareness_stage, role pillar|support
                          └── page        page_plan -> client_pages
                               ├── angle       page_angles (idea, narrative, indoctrination)
                               ├── headline    client_headlines
                               ├── magnet      page_magnet_candidates -> lead_magnets
                               ├── evidence    page_sources
                               └── measurement audit_runs, fanout_citations, market_mentions
```

**Build:**

1. `northStar(clientId)` returning that tree, every node marked present / missing / stale, with a
   completeness number per branch. This is W2 seen from the top.
2. **The mind map** at `/dashboard/clients/<id>/strategy`, grouped by pillar and keyword, **generated
   from the tables and never hand-maintained**. Mermaid renders natively; a static SVG is fine.
3. **Labels are the point.** Every node carries vertical, avatar slug, awareness stage and pillar, so
   the map can answer "everything we are doing for this avatar at this stage", which is the question
   the strategy is actually asked.

### ‼️ The view counts, and the one rule that must not bend

Matthew wants view data per keyword and pillar. **`weekly-report.ts` carries `ATTRIBUTION_NOT_WIRED`
and tells the client in writing that nothing measures whether a published page was ever cited.**
`page-dataset.ts` refuses ranking and citation columns for the same reason, in its own words: *"a
column no process can fill would put an invented number into the training set, which is worse than an
absent one because a later reader cannot tell it was never measured."*

So either **wire a real source** (Search Console arrives at the access step; GBP insights; and the
audit engine already holds 6,060 `fanout_citations` and 3,279 `market_mentions` which ARE measured
appearances) or **render the node as "not measured"**. Do not put a number on that map that nothing
produced. The citation data is real and is the honest first version of this.

---

## W6. Keep every byte we pull, for every lead, forever

Matthew: *"we want to keep the raw data pulls we do from the web for each lead as context we can scan
later ... make sure all the data we pull gets saved same as AI visibility audit etc and everything we
have inbounding data to enrich our own database/clients."*

**Start with the three columns that exist and are empty**, because it is free:

- `audit_reports.identity` is **0 of 104** and is the most expensive generation in the pipeline.
- `audit_reports.site_crawl` is **1 of 104**. Store the distilled crawl, **not `homepageHtml`**: it is
  raw markup, it is the largest field, and `detectSiteSignals` already distils it into the column that
  works (91 of 104).
- `audit_reports.classification` is **1 of 104**. Store the WHOLE return verbatim in one jsonb column,
  so the next field the classifier learns needs no migration.

‼️ **Never merge `identity.competitors` into the existing `competitors` column.** Two different
meanings: the existing column holds the classifier's HYPOTHESES, `identity.competitors` is the only
list of real competitors a source named. `prior-report.ts` already misreads this.

**Then the general rule.** Every pull from the web, whoever makes it, lands in `client_datasets` through
`getOrFetch()` with its `kind`, `cache_key`, `params`, `payload`, `provider` and `cost_usd`. That covers
the audit engine, the crawler, DataForSEO, the GBP audit, MillionVerifier, the concierge scan, the
scraper's pulls when that lane lands, and anything added later.

- `client_id` is **nullable** throughout, deliberately: a vertical-wide pull belongs to no client.
- A prospect has no `clients` row, so ‼️ **do not write `page_sources` directly from a prospect scan**:
  `page_sources.client_id` is `not null references clients(id)`. Hold it as jsonb on the report and
  **promote** it at `intake_received` through the existing `recordWebsiteSnapshot()`, with `source_date`
  set to the CRAWL date rather than the promotion date.
- `fanout_queries` holds **10 rows against 1,378 `fanout_runs`**. The searches the engine actually ran
  are still being dropped. Find out where and fix it; the citations path proves the capture works.

**The point of keeping it is reading it back.** W1's `leadContext.research` is that read. A pull nobody
can retrieve is the same as a pull nobody made.

---

## W7. Why no page has ever been drafted

`page_plan`, `client_pages` and `page_gate_runs` are all zero, so step 21 has never completed for
anybody. **Reproduce it on SRT and report the actual refusal before changing anything.** Candidates, in
order: the board is parked before 21; `planKeywords` refuses because fewer than seven approved keywords
sit at the anchored rung; the magnet or concierge row refuses (`_probe-page-gate.ts` has a documented
data-state failure that clears when step 18 runs).

By the end of the step the thread carries **one preview link per page plus an index**, and the gate
verdict for each. `src/app/preview/[token]` and the hub renderer already exist.

---

## W8. Read the screenshot, including what is crossed out

Matthew: *"I can just cross over a full section of that page if i dont like it so make sure it actually
reads what we are sending."*

- `src/lib/clients/screenshot-read.ts` exists but **transcribes the Chrome address bar and nothing
  else**, on purpose, and is reached only from the presence sweep.
- `callClaudeJSON` already takes `images` and eight modules use vision. The capability is there.
- Build a **page-annotation reader**: a screenshot of a drafted page with sections struck through,
  circled or arrowed, returning a structured edit list.
- ‼️ **It returns references to the page's OWN outline headings, never free text.** "Delete the pricing
  part" moves the ambiguity downstream. An unresolvable mark is reported unresolved, never guessed,
  which is the tri-state rule `screenshot-read.ts` and `mx.ts` already carry.
- ‼️ **A read is a PROPOSAL.** It posts the edit list and waits. Nothing edits a page from a picture
  without confirmation, and any applied edit goes through the path that pushes onto `page-studio.ts`'s
  undo stack.

---

## Also hand off, separately

`docs/prompts/concierge-on-invisible.md`, to its own session, that path and nothing else. That lane is
where the **lead magnet data** gets collected: `page_magnet_candidates` holds 5 rows and `lead_magnets`
12, and what the widget offers per page is what it measures.

Two corrections to it, measured 2026-09-17: its finding that `lead_magnets` is EMPTY is **out of date,
it holds 12 rows**; and its blocker 2 (`enabled` is false) now has a button rather than needing SQL.

**The Vercel bypass token in `srt-agwb` branch `magnet` still needs rotating.** It is in a pushed
branch, it is Matthew's to do, and it is independent of everything above.

---

## Decisions. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | The two structured research passes stay MANUAL paste-back. W3 adds a door, it does not replace them |
| D2 | Onboarding is always 1 pillar + 6 supports |
| D3 | The gate blocks on EVIDENCE and only warns on style |
| D4 | `clientAvatarVerticalId` returns null rather than a wrong default |
| D5 | Nothing publishes before the Day 0 wall and the quality gate |
| D6 | The board cursor is ONE AT A TIME |
| D7 | The tool proposes, a person confirms. No screenshot read and no context-derived suggestion applies itself |
| D8 | The North Star is the whole picture of a lead. The old "north star belief" is renamed to `hinge_belief`, in its own commit |
| D9 | No number on the mind map that no process measured |
| D10 | Every paid pull goes through `getOrFetch()` and lands in `client_datasets` |

## Verification

```
bunx tsx scripts/_probe-aeo-headlines.ts
bunx tsx scripts/_probe-page-angles.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-do-this-now.ts
bunx tsx --env-file=.env.local scripts/_probe-dataset-cache.ts
bun run --env-file=.env.local scripts/_probe-page-datasets.ts
bun run scripts/test-onboarding-artifacts.ts
./node_modules/.bin/tsc --noEmit
bun run build
```

Add `scripts/_probe-lead-context.ts` and `scripts/_probe-gaps.ts`: every step returns a gap list, every
command named in one exists in `src/`, a field already on file is never asked for again, and a field
that is missing is never filled with a default.

**End to end on SRT, in `#srt-agency-onboarding`, and this is the real test.** Ask the board what step
11 needs. Get a bullet list. Answer it in the thread. Get a shorter bullet list. Repeat until the step
completes, then walk to 21 and get seven drafted pages with a preview link each. Then `rerun step 21`
and confirm the card says what changed rather than re-asking, and that `page_plan_runs`, `page_angles`
and `page_dataset` gain rows rather than losing them.

## Gotchas that have bitten before

- One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather than
  throwing, so a try/catch never fires. Read a new column in its own select.
- An embed between two tables with TWO foreign keys between them must name the constraint
  (`page_plan!page_angles_plan_id_fkey`). A swallowed embed error looks identical to no data.
- Postgres aborts a whole transaction on the first error, so a second "this is refused" assertion in
  one transaction catches "transaction is aborted" and passes for the wrong reason. Savepoint per
  expected failure.
- A HEAD against a table PostgREST does not know returns 404 with no body, reported as
  `{count: null, error: null}`, indistinguishable from an empty table. Use a real GET for idempotency
  preflights.
- `NEXT_PUBLIC_APP_URL` is `http://localhost:3000` locally. **Never run a step generator locally**: it
  posts localhost links into production Slack.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything goes through `bodySections()`.
- `vercel env pull` writes BLANK for encrypted values; `vercel env add` from stdin writes EMPTY.
- Resolve SRT by slug `srt-agency-llc`, never a pinned id.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced sql block, never a file path.
- Ask before deleting production data.
