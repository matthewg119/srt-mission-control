# Finish the batch drafting flow, then onboard at production volume

A build prompt for a fresh session, written 2026-09-14. It supersedes
`Desktop/SRT-Headline-First-Pages-Prompt.md` and the 2026-09-13 plan that followed it. Everything
below was measured against the repo and the production database on 2026-09-13 and 2026-09-14.
Line numbers drift; symbol names do not.

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-page-plan"      # git worktree, branch feat/page-plan
```

Not `Mission control 2.0/srt-mission-control` (parked on another branch) and not `_wt-magnet-finish`.

`main` and `feat/page-plan` are both at **ab818e6**. The tree is clean. Start by confirming that
and by running the verification block at the foot of this file, so you know what green looks like
before you change anything.

## READ THIS BEFORE YOU CHASE A FAILING PROBE

`bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts` reports **2 failing**, and it is NOT a
code fault. Do not "fix" it.

`concierge_configs` is empty for every client. `offerForPage` (`concierge/for-client.ts:87`) resolves
a magnet through `conciergeTenant`, which reads that table; no row means no magnet, and
`checkMagnet` (`hub/page-gate.ts:329`) is tier **block**. So the two fixtures that expect `warn` and
`pass` get `block`, and the `no_magnet` detail says so.

`_reset-client-board.ts:147` lists `concierge_configs` in the WIPE set. The W7 reset on 2026-09-13
deleted SRT's row and SRT was the only one. Step 20 `concierge_preview` recreates it, and the board
is parked at #10, so it has not run yet. `delivery-steps.ts:292` already documents this dependency:
minting a magnet and resolving one for the drafter both need that row.

**It clears itself when step 20 runs.** `house_style` failing beside it is warn-tier noise (the
fixture page carries no meta description, which is why it fails in all four checks including the two
that pass). Re-run this probe after step 20 and expect green; if it is still red THEN, it is real.

## What is already done and pushed. Do not rebuild it.

Three commits landed on main on 2026-09-14. Read them before writing code: `git log -3 ab818e6`.

| Commit | What it settled |
|---|---|
| `8886b3f` | `clientAvatarVerticalId` maps `clients.vertical_slug` onto `verticals.id`. They are two namespaces and were never mapped, so `loadVertical("aeo-agency-med-spa")` fell through to DEFAULT and returned **pest control**: 0 quotes, 0 approved numbers, and "backed, not banned" collapsed into "banned". Also lands the AEO headline engine, `client-headlines.ts` and its 56-check probe. |
| `3c4cf57` | The whole keyword research loop. The research now reads the LOCKED offer (`loadOffer`, `offerTerms`), the KEYWORDS block ships a worked pipe-delimited row so it actually parses, `ingestResearch` reports phrases / keyword rows / how many carry a source URL, `askedAboutOffer` is granted to `manual` ONLY, and expansion asks for the shortfall instead of the full target. |
| `ab818e6` | `PRE_CALL_SUPPORTS` 8 to 6 and `PLAN_KEYWORDS_NEEDED` 9 to 7. |

**`scope: "over_delivery"` stays at `rank >= 9` and must not be tied to `PRE_CALL_SUPPORTS`.**
That 9 is 1 + the 8 pages core sells in a month. It is a contract, not a batch size. Tying them
together would tag the eighth page, which the client paid for, as over-delivery. An earlier draft of
this plan got that wrong and the correction is in `ab818e6`'s message.

**Expect the relevant-approved keyword count to DROP on existing clients.** That is the point of
`3c4cf57`: `keywordVerdict` now says a set is short and names the fix instead of passing on filler.
If SRT's set reads short at step 12, that is the fix working, not a regression.

## Decisions. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | Onboarding always starts **1 pillar + 6 supports = 7 pages**. Done in `ab818e6`. |
| D2 | In the DRAFTING channel a batch first asks **new pillar or existing pillar**, and may be supports-only under an existing one. The onboarding channel never asks: always a new pillar plus 6. |
| D3 | Order is **pillar, then a headline per page, then a skeleton per page, then ONE research for the whole batch, then draft all 7**. Every decision for every page is made BEFORE the research fires, so it is one shot. |
| D4 | **Two research passes per client, BOTH manual paste-back.** Step 11 `avatar_harvest` covers avatar, offer and the 100 buyer search phrases. Step 21 `pre_call_pages` runs ONE prompt covering all 7 skeletons. Never one prompt per page. |
| D5 | **Research first, expansion fills gaps only.** Done in `3c4cf57`. |
| D6 | Sections per page: **the subject decides, 6 to 14**, hard floor 6, at least **5 divergent** (not price, fear, comparison or process). What, why and how are mandatory on every page and checked in code. |
| D7 | **One card for the whole batch**, numbered, and Matthew can ask for MORE at any point (`headlines more`, `skeleton 3 more`). |
| D8 | Schema: **Article + FAQPage** for multi-section pages, `QAPage` kept for genuine single-question pages. |
| D9 | **Volume is CONCURRENCY, not batch size.** Matthew, 2026-09-14: roughly 14 new onboardings a day, each client getting the same 7 pages. The per-client flow does not change. What must hold is many clients mid-onboarding at once. |
| D10 | **Research stays a manual paste-back** (Matthew, 2026-09-14, asked directly and chose it over automating step 21 by API). He reads every answer. |

### What D9 and D10 mean together, and it is the one thing to design for

Two manual research runs per client at roughly 14 clients a day is roughly 28 paste-backs a day.
Matthew was told that and chose it, so build to it. It makes three properties load-bearing:

1. **A paste must never reach the wrong client.** It does not today:
   `api/slack/events/route.ts:860` resolves `clientId` from the channel, and every client has its
   own ops channel. Verified 2026-09-14. Do not refactor the door onto a global listener.
2. **No client's board may stall on another's.** `reachableCursor` and `runReadyAutoSteps` are
   per-client and already satisfy this. Check it stays true for anything new you chain.
3. **A thin ingest must be loud, per client.** `3c4cf57` made `ingestResearch` report three counts.
   At 28 pastes a day nobody re-reads a silent success, so that count line is the whole safety net.
   Keep it on the card as well as in the reply.

## The work

### W1. The batch at step 21, and in the drafting channel

Order is D3: pillar, headlines, skeletons, one research, draft 7.

**1a. Pillar choice.** New in the drafting channel: `batch` starts one and asks new pillar or
existing pillar first (D2). `page_plan.pillar_id` and `role` already exist (`PlanRow`,
`page-plan.ts:84-104`), so an existing pillar is a row to point at. In the onboarding channel
`runPreCallPlan` keeps its current behaviour and never asks.

**1b. Headlines for the batch.** Wire `generateClientHeadlines` (`client-headlines.ts:372`), which
**today has zero callers**. For each of the 7 planned pages generate 3 candidates carrying that
page's keyword (`generateKeywordHeadlines({clientId, keyword, count: 3})`, new, reusing the same
engine, prompt and validators plus a placement check that the keyword really is in the line). Post
ONE card with all 7 pages and their 3 options each (D7). Commands: `headline 3 pick 2`,
`headline 3 more`. Both write `client_headlines` with `origin = 'keyword'`, which needs the
migration below.

**1c. Skeletons for the batch.** `OUTLINE_LIMITS` (`draft-page.ts:667`) is still
`minSections: 2, maxSections: 5`. Rewrite it and `OUTLINE_SYSTEM` to **6 to 14, the subject
deciding** (D6), each section an H2 phrased as a long-tail question in her words. Enforce in code,
not only in the prompt:

- at least 5 headings that are NOT price, fear, comparison or process vocabulary;
- what, why and how all present;
- each section carries its own long-tail keyword, written to `client_pages.section_keywords`.
  The column exists, shape `[{heading, keyword}]`, and **nothing writes it today** (grep returns
  zero writers). `DraftedOutline` (`:704-707`) needs the per-section keyword field.

Post all 7 skeletons on one card. `skeleton 3 more` regenerates one page's options.

**1d. ONE research for the batch.** After `batch approve`, build a single prompt from the UNION of
all 7 skeletons' gaps, each question tagged by page (`[P1]` through `[P7]`). Reuse
`buildCompactPrompt`'s shape (`deep-research-run.ts:505-536`) and the `research:` door
(`research-intake.ts:37`).

**It needs a new destination.** `ingestResearch` writes `question_bank` only, which is keyed
(vertical, avatar) with no `client_id` and no `page_id`. A batch answer is per page. Route it to
`page_sources` with `page_id` set and `source_type = EXTERNAL_RESEARCH` (the type exists,
`page-evidence.ts:37`; its only writer today is `api/clients/[id]/hub/route.ts:416`). Parse by the
`[Pn]` tag and fan out. An untagged section goes to the client-wide library (`page_id` null), which
is what that null already means. Leave the KEYWORDS-block path untouched: that one is about the
offer, not about these pages.

**1e. Draft all 7.** `draftOne` (`pre-call-pages.ts:354-471`) must pass the outline to `draftPage`;
it is the only path that does not, and the studio already does. Budgets hold: 7 pages at
`CONCURRENCY = 3` is three waves inside `WAVE_BUDGET_MS = 240_000`, `MAX_HOPS = 6`.

**1f. The magnet moves after the body.** Move `stageFrameCandidate` and `approveMagnetCandidate`
(`:415-431`) to after `savePage` (`:443-457`) and frame the magnet from the finished body. The
current order is deliberate and commented ("so the draft knows where to stop"), so **rewrite that
comment to say what replaced it rather than deleting it**. Keep the guard on `page.leadMagnetKey` so
a re-entered wave cannot mint twice, and keep failure non-fatal.

### W2. The drafter

- **Length.** Replace the global "250 to 500 words" in the SHAPE block of `SYSTEM`
  (`draft-page.ts:143-145`) with **250 to 600 characters per section**, and replace the flat
  `>= 120 words` floor in `isDrafted` (`:241`) and `whyInvalid` with a per-section check.
- **Rule 8**: what, why and how on every page.
- **Keep rule 4** (no outcome promises in the body, `:130`) and the link ban (`:254`). The asymmetry
  is deliberate: a headline may open a loop that the body must close with evidence.
- More `##` subheadings are now expected, so the "at most two" line in SHAPE goes.

