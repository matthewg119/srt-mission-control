# NPPES against our own failures: 2 names in 75, and the reason is the vertical

Measured 2026-10-06 by `bun run scripts/_probe-nppes-coverage.ts` over the frozen cohort in
`docs/2026-10-06-nppes-sample.txt`. Free, keyless, nothing spent.

## Read this part first

**NPPES does not move the owner-identified rate for med spas. It moves 25% to 27%.** Of the two
names it found, one is on a Google Workspace domain where `permute-guess` refuses to guess, so the
usable gain is **one company out of seventy-five**.

This is not a verdict on the lookup, which works. It is the vertical. And it was already written
down in `docs/2026-09-27-owner-email-vendors.md` before `nppes.ts` was built on 2026-10-04:

```
dental    NPI is excellent and free. Use it.
med spa   NPI is a bonus source at best. Use the crawler.
```

That note measured 20 of 20 Oklahoma dentists carrying an authorized official, against 2 of 14
Dallas med spas with one of the two a false positive. This run is the same answer at five times the
sample. Cash-pay aesthetics mostly have no organisational NPI, because they file no insurance claims.

## The cohort

The 75 companies in run `c74a895d-4ea0-4d1b-9904-33fb4ace00b4` that were qualified, offered to the
site crawl, and left with no owner name — 78 of that cohort's 101 are `primary_type` "Medical spa".

‼️ The 155 companies the 2026-10-06 requalify added are **not** this cohort and must not be used for
this measurement: 17 beauty salons, 9 nail salons, 5 hair salons and 5 massage therapists against 11
medical spas. NPPES asks for `enumeration_type=NPI-2`, an organisation with a licensed clinician, so
a nail salon has no NPI as a matter of law. A low number there would score the business mix.

## What it found

```
asked                          75
registry named somebody         2    both exact matches, one carrying an MD
  MyBliss Wellness        -> Patience Effanga   MYBLISS WELLNESS LLC    NPI 1407642499
  Peak Life Health        -> Raman Dhillon      PEAK LIFE HEALTH PLLC   NPI 1073383105  MD
no NPI, or no match            73

owner-identified, before       25 of 101   (25%)
owner-identified, after        27 of 101   (27%)
of the gain, permutable         1          the other is on Google Workspace
```

**Zero false positives**, where the earlier hand sampling had one in two. `matchConfidence`'s
eight-character containment floor rejects the exact pair that fooled it — `Sage and Skin Aesthetics`
against `SAGE AND SADDLE COUNSELING` scores `weak`. The rail is doing the job it was written for.

## The mail side, which turned out to matter more

Measured over the same 75 domains with `mailProviderOf` / `mxRecords`, reusing the `dns.mx` cache:

```
receives mail at all           49 of 75
  Google Workspace              20    permute-guess refuses outright
  Microsoft 365                 16    decisive 93% of the time
  another named provider         3
  MX present, host unknown      10    still guessable
no MX at all                   26    freeRejects drops these for $0
could not be asked              0

domains a guess is allowed on  29    the ceiling BEFORE any name is known
names permutations can use      1    the ceiling after the names
```

‼️ **`mailProviderOf` returning null means two opposite things**, and conflating them understated
this by a factor of ten on the first pass of the probe. It is null both when a domain has no MX
records and when the MX is simply not in `detectMailProvider`'s list — a small host, cPanel,
self-hosted. The first cannot be mailed at all; the second is perfectly mailable and
`permute-guess` allows it, since the only provider that rung refuses is Google Workspace. Use
`mxRecords` to separate them: `null` is undetermined, `[]` is genuinely no MX.

## So where the bottleneck actually is

The hand-off premise was "the bottleneck is owner name, and given a name the free permutation rung
works." The first half holds: **28 of the 29 domains a guess is allowed on still have no name.** The
second half is unproven — `permute-guess` has been asked about exactly **two** companies in this
run's entire history, produced 12 candidate rows (2 companies x 6 permutations), had 10 collapsed by
`resolvePermutations`, and both surviving primaries came back `catch_all` and were refused by
`GUESSING_PROVIDERS` in `sendableRows`. All 46 sendable leads on this run came from `site-scrape`.

So the rung is untested rather than blocked, and NPPES is not the instrument that will test it.

## Recommendation

1. **Gate NPPES by vertical rather than retiring it.** Keep it for `dentist`, where registration is
   the norm and the prior measurement was 20 of 20. Skip it for `medspa`. Unconditional it costs
   about half a second of a 240-second cron tick per nameless lead to find roughly three names per
   hundred, and the next pull is 1,000 records.
2. **Do not buy a paid name finder on the strength of this.** The 26 no-MX domains cannot be mailed
   at any price, and the 20 Workspace domains cannot be guessed at. The addressable set is 29 of 75.
3. The untested thing worth testing is the **crawler on the About page**, which
   `docs/2026-09-27-owner-email-vendors.md` measured at 75% of the sites the regex misses for
   $3.10 per 1,000 — against a 2.7% registry hit rate on the same kind of business.

## Reproducing

```
bun run scripts/_probe-nppes-coverage.ts            measure the frozen cohort
bun run scripts/_probe-nppes-coverage.ts --pick     re-choose it (a DIFFERENT cohort; see below)
```

‼️ The cohort predicate keys on `owner_name` being empty, so every name the rung finds removes a row
from it. It is frozen in `docs/2026-10-06-nppes-sample.txt` for that reason; `--pick` after a
production sweep measures the after-state and would report it as the before.

The probe runs **two** controls before reporting anything, and exits 1 on either. A refusal control
alone is passed perfectly by a rung that can only ever return null, and such a rung reports 0%
coverage — which reads as "this vertical has no NPIs" and would retire the idea on the strength of a
bug. So it also has to be seen finding somebody it is known to be able to find.
