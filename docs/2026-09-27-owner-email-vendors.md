# Owner-email finders: prices, terms, and the number nobody publishes

Read off live pages on 2026-09-27. Where a page renders prices in JavaScript only, this says
**not published** rather than guessing.

## Read this part first

**No provider publishes a hit rate for one-to-three person local businesses. Not one.** The two
industry benchmarks both sample contacts drawn from LinkedIn Sales Navigator, which is structurally
the opposite of a solo med spa owner in Tulsa. The same tool, Anymailfinder, scores 86.4% in its own
study and 41.3% in a competitor's. Those numbers cannot tell you anything about your list.

The rescuing fact: **almost every credible vendor bills only on success.** A bad hit rate costs you
list volume, not money. At 2,000 found per month you pay for 2,000 credits whether you burned 3,000
domains or 9,000. The binding constraint is domain supply, not budget.

## The table

| Provider | $/1,000 found at 2k/mo | Miss billed? | Cold email allowed? | Resale allowed? | Top risk |
|---|---|---|---|---|---|
| **Hunter.io** | **$17 annual**, $24.50 monthly | **No**, stated three ways | **Yes**, no clause against it | **Yes**, no clause | Falls off a cliff at 3k/mo: Starter is 2k, next tier is 10k |
| **Anymailfinder** | $29.50 annual | **No**, and risky results are free | **Yes, explicitly** | Yes | Its own 86.4% claim versus a competitor's 41.3% for the same tool |
| Datagma | $19.50 annual | No | not restricted | yes | Public changelog cold since Jul 2024 |
| Prospeo | $24.50 | No | not restricted | yes | Pricing page is JS-only and internally inconsistent |
| Apollo.io | ~$49/mo | No | yes for the send | **NO. Bars distributing contact data to third parties** | Self-declared data broker that SELLS its database; a synced CRM feeds other customers searches |
| Snov.io | $74.25/mo | Domain Search yes | **NO. ToS prohibits unsolicited commercial email** | no | Disqualified on terms |
| LeadMagic | $82.50/mo | No | **NO. ToS bars spam** | **NO** | Best-engineered API, wrong terms |
| BetterContact | ~$98/mo | No | yes | yes | 3,000-credit price not published |
| FullEnrich | ~$110/mo | No | yes | yes | Its 87.1% benchmark win was on a LinkedIn-sourced sample |
| Dropcontact | EUR 33-39/1,000 | No | **NO. Section 12.1 prohibits commercial prospecting** | no | Publishes the only real US number here, 52.8%, and contractually forbids this use |
| Findymail | $99/mo | No | yes | yes | 5,000-credit floor makes it the worst value at this volume |
| Clay | **not computable** | No | yes | **NO** | Wrong shape, priciest credits, resale ban |
| People Data Labs | **not published** | No | yes | **NO, internal use only** | 81.9M work emails across 2.47B records is a 3.3% fill |
| Clearbit / Breeze | n/a | n/a | n/a | n/a | **Structurally cannot do this.** It requires a work email as INPUT and never returns one |
| OpenMart | $105/1,000 annual | names free on a miss | yes | yes | Most expensive, but the only one sourced from business registrations and Maps rather than LinkedIn. 5,000 free leads to test |

## The measurement that decides it for med spas

MX records resolved live for **31 real med spa and dental domains** (Tulsa, Boise, Sarasota, Scranton):

```
Google Workspace                11  (35%)   verifiable
Microsoft 365                    7  (23%)   accept-all, returns 250 OK for everything
Third-party gateway              7  (23%)   Proofpoint, Barracuda, Officite, SpamExperts
Zoho / GoDaddy / Rackspace       4  (13%)   verifiable
NO MX RECORD AT ALL              2   (6%)   mail to that domain is undeliverable, period
```

**On about 52% of these domains, address-level verification is physically impossible.** Any vendor's
"verified" badge there is a pattern-confidence guess. Two domains resolve fine as websites and have
zero MX: the owner's inbox is not on the domain at all, and anything billed as verified there is a
bounce you paid for.

This matches what this repo measured independently: 42% of the frozen 60 sites are on Google
Workspace, which is catch-all about half the time, and `permute-guess` already refuses them.

Caveat on the 31: harvested from search results, so skewed toward better-resourced practices, n is
small, and it is MX inference rather than live SMTP probing.

## Is chasing the owner's address even right?

**Targeting owners: yes, with real evidence.** Belkins, 7,530,489 emails and 34,393 replies:

