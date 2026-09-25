# The lead engine: one enrichment core, three front doors

A prompt for a fresh session. Everything in a **Ground truth** block was measured against
production on **2026-09-25** and is quoted, not remembered.

**Repo:** `Mission control 2.0/srt-mission-control`. Work in a worktree; run
`git branch --show-current` before every commit. Read `CLAUDE.md` and `docs/lanes/CONTRACT.md`
before writing code.

**Branch state:** `feat/workflow-c` is **3 ahead of and 19 behind `origin/main`**. It carries
Workflow C (the 3️⃣ arm). Nothing in it has ever executed against production. Rebase and re-prove
before writing a line of new code — see W1.

---

## What this build is

Today the scraper lane has two live arms and one unmerged third. This build finishes the third,
then puts two lead-*getting* front doors in front of it.

```
4️⃣ MAPS PULL                    5️⃣ INSTAGRAM PULL
   input:  metro + query            input:  a post / audio / competitor handle
   source: Outscraper               source: SocialScraper
   out:    businesses               out:    handles + emails + bios
                  │                              │
                  └──────────────┬───────────────┘
                                 ▼
                     3️⃣ CLEAN + ENRICH  (the one engine)
             qualify → name → email → MX route → verify → suppress
                                 ▼
                           sendable.csv
```

3️⃣ is the **only** enrichment engine. 4️⃣ and 5️⃣ are front doors. A hand-dropped CSV is the third
front door and keeps working exactly as it does now. Do not build a second enrichment path for
either source; that is the mistake this shape exists to prevent.

---

## Decisions Matthew made 2026-09-25, so they do not get re-litigated

- **Option A on the owner problem: `info@` is an acceptable target, and the COPY does the work.**
  For a 1–3 person med spa the shared inbox *is* the owner's inbox. Email 1 names the business in
  the subject and opens with a pass-this-along line. We are not gating sends on finding a personal
  address.
- **No Reacher, and no second verifier.** MillionVerifier stays the only one. Rejected on 2026-09-25
  because it is not the same job: MV carries disposable lists, spam-trap detection and complainer
  data; Reacher is syntax + MX + SMTP only. The saving at our scale is ~$30 per 10k against a
  domain-reputation risk. Do not add a verifier seam "for later" — there is no second verifier.
- **Free pre-filter before MV instead.** MV bills per address UPLOADED, so rejecting junk for free
  first is where the money actually is. This is the approved version of "don't pay for what we can
  do for free".
- **`pickBestEmail` goes owner-first.** A same-domain named address now beats `info@`.
- **Paid `domain → people` lookup is designed but OFF.** It ships as an unconfigured `Provider`
  rung. No key means the rung returns nothing, exactly like every other unconfigured rung. Do not
  sign a vendor or spend money without asking Matthew.

---

## Ground truth: production, 2026-09-25

Row counts, read back live:

```
contacts                8440
med_spa_leads            439      all status=new · 425 have a website · owner_name 54 (mostly junk)
scraper_rows            1757      across 8 batches
audit_reports            107
client_events            280
clients                    5
outreach_prospects         3   ‼ the attribution break
raw_leads                  0   ‼ Workflow C has never run
sendable_leads             0
list_pipeline_runs         0
outreach_send_queue        0
```

The three Apollo batches that produced everything currently mailable:

```
2026-09-21  apollo-contacts-export (8).csv   stored=236  clean=194  mvOK=122  catchall=63
2026-09-16  apollo-contacts-export (7).csv   stored=293  clean=245  mvOK=166  catchall=70
2026-09-15  apollo-contacts-export (6).csv   stored=250  clean=219  mvOK=136  catchall=64
```

Of 658 clean rows: **563 United States**, 21 UK, 12 Canada, then a long tail.
**US + MV valid = 359. US + valid-or-catch-all = 535.** Titles are owner-heavy
(Owner 110 · Founder 48 · President 33 · Medical Director 33 · Business Owner 29).

### Ground truth: the crawl, measured on 60 live sites from `med_spa_leads`

Not estimated. `scrapeEmail()` and `scrapeOwnerName()` were run against a spread sample of the
real batch on 2026-09-25:

```
EMAIL   any found            37   62%
        role (info@ etc)     18   30%
        non-role             19   32%
        nothing              23   38%

NAME    scraper returned     20   33%
        genuinely a person    7   12%   ← inspected by hand
        title or nav junk    13   22%
```

The junk it returned, verbatim: `Nurse Practitioner`, `Medical Director`, `Lead Physician`,
`Aesthetic Nurse`, `Policy Refund`, `Button James`. The real hits: Marina Musalyants, Anya Stassiy,
Nilam Patel, Kathy Newman, Ashraf G. Andrawis, Jennie Evans, Chidi Uche.

And the non-role addresses are almost all **business webmail, not people**:
`highpointmedspa@gmail.com`, `zenfuldaymedspa@gmail.com`, `jennieevansnaturalmedspa@yahoo.com`.
Only `marina@mmaestheticss.com` was a true owner-name address. This is the evidence behind
Option A: expect a shared inbox, and write for it.

