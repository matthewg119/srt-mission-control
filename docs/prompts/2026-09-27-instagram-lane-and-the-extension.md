# The Instagram lane, and an extension that drafts the email it just earned

A prompt for a fresh session. Everything in a **Ground truth** block was measured against production
on **2026-09-27** and is quoted, not remembered.

**Repo:** `Mission control 2.0/srt-mission-control`. Work in a worktree; run `git branch --show-current`
before every commit. Read `CLAUDE.md` and `docs/lanes/CONTRACT.md` before writing code.

**Branch state:** everything below is already on `origin/main` and deployed. Start from main.

## What this build is

Matthew's day is: cold DM med spa owners on Instagram, and prepare email campaigns. Today those are
two disconnected motions. This build makes them one pipeline with two exits.

```
        followers of the accounts med spa OWNERS follow
        (equipment brands, injectable brands, trade orgs)
                            |
                     5, the IG door  (HikerAPI)
                            |
                     raw_leads (source=socialscraper)
                            |
              3, the one engine, unchanged
        qualify -> crawl -> MX route -> verify -> suppress
                            |
             +--------------+--------------+
             |                             |
        sendable.csv                  the extension
        email campaign            DM queue, ranked, with a
        (1,000 leads)             drafted email when there IS
                                  an email for that lead
```

IMPORTANT: **the engine does not change.** 5 is a door, like 4. Everything from `qualifying` onward
already reads `raw_leads` and does not care which vendor filled it. Building a second enrichment path
is the mistake this shape exists to prevent.

## Ground truth: production, 2026-09-27

```
contacts              8441
trt_leads              889
med_spa_leads          439      425 with a website
scraper_rows          1757      across 8 batches
raw_leads               50      the first real 4 pull, see below
sendable_leads           0      nothing has reached the end yet
list_pipeline_runs       1
outreach_prospects       4
clients                  5
ig_dm_runs               exists. The extension's DM lane already writes here.
```

### The first real Maps pull, end to end

`pull maps medspa | Dallas TX | med spa | limit 50`, approved with a check mark:

```
DataForSEO returned    50 records for $0.030      (1,765 matched in the metro)
with a website         35 of 50        70%
qualified keep=true    14 of 50        28%        <- a Claude call was paid for all 50
stage                  qualified, waiting at the drop-review check mark
```

IMPORTANT: **28% keep is the number this build should attack, not the record price.** The records cost
three cents. The qualification sweep ran over all 50 and threw away 36, including `CANDLE NAIL SPA`
and `Charlotte Tilbury - Sephora`. That waste comes from the category list: `facial_spa` and
`skin_care_clinic` are broad. Options, in order of how much they are worth trying: add
`is_claimed = true` (free, already supported by `searchListings`), narrow the categories, or filter on
name before qualifying. Measure the keep rate before and after, the way the crawl sample was measured.

### What is already built and must not be rebuilt

- `src/lib/scraper/pull.ts` - `LeadSource` already admits `"socialscraper"`, and so does
  `raw_leads_source_check` in production. `storeRawLeads` is chunked and idempotent on
  `(run_id, place_id)`. `fromOutscraper` and `fromDataForSeo` are the two templates for a third mapper.
- `src/lib/scraper/lane.ts` - `sweepPull` dispatches on `batch.workflow` through an exhaustive switch
  with a `never`. `releaseMapsPull` dispatches on `command.source` the same way. An IG arm is one
  `case` in each.
- `src/lib/scraper/maps-command.ts` - the grammar, `unwrapCode`, `parseNaturalPull`, `laneHelp`.
- `src/lib/geocode.ts` - Nominatim, cached a year, refuses rather than guessing.
- `src/lib/instagram/profile.ts` - parses a handle, business name, city and website out of a profile
  and returns null rather than guessing. **Do not write a second handle parser.**
- `src/lib/instagram/dm-run.ts` and `src/app/api/ext/instagram/prospect/route.ts` - the extension's
  existing one-profile-at-a-time flow: add the lead, draft the DM, poll for the result.
- `src/config/cold-email-1.ts` - the shared-inbox cold email, with `guard()` so an em dash fails the
  build. `[[ ... ]]` marks a clause that disappears when its token is empty.
- `sourceEmailOf` in `lane.ts` reads `raw_leads.raw` when there are no CSV headers, so the cheapest
  rung works for a non-CSV source. **For Instagram this is the rung that matters most**, because most
  IG leads have no website and the contact-button address is the only one they publish.