### W3. Placement, round trip, preview, schema

- **New pure `src/lib/hub/keyword-placement.ts`** (the file does not exist): the primary keyword in
  slug, title, H1, meta, first sentence, at least one H2, the pillar's anchor text, and schema. None
  of it is checked today. Add `keywordSlug()` (stopwords stripped) and pass it as `input.slug` for
  NEW pages only, never a published one.
- **`checkKeywordShaped`** (`page-gate.ts:401`) warns when a term repeats, which fights deliberate
  placement. Raise the threshold and add a warn-tier placement check. **Warn, never block: evidence
  is the only thing that blocks.**
- **Round trip** in the page studio. The body path is append-only by design and anything unmatched
  is appended verbatim, so new verbs must be anchored (`page-studio.ts:2307-2527`): `text` (whole
  body in one copyable block) next to `/^body$/i` at `:2452`; `replace:` (whole-body verbatim
  replacement via `savePage`, prior body pushed onto the existing `undo` stack) beside `add:` at
  `:2436`; `preview` beside `check` at `:2462`. Add all three to `howToLines()` (`:370-380`) and to
  `_probe-page-studio.ts`.
- **Schema** (D8): `articleJsonLd` plus `faqJsonLd` built from the H2 long-tails for multi-section
  pages, `QAPage` kept for single-question pages. The 2023 comment in `jsonld.ts` explains the old
  choice and should be rewritten rather than removed.