### Ground truth: MX, and why routing is per-domain

MX of the 60-site med spa sample:

```
Google 33% · M365 25% · NO MX 23% · Other 17% · GoDaddy 2%
```

MX cross-tabbed against MillionVerifier's verdict, across all 561 US domains in the Apollo list:

```
MX provider              valid  catch_all  invalid  unknown    catch-all rate
Google Workspace           126        133        9        0        50%   (n=268)
Microsoft 365              163         12        6        0         7%   (n=181)
Other / host-provided       64         25       10        2        25%   (n=101)
Security gateway             1          5        0        0        83%   (n=6)
Zoho                         4          1        0        0        20%   (n=5)
```

**This is the whole argument for MX routing.** On Microsoft 365 a permuted address gets a decisive
answer 93% of the time, so guessing is cheap and safe. On Google Workspace half the domains accept
everything, so a permutation is unresolvable and must not be sent. Nothing that speaks SMTP can beat
this — it is a property of the receiving server, not of the verifier.

---

## The work, in order

### W1 · Rebase and re-prove (prerequisite, no new code)

`feat/workflow-c` is 19 behind main. Rebase onto `origin/main`, then:

```
bunx tsx scripts/_probe-scraper.ts
bunx tsx scripts/_probe-list-prep.ts
npx next build
```

All four Workflow C migrations are **already applied to production** and were verified by reading
the columns and constraints back on 2026-09-21. Do not re-run them. `scraper_batches.list_run_id`
exists in prod — that is the proof.

Do not start W2 until the build is green on the rebased branch.

### W2 · The free fixes inside 3️⃣

**a. Flip the `pickBestEmail` tiers — owner-first.** [`src/lib/email-scrape.ts:156`](../../src/lib/email-scrape.ts)
currently ranks:

```
Tier 1. same-domain ROLE address      (info@clinic.com)      ← preferred today
Tier 2. same-domain anything          (drsmith@clinic.com)   ← discarded in favour of tier 1
```

Swap 1 and 2. If both are on the page we want the doctor. `info@` remains tier 2 and stays fully
sendable — Option A is unchanged, this only decides which wins when we have both.

**b. Title blocklist in `medspa-owner-scrape.ts`.** The cue regex returns on **first match**, so
capturing `Medical Director` as a name *stops the search before it reaches the real name further
down the page*. This is why precision is 12%. A blocklist of role/title words
(nurse, practitioner, director, physician, aesthetic, policy, refund, lead, …) should make the
matcher keep looking rather than merely discard. Expect recall to rise, not just precision — but
**measure it on the same 60-site sample and write the number down.** Do not assume.

**c. Chain `scrapeOwnerName()` into the listprep enrich stage.** It already exists and is already
imported by `email-scrape.ts` for its fetch helpers. One pass should collect name and email
together rather than fetching each site twice.

**d. Free pre-filter before the MillionVerifier upload.** `mx.ts` already exports `hasMx()` and
`resolveMxBatch()`; `dedup.ts` already exists. Before uploading, drop for $0: syntax failures,
no-MX domains, disposable domains, duplicates. **23% of the med spa batch has no MX** — those are
unmailable and we are currently paying to be told so. Report on the card how many were rejected
free, so the saving is visible rather than asserted.

### W3 · MX routing in the enrich stage

Route each row by its MX provider:

```
M365 / Other / GoDaddy  →  permute the name into candidates, verify via MillionVerifier   (free-ish, 93% decisive)
Google Workspace        →  paid `domain → people` rung                                    (UNCONFIGURED, returns nothing)
no MX                   →  drop before anything is spent
```

The paid rung ships as one object in `PROVIDERS` with a real `gate`, no key set. Follow the
existing doctrine in `enrich.ts` exactly: a rung with no credential returns nothing and reports
once on the card, it never throws and it never pretends to have a key.

‼️ **`acceptsRole` interacts with W2a.** `enrichOne` treats a role address as a MISS while
`pickBestEmail` ranks role addresses highly; the file documents this as "the highest-severity
silent bug available here". Re-read that comment after flipping the tiers and confirm the crawl
rung still reports correctly. The probe must cover it.

### W4 · Attribution, before the first big send

One column closes the loop:

```sql
alter table public.outreach_prospects
  add column if not exists run_id uuid references public.list_pipeline_runs(id);
```

`recordHandoff` must write it. Then `list_pipeline_runs` → `outreach_prospects.run_id` →
`contacts` → `clients` answers *"what % of the Instagram list converted vs the Maps list"*, which
is the question this whole build exists to make answerable.

‼️ `outreach_prospects`'s unique index is on **`lower(email)`**, an expression index, so PostgREST
`on_conflict=email` cannot target it. Read-then-insert, chunked — `recordHandoff` already does this
correctly; do not "simplify" it into an upsert.

