# Finish the North Star: C7 to C12

A build prompt for a fresh session, written 2026-09-17 after C0 to C6 shipped to production.
**Read what is already built before writing anything.** The first half of this build is live; the
mistakes worth avoiding are mostly the ones its predecessor made and this one records.

Its predecessor is `docs/prompts/2026-09-17-north-star-and-onboarding-datasets.md`. That document is
still the statement of intent and is worth reading, **but three of its diagnoses are wrong and were
measured wrong on 2026-09-17.** They are corrected below. Do not act on its W6 opening.

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-concierge-toggle"   # or your own worktree off origin/main
git fetch origin && git log --oneline -1 origin/main    # should be at or after 2f4ee43
```

Read `CLAUDE.md` and `docs/lanes/CONTRACT.md` before writing code. Run `git branch --show-current`
before every commit.

---

## What is already built and LIVE

Eight commits, merged to `main` and deployed 2026-09-17. **No SQL migration and no new env var was
needed for any of it.**

| Commit | What it does |
|---|---|
| `1a7060d` | D8: "north star" now means the whole lead. The old term is the **hinge belief** |
| `e246682` | Three N+1 reads fixed. `documentsFor()`, `auditsForLead()`, `CompletenessInputs` |
| `1a4260b` | **`leadContext(clientId)`** in `src/lib/clients/lead-context.ts`, and `Held<T>` |
| `9036b6f` | **`STEP_NEEDS`** in `src/lib/clients/step-needs.ts`: what each of the 41 steps needs |
| `418465d` | **`gapsFor` / `gapLines`** in `src/lib/clients/step-gaps.ts`: the bullets |
| `12a48e5` | Fixed a probe that cried drift on every Windows checkout |
| `ced215a` | **`gapPromptsFor`** in `src/lib/clients/gap-prompts.ts`: the prompts, pre-filled |
| `2f4ee43` | **Wiring**: two doors on every card, `gaps` and `prompts` in any thread |

### The shapes you will build on

```ts
// lead-context.ts  - the one read model. Cached per unit of work, never across a write.
type Held<T> =
  | { state: "present"; value: T; at: string | null; source: string }
  | { state: "stale";   value: T; at: string | null; source: string; why: string }
  | { state: "missing"; because: MissingBecause; why: string };

type MissingBecause = "never_asked" | "asked_unanswered" | "blocked" | "unreadable";

leadContext(clientId, { include?: LeadSlice[] }): Promise<LeadContext>
// slices: core | documents | keywords | pages | audits | research | history | gaps
```

**Five rules the existing code enforces and the probes will fail you on:**

1. ‼️ **`lead-context.ts` selects from exactly one table: `client_datasets`.** Everything else is a
   call into the reader that owns those rows. `_probe-lead-context.ts` greps the file and fails on
   any other table name, on any write, and on a call to `reachableCursor` (which seeds rows).
   **If a reader you need lacks a column, extend that reader**, the way `clientIdentity()` was added
   to `client-reads.ts`. Do not add a query to `lead-context.ts`.
2. ‼️ **There is no `unwrap(h, fallback)` and adding one fails a probe.** On the `missing` arm there
   is no `value` key, so `h.value ?? ""` does not compile. That is the point.
3. ‼️ **Staleness is only claimed where a fingerprint, a supersession column, an expiry or a
   completion ordering makes it computable.** An age threshold would be an invented number. The
   probe asserts every `stale()` site sits next to one of the five signals.
4. ‼️ **`unreadable` is never rendered as a question.** A broken select must not become an ask for
   work somebody already did.
5. ‼️ **`STEP_NEEDS` is `Record<StepKey, StepNeed>`**, so a 42nd step fails the build until somebody
   says what it needs. A step with no dataset field declares `{ kind: "nothing", why }` and the
   sentence is required. 31 of 41 are "nothing" today, and `_probe-gaps.ts` prints them as a backlog.

### What it produces, measured against SRT

```
Step 11 needs 3 more things before it can complete.
:no_entry: 20 fields: age range, gender split, where they live, and more
    -> `avatar sheet:` in step 11's thread (message 4)
