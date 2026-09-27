# Owner emails, a per-lead extension, and the Instagram door

A prompt for a fresh session. Everything in a **Ground truth** block was measured against production
on **2026-09-27** and is quoted, not remembered.

**Repo:** `Mission control 2.0/srt-mission-control`. Work in a worktree; run `git branch --show-current`
before every commit. Read `CLAUDE.md` and `docs/lanes/CONTRACT.md` before writing code.

**Branch state:** everything described as built is on `origin/main` and deployed. Start from main.

## What this build is, and what it is not

Matthew's day is: cold DM med spa owners on Instagram one at a time, and prepare email campaigns.
This build serves both without mixing them.

```
   ONE LEAD, ON DEMAND                    MANY LEADS, IN BULK
   the Chrome extension                   the scraper lane
   logged in as Matthew                   logged out, vendor
           |                                      |
   he opens a profile                     4 Maps / 5 Instagram door
           |                                      |
   pull THAT lead's site once             raw_leads -> 3 engine
   owner name + best email + TIER                  |
           |                              sendable.csv -> campaign
   DM draft + email draft
   + a follow-up two days later
```

IMPORTANT: **the extension NEVER harvests in bulk.** It is logged in as Matthew, and the account it
would cost is the one that sends the DMs. It enriches exactly the one lead on screen. Bulk discovery
is the vendor's job, logged out. Meta v. Bright Data (N.D. Cal., 2024) covers scraping public data
while logged OUT and does not cover a logged-in session.

## Ground truth: the owner-email problem, measured

This is the question the whole build turns on: can we email the OWNER, or only the front desk?

Measured on the 60 frozen med spa sites in `docs/2026-09-25-crawl-sample.txt`, today:

```
owner NAME found by the crawl      17 of 60    28%
any email found at all             35 of 60    58%
no email anywhere on the site      25 of 60    42%
domain on Google Workspace         25 of 60    42%   <- catch-all half the time, cannot guess
permute-guess CAN fire on           9 of 60    15%   <- has a name AND a guessable domain
```

And from the same sample on 2026-09-25, of the 35 addresses found: **19 were role addresses**
(`info@`, `hello@`), and of the 16 non-role, nearly all were business webmail
(`zenfuldaymedspa@gmail.com`). Exactly ONE, `marina@mmaestheticss.com`, was a true owner-name address.

**So the honest ceiling of the free approach is about 15% owner-shaped, and about 58% reachable at
all.** The crawl is very good at finding the front desk and poor at finding the owner, because most
small med spas do not publish an owner address anywhere.

Three ways forward, and this build has to pick one with Matthew:

1. **Accept info@ and write for a shared inbox.** For a one to three person med spa the shared inbox
   IS the owner's inbox. `src/config/cold-email-1.ts` is already written this way: it opens with a
   pass-along line and assumes the reader is not the owner. Cost: zero. This is what ships today.
2. **Guess and verify.** Already built: `permute-guess` in `enrich.ts` takes an owner name the crawl
   found, builds `first@domain`, and the existing MillionVerifier gate tests it. It refuses Google
   Workspace, because those domains accept everything and a wrong guess would SHIP. Reaches 15%.
3. **Buy a domain-to-people lookup.** The `domain-people` rung in `enrich.ts` is already shipped DARK
   for exactly this: no key means it returns nothing and reports once on the card. Picking the vendor
   is Matthew's call; the comparison is in `docs/2026-09-27-owner-email-vendors.md`.

IMPORTANT: **do not assume a vendor fixes this.** Most B2B email finders are built on
professional-network data and are good at tech companies. A solo med spa owner in Tulsa on a
Squarespace domain is the hardest case they have. Whatever is picked, **measure its hit rate on the
frozen 60 before wiring it into the waterfall**, the same way the crawl was measured.

## Ground truth: the first real Maps pull

`pull maps medspa | Dallas TX | med spa | limit 50`, approved with a check mark:

```
DataForSEO returned        50 records for $0.030   (1,765 matched in the metro)
dropped free, no website   15 of 50   by rule, qualify_model='rule', NO model call
sent to the model          35 of 50
kept                       14 of 35   40% of the paid ones
```

Keep rate by the category the record came from:

```
Medical spa          kept  9 of 14    64%
Skin care clinic     kept  3 of  9    33%
Facial spa           kept  0 of 10     0%   <- ten rows qualified, nothing kept
Nail salon           kept  0 of  3
Weight loss service  kept  1 of  2
```

IMPORTANT: **that is n=50, which is suggestive and not conclusive.** `facial_spa` produced nothing on
this pull; `skin_care_clinic` produced three of the fourteen keepers and should probably stay. Before
changing the category list, run one larger pull and count again. `searchListings` already supports
`is_claimed`, which is free and may be a better lever than dropping a category.

## The work, in order

### W1 - The extension enriches the ONE lead on screen

No vendor, no new key, useful the day it ships.

Today `POST /api/ext/instagram/prospect` takes a handle, parses the profile through
`src/lib/instagram/profile.ts`, creates the lead and drafts a DM. It already accepts a `businessEmail`
from the panel, so an address read off the Instagram contact button already lands on the contact.