## The work, in order

### W1 - The 5 door: HikerAPI into raw_leads

**Vendor decided: HikerAPI.** Roughly $0.60 to $1.00 per 1,000 requests, prepaid, no monthly floor,
and `public_email` comes back on the profile endpoint. Against SocialScraper at about $24.75 per 1,000
emailable leads, HikerAPI is the one worth the orchestration because this lane will run monthly.
`docs/2026-09-25-instagram-vendor-options.md` has the full comparison and the ToS position.

IMPORTANT: **the input is FOLLOWERS OF INDUSTRY ACCOUNTS, not likers of consumer posts.** Likers of a
med spa's post are its PATIENTS. Followers of an equipment or injectable brand are practices, owners
and injectors. Likers also do not paginate: one post caps at roughly 1,000 to 1,900 accounts and about
72% of them are private. Followers paginate properly, which is the only reason 1,000 leads is
reachable at all.

Seed accounts to harvest, by company. **Verify every handle by hand before running anything**, because
a wrong handle spends money on the wrong followers: Allergan Aesthetics, Galderma, Merz Aesthetics,
Revance, Evolus, InMode, Cynosure, Candela, Sciton, Cutera, Alma, BTL, Hydrafacial, Venus Concept,
plus AmSpa and the practice-management tools Zenoti, Boulevard and Aesthetic Record.

Build:

1. `src/lib/hikerapi.ts`, shaped exactly like `src/lib/dataforseo-places.ts`: `isConfigured()`, typed
   responses, no throws, errors returned rather than raised. Two calls: followers by handle (50 per
   page, you paginate) and profile by username.
2. `fromHiker(profile, ctx)` in `pull.ts`, sibling of `fromDataForSeo`. `source: "socialscraper"`.
   `placeId` falls back to `"ig:" + handle` so a re-driven pull is idempotent, the way the other two
   mappers fall back to a domain.
3. The command: `pull social medspa | @inmodemd | followers | limit 500`. Extend `MapsSource` to
   include `hikerapi` rather than inventing a second grammar, and let `parseNaturalPull` reach it too
   (`get me med spa leads from @inmodemd followers`).
4. `Workflow` gains `"socialpull"`, which needs `scraper_batches_workflow_check` widened. It is NOT
   added to `FILE_WORKFLOWS`: it has no file, so it has no columns and no keycap.
5. The estimate card must show the request count and the cost, because HikerAPI bills per request and
   a follower list of 200,000 is not a pull anybody meant to run. Cap it.

**The decision this build has to make and write down:** most IG leads have no website. `listprep`
requires one, and `_probe-scraper.ts` pins that on purpose. Either give the IG arm its own
`REQUIRED_COLUMNS` entry, or qualify IG leads on bio and follower count instead. **Do not loosen
`listprep`.** Whichever is chosen, say why in a comment and cover it in the probe.

### W2 - Filter for owners, not employees

Followers of an equipment brand include a great many employed injectors and nurses. Before a Claude
call is spent on a row, drop for free: private accounts, accounts with no business category, personal
accounts, and handles whose bio names an employer rather than a practice. Report the count on the card
the way the free pre-filter before MillionVerifier does, so the saving is visible rather than asserted.

### W3 - The first 1,000, measured

Pull, qualify, crawl, verify, suppress, publish `sendable.csv`. Write the funnel into this file under
a heading dated the day it ran, the same way the 60-site crawl sample was written into the 2026-09-25
prompt:

```
followers pulled        ?
readable profiles       ?     (private accounts are the rest)
with a contact email    ?     expect 30 to 43%, business accounts highest
with a website          ?
qualified keep          ?
verified sendable       ?
cost, vendor            $?
cost, qualification     $?
```

IMPORTANT: **write down what it cost per SENDABLE lead.** That number is the only thing that decides
whether Instagram earns a second run against the Maps door, which currently produces 50 records for
three cents before qualification.

### W4 - The extension drafts the email it just earned

Today `/api/ext/instagram/prospect` adds the lead and drafts a DM. When that lead HAS an email, from
the contact button or from the site crawl, the panel should also offer a drafted email and a follow-up
two days later.

The two emails Matthew actually sends are the shape to reproduce:

- **Email 1, the permission ask.** Names what their patients do, states the free offer, asks permission
  to send a short video, ends with a question that is easy to answer.
