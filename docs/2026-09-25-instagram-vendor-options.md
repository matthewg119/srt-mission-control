# The 5 Instagram door: vendor options, and why nothing was wired

Researched 2026-09-25. Every price was read off the vendor's own page on that date and is quoted, not
estimated. Anything not published says so.

**The door is not built, and this file is why that is a decision rather than a task.** There is no
SocialScraper account, no API key, and no way to test a client against their real response shape.
Writing an adapter against their docs would produce a file that compiles and lies, which is the class
of thing `enrich.ts` refuses by design. What IS built is the plumbing, listed at the bottom.

## The three structural facts no amount of money fixes

1. **Likers do not paginate.** Instagram serves a post's likers as a single capped sample, measured at
   roughly 1,000 to 1,900 accounts per post, with no cursor to page past it. About 72% of those
   accounts are private, and a private account publishes no profile data. So one post URL yields
   perhaps 280 to 530 readable profiles. **3,000 leads a month from the likers lane alone needs 15 to
   35 source posts a month.** Followers and location paginate properly and are the real volume.
2. **The contact-button email exists on 30 to 43% of accounts**, not 90%. By account type: business
   43%, creator 39%, personal 17%. Budget 2,300 to 3,300 profile reads per 1,000 emailable leads.
   Anyone quoting higher is counting bio-regex and website-crawl addresses, which is the enrichment we
   already do ourselves and do not need to buy.
3. **Follower lists and liker lists exist in no official API.** The Graph API returns
   `followers_count` as an integer and never the list. Every option below that returns them is reading
   Instagram's private surface.

## The table

| Option | Our four inputs | Email? | Per 1,000 emailable leads | Real API | Top risk |
|---|---|---|---|---|---|
| **SocialScraper.io** | **all four**: likers, commenters, trending audio, followers, location | yes, it is the billing unit | **$49 / $24.75 / $13.83** at the $49, $99 and $249 tiers | yes, documented | young single vendor, no SLA, per-request pricing not published |
| **HikerAPI** | followers, likers, commenters, hashtag, location. **no audio** | yes, `public_email` on the profile endpoint | **$1.50 to $3.50**, at $0.60 to $1.00 per 1,000 requests, prepaid, no monthly floor | yes, 100+ endpoints | wraps the private API, silent breaking changes, you build pagination and retries |
| **Apify**, multi-actor | all four, spread across separate actors | yes, `businessEmail` | **$7 to $11** plus $19/mo | yes, REST and OpenAPI per actor | third-party actors can reprice or vanish overnight |
| IGLeads.io | yes | yes | $5.90 / $2.98 | **no API**, two UI seats | disqualifying for a pipeline |
| Bright Data | **no followers, no likers, no audio** | **no** | n/a | yes, strong | fails on requirements, not on quality |
| Data365 | yes | not documented | ~EUR 100 at our volume, against a EUR 300/mo floor | yes | pay for 55,000 profiles, use 3,000 |
| Phantombuster | yes | via its own credits | not published, execution-hours model | yes | **drives a browser as you. real account-ban exposure** |
| RocketAPI | not documented past profile info | not documented | ~EUR 2.30 to 3.30 if the endpoints exist | yes | a worse-documented HikerAPI |
| instaloader | profiles and posts. likers need a login | **no. cannot return the email at all** | $0 | library | ~200 requests/hour/IP |
| instagrapi | everything | yes | $0 plus burner accounts and proxies | library | **gets accounts challenged or banned** |

## Recommendation, ranked

1. **SocialScraper.io, $99 tier.** The only vendor that accepts all four of our inputs behind one
   documented API and returns the email. **Buy one month at $49 first and measure one thing: whether a
   credit burns on a miss or on a profile read.** If it burns per read, the real cost is 2 to 3x the
   headline and option 2 wins.
2. **Apify two-step, roughly $40 to $52/mo at 3,000 leads.** A discovery actor into
   `dami_studio/instagram-profile-scraper` at $0.70 per 1,000 profiles. More moving parts, no
   single-vendor risk, and the most honest per-lane pricing in the market.