What is missing: when that lead has a WEBSITE and no email, nobody looks at the site.

1. In the prospect run, when `website` is present, call `crawlSite(website)` from
   `src/lib/email-scrape.ts`. ONE site, on demand, for the lead on screen. It returns the owner name,
   the best email, its source and the pages fetched, and it already takes a deadline and a page cap.
2. Store what it found on `ig_dm_runs`. Its columns today are `handle, website, status, lane, angle,
   check_json, variants, error_detail`. `check_json` is the natural home; a new column is fine if it
   reads better.
3. IMPORTANT: **return the TIER with the email, not just the address.** `emailTier` in
   `email-scrape.ts` already ranks them OWNER, FRONT_OFFICE, SAME_DOMAIN, BACK_OFFICE, WEBMAIL. The
   panel should say "this is the front desk" or "this looks like the owner", because Matthew is about
   to decide whether to DM, email or both, and "an email was found" is not enough to decide on.
4. If the crawl finds an owner NAME and no address, say so. That name is the input the guess rung
   needs, and it is worth showing even when there is nothing to send to yet.
5. IMPORTANT: **one site, never a list.** No walking followers, no queue of profiles, nothing that
   turns this route into a harvester. The rule is one fetch per lead Matthew is already looking at.

### W2 - The email the extension just earned

When W1 produced an address, offer a drafted email and a follow-up two days later, beside the DM.

The two emails Matthew actually sends are the shape to reproduce:

- **Email 1, the permission ask.** Names what their patients do, states the free offer, asks permission
  to send a short video, ends with a question that is easy to answer.
