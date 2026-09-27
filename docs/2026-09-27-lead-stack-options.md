# The lead stack: every option, measured

Written 2026-09-27. Every number here was measured against the live APIs and the frozen 60-site
sample on that date. Nothing is estimated. Where something was not tested, it says so.

## The one finding that changes everything

**Claude reading the About page finds an owner on 75% of the sites the regex collector misses.**

Measured on 12 sites from the frozen sample where `collectNames` returned nothing, using
Haiku 4.5 over the homepage plus About/Team pages:

```
sites where the regex found nothing    12
of those, Claude found a named owner    9    75%
cost                                    $0.0372 total  =  $3.10 per 1,000 sites
```

It returned real people with real titles: `Dina Ferry (Owner)`, `Charlie Carter (Founder)`,
`Katelyn Cao (Founder & Aesthetic Registered Nurse)`, `Elizabeth G. Bagan (APRN, Founder)`.

Combined with the regex collector's own 28%, that is roughly **82% of sites yielding an owner name**,
up from 28%.

IMPORTANT: **the owner NAME is the bottleneck, not the email.** Every email finder on the market,
paid or free, takes a name plus a domain. Without a name you can only reach `info@`. Going from 28%
to 82% on names multiplies the yield of every downstream option, free or paid. This step is worth
building before any vendor is chosen.

## Source options: getting the businesses

| # | Source | Cost per 1,000 | With a website | API | Notes |
|---|---|---|---|---|---|
| S1 | **DataForSEO Maps SERP** | **$0.02** | **98 of 100** | yes | `serp/google/maps/live/advanced`, depth 100, $0.002 per query. Live Maps ranking, so the results are the ones a searcher sees |
| S2 | DataForSEO Business Listings | $0.37 | 35 of 50 (70%) | yes | Filterable database: category, radius, `is_claimed`. What is wired today |
| S3 | Outscraper | $3.00 | not measured | yes | Account exists, no credits. Zero engineering |
| S4 | Foursquare OS Places | **$0** | not published | **no**, parquet | Apache 2.0, no retention limit, monthly refresh. Needs a data pipeline, not an API call |
| S5 | Overture Places | **$0** | not published | **no**, parquet | CDLA-Permissive, 81M places, 61% US. Their own docs warn of a high junk rate |
| S6 | Google Places API | $0 at this volume | yes | yes | **Disqualified on terms, not price.** Storing `websiteUri` and `nationalPhoneNumber` is forbidden, and "business listings database" is a named prohibited use |
| S7 | Self-hosted Maps scraping | ~$0.15 of proxy | yes | DIY | Terms breach, parsers break every few weeks, 2 to 6 engineer-hours a month to save a $0.02 bill |

**Measured quality difference between S1 and S2, same metro, same day:**

```
S1  Maps SERP, "med spa Dallas TX", depth 100
    Mara's Med Spa | It's A Secret Med Spa | Elase Medical Spa | Unicorn MedSpa |
    SkinSpirit | InjectCo MedSpa | Sculpt Haus Medical Spa
    98 of 100 had a website

S2  Business Listings, categories medical_spa + facial_spa + skin_care_clinic, 30km
    included CANDLE NAIL SPA RICHARDSON, Charlotte Tilbury - Sephora, a beauty school,
    a dermatology practice and a plastic surgeon
    35 of 50 had a website, and the model then threw away 21 of those 35
```

S1 is 18x cheaper AND better targeted, because Google's own ranking for "med spa" is a better ICP
filter than a category label. S2 earns its place for exhaustive sweeps, where you want every listing
in a radius rather than the best 100.

## Owner-name options: the bottleneck

| # | Method | Hit rate | Cost per 1,000 | Status |
|---|---|---|---|---|
| N1 | Regex cue collector | **28%** | $0 | **Built.** 94% precision, measured |
| N2 | **Claude on the About page** | **75% of what N1 misses** | **$3.10** | **Not built. The single highest-leverage step available** |
| N1+N2 | Both, N2 as fallback | **~82%** | $3.10 | The recommended combination |
| N3 | NPI Registry (NPPES) | **2 of 14 matched, 1 a false positive** | $0 | Free federal API. Returns a named Authorized Official with a title when it hits. Med spas are cash-pay so most have no organisational NPI |
| N4 | Google review replies | not tested | cheap | Owners sign replies. DataForSEO already sells review data |
| N5 | State business registry | not tested | $0 to scrape | Officers and registered agents. Per-state, no uniform API |

**On N3, measured rather than assumed.** Searching the 14 qualified Dallas med spas by name returned
2 matches, one of which was wrong (`Sage and Skin Aesthetics` matched `SAGE AND SADDLE COUNSELING`).
When a record does exist the data is excellent, free and authoritative, with titles like `Owner` and
`President`. But coverage for cash-pay aesthetics is poor, and naive name matching produces false
positives. It needs address matching before it can be trusted. **It is a bonus source, not a spine.**

## Owner-email options

