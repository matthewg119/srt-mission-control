# Say "pull 2000" and have it know where. Then be able to ask it questions.

## Why this exists

The territory system landed on 2026-10-08 and the lane now knows, per metro, what has been pulled,
what remains, what tier it is and where each lead was routed. Everything needed to answer "which
metro next" is in the database and on `/dashboard/territory`.

What is still manual is the part a person does badly: reading the plan, doing the arithmetic,
splitting it into 300-row chunks, and typing four commands with the right offsets. `limit 3000`
against a metro holding 1,990 is how batch `7a472c40` died, and the offsets in the four chunks run
on 2026-10-08 were worked out by hand from a number that turned out to be stale.

This prompt builds three things: the command that plans a pull for you, the drops made visible, and
a scraper you can ask questions.

---

## Ground truth, measured 2026-10-09. Do not re-derive any of it.

Production is `main`, and everything below is already live and already backfilled.

### Where the data stands
```
1,750  raw leads pulled, all medspa, all Dallas
  977  route = email
  416  route = call
  357  route = drop
    0  tiered          <- every row was judged under the OLD boolean prompt
    0  judged_vertical <- same reason
  345  contacts on the CRM call list, every one dialable
  492  addresses awaiting MillionVerifier
    0  scraper_cells   <- the national crawl has never been run
```

### The Dallas circle
```
1,990  businesses in the 30km circle, five med spa categories (read 2026-10-08)
1,765  the same circle read 2026-09-28. The vendor's index grew 12.7% in ten days.
1,750  pulled
  240  LEFT
```
‼️ **One 300-row chunk at `offset 1750` finishes Dallas.** The next metro is Houston.

### The funnel, both cohorts
```
                        first run (500)    the four chunks (1,200)
raw                              500                  1,200
kept                             256  51%               707  59%
crawled                          111                    707   <- all of them
address found                     64  13% of raw        486   41% of raw
sendable                          46  9.2%                ?   waiting on MV
```
The first run died mid-crawl at 111 of 256. The difference is entirely that.

### What the ICP actually rejects
Of 1,200 pulled, 493 dropped: **257 by a free rule** (no website) and **236 by the model**. The
model's 236:
```
 80  chain or multi-site location
 57  no own domain (Instagram, Facebook, Vagaro, GlossGenius, Square)
 39  too few reviews to confirm trading
 19  other
 13  wrong trade entirely
 13  sells products, not treatments
  6  beauty or dental school
  5  salon suite rental model
  4  barber shop
```
The ICP rejects about 1 in 5, and 137 of those 236 are the two rules nobody argues with.

---

## What must NOT be re-measured or re-litigated

- ‼️ **PostgREST caps any rpc at 1,000 rows, server side.** `.range(0, 3999)` does not lift it;
  `.range()` can only PAGE. This silently truncated the territory map: the function returned 1,546
  rows, supabase-js handed back 1,000, and because the query orders by cluster size the map looked
  full while 546 businesses went missing from the quiet edges. `territoryDots` pages now. Any new
  rpc returning more than 1,000 rows must page the same way.
- ‼️ **`contacts.phone_last10` is GENERATED ALWAYS** from `phone` and REFUSES any value you send.
  There is no trigger; looking for one is a dead end. Set `phone`.
- ‼️ **There is no `contacts.city`.** The business location columns are `biz_city`, `biz_state`,
  `biz_zip`, `biz_address`. `home_address` belongs to the funding side.
- ‼️ **`contacts.source` is a controlled vocabulary matched with `eq`.** Deriving it from a label
  put 253 contacts in a bucket no filter knew about. It lives on the registry as `crmSource`.
- ‼️ **NPPES is a dead end for med spas** (2 names from 75, 1 usable) and worth running only for
  `dentist`. **Prospeo has 0% usable coverage.** **LeadMagic, Dropcontact and Snov.io are ruled out
  on contract, not performance.** Do not re-test any of them.
- ‼️ **Do not measure a paid email vendor yet.** The cohort is about to change: nothing is tiered.
  Hunter.io and Anymailfinder are the two to try, after the first tiered pull.
- ‼️ **`day_spa` and `beauty_salon` kept 0 of 35** and stay out of `DFS_CATEGORIES`. And a live
  vertical's category list may NOT be edited: `scraper_cells` is keyed on it. A new list needs a
  new slug.
- ‼️ **A vendor 500 no longer kills a pull.** It parks for two more cron ticks and then refuses by
  name. Do not add a second retry.

---

## Phase B — `pull 2000 medspa`, one command

The operator says how many records they want. The lane works out where.

Everything needed exists in `src/lib/scraper/territory.ts`: `metroRows`, `metroPlan` (16 Sun Belt
metros with what is worked and what remains), and `pullCommands` (300-row chunks with walking
offsets). None of it is wired to a Slack command.

**The command.** `pull 2000 medspa`, parsed next to the existing `pull maps ...` grammar in
`src/lib/scraper/maps-command.ts`. A count and a vertical, nothing else.