- **Email 2, two days later, the audit result.** Leads with a measured number ("you came back in 1 of 4
  searches"), repeats the free offer, asks a negative-consent question ("would you be against me
  sharing a video"), and says exactly how to reply.

1. `src/config/ig-email-sequence.ts`, beside `cold-email-1.ts` and under the same rules: every string
   through `guard()` so an em dash fails the build, `[[ ... ]]` around any clause whose token can be
   blank, and only merge fields the lead actually carries.
2. IMPORTANT: **email 2 claims a measured number, so it must not send without one.** "1 of 4 searches"
   is a fact from the audit engine. No audit for that lead means either run one first or send a
   version that makes no claim. A follow-up that invents a number cannot be walked back.
3. The follow-up is SCHEDULED, not sent. It lands in the approval surface the rest of the outbound
   uses. Nothing in this repo sends mail unattended, and that is deliberate.
4. IMPORTANT: **the copy changes with the TIER from W1.** A front-desk address gets the pass-along
   opening `cold-email-1.ts` already uses. An owner-shaped address does not need it and must not carry
   it: telling the owner to forward it to whoever handles marketing is a worse email than the one that
   speaks to them directly.

### W3 - Decide the owner-email question, then wire it

Read `docs/2026-09-27-owner-email-vendors.md`, pick one with Matthew, then:

1. Wire it as the `domain-people` rung that already exists in `PROVIDERS`. It has a real `gate`, and
   with no key it is dark: `configuredProviders` puts it in `dark`, `enrichLines` names the env var
   once on the card, and `enrichOne` never calls it. Do not restructure the waterfall for it.
2. `appliesTo` already refuses it for anything but Google Workspace domains, on the grounds that the
   free rungs handle the rest. Re-decide that once there is a real hit rate: if the vendor is good at
   small local businesses it may deserve a wider gate, and if it is bad it may deserve a narrower one.
3. IMPORTANT: **measure on the frozen 60 first and write the number into this file.** Cost per OWNER
   address found is the only number that decides whether it stays. The free path reaches 15%; a paid
   rung has to beat that by enough to be worth the per-lookup price.

### W4 - The Instagram door, 5

Only after W1 to W3, because this is the part that costs money and takes a vendor.

**Vendor if this goes ahead: HikerAPI.** Roughly $0.60 to $1.00 per 1,000 requests, prepaid, no
monthly floor, `public_email` on the profile endpoint. `docs/2026-09-25-instagram-vendor-options.md`
has the comparison and the ToS position.

IMPORTANT: **the input is FOLLOWERS OF INDUSTRY ACCOUNTS, not likers of consumer posts.** Likers of a
med spa's post are its PATIENTS. Followers of an equipment or injectable brand are practices, owners
and injectors. Likers also do not paginate: one post caps at roughly 1,000 to 1,900 accounts and about
72% are private. Followers paginate, which is the only reason volume is reachable.

Seed accounts by company, and **verify every handle by hand before running anything**, because a wrong
handle spends money on the wrong followers: Allergan Aesthetics, Galderma, Merz Aesthetics, Revance,
Evolus, InMode, Cynosure, Candela, Sciton, Cutera, Alma, BTL, Hydrafacial, Venus Concept, plus AmSpa
and the practice-management tools Zenoti, Boulevard and Aesthetic Record.

Build:

1. `src/lib/hikerapi.ts`, shaped exactly like `src/lib/dataforseo-places.ts`: `isConfigured()`, typed
   responses, no throws, errors returned rather than raised.
2. `fromHiker(profile, ctx)` in `pull.ts`, sibling of `fromDataForSeo`. `source: "socialscraper"`,
   which `raw_leads_source_check` already admits. `placeId` falls back to `"ig:" + handle` so a
   re-driven pull is idempotent, the way the other two mappers fall back to a domain.
3. `pull social medspa | @inmodemd | followers | limit 500`. Extend `MapsSource` rather than inventing
   a second grammar, and let `parseNaturalPull` reach it.
4. `Workflow` gains `"socialpull"`, which needs `scraper_batches_workflow_check` widened. It is NOT
   added to `FILE_WORKFLOWS`: it has no file, so it has no columns and no keycap.
5. Before a Claude call is spent, drop for free: private accounts, personal accounts, no business
   category, and bios that name an employer rather than a practice. Followers of an equipment brand
   are full of employed injectors and nurses. Report the count on the card the way the free pre-filter
   before MillionVerifier does.

**The decision this needs:** most IG leads have no website, and `listprep` requires one, which
`_probe-scraper.ts` pins on purpose. Either give the IG arm its own `REQUIRED_COLUMNS` entry or
qualify IG leads on bio and follower count. **Do not loosen `listprep`.**

## Traps, each one already paid for once

1. IMPORTANT: **a command surface that is also a chat surface cannot fail silently.** `pull maps ...`
   typed into Slack as CODE did not match `^pull maps`, `handleScraperEvent` returned false, and the
   general assistant answered it out of the CRM instead. It looked exactly like the feature had worked
   and returned 25 leads. Nothing had run. `unwrapCode` exists for this; every new command goes
   through it.
2. IMPORTANT: **a vendor can accept a filter and ignore it.** DataForSEO takes `location_name`, returns
   status `20000 Ok`, and answers globally: 85,179 matches from Quito, Phuket and Shenzhen where a
   coordinate returned 804 in Dallas. **Checking the status code proved nothing. Only the rows did.**
   Assume every new vendor has at least one filter of this kind, and look at the rows.
3. IMPORTANT: **a literal that was right when it was written.** `beginMapsPull` passed
   `source: "outscraper"` as a literal, correct until a second source existed, and it silently
   mislabelled the first real DataForSEO run. `raw_leads.source` was right the whole time, which is
   what hid it: the per-row truth was right and the run-level summary, which the attribution reads,
   was wrong. A third source makes this shape likely again.
4. **A claim about damage is not a measurement.** A missing `WA` state code was reported here as
   having "dropped Seattle from every list this lane has ever built". It had not: the filter runs in
   one workflow, four batches used it, and re-reading all four files showed zero Washington rows. The
   bug was real and latent. Checking cost one read of four files.
5. `_probe-scraper.ts` is offline and runs in CI. `_probe-list-prep.ts` needs the live DB and cannot:
   run it as `bun run --env-file=.env.local scripts/_probe-list-prep.ts`. `bunx tsx` cannot load it,
   because it imports `bun:SQL`.
6. An absence check over un-stripped source tests the prose, not the program. Strip comments first.
7. **The escape trap.** Writing TS through a shell heredoc silently eats one backslash level: a lone
   `\s` inside a template literal becomes the letter `s`, and every test using a single space still
   passes. Use `String.raw`, and assert on a tab or a double space.
8. No em dashes anywhere. `guard()` makes it a build failure for copy; the probes check the cards.

## Definition of done

- Opening a med spa profile in the extension returns, for that ONE lead: the owner name if the site
  names one, the best email, and **which tier that email is**, so Matthew knows whether he is looking
  at the owner or the front desk.
- A lead with an address gets a drafted email whose opening matches the tier, plus a follow-up
  scheduled two days out into the existing approval surface, and email 2 makes no measured claim
  unless there is a measurement.
- The owner-email decision made and written down, with the chosen option's hit rate measured on the
  frozen 60 and compared against the 15% the free path reaches.
- If W4 runs: `pull social medspa | @<handle> | followers | limit N` lands in `raw_leads` with
  `source='socialscraper'` and reaches `sendable.csv` through the same 3 engine, with the cost per
  sendable lead written into this file.
- Probes green: `bun --no-env-file run scripts/_probe-scraper.ts` and
  `bun run --env-file=.env.local scripts/_probe-list-prep.ts`. `next build` green.
- SQL handed to Matthew pasted in full in a fenced sql block, never as a file path.

## Left for Matthew to decide, do not decide it yourself

- **The owner-email question.** Accept `info@` with shared-inbox copy, rely on guess-and-verify at
  15%, or buy a domain-to-people vendor. This is the decision the rest of the email lane hangs on.
- Whether `facial_spa` stays in the category list. It produced 0 of 10 on a 50-record pull, which is
  suggestive and not conclusive.
- Whether IG leads with no website are qualified on bio and follower count, or held back.
- Whether the two-day follow-up sends on a timer once approved, or asks again each time.