- **Email 2, two days later, the audit result.** Leads with a measured number ("you came back in 1 of 4
  searches"), repeats the free offer, asks a negative-consent question ("would you be against me
  sharing a video"), and says exactly how to reply.

Build:

1. `src/config/ig-email-sequence.ts`, next to `cold-email-1.ts` and under the same rules: every string
   through `guard()`, `[[ ... ]]` for any clause that depends on a field that might be blank, and only
   merge fields the lead actually carries.
2. IMPORTANT: **email 2 claims a measured number, so it must not be sent without one.** "You came back
   in 1 of 4 searches" is a fact from the audit engine. If no audit has run for that lead, either run
   one or send a version that makes no claim. A follow-up that invents a number is the one failure
   here that cannot be walked back.
3. A `GET /api/ext/instagram/prospect/{runId}` response that carries the drafted email alongside the
   DM, so the panel renders both without a second round trip.
4. The two-day follow-up is SCHEDULED, not sent: it lands in the same approval surface the rest of the
   outbound uses. Nothing in this repo sends mail unattended, and that is deliberate.

### W5 - Keep the two motions apart, on purpose

IMPORTANT: **do not put bulk harvesting in the extension.** The extension is logged in as Matthew.
Bulk follower scraping from a logged-in session is the pattern Instagram restricts accounts for, and
the account it would cost is the one that sends the DMs, which is the asset. Meta v. Bright Data
(N.D. Cal., 2024) covers scraping public data while logged OUT; it does not cover a logged-in session.

So: the vendor discovers, logged out, at volume. The extension closes, logged in, one at a time, on a
queue the pipeline has already ranked and enriched. The extension gets a FEEDER, not a scraper.

## Traps, each one already paid for once

1. IMPORTANT: **a command surface that is also a chat surface cannot fail silently.** `pull maps ...`
   typed as Slack CODE did not match `^pull maps`, `handleScraperEvent` returned false, and the general
   assistant answered it out of the CRM instead. It looked exactly like the feature had worked and
   returned 25 leads. Nothing had run. `unwrapCode` exists for this; any new command goes through it.
2. IMPORTANT: **a vendor can accept a filter and ignore it.** DataForSEO takes `location_name`, returns
   status `20000 Ok`, and answers globally: 85,179 matches from Quito, Phuket and Shenzhen where a
   coordinate returned 804 in Dallas. **Checking the status code proved nothing. Only the rows did.**
   Assume HikerAPI has at least one filter of the same kind, and look at the rows.
3. IMPORTANT: **a literal that was right when it was written.** `beginMapsPull` passed
   `source: "outscraper"` as a literal, correct until a second source existed, and it silently
   mislabelled the first real DataForSEO run. `raw_leads.source` was right the whole time, which is
   what hid it. A third source makes this shape likely again: grep for literals near `startRun`.
4. `_probe-scraper.ts` is offline and now runs in CI. `_probe-list-prep.ts` needs the live DB and
   cannot: run it as `bun run --env-file=.env.local scripts/_probe-list-prep.ts`. `bunx tsx` cannot
   load it, because it imports `bun:SQL`.
5. An absence check over un-stripped source tests the prose, not the program. Strip comments first.
6. **The escape trap.** Writing TS through a shell heredoc silently eats one backslash level: a lone
   `\s` inside a template literal becomes the letter `s`, and every test using a single space still
   passes. Use `String.raw`, and assert on a tab or a double space.
7. No em dashes anywhere. `guard()` makes it a build failure for copy; the probes check the cards.

## Definition of done

- `pull social medspa | @<handle> | followers | limit N` runs end to end, lands in `raw_leads` with
  `source='socialscraper'`, and reaches `sendable.csv` through the same 3 engine.
- The 1,000-lead funnel written into this file, with the cost per sendable lead stated.
- The keep rate on a Maps pull measured before and after whatever W1's category or `is_claimed` change
  turns out to be, with both numbers written down. If it did not move, say so.
- The extension returns a drafted email for a lead that has one, and schedules the two-day follow-up
  into the existing approval surface.
- Probes green: `bun --no-env-file run scripts/_probe-scraper.ts` and
  `bun run --env-file=.env.local scripts/_probe-list-prep.ts`. `next build` green.
- SQL handed to Matthew pasted in full in a fenced sql block, never as a file path.

## Left for Matthew to decide, do not decide it yourself

- Whether IG leads with no website are qualified on bio and follower count, or held back.
- Which seed accounts to harvest first, and whether to start with one to measure before spending wider.
- Whether the two-day follow-up sends on a timer once approved, or asks again each time.