### W4. Weekly headlines

20 general per client per week, riding `followup-digest` as a passenger, weekday-gated like
`runWeeklyReports` and idempotent on ISO week. **Do not add a `vercel.json` cron**: there are
already 17 against a Hobby plan that documents 2, and `followup-digest/route.ts:43` says so.

### W5. Then onboard SRT Agency LLC, and only then the volume check

The board is reset and waiting at **#10, the prep call**, in `#srt-agency-onboarding`
(`C0C1GK0PR6V`). 82 events are backfilled. Do NOT reset again unless something forces it; if it is
forced, the command is in the header of `_reset-client-board.ts` and it keeps `intake_completed_at`.

1. `offer:` and `terms:` on #10, then Done.
2. #11 `avatar_harvest`: run the FIXED research prompt in claude.com, paste back with `research:`,
   and **read the ingest report**. It must say how many KEYWORDS rows parsed and how many carry a
   source URL. If it says zero, the answer is wrong, not the code. Before `3c4cf57` this number was
   zero every time and nothing said so.
3. #12 `keywords approve`. The card must show research and harvest outranking expansion, and must
   name any category the model was not asked about.
4. #20 runs and writes `concierge_configs`. Re-run `_probe-page-gate.ts` here: it should go green.
5. #21: pillar, 7 headlines, 7 skeletons, one research, then 7 drafts.
6. Verify a page: the picked headline as H1, 6 to 14 long-tail H2s with 5 or more divergent,
   what/why/how, 250 to 600 characters per section, the keyword in slug, title, meta, first sentence
   and an H2, the magnet minted after the body, and `section_keywords` populated.
