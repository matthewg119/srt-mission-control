# Finish the North Star: C8 to C13

A build prompt for a fresh session, written 2026-09-18 after C7 shipped to production.
**Read what is already built before writing anything.** Its predecessors are
`docs/prompts/2026-09-17-north-star-and-onboarding-datasets.md` (the statement of intent, W0 to W8)
and `docs/prompts/2026-09-17-north-star-continuation.md` (C7 to C12). Both are still worth reading.
**Four of their diagnoses are wrong and are corrected below.**

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-concierge-toggle"
git fetch origin && git log --oneline -1 origin/main    # should be at or after 71ed64f
git branch --show-current                               # feat/north-star-2
```

Read `CLAUDE.md` and `docs/lanes/CONTRACT.md` before writing code. Run `git branch --show-current`
before every commit. Push each finished chunk with `git push origin HEAD:main` after confirming
`git merge-base --is-ancestor origin/main HEAD`.

**‼️ Read `docs/ONBOARDING-MAP.md` first.** It did not exist before C7. It is generated and it
answers, per step, what reads it, what writes it, what it refuses on, and every question it would
have to ask. `docs/ONBOARDING-MAP-MEASURED.md` is the same thing measured against SRT.

---

## What C7 shipped, 2026-09-18, five commits `8610e31..71ed64f`

| Commit | What it does |
|---|---|
| `4038c73` | **A live bug.** `ctx.ladder` and `ctx.beliefs` read shapes their writers never wrote |
| `8353c91` | `bodyOf()` in `_step-wiring.ts`: one Record entry, not one entry plus the next step's comment |
| `ddedddd` | `gapLines(g, max)` and `NOTHING_ON_FILE` in `dataset-spec.ts` |
| `b962078` | **`docs/ONBOARDING-MAP.md`** + `--live` + `docs/ONBOARDING-MAP-MEASURED.md` + probe |
| `71ed64f` | **The paid-pull inventory** and a credential census that fails `--check` by name |

### The three things the work itself found, which are now doctrine

1. **A `present` document whose derived field is `missing` is a parser mismatch, not an absence.**
   `ctx.ladder` read `parsed.rungs`; `writeLadder` stores `{ladder, inputs, model}` and
   `ladderState()` reads `parsed.ladder.rungs`. Measured on SRT: the document was present with five
   approved rungs and `ctx.ladder` said missing. `ctx.beliefs` was worse and latent: it reported
   **present** while holding `[{id,text}]` cast to `string[]`, so the first card to print a belief
   would have printed `[object Object]`. `_probe-lead-context.ts` now fails on the general form.
2. **A `fetch("https://...")` census lies.** Forty files, and it misses `run-prompts.ts`,
   `dataforseo.ts`, `outscraper.ts` and `site-research.ts`, the four biggest spenders, because each
   builds its URL in a variable or goes through a timeout wrapper. The census keys on
   **credentials** instead: a provider you pay needs a key, so a credential-shaped env var
   classified neither as a paid provider nor as something else fails `--check` by name.
3. **`avatar_briefs` is not keyed by client.** It is `(vertical, avatar_slug)` with
   `first_client_id`, because a brief belongs to an AVATAR and is deliberately shared. Filtering it
   by `client_id` selects a column that does not exist, and one unknown column fails the whole
   PostgREST select.

### ‼️ Also found: buying and keeping are different files

Asserting that the fetching file names the table its response lands in failed on **six of
twenty-two rows**, correctly. `run-prompts.ts` buys the fanout answer and `run-batch.ts` stores it;
`classify.ts` buys and `run-audit-pipeline.ts` stores. **That gap is where a raw response gets
dropped**, and it is the shape of the whole C8 problem.

---

## The paid-pull inventory: C8's work list, measured

**22 sites. 2 through `getOrFetch()`. 8 survive nowhere at all.** The live table is in
`docs/ONBOARDING-MAP.md`; regenerate it rather than copying it. The eight that keep nothing:

`claude-calls.ts` · `geocode.ts` · `voice-notes.ts` · **`dataforseo.ts`** (the only genuinely
metered provider) · `mx.ts` · `enrich.ts` (no provider wired at all: `PROVIDERS` is empty) ·
`image-gen.ts` · `motion-adapter.ts`

---

## ‼️ NEW. C13, and it is the reason the rest exists

Matthew, 2026-09-18, verbatim:

> "if for example im rerunning step 12 for SRT Agency and I havent completed step all the way up to
> 17, when I finish with step 12 rerunning, please continue with the onboarding (rerun the step that
> we are supposed to finish up next. And if you can have it make suggestable to rerun a specific
> step, for example after we start running 200 pages for X keyword and we want to focus on more
> pillars/keywords/narratives it suggests to buil new pages from new avatar or suggests diferent
> angles to focus on top of funnnel vs bottom of funnel based on the map and the performance of the
> actual pages that are live, this way this brain can live within each answer the onboarding flow
> gets I can just text back and it can pull the context even if it suggests building a new avatar,
> trying a new offer etc."

Three things, and they are not the same size.

### C13a. A rerun continues the onboarding. Small, and buildable today.

`rerunStep()` in `src/lib/clients/step-rerun.ts` resets the step, runs its runner or posts its card,
refreshes the anchor, **and stops**. The board then sits until a cron or a button moves it.

The cascade already exists and is already correct: `ensureReachableAnchors` → `runReadyAutoSteps` →
`postReadySteps` → `refreshDeliveryChecklist`, exactly as `/api/internal/board-kick` runs it. A
rerun should end by running it.

- ‼️ **This does not break D6.** `reachableCursor()` stops the walk at the first non-`auto` step, so
  "continue" means "post the next card that is legitimately reachable", never "post seven cards".
- ‼️ **`reachableCursor` WRITES** (it tops up missing rows via `seedDeliverySteps`). That is why
  `lead-context.ts` is forbidden from calling it and `_probe-lead-context.ts` greps for it.
- ‼️ A rerun that leaves its step `pending` must advance **nothing**. The cursor stops there by
  itself; do not special-case it.
- `rerunRange` already walks a range; it must not kick after every step, only after the last, or a
  range posts and re-posts the same cards N times.

### C13b. The board suggests what to do next. This is C9 + C11 seen from the top.

Not "what is missing from this step" (that is `gapsFor`, shipped in C6) but **"what is worth doing
next given everything we hold"**. It needs:

- `leadContext` in every thread handler and both assistant tails (**C9**).
- `northStar(ctx)` (**C11**) for the map the suggestion argues from.
- Live page performance, which today **does not exist**: `fanout_citations` has 6,060 rows and
  **zero readers in `src/`**, `market_mentions` is read only through the `market_competitors` view
  keyed on `(city, service_key)`, and `weekly-report.ts` tells the client in writing that nothing
  counts leads (`ATTRIBUTION_NOT_WIRED`).
- ‼️ **D9 binds here hardest.** "Top of funnel is underperforming" is a claim. If the only measured
  thing is citations, the suggestion must argue from citations and say so, or say **"not measured"**.
  A suggestion built on an invented number is worse than no suggestion, because it is actionable.
- ‼️ **D7: it proposes, Matthew confirms.** The output is a card with the step to rerun and the
  reason, not a rerun.

### C13c. Suggestions that leave the board: a new avatar, a new offer, new angles.

The tables already exist and the model is settled: many audiences per client, an offer under an
audience, `client_audiences` → `avatar_briefs` / `client_offers` → `audience_documents` →
`client_keywords` (role pillar/support) → `page_plan` → `client_pages`. A suggestion to "build a new
avatar" is a proposal to insert a `client_audiences` row and walk the framework again for it.

‼️ **`clientAvatarVerticalId` returns null rather than a wrong default (D4), and that rule holds
here.** A suggested avatar with invented demographics is a wrong quote bank, and a wrong quote bank
is worse than an empty one because an empty one is visible.

---

## ‼️ Corrections to the earlier prompts. Do not redo this work.

1. **The `generate pages` failure was never a routing bug.** `generate pages` is not a registered
   grammar anywhere, so it fell through the whole `??` chain in `events/route.ts` to the in-lane
   assistant tail at `route.ts:1464`, which calls `askAssistant()` with no lead context at all. "No
   med spa client in the system yet" is **not a string in this repo**; it is model output from the
   chat assistant's own `client-tools.ts` lookups. C9 is the fix.
2. **`anchor at 4` is wired correctly in this tree.** `readRung` in `anchor-ladder.ts` handles
   `anchor at 4`, backticked, bolded, `anchor at #4`, `rung 4` and `anchor at problem aware`;
   `handleLadderThreadReply` is the **second** link in the dispatch chain at `route.ts:1164`; and
   `step-commands.ts` covers the wrong-thread case with a pointer rather than the tail. Production
   shows no red builds. **Reproduce it in Slack before changing anything.**
