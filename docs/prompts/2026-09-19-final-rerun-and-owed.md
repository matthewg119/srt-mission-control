# The last details, then one full end-to-end run before going live

A build prompt for a fresh session, written 2026-09-18 at commit `77d0c8a`, all on `origin/main`,
Vercel Ready.

**Read first, in this order:** `CLAUDE.md`, then **`docs/DATA-AND-WORKFLOWS.md`** (the doctrine, the
workflows, and the measured list of what is still dropped), then `docs/ONBOARDING-MAP.md` and
`docs/STEP-WIRING.md` (generated, never hand-edited).

```
cd "C:\Users\matth\Desktop\Code\_wt-concierge-toggle"      # or a fresh clone, see "On a second machine"
git fetch origin && git log --oneline -1 origin/main        # should be at or after 77d0c8a
git branch --show-current                                   # feat/north-star-2
```

Push each finished chunk with `git push origin HEAD:main` after confirming
`git merge-base --is-ancestor origin/main HEAD`.

---

## What is already done. Do not redo any of it.

**`final prompt`**, the thing this arc was for. Typed in any of a client's step threads, it uploads
one `.txt` carrying everything on file and asking for everything missing, across all 71 declared
fields and every audience. `src/lib/clients/final-prompt.ts` (pure) +
`final-prompt-thread.ts` (the IO) + `gap-thread.ts` (the door) + `scripts/_probe-final-prompt.ts`.

**12 of 23 outbound pulls through `getOrFetch()`**, 5 exempt with a written reason, 6 owed with a
written reason (`owedWhy` in `scripts/_step-wiring.ts`). Each lane is its own commit.

**A document dropped anywhere now has readable text.** `src/lib/clients/doc-text.ts`. Before this,
only a drop in step 11's thread was ever extracted; everywhere else it was a filename and bytes for
ever. Measured on SRT: 8 readable documents.

**`force` on `getOrFetch`**, which C12b's re-run button needs.

### Two lanes were written and then REVERTED. Do not put them back as they were.

`run-prompts.ts` (the audit fanout) and `extract-recommended.ts`. The full reasoning is in commit
`d0629bf` and section 4 of `docs/DATA-AND-WORKFLOWS.md`. In short: the cache is **not an archive**
(the write is an upsert, and on conflict Postgres replaces the row), which was the entire
justification; and caching the fanout double-counted the append-only `fanout_queries` evidence on
every watchdog re-kick, and served `search-research.ts`'s deliberately-rejected identity answers
straight back for the exact window a person re-runs in.

**They become correct once the append-only purchase table exists (owed item 1), and not before.**

---

## Part 1: the run. Do this first, before any more building.

The point is one honest end-to-end pass. Matthew types in Slack; the session reads the results back
and fixes what breaks. **Never run a step generator locally**: `NEXT_PUBLIC_APP_URL` is
`http://localhost:3000` here and it posts localhost links into production Slack.

### Choose the shape of the test

**(a) Re-walk SRT from the prep call.** Fastest, keeps the audit and the evidence.

```
bunx tsx --env-file=.env.local scripts/_srtid.ts
bunx tsx --env-file=.env.local scripts/_backfill-client-events.ts     # BEFORE anything deletes cards
bunx tsx --env-file=.env.local scripts/_reset-client-board.ts srt-agency-llc --dry
bunx tsx --env-file=.env.local scripts/_reset-client-board.ts srt-agency-llc --yes
```

‼️ **No `SLACK_CLIENT_ONBOARDING_CHANNEL` and no `--channel` any more.** The script resolves the
client's own `ops_channel_id` (SRT: `C0C1WTPH0AZ`) and prints which channel it used. Passing the
old shared channel made it delete from the wrong place and leave 33 live cards behind; passing
`--channel` on a client that already has one is a no-op, because `createOpsChannel` refuses to move
a board that has a home. Both were fixed in `77d0c8a`.

The board lands on **step 10, `offer_locked`**, with steps 1 to 9 re-confirmed by their own
verifiers. Note the reset deletes the 8 `client_docs` rows, so re-drop a PDF or two in a thread if
you want to see the final prompt carry them.

**(b) A genuinely new client, start to finish.** The stronger test, and the one that proves the
funnel. `scripts/_archive-client.ts <slug> --reason "..."` then re-provision, or onboard somebody
real. ‼️ `clients.intake_completed_at` is written by **nothing but a real `/onboarding2` signing**,
so a hand-made client deadlocks at step 1 for ever. Either sign one properly or set that column
deliberately and write down that you did.

### The walk, one command per message, in the step's own thread

| Step | Type |
|---|---|
| 10 | `offer: …` then `terms: …` then `outcome: …` then `price: …` then `review platform: …` then `review link: …` |
| 11 | **`final prompt`**, run it, then `research:` + answer, `avatar sheet:` + template, `short offer:` + template, `beliefs:` one per line |
| 12 | `keywords more <category>` as needed, then `keywords approve` |
| 13 | `objection: <what they said>` until the vertical has 20 |
| 14-20 | auto, or each card's buttons |
| 21 | `ladder` → `anchor at 4` → `headlines pick 4, 9, 12, 15, 18, 22, 27` → `plan approve` → `skeleton` → `research` → `research:` + paste → `plan draft` |
| 22 | auto |

**Verified gotchas, all measured:**

- The **channel top level is a wall**. Only `rerun 12` / `rerun 18-21` work there, and only in the
  client's own ops channel. Everything else gets an ephemeral pointing into a thread.