7. In `#aeo-seo-page-drafting`: `text`, edit outside Slack, `replace:`, `preview`, `check`.
8. **Only once one client is through end to end**, run a second client alongside a third to prove
   D9: two boards moving at once, two `research:` pastes in two channels, neither cursor blocking
   the other, and `client_events` showing both cleanly separated.

Nothing publishes. The gate blocks on evidence and only warns on placement.

## SQL

Both were pasted to Matthew in full on 2026-09-14 and he is running them. Confirm before relying on
either: `voc_quotes` was measured MISSING in production on 2026-09-13, and `client_headlines.origin`
does not accept `'keyword'` until the second one runs.

- `docs/2026-08-26-voc-quotes.sql` (adds `verticals.voc_quotes`, seeds 20 med spa owner quotes)
- a new migration widening `client_headlines_origin_check` to include `'keyword'`

Every further migration goes in the chat as a full sql block, never a file path.

## Verification

```
bunx tsx scripts/_probe-aeo-headlines.ts        # 56 checks, must stay green
bunx tsx scripts/_probe-dr-headlines.ts         # the ad lane must not regress
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-page-studio.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts   # 2 failing until step 20 runs, see above
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx scripts/_probe-step-verify.ts          # 41 steps
bun run scripts/test-onboarding-artifacts.ts    # 824 checks
./node_modules/.bin/tsc --noEmit
bun run build
```

Add `_probe-headline-page.ts`: outline divergence, what/why/how, per-section characters, all eight
placement slots, `keywordSlug` stopword stripping, and the `[Pn]` batch-research router.

## Gotchas that have bitten before

- A local rebuild of a step card publishes localhost links. Check `APP_URL` before running a step
  generator locally. One was seen in production Slack on 2026-09-12.
- `scripts/*.ts` needs an import or an export or `next build` breaks.
- `vercel env pull` writes BLANK for values marked Encrypted. `CLIENT_LINK_SECRET`,
  `SLACK_CLIENT_ONBOARDING_CHANNEL`, `OPENAI_API_KEY` and `MATTHEW_SLACK_USER_ID` all pull empty and
  are set in production. Do not conclude prod is broken from a pulled env file.
- `vercel env add` from stdin writes an EMPTY value. Use the REST API.
- A "does nothing" production deploy usually means a red build: `vercel ls --prod`.
- One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather than
  throwing, so a try/catch around it never fires.
- ON CONFLICT infers by matching key expressions; a bare column list does not match a partial index
  (42P10). Use plain unique constraints.
- Never an em dash in copy or in anything a model writes.
- Deploy only by fast-forward push to main after `git fetch` confirms main has not moved. Never
  `git add -A`; run `git branch --show-current` before every commit; stage by `:(literal)` paths.