3. **`promoteCrawl()` already does C8 item 5.** Module-private in `adopt-audit.ts:169`, runs at
   intake, already uses the CRAWL date rather than the promotion date. Confirm and close it.
4. **`fanout_citations` needs two tables, not three.** It carries `report_id` directly. Measured on
   SRT: **441 citations by `report_id` against 367 by `client_id`**, because a report linked after
   the backfill ran carries a null `client_id`. `report_id` is the honest key. `market_mentions`
   has `report_id` too and no `client_id` column at all.

---

## Ground truth, measured 2026-09-18 against slug `srt-agency-llc`

**Resolve by slug, never a pinned id.** Ops channel `C0C1WTPH0AZ`. Regenerate
`docs/ONBOARDING-MAP-MEASURED.md` rather than trusting this table.

| Table | Rows | Table | Rows |
|---|---|---|---|
| `client_delivery_steps` | 41 | `client_keywords` | 385 |
| `client_audiences` / `client_offers` | 1 / 1 | `client_headlines` | 33 |
| `audience_documents` | **2** | `page_sources` | 7 |
| `avatar_briefs` (by `first_client_id`) | **0** | `lead_magnets` | 1 |
| `page_plan` / `page_angles` / `client_pages` | 0 / 0 / 0 | `client_datasets` | **0** |
| `page_dataset` / `page_gate_runs` / `page_plan_runs` | 0 / 0 / 0 | `client_events` | 145 |