3. **HikerAPI, roughly $5 to $10/mo of requests.** An order of magnitude cheaper and the right end
   state once Instagram is proven to convert. You write the pagination, the dedupe and the
   private-account skipping, and there is no audio endpoint.

**Do not buy:** Bright Data (cannot deliver the inputs or the email), Data365 (pay for 18x what we
would use), Phantombuster (execution hours plus the worst ban exposure), instaloader (cannot return an
email at all).

## Two flags worth more than the vendor choice

1. **Likers of a med spa's post are patients, not owners.** That lane fills the list with consumers at
   scale, and consumer accounts are the 17%-email, mostly-private cohort. The inputs that surface
   *operators* are followers of industry accounts (injectable brands, device manufacturers, aesthetics
   conferences, practice-management software), the location lane filtered to business accounts, and
   hashtags only operators use. Pointing the budget there raises both the email rate and the reply rate.
2. **We already own a cheaper, safer source for this exact ICP, and it is the 4 door.** Outscraper has
   no Instagram surface at all, confirmed against its SDK. But for local service businesses Google Maps
   returns business name, city, website and phone for essentially every med spa in a metro, with zero
   Instagram ToS exposure and no account to lose. **Instagram is the incremental lane for businesses
   Maps misses, not the primary source.**

## ToS, plainly

Instagram's terms say you may not collect data by automated means without permission. The counterweight
is *Meta v. Bright Data* (N.D. Cal., January 2024), where the court held that Meta's terms do not reach
scraping of public data while logged OUT, reasoning that a non-logged-in scraper is not a contractual
user. That ruling is narrow and does not bless logged-in scraping. Practical reading: **logged-out
vendors sit behind a real, tested defence; logged-in tooling does not.** Phantombuster and instagrapi
are the two that would use a session belonging to us.

Separately, a contact-button address on a business profile is a published B2B business contact, which
is the most defensible category to cold-email. Bio-regex addresses and personal-account addresses are
not. Filter on the business flag and on the contact-button source specifically.

## What is already built, so 5 is a mapper and a client away

- `sweepPull` dispatches on `batch.workflow` through an exhaustive switch. An Instagram arm is one
  `case` plus one `sweepPullSocial`.
- `LeadSource` in `pull.ts` already admits `socialscraper`, and so does `raw_leads_source_check` in
  production.
- `fromOutscraper` is the literal template for a `fromSocialScraper` sibling, and
  `RawLeadInput.instagramHandle` already exists.
- `storeRawLeads` is chunked and idempotent on `(run_id, place_id)`.
- The webhook route shape is copyable: token, `results_location` fallback, resolve the run from the
  query string, store, mark `pull_finished_at`.
- `src/lib/instagram/profile.ts` already parses a handle, a business name, a city and a website out of a
  profile and returns null rather than guessing. **Do not write a second handle parser.**
- **`sourceEmailOf` is the piece that mattered most, and it is done.** It reads `raw_leads.raw` when
  there are no CSV headers, so the `file` rung works for a non-CSV source. For Instagram that rung is
  the *only* one that can work: most IG leads have no website, so the site crawl finds nothing and the
  guessing rung has no domain to build on.

## What is deliberately absent

No `Workflow` value, no `REQUIRED_COLUMNS` entry, no `PICK` or `KEYCAPS` entry, no command grammar, no
client, no env key, no route. A value with a reader and no writer is the class CLAUDE.md records as
deliberately not created.

IMPORTANT, AND THE EASY MISTAKE: when it is built, do not build it by loosening `listprep`'s
`REQUIRED_COLUMNS`. `_probe-scraper.ts` pins `listprep` to needing a website, and that pin is what
stops a website-less list running a full paid qualification sweep to produce zero sendable rows. An
Instagram arm gets its own entry, or its leads are qualified on bio and follower count instead. That
choice is still open, and it is Matthew's.