:no_entry: 14 fields: the short offer, the big idea, the metaphor, and more
    -> `short offer:` in step 11's thread (message 5)
:no_entry: the necessary beliefs (up to 6, "I believe that")
    -> `beliefs:` in step 11's thread (message 7 of the framework script)
```

It does **not** ask for the deep research, which is on file. `prompts` hands back four ready-to-run
prompts carrying SRT's own cited domains and the owner's own words.

---

## ‼️ Corrections to the original prompt. Do not redo this work.

### 1. The "single cheapest win" already shipped on 2026-09-14

The original says `run-audit-pipeline.ts` "computes all three and lets two of them die as locals".
**It does not.** The insert names `site_crawl`, `identity` and `classification` explicitly, under a
comment written in the past tense. Measured: **exactly one audit has run since those columns
shipped**, and it stored two of the three. The other 103 predate the migration and their raw values
are gone, so there is nothing to backfill.

`identity` is null **by design** on the happy website path: it is assigned only on name-mode, thin-page
enrichment and site-unreadable fallback. **Matthew decided 2026-09-17: leave it, report it missing,
hand back the prompt instead.** That decision is now D11 and W2b is the thing that replaced it.

### 2. `getOrFetch()` is not un-called, it is under-called

Two production callers (`claude-research.ts`, `search-research.ts`) of roughly eighteen web-pull
sites. **The work is routing the other sixteen through the one door, not wiring up the first caller.**

### 3. The "89 hidden audits" are not about this lead

Measured: 89 reports carry no `client_id` and **zero of them name srtagency.com.** They are prospect
audits of other businesses. The domain arm of `auditsForLead()` is still right, and it is how three
of SRT's fifteen were found, but it adds nothing on the only real client today. The code comment
already says so. Do not go hunting for data that is not there.

---

## Ground truth, measured 2026-09-17

Only one client is real: slug `srt-agency-llc`. **Resolve by slug, never a pinned id.** Ops channel
`C0C1WTPH0AZ`.

| Table | Rows | Table | Rows |
|---|---|---|---|
| `clients` | 5 (1 real) | `audit_runs` | 2,900 |
| `client_delivery_steps` | 41 | `fanout_citations` | 6,060 |
| `client_audiences` / `client_offers` | 1 / 1 | `fanout_runs` / `fanout_queries` | 1,378 / **10** |
| `audience_documents` | **2** | `market_mentions` | 3,279 |
| `client_keywords` | 385 (376 approved) | `audit_reports` | 104 (15 linked) |
| `keyword_runs` / `keyword_decisions` | 0 / 0 | `client_datasets` | **0** |
| `page_plan` / `page_angles` / `client_pages` | 0 / 0 / 0 | `lead_magnets` / `page_magnet_candidates` | 12 / 5 |
| `page_dataset` / `page_gate_runs` | 0 / 0 | `avatar_briefs` | 2 |
| `client_headlines` | 33 (**0** approved) | `page_sources` | 7 |

SRT's board: offer **locked**, ladder **approved**, `anchor_stage = 4`, 376 approved query keywords,
and `role=pillar` / `role=support` both **0**. It is parked on `pre_call_pages`, `awaiting_me`.

---

## C7. The onboarding map (W0)

**Deliverable:** `docs/ONBOARDING-MAP.md`, generated by extending `scripts/_step-wiring.ts`.

‼️ **That generator is 100% static and its `--check` arm gates `_probe-step-rerun.ts`.** Live numbers
inside a `--check`ed file would fail the probe every time production changed. So it gains `--live`
and writes **two** files:

| File | Content | `--check`ed |
|---|---|---|
| `docs/ONBOARDING-MAP.md` | static: per step what it reads, writes, refuses on; the fields it needs from `STEP_NEEDS`; whether anything downstream reads its output; every question it would have to ask | **yes** |
| `docs/ONBOARDING-MAP-MEASURED.md` | the live half, with the measurement date and client slug on line 1 | **no** |

Much of the static half is now derivable rather than authored: `STEP_NEEDS` already says what each
step needs, and `gapLines` already writes the questions. **Generate from those rather than restating
them**, or the map becomes a third declaration to keep in step.

Second deliverable, the input to C8: the **paid-pull inventory**. Lane, file, the function that makes
the HTTP call, whether the raw response survives and where. Eighteen sites; two use `getOrFetch`.

---

## C8. Every byte through one door (W6)

1. **Route the other sixteen pull sites through `getOrFetch()`**, one lane per commit, so a bad one
   reverts alone. Then `select kind, sum(cost_usd) from client_datasets group by 1` is a real number,
   and `leadContext.research` (already built, already reads it back) stops being empty.
   ‼️ `search-research.ts` writes `costUsd: 0` because there is no OpenAI rate card. That zero is a
   known lie in the ledger: fix it or label it, do not leave it silent.
2. ‼️ **`audit_runs` is delete-then-insert per batch** (`run-batch.ts`), so a re-run overwrites
   `raw_response`. If "keep every raw pull forever" means history, `audit_runs` is the wrong home.
   `raw_leads.raw` with its `(run_id, place_id)` unique index is the precedent to copy.
3. **`fanout_queries`, 10 against 1,378 runs. Two causes, both measured, and one is CORRECT.**
   (a) `scripts/_backfill-fanout-citations.ts` writes runs and citations only, **on purpose**: *"a
   backfilled run is an honest partial record: we know what was cited, we do not know what was
   searched."* ‼️ **Do not "fix" this.** (b) the live path reads `web_search_call.action.query` and
   `OPENAI_AUDIT_MODEL` defaults to `gpt-4.1-mini`, which may not surface it. ‼️ **Log one raw
   Responses body and look before changing anything.**
4. ‼️ **Never merge `identity.competitors` into `competitors`.** The column holds the classifier's
   HYPOTHESES; `identity.competitors` is the only list of real competitors a source named.
   `prior-report.ts` documents the column as the second thing. That comment is wrong and is a
   one-line fix in its own commit.
5. **A prospect has no `clients` row** and `page_sources.client_id` is `not null`. Hold prospect crawl
   as jsonb on the report and **promote** at `intake_received`. ‼️ `promoteCrawl()` already does
   exactly this, with the CRAWL date not the promotion date. Reuse it.
- `client_id` stays **nullable** throughout: a vertical-wide pull belongs to no client.

---

## C9. The assistant answers with the lead's context (W4)

**The acceptance test is already on the record.** On 2026-09-16 at 19:32, in SRT's own step-21 thread,
Matthew typed `generate pages` and the assistant replied *"No med spa client in the system yet"*. Nine
minutes earlier `anchor at 4` reached the same generic tail.

- Feed `leadContext` into the thread handlers and the assistant tail. `gap-thread.ts` shows the shape:
  one `withLeadScope` around the reply, `leadContext` inside it.
- `client_events` holds 136 rows with sixteen writers and **one** reader. On a rerun the card should
  say what changed since last time rather than re-asking.
- ‼️ **Also settle the `anchor at 4` question**, which is still open: the commit adding that grammar
  (`09d400f`) landed 66 minutes before the failure, so it is either a routing miss or a stale
  production build. `vercel ls --prod` distinguishes them. **Reproduce before changing anything.**
- ‼️ **A paste must never reach the wrong client.** `clientForThread()` resolves both `client_id` and
  `step_key` from `slack_anchor_ts`, and the lane returns from every branch so nothing reaches the
  generic tail. Do not refactor that door onto a global listener.
- ‼️ **Context makes suggestions, never decisions** (D7).

---

## C10. Walk step 21 (W7)

Not a bug hunt. SRT has a locked offer, an approved ladder, `anchor_stage = 4` and 376 approved query
keywords. **Nobody has ever pressed [Pillar].** The board's own last words on that step:

```
2026-09-17 12:58  bot      :warning: No plan: no pillar keyword is picked yet.
2026-09-17 12:59  Matthew  [step_done]
2026-09-17 12:59  bot      :warning: Not confirmed: Seven pages drafted before the call...
```

Walk it and report each refusal as you meet it: `pillar: auto`, `supports: auto`, `headlines`,
`headline N pick M` seven times, `skeleton`, the batch research paste, `draft`. Each hop refuses
loudly by design. End state: **one preview link per page plus an index**, and a gate verdict for each.

‼️ The beliefs were the blocker and C4 now asks for them. If they are on file by the time you run
this, that half is already done.

---

## C11. `northStar()` and `/strategy` (W5)

```ts
// north-star.ts, PURE. Imports TYPES from lead-context.ts and nothing else.
export function northStar(ctx: LeadContext): NorthStarTree;
```

‼️ **Taking a `LeadContext` rather than a `clientId` is the whole enforcement.** A function with no
client id and no db import cannot become a second read.

- Route `/dashboard/clients/<id>/strategy` is free. It sits **above** the existing page-plan map at
  `/plan` (`plan-map.ts`), which stays. `leadContextForPage()` in `lead-context-rsc.ts` is the loader.
- `"unread"` is a **tree** state, never a field state, for a slice absent from `ctx.loaded`.
- ‼️ **A branch with an `unread` descendant gets `completeness: null`, never a number.**
- `gapsFor` and `northStar` cannot disagree: both read `ctx.gaps`, one evaluation of one snapshot.

### ‼️ D9: no number the system did not measure

`weekly-report.ts` carries `ATTRIBUTION_NOT_WIRED` and tells the client **in writing** that nothing
counts leads. `page-dataset.ts` refuses ranking columns in its own words. So either wire a real source
or render the node **"not measured"**. `fanout_citations` (6,060) and `market_mentions` (3,279) **are**
measured appearances and are the honest first version of view data.

---

## C12. The rest

### a. Suggested datasets (W2b(b)), and it needs the only SQL in this build

When a pasted answer contains a field no `FieldSpec` declares, the system **proposes** adding it and
asks. `dataset-spec.ts` is pure TS, so a runtime field cannot be written into it. The shape:

- `dataset_suggestions`: the proposed key and label, the observation that produced it (client,
  document, verbatim excerpt), `status`, `decided_at`, `decided_by`.
- A card with **[Add] / [Ignore]**. Nothing is added by a model (**D7**).
- On [Add], `DATASET_FIELDS` is read as **static spec + confirmed suggestions**. The static file stays
  pure; the merge happens in the loader.
- ‼️ A suggested field is born `asked: false`, so it renders as "nothing asks for this yet" until
  somebody writes the ask. **It must never silently start asking.**

**SQL owed:** `docs/2026-09-18-dataset-suggestions.sql`, pasted in full in a fenced `sql` block in
chat, never as a file path.

### b. The research console (W3)

`research <topic>` in any client thread, stored through C8's door, summarised back. A panel on
`/dashboard/clients/<id>` listing every pull, its cost, when fetched, when it expires, with a re-run
button. `spendSoFar(clientId)` already exists and is the total. ‼️ **D1: this adds a door, it does not
replace the two structured passes.**

### c. The screenshot annotation reader (W8)

`callClaudeJSON` already takes `images` and seventeen modules pass them. Build a reader that returns a
structured edit list from a marked-up screenshot.
‼️ **It returns references to the page's OWN outline headings, never free text.** An unresolvable mark
is reported unresolved, never guessed. ‼️ **A read is a PROPOSAL** (D7); any applied edit goes through
`page-studio.ts`'s undo stack.

---

## Decisions. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | The two structured research passes stay MANUAL paste-back. W3 adds a door |
| D2 | Onboarding is always 1 pillar + 6 supports |
| D3 | The gate blocks on EVIDENCE and only warns on style |
| D4 | `clientAvatarVerticalId` returns null rather than a wrong default |
| D5 | Nothing publishes before the Day 0 wall and the quality gate |
| D6 | The board cursor is ONE AT A TIME |
| D7 | The tool proposes, a person confirms |
| D8 | The North Star is the whole lead. The old term is `hinge belief`. **Done** |
| D9 | No number on the mind map that no process measured |
| D10 | Every paid pull goes through `getOrFetch()` and lands in `client_datasets` |
| D11 | **`identity` stays unbought.** Report it missing and hand back the prompt instead (2026-09-17) |

## Verification

```
bunx tsx scripts/_probe-aeo-headlines.ts
bunx tsx scripts/_probe-page-angles.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-do-this-now.ts
bunx tsx --env-file=.env.local scripts/_probe-dataset-cache.ts
bunx tsx --env-file=.env.local scripts/_probe-step-rerun.ts
bunx tsx --env-file=.env.local scripts/_probe-lead-context.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bun run scripts/test-onboarding-artifacts.ts
./node_modules/.bin/tsc --noEmit
bun run build
```

> ‼️ **Probes without `--env-file=.env.local` silently return nothing.** Not an error. Nothing.

‼️ **`_probe-page-gate.ts` fails 2 checks today and it is PRE-EXISTING.** `no_magnet` fires on the
throwaway page, so "no evidence blocks" degrades to warn. It is the documented data-state failure.
Confirm it still fails the same two before assuming you caused it, and do not "fix" it blind.

‼️ **`_probe-deep-research.ts` takes a client id**: `bunx tsx --env-file=.env.local
scripts/_probe-deep-research.ts <clientId> --prompt-only`.

### End to end on SRT, in its ops channel

Ask what step 11 needs. Get bullets. Answer one in the thread. Get a **shorter** list. Repeat until
the step completes, then walk to 21 and get seven drafted pages with a preview link each. Then
`rerun step 21` and confirm the card says what changed rather than re-asking, and that
`page_plan_runs`, `page_angles` and `page_dataset` **gain** rows rather than losing them.

---

## Gotchas that have bitten, including two found on 2026-09-17

- ‼️ **Heredocs and `sed` mangle regex escapes in this environment.** Three regexes and two
  `split("\n")` calls were silently turned into literal newlines mid-file, producing "unterminated
  string literal" far from the cause. **Write TypeScript containing regexes or escapes with the Write
  tool**, or build them escape-free (`String.fromCharCode(10)`).
- ‼️ **`core.autocrlf=true` here.** A byte comparison between a git-checked-out file and a
  `writeFileSync` one reports every line changed. Fixed in `_step-wiring.ts`; the same trap waits for
  any new generated doc with a `--check` arm. The tell is a diff where every line looks identical and
  the size delta equals the line count.
- One unknown column fails the WHOLE PostgREST select, and supabase-js **returns** the error rather
  than throwing, so try/catch never fires. Read a new column in its own select.
- An embed between two tables with TWO foreign keys must name the constraint
  (`page_plan!page_angles_plan_id_fkey`). A swallowed embed error looks identical to no data.
- A HEAD against a table PostgREST does not know returns `{count: null, error: null}`,
  indistinguishable from an empty table. Use a real GET.
- `NEXT_PUBLIC_APP_URL` is `http://localhost:3000` locally. ‼️ **Never run a step generator locally**:
  it posts localhost links into production Slack. Typing in Slack from any device is fine.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything goes through `bodySections()`.
- `vercel env pull` writes BLANK for encrypted values; `vercel env add` from stdin writes EMPTY.
- `main` is checked out in the `_wt-magnet-finish` worktree, so `git checkout main` fails here. Push
  with `git push origin HEAD:main` after confirming a fast-forward.
- Resolve SRT by slug `srt-agency-llc`, never a pinned id.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