- On the pillar/supports route, **`plan approve` comes BEFORE `headlines`** (`readBatch` only sees
  `approved` or `claimed` rows). On the shorter route above, `anchor at 4` fires the headline lane
  itself, so `headlines` is not typed at all.
- `headlines pick` takes **exactly seven**, distinct, first one is the pillar.
- `emotional:` **requires a newline straight after the colon**. On one line it matches nothing and
  reaches the general assistant.
- **Two commands in one message is not refused outside step 10.** Every other matcher is `^…$`
  anchored with no `/m`, so a combined message matches nothing and the general assistant answers it
  in prose while saving nothing. One command per message, always.
- `skeleton` before `plan approve` prints *"There is no page null in this batch. There are 0."* It
  refuses correctly and the message is a bug worth fixing if it annoys anyone.

### What to watch and report back

- Does `final prompt` carry the documents, the research on file, the beliefs and the ladder, and
  ask for nothing already answered? That is the feature.
- `_probe-page-gate.ts` fails **two** checks today and it is pre-existing (`no_magnet` on a
  throwaway page). Confirm the same two before blaming the walk.
- If the audit engine is out of OpenAI credit, step 2's baseline cannot be re-measured. The cache
  lanes still work; say so rather than implying they were exercised.

---

## Part 2: what is owed, in priority order

Full detail in `docs/DATA-AND-WORKFLOWS.md` §5 and §7. The first three are data being thrown away
today; the rest is the North Star tail.

1. **The append-only purchase table.** One migration. Makes the archive an archive and
   `sum(cost_usd)` a real total, and only then can `run-prompts` be routed without lying. Paste the
   SQL in full in a fenced `sql` block, run it before the deploy that reads it.
2. **The market centre.** `MarketCenter.precision` is computed, documented as stored, and dropped by
   `provision.ts`; there is no column for it. `zip_centroids` has two readers and no writer, and
   `zipCentroidsLoaded()` exists to tell "no centroid" from "table never loaded" and **has no
   callers**. That centre is locked for the life of the tenant and is what an exclusivity promise is
   measured against.
3. **`question_bank.frequency_score` is overwritten, not raised**, across runs, on a table shared by
   the whole vertical for ever. The comment claims the opposite.
4. **C11**: `northStar(ctx)` and `/strategy`. Extract `Held`/`held`/`missing`/`stale`/`isHeld` into a
   pure `held.ts` first; `leadContextForPage()` already exists with zero callers and its signature
   must stay `(clientId: string)` because React `cache()` keys on argument identity.
5. **C12a**: `dataset_suggestions`, the one SQL in the North Star build.
6. **C12b**: the research console, `spendSoFar()`'s first caller. Blocked on item 1 being honest.
7. **C12c**: the screenshot annotation reader.
8. **C13c**: suggestions that leave the board (a new avatar, a new offer, new angles). Blocked on
   live page performance existing, because D9 forbids arguing from a number nothing measured.
9. **The four two-phase pulls.** `dataforseo`, `outscraper`, `millionverifier`, `enrich`. They need a
   read half and a write half rather than one read-through door; `owedWhy` says why for each.
10. **`outbound_queue` has one writer and no readers**, so a reply typed into a message thread is
    queued and never sent while Slack shows it as handled. And the voice-note failure message
    invites a paste that nothing stores.

---

## On a second machine

The test itself happens in **Slack against production**, so the only thing a machine is needed for
is the reset script and the probes.

```
git clone https://github.com/matthewg119/srt-mission-control.git
cd srt-mission-control && bun install
```

Then `.env.local`. It is deliberately not in git. The minimum for the reset and the probes is
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SLACK_BOT_TOKEN`; `ANTHROPIC_API_KEY`
for anything that calls a model.

‼️ **`vercel env pull` writes BLANK for every value marked Encrypted** and `vercel env add` from
stdin writes EMPTY. Copy `.env.local` across by hand, or read the encrypted ones out of the Vercel
dashboard. On this machine `OPENAI_API_KEY`, `DATAFORSEO_PASSWORD`, `MILLIONVERIFIER_API_KEY` and
`CRON_SECRET` are all blank locally and set in production, so a probe that needs them reports
nothing rather than failing. Do not conclude production is broken from a pulled env file.

Verification, all of it:

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts                          # 1064 checks
bunx tsx --env-file=.env.local scripts/_probe-final-prompt.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
bunx tsx --env-file=.env.local scripts/_probe-lead-context.ts
bunx tsx --env-file=.env.local scripts/_probe-dataset-cache.ts
bunx tsx --env-file=.env.local scripts/_probe-step-rerun.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-do-this-now.ts
bunx tsx --env-file=.env.local scripts/_step-wiring.ts --live          # regenerate the measured map
```

> ‼️ A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

---

## Rules that have already cost a day each

- **One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather
  than throwing.** `doc-text.ts` shipped selecting `client_docs.created_at`, which does not exist,
  and the feature silently did nothing while tsc, the build and every probe passed. Any lane that
  reads a table needs a live probe that runs the real select.
- **Write TypeScript containing regexes or escapes with the Write tool.** Heredocs and `sed` mangle
  escapes here and produce "unterminated string literal" far from the cause.
- **`core.autocrlf=true`.** Any generated doc with a `--check` arm needs the CR strip in
  `_step-wiring.ts`.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Anything bigger is a file upload.
- Resolve SRT by slug `srt-agency-llc`, never a pinned id.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