**The board cursor is `avatar_harvest` (step 11)**, not `pre_call_pages`. `ctx.ladder` now reads
**5 rungs anchored at 4**. `ctx.beliefs` is missing, and beliefs are what step 21's headline lane
warns on.

---

## C8. Every byte through one door

One lane per commit, so a bad one reverts alone. Order, cheapest to verify first:

1. `site-research.ts` + `robots-check.ts` (free pulls: a mistake costs nothing and proves the shape)
2. `run-prompts.ts` (the audit engine's OpenAI Responses calls)
3. `dataforseo.ts` (**the only genuinely metered provider**)
4. `outscraper.ts`, `millionverifier.ts`, `mx.ts`, `geocode.ts`, `site-intel.ts`
5. `intel-brief.ts` — it has its own `niche_briefs` cache with a different shape. Fold it in or
   document why it stays. Three caches that disagree is the thing C8 exists to end.
6. `image-gen.ts`, `motion-adapter.ts`, `voice-notes.ts`, `harvest.ts`, `vercel-domains.ts`

Per lane: `clientId` stays **nullable** (a vertical-wide pull belongs to no client), `kind` is
`provider.endpoint`, `cacheKey` via `cacheKeyOf()`, and "buy it, use it, do not cache it" is a throw
from inside `fetch()` the way `UnusableIdentity` / `UnusableProfile` already work.

Four one-off items, each in its own commit:

- **`audit_runs` is delete-then-insert per batch** (`run-batch.ts`), so a re-run overwrites
  `raw_response`. Routing the pull through `getOrFetch` into `client_datasets` gives it a home that
  survives. `raw_leads`' `(run_id, place_id)` **partial** unique index with `ignoreDuplicates: true`
  is the precedent if a per-run archive is wanted instead.
- **`fanout_queries`, 10 rows against 1,378 runs.** Cause (a), the backfill writing runs and
  citations only, is **correct and stays** (*"a backfilled run is an honest partial record"*). For
  (b): `run-prompts.ts` already reads **both** `action.query` and `action.queries`, and
  `OPENAI_AUDIT_MODEL` is unset in production so `gpt-4.1-mini` is what runs. ‼️ **Log one raw
  Responses body and look before changing anything.**
- **`prior-report.ts`**, one line: its doc comment calls `competitors` "businesses the engines named
  instead of them", which is `identity.competitors`. The column holds the classifier's HYPOTHESES.
  Never merge the two.
- **`promoteCrawl()`**: confirm and close.

**The cost ledger.** `search-research.ts` writes a literal `costUsd: 0` because there is no OpenAI
rate card. **Label it unpriced, do not invent a rate card**: an absent number beats a wrong one, and
`claude-research.ts` already documents its `tokensOnly()` figure as a floor for the same reason.
`spendSoFar()` has no callers at all; C12b is its first.

---

## C9. The assistant answers with the lead's context

- `gap-thread.ts:56` is the shape: one `withLeadScope` around the reply, `leadContext` the first
  call inside. It and `step-engine.ts:2019` are the **only two scopes in `src/`**.
- Seventeen thread handlers share one `(input) => Promise<{message, after?} | null>` contract. The
  two tails are `route.ts:1464` (in-lane) and `route.ts:1716` (global, and it posts at channel top
  level with no `thread_ts`).
- ‼️ **Do not refactor `clientForThread()` onto a global listener.** It resolves `client_id` AND
  `step_key` from `client_delivery_steps.slack_anchor_ts`, and the client lane returns from every
  branch. That is the guarantee a paste never reaches the wrong client.
- **`client_events`: 136+ rows, sixteen writers, one reader** (`search_client_events`, a chatbot
  tool). `history` is **not in `CARD_SLICES`**, so no card reads it today. C13b needs it.

---

## C10. Walk step 21

**Matthew types it in Slack; the session reads the results back.** Never run a step generator
locally: `NEXT_PUBLIC_APP_URL` is `http://localhost:3000` here and it posts localhost links into
production Slack.

```
ladder → anchor at 4 → pillar: auto → supports: auto → headlines
→ headline N pick M (x7) → plan approve → skeleton → research → paste → plan draft
```

Gates to expect and report, not fix: `headlines` refuses without an anchored rung; refuses again
unless the vertical has **20 objection rows** on file (`emotional:` fills that; beliefs only warn);
`skeleton` refuses until every page has a headline; `plan draft` refuses until every page has both.
`runPreCallPlan` short-circuits when any role row exists, so **`plan new` is the door for a second
pass, not `rerun`**.

‼️ `_probe-page-gate.ts` fails 2 checks today and it is **pre-existing** (`no_magnet` on a throwaway
page). Confirm the same two before assuming this walk caused them.

---

## C11. `northStar()` and `/strategy`

```ts
// north-star.ts, PURE. Takes a LeadContext, never a clientId. That IS the enforcement.
export function northStar(ctx: LeadContext): NorthStarTree;
```

- `isHeld` is a **value** in `lead-context.ts`, which imports the db. Extract `Held`,
  `MissingBecause`, `held`, `missing`, `stale`, `isHeld` into a pure `src/lib/clients/held.ts` and
  re-export from `lead-context.ts` so no existing importer changes. Widen the probe's `unwrap` and
  `.value ??` greps to both files.
- `"unread"` is a **tree** state, never a field state. Check `ctx.loaded` **before** inspecting the
  `Held`, because an unloaded slice is already encoded as `missing("unreadable", ...)` and reading
  the Held first renders "we did not look" as "it is not there".
- ‼️ **A branch with an `unread` descendant gets `completeness: null`**, propagating to every
  ancestor. `not_measured` is excluded from numerator AND denominator.
- Extract the one loop over `ctx.gaps.value` out of `step-gaps.ts:138` into `missingByRef(ctx)` and
  have `gapsFrom` call it, so `gapsFor` and `northStar` cannot disagree. `ctx.gaps` has exactly one
  reader in `src/` today; a probe should count them.
- **D9's one real source:** `citationTally({clientId, reportIds})` in `client-reads.ts`, keyed on
  `report_id`, taking the ids `auditsForLead()` already returned so it costs no extra lookups. **The
  denominator travels with the number**: not "11" but "11 of 441 citations across 15 audits".
- Route `src/app/dashboard/clients/[id]/strategy/page.tsx`, the first caller of
  `leadContextForPage()`. ‼️ Its signature must stay `(clientId: string)` only: React `cache()` keys
  on argument identity. Copy `metrics/page.tsx` (async `params`), **not** `plan/page.tsx` (sync).
- **Nested HTML, not SVG.** `/plan` stays and is the picture. SRT has 385 keywords across three
  awareness stages; every `missing` node renders its `why` verbatim and SVG does not wrap text.

---

## C12

**a. `dataset_suggestions`** — the only SQL in this build. `parseTemplateDocument` in
`avatar-framework.ts:94-178` **silently absorbs strays today**: a line before any heading is dropped
with no `else`, and an undeclared heading is appended into whatever declared section is open and can
make it read as *answered*. Add `strays: StrayLine[]`, collected in the existing pass, changing
`sections` / `subs` / `answered` / `missingHeadings` **byte for byte not at all** (a probe asserts
it). `readBeliefs()` is the only existing "we saw a stray and refuse by name" precedent.
`dataset-spec.ts` stays pure: `evaluateDatasets(snap, keys, extra = [])` and `suggestedField()`
whose `present` is the constant `false`. ‼️ `STEP_NEEDS` is a static literal, so a suggested field
can never reach a step card even when confirmed. Card modelled on `duplicate-card.ts`; handler
**appended** to the switch in `actions/route.ts`, never editing an existing case.
SQL: `docs/2026-09-18-dataset-suggestions.sql`, **run before the deploy that reads it**, pasted in
full in a fenced `sql` block in chat.

**b. The research console** — `research <topic>` in any client thread, stored through C8's door, a
panel on `/dashboard/clients/<id>` listing every pull with cost, fetched-at, expiry and a re-run
button. `spendSoFar()` is the total and gets its first caller. **D1 holds: this adds a door.**

**c. The screenshot annotation reader** — `callClaudeJSON` takes `images` already;
`screenshot-read.ts` is the house pattern (a `legible` number that measures legibility, **not**
certainty, plus an `evidence` field naming where it read from). ‼️ **A mark resolves to the exact
outline heading string.** `OutlineSection` is `{heading, bullets, keyword?}` with **no stable id**;
`OutlineGap.id` ("G1") is the only addressable-element precedent. No match or two matches is the
same answer: **unresolved**. A read is a PROPOSAL; an applied edit parks the previous body in
`page_studio_sessions.undo_body`, which is what `undo` restores.

---

## Decisions. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | The two structured research passes stay MANUAL paste-back. W3/C12b adds a door |
| D2 | Onboarding is always 1 pillar + 6 supports |
| D3 | The gate blocks on EVIDENCE and only warns on style |
| D4 | `clientAvatarVerticalId` returns null rather than a wrong default |
| D5 | Nothing publishes before the Day 0 wall and the quality gate |
| D6 | The board cursor is ONE AT A TIME. `reachableCursor` stops at the first non-auto step |
| D7 | The tool proposes, a person confirms |
| D8 | The North Star is the whole lead. The old term is `hinge belief` |
| D9 | No number on the mind map that no process measured |
| D10 | Every paid pull goes through `getOrFetch()` and lands in `client_datasets` |
| D11 | `identity` stays unbought. Report it missing and hand back the prompt |
| **D12** | **Every paid pull offers the prompt instead.** Matthew, 2026-09-17: *"worst case tell it to give me the prompt and I will run it online and paste the results in slack apply this for everything with prompts and stuff like that offer the option to paste the workflow to do it right there and just paste the answer."* The paid call is a choice, never the only path |
| **D13** | **A rerun continues the onboarding**, through the existing cascade, bounded by `reachableCursor`. Suggestions about what to do next are PROPOSALS (D7) and may only argue from measured numbers (D9) |
| **D14** | **A `present` document whose derived field is `missing` is a parser mismatch, not an absence.** Probe-enforced |

---

## Verification

```
bunx tsx scripts/_probe-aeo-headlines.ts
bunx tsx scripts/_probe-page-angles.ts
bunx tsx scripts/_step-wiring.ts --check
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-do-this-now.ts
bunx tsx --env-file=.env.local scripts/_probe-dataset-cache.ts
bunx tsx --env-file=.env.local scripts/_probe-step-rerun.ts
bunx tsx --env-file=.env.local scripts/_probe-lead-context.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bun run scripts/test-onboarding-artifacts.ts        # 1064 checks
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx --env-file=.env.local scripts/_step-wiring.ts --live   # regenerate the measured map
```

> ‼️ Probes without `--env-file=.env.local` silently return nothing. Not an error. Nothing.

---

## Gotchas that have bitten

- ‼️ **Write TypeScript containing regexes or escapes with the Write tool.** Heredocs and `sed`
  mangle escapes here and produce "unterminated string literal" far from the cause.
- ‼️ **`core.autocrlf=true`.** Any generated doc with a `--check` arm needs the `sameText` CR strip
  in `_step-wiring.ts`. The tell is a diff where every line looks identical and the size delta
  equals the line count.
- ‼️ **A magic slice width is unfalsifiable.** 700 characters happened to stop before the comment
  above the next step, until it did not. Slice to a real boundary.
- One unknown column fails the WHOLE PostgREST select, and supabase-js **returns** the error rather
  than throwing, so try/catch never fires. Read a new column in its own select.
- A HEAD against a table PostgREST does not know returns `{count: null, error: null}`,
  indistinguishable from an empty table. Use a real GET.
- An embed between two tables with TWO foreign keys must name the constraint
  (`page_plan!page_angles_plan_id_fkey`).
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything goes through `bodySections()`.
- `vercel env pull` writes BLANK for encrypted values; `vercel env add` from stdin writes EMPTY.
- `main` is checked out in the `_wt-magnet-finish` worktree, so `git checkout main` fails here.
- Resolve SRT by slug `srt-agency-llc`, never a pinned id.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