```
companies 0-10 employees    0.72%     <- the highest cell in the dataset
companies 11-50             0.49%
companies 10,000+           0.22%
founders and owners         0.57%
C-level                     0.42%
healthcare                  ~0.56%
overall average             0.45%
```

Tiny company plus owner is the single best cell in a 7.5M-email study. The targeting instinct is right.

**Chasing their personal ADDRESS: much weaker than the industry claims.**

- There is **no rigorous study comparing info@ to a named address at the same company.** Every
  "info@ destroys deliverability" claim traces back to cold-email-tool marketing.
- The one authoritative source contradicts it. **Klaviyo's role-address block list carries 25+
  prefixes (abuse@, postmaster@, noreply@, spam@, root@) and does NOT include info@ or contact@.**
  The spam-trap risk is infrastructure mailboxes, not the front desk.
- At a genuinely one-to-three person med spa, info@ and the owner's inbox are usually **the same
  human**. Paying for rosalie@ does not reach a different person.
- CAN-SPAM makes either send legal, with no opt-in required and no B2B exemption.

**So, split by vertical:**

- **Med spa: the owner's NAME is worth far more than their ADDRESS.** Send to info@ with the owner
  named in the subject and the first line. Spend on name extraction, not email discovery.
- **Dental: buy the address.** Practices are bigger, a front-desk employee reads info@, and DSO-owned
  offices route it to a call centre.

## The free half nobody sells

**NPPES / NPI Registry, free, no key.** Queried live for dentists in Oklahoma:

```
20 of 20 organisation records returned an authorized official name        100%
10 of 20 had a title containing "owner"    e.g. 313 PLLC -> JORDON SMITH | Dentist/Owner
20 of 20 carried a practice phone          joins to a lead list on normalised digits
```

It even exposes DSO ownership: one official fronted three separate PLLCs, which is a disqualification
signal when selling to owner-operators.

**But it is vertical-specific, and this repo measured the other side.** Against the 14 qualified
Dallas med spas, NPI matched 2, and one of those was a false positive (`Sage and Skin Aesthetics`
matching `SAGE AND SADDLE COUNSELING`). Cash-pay med spas mostly have no organisational NPI.

```
dental    NPI is excellent and free. Use it.
med spa   NPI is a bonus source at best. Use the crawler.
```

## Recommendation

1. **Build the free half first.** An MX pre-check before any credit is spent (this repo already has
   `mailProviderOf`, and it kills the guaranteed-bounce tier and flags the ~46% where "verified"
   cannot be trusted), plus Claude reading the About page for owner names, measured here at **75% of
   the sites the regex misses, $3.10 per 1,000**. Those two attack the half no paid API solves well.
2. **Then, if a finder is still wanted: Hunter.io Starter, annual, $34/month for 2,000 found.**
   $0.017 per owner email, cheapest by a wide margin, miss-free in writing three times over, a numeric
   confidence score, API on the free tier, data crawled from the open web rather than LinkedIn (the
   right shape for local businesses), and **no resale clause**, which for an agency handing lists to
   clients matters more than the price.
3. **Or Anymailfinder, $59/month**, if reliability is worth $25: it verifies live rather than serving
   from a database, publishes a 97% delivery guarantee with bounce refunds, gives **100 free credits**
   to measure your own hit rate, and its ToS explicitly blesses B2B cold email.

**Do not use:** Dropcontact, Snov.io and LeadMagic (their terms forbid cold email), Apollo, Clay and
PDL (resale clauses, and Apollo sells the database a synced CRM feeds), Clearbit (cannot do this),
Findymail (5,000-credit floor).

IMPORTANT: **run both free tiers against 100 real med spa domains before signing anything.** Hunter
gives 50 credits a month and Anymailfinder 100. No published figure tells you which wins on this list,
and both vendors' own benchmarks are self-refuting.

## For reference

MillionVerifier, already paid for: $89 per 50,000 = **$0.00178 each**, credits never expire. Their
docs say risky results are not charged on API calls. One trap: the ToS excludes API verifications from
the money-back guarantee, and catch-all refunds have a cash value of zero.

The genuinely cheapest credible route is **no finder at all**: names from the crawler, then permutation
verified by MillionVerifier. About six patterns covers small businesses, which is 2,000 x 6 x $0.00178,
roughly **$21 a month**. It only produces a trustworthy answer on the ~48% of domains where SMTP
verification works, so treat it as a free pre-pass that skims the easy wins before a finder credit is
spent, not as a replacement.