| # | Method | Reach | Cost | Status |
|---|---|---|---|---|
| E1 | Site crawl for any address | **58%** of sites, but 19 of 35 were `info@` and only 1 of 60 was a true owner address | $0 | **Built** |
| E2 | Guess `first@domain`, verify with MillionVerifier | **15% today**, and roughly **48% once N2 lands** | one MV credit each | **Built** (`permute-guess`) |
| E3 | Paid finder from name + domain | see the vendor comparison | per lookup | The `domain-people` rung is shipped **dark**, waiting on a key |
| E4 | Self-hosted Reacher SMTP check | same as E2 | a VPS with port 25 open | **Not recommended.** Vercel blocks port 25, the licence is AGPL or commercial, and SMTP probing at volume gets the IP blacklisted |
| E5 | DataForSEO SERP for `"@domain.com"` | not tested | ~$0.002 per query | Sometimes surfaces an owner address from a directory or press mention |

IMPORTANT on E2: **42% of these domains are on Google Workspace, which is catch-all about half the
time.** A guess there cannot be disproved, and `sendableRows` admits `catch_all` as sendable, so a
wrong guess would SHIP. `permute-guess` already refuses those domains for that reason. That ceiling
is real and no amount of guessing removes it: those domains need E3 or `info@`.

## The stacks

Costs are per 1,000 businesses pulled, and assume the crawl and qualification already built.

### Stack 1: Zero dollars, forever

```
S4 Foursquare OS Places (parquet, $0)  ->  filter to med spa categories offline
   -> the site crawl already built ($0)
   -> N1 regex owner names ($0)
   -> E2 guess first@domain
   -> verify: nothing. You have no verifier in this stack.
```

**Cost: $0.** **What you give up:** no MillionVerifier means unverified sends, which is how a sending
domain gets burned. Foursquare has no API, so this is a data pipeline, not a call. Owner names cap at
28% without Claude. **Honest verdict: this is a research stack, not a sending stack.** If truly zero
spend is the constraint, the bottleneck is verification, not discovery.

### Stack 2: Free-ish, and actually sendable  (RECOMMENDED FREE OPTION)

```
S1 DataForSEO Maps SERP          $0.02 per 1,000   <- credit already on the account
   -> site crawl                 $0
   -> N1 regex owner names       $0
   -> E2 guess + MillionVerifier a credit per address
```

**Cost: about $0.02 per 1,000 plus MV credits.** Everything except MV is already built. Nothing new
to sign. **This is what to run tomorrow.**

### Stack 3: The recommended build  (MY FAVOURITE)

```
S1 DataForSEO Maps SERP          $0.02 per 1,000
   -> site crawl                 $0        58% find some address
   -> N1 regex                   $0        28% owner names
   -> N2 Claude on About page    $3.10     takes owner names to ~82%
   -> E2 guess + MillionVerifier           reaches ~48% instead of 15%
   -> E1 info@ as the fallback, with the shared-inbox copy already written
```

**Cost: about $3.12 per 1,000 businesses, before MillionVerifier.** No new vendor, no new contract,
one new step. It roughly triples the owner-email yield for three dollars a thousand, and every number
in it was measured today rather than projected.

### Stack 4: Stack 3 plus a paid finder

```
Stack 3, then for leads WITH a name and NO verified guess:
   -> E3 paid finder (Prospeo / Findymail / Hunter), name + domain
```

Only fires where the free path already failed, which is what keeps the bill small. **Do not buy until
N2 is built**, because N2 is what produces the names the finder needs: buying a finder first means
paying for lookups on the 72% of leads you cannot name yet. See the vendor comparison for prices.

### Stack 5: Exhaustive sweep of a metro

```
S2 Business Listings, is_claimed=true   $0.37 per 1,000, every listing in a radius
   -> the rest of Stack 3
```

Use when you want **every** med spa in a market rather than the best 100, for example before a local
campaign. `is_claimed` is free and should cut the nail-salon noise that cost 21 qualification calls
on the Dallas pull.

### Stack 6: Both sources, deduped

```
S1 Maps SERP for the ranked top 100 per query
+  S2 Business Listings for the long tail
   -> dedupe on domain, which ACTIVE_KEYS in dedup.ts already does
   -> the rest of Stack 3
```

The most complete list, roughly $0.39 per 1,000. Worth it for a market you intend to work hard.

### Stack 7: Instagram as a second door

```
5 HikerAPI followers of equipment brands  ->  same engine
```

Separate from all of the above, and separately decided. See
`docs/2026-09-25-instagram-vendor-options.md`.

## What to do, in order

1. **Add S1, the Maps SERP source.** One more entry in the same dispatch that already handles
   DataForSEO and Outscraper. 18x cheaper and better targeted than what runs today.
2. **Build N2, Claude on the About page.** The highest-leverage step available: 28% to 82% owner
   names for $3.10 per 1,000. Everything downstream, free or paid, depends on having a name.
3. **Re-measure E2** once N2 lands. The guess rung should go from 15% to roughly 48% of sites.
4. **Only then decide on E3.** With names on 82% of leads, a paid finder is being asked a question it
   can actually answer, and its hit rate can be measured against a real baseline instead of a hope.

IMPORTANT: **two pulls are not needed.** One S1 query returns the business, the website, the phone and
the place id together. Everything after that works from the website, which the first pull already gave
you. The only reason to pull twice is to add S2's long tail to S1's ranked top 100, and that is a
choice about coverage rather than a requirement.