**What it does, before spending anything:**
1. Reads the plan. Takes metros in priority order, skipping any whose `remaining` is 0.
2. Allocates the budget across them: fill the current metro's remainder first, then the next.
3. Splits each metro's allocation into 300-row chunks with correct offsets, from `pullCommands`.
4. Posts **one card**: the metros, the chunk count, the total records, the estimated cost
   (`$0.37/1,000 + $0.012/task`), and what will be left in each metro afterwards.

**‼️ NOTHING IS BOUGHT UNTIL A CHECK MARK.** Same gate the estimate card already uses. Matthew's
standing rule, 2026-10-09: "for changes always ask permission in slack".

**‼️ AND THE CHUNKS RUN ONE AT A TIME.** `activeMapsPull` serialises pulls on purpose: two in
flight means two qualification sweeps and two crawls competing for one cron tick. The card's check
mark queues the plan; the cron walks it.

**‼️ A METRO WITH NO MEASURED CIRCLE CANNOT BE ALLOCATED A BUDGET.** `remaining` is null, not zero,
for anything never measured, and 15 of the 16 metros are in that state today. Guessing a metro
holds 1,990 because Dallas does is how a plan buys 300 records in a city that has 40. Either
allocate only to measured metros and say the budget could not be spent, or spend one task fee
($0.012) measuring the next metro first and say that on the card. The second is better; make it
explicit rather than silent.

## Phase C — the drops, visible

The bucket table above, live, so "what categories are we throwing away" is a page rather than a
question.

- On `/dashboard/territory`, per metro: drops split into **free rule** vs **model**, and the model's
  drops bucketed. The buckets are prose today; once tiering is live they are `judged_vertical`,
  which is the real answer.
- ‼️ **Bucket on `judged_vertical` where it exists and fall back to the reason text, never the
  reverse.** The reasons are model prose: the stored rows carry nine spellings of "Instagram only".
  `groupDrops` normalises them for counting and even that is fuzzy.
- Tier C and off-vertical rows are NOT drops and must not be shown as such. They are on the call
  list.

## Phase D — the conversational scraper

Matthew, 2026-10-09: "let me be able to conversate with scraper to organize data and stuff like
that ... if i text it right now like hey so what categories we have from the dropped clients we
have pulled and what do you think of doing X ... it should understand our whole onboarding, avatar,
offer etc, like vektor you know."

**This is smaller than it sounds, and the reason is that two thirds of it already exist.**

- `#srt-scraper` ALREADY falls through to the assistant. `handleScraperEvent` returns false for
  anything that is not a CSV drop or a known command, and
  `src/app/api/slack/events/route.ts` then passes the message on. Ordinary chat in that channel is
  already reaching a model.
- The assistant already has 13 tools in `src/lib/crm-tools.ts`, including `describe_schema` and
  `query_database`.

**So the work is tools and context, not a new agent.** Add scraper-shaped tools:
`get_territory` (the plan and the per-metro table), `get_drop_breakdown` (Phase C's buckets),
`get_run` (one run's funnel), `get_call_list`, and the onboarding/avatar/offer context the client
side already models.

**‼️ READ-ONLY TOOLS FIRST, AND A PLAN RATHER THAN AN ACTION FOR ANYTHING THAT SPENDS.** When asked
to do something that costs money or writes, it must produce the COMMAND and post it for a check
mark, never run it. That is the same rule as every other card in this lane and it is the thing that
keeps a conversation from becoming an unreviewed purchase.

**‼️ AND IT MUST NOT GET `query_database` AGAINST PRODUCTION WITHOUT THE EXISTING GUARD.**
`crm_readonly_query` is SECURITY DEFINER with a SET ROLE and needs the SESSION pooler URI; the
transaction pooler breaks it. Reuse it, do not write a second one.

---

## Definition of done

- `pull 2000 medspa` posts one card naming the metros, the chunks, the cost and what is left after,
  and buys nothing until a check mark.
- A metro with no measured circle is either measured first or reported as unallocatable. Never
  guessed.
- `/dashboard/territory` shows drops split free-rule vs model, bucketed, per metro.
- Asking a question in `#srt-scraper` gets an answer drawn from the lane's own data, and asking for
  something that spends gets a card, not a purchase.
- `./node_modules/.bin/tsc --noEmit` clean. `npx tsc` is a decoy.

## Conventions

`bun run`, never `bunx tsx`, for anything needing `.env.local`. Migrations are
`docs/YYYY-MM-DD-name.sql`, applied with `bun run scripts/db.ts --file=... --dry` then for real, and
pasted in full in chat rather than referenced by path. Probes are `scripts/_probe-*.ts`; offline
ones end in a summary plus `process.exit`, live ones end in `await sql.end()`. Prove a check can
fail before trusting that it passed, and prefer an index comparison to a character window when the
thing being asserted is an ordering. No em dashes in any copy the system generates.

Repo: `C:\Users\matth\Desktop\Code\_wt-kwstrategy`, a worktree of
`Mission control 2.0/srt-mission-control`. Production builds `main`. The worktree is shared, so
never `git add -A` across the whole tree.