**Do W4 before W5 and W6.** Everything else in this build is recoverable. Attribution you did not
capture on the first send is gone.

### W5 · 4️⃣ Maps pull front door

The transport already exists and is not to be rebuilt: `src/lib/outscraper.ts` (async submit +
webhook), `src/lib/medspa.ts` (record mapping, chain filtering, scoring), `src/lib/scraper/pull.ts`
(writes `raw_leads` with pull metadata, unique on `(run_id, place_id)`).

What is missing is the **front door**: a Slack command in `#srt-scraper` taking a metro and a query,
opening a `list_pipeline_runs` row with `source='outscraper'`, and handing the result to 3️⃣ when the
webhook lands. `MAPS_PULL_ENABLED=1` gates the old paused route — decide explicitly whether the new
door reuses that gate or supersedes it, and say which on the card.

Because Outscraper is async-with-webhook, **this half runs fine on Vercel.**

### W6 · 5️⃣ Instagram pull front door

`LeadSource` in `pull.ts` already admits `"socialscraper"` — one line, nothing behind it.

SocialScraper.io pulls post likers, commenters, trending-audio users and location posters, and
enriches handles with profile data and emails sourced from Instagram's business-profile contact
button. That address is owner-declared, which makes it a good source, but it is usually the same
shared business inbox — Option A applies here too.

Required columns differ from 4️⃣: **handle + email**, and many IG leads have **no website at all**,
which 3️⃣'s current column check would refuse. Add the arm's own entry to `REQUIRED_COLUMNS` rather
than loosening `listprep`'s.

`src/lib/instagram/profile.ts` already parses a handle, business name, city and website out of a
profile and returns null rather than guessing. Reuse it. Do not write a second handle parser.

Operational note for the card, not a blocker: scraping likers and commenters at volume is against
Instagram's ToS and accounts used for it can be restricted.

### W7 · Email 1 for a shared inbox (Option A)

Subject names the business. First line offers the pass-along. No personalisation that only makes
sense if the reader is the owner, because usually they are not.

‼️ No em dashes in any generated copy (house rule).

---

## Traps, each one already paid for once

1. ‼️ **The `workflow` CHECK constraint will block 4️⃣ and 5️⃣, exactly as it blocked 3️⃣.**
   `docs/2026-09-18-workflow-c-wiring.sql:21` currently reads
   `check (workflow is null or workflow in ('filter', 'score', 'listprep'))`. Postgres will refuse
   the new arms until it is widened. This trap has already cost one session; do not rediscover it.

2. ‼️ **Four `else → score` fall-throughs behind one keycap cap** were the original 3️⃣ wiring bug: a
   pick that fell through would buy a DataForSEO SERP per row with no error. The fix was one `PICK`
   table plus an exhaustive `switch` with a `never` default. Adding two arms re-opens exactly this
   surface. Keep the `never`.

3. **`med_spa_leads.owner_name` is not trustworthy.** 54 of 439 filled, and the sample is
   `Vision Empower`, `Join Our`, `Learn More`, `Marianne Marianne`. It is the output of the
   pre-fix scraper. Re-scan after W2b rather than treating those rows as done.

4. **MillionVerifier bills per address UPLOADED, not per OK.** This is the whole reason W2d exists.

5. **The site crawl cannot run on Vercel.** 10k sites × 7 paths blows every timeout. That half runs
   on the local box or a worker. `bun run medspa:owners` is the existing precedent.

6. **`IN_FLIGHT` in `report.ts` is a `BatchStatus[]`**, so the compiler does NOT catch a missing
   stage there. Any new stage must be added by hand and covered by the probe.

7. **`_probe-list-prep.ts`'s `normalize()` only fixes CRLF, it does not strip comments.** An
   absence-check regex over a commented file tests the prose, not the program.

8. **Shared worktree.** A peer pushes the whole branch. Never bare `git stash`. Park SQL-dependent
   commits off the shared branch.

---

## Definition of done

- Rebased branch, both probes passing, `next build` green.
- The 60-site sample re-measured after W2, with the new email and name hit rates **written into this
  file** next to the old ones. If the title fix did not move the number, say so.
- A 10-row drop through 3️⃣ end to end in `#srt-scraper`, producing `sendable.csv` and writing
  `outreach_prospects` rows carrying `run_id`.
- One real 4️⃣ pull and one real 5️⃣ pull, each landing in `raw_leads` with the right `source`, each
  reaching `sendable.csv` through the same 3️⃣ engine.
- The attribution query demonstrated: one `list_pipeline_runs` row joined through to `contacts`.
- SQL handed to Matthew **pasted in full in a ```sql block**, never as a file path.

## Left for Matthew to decide, do not decide it yourself

- Whether the paid `domain → people` rung gets a vendor and a key, and which one.
- Whether `MAPS_PULL_ENABLED` is reused or superseded by the 4️⃣ door.
- Whether IG leads with no website are qualified on bio and follower count alone, or held back.
