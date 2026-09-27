# The run book: what it costs, what to run, and what to expect

Every number measured on 2026-09-27 against the live APIs and the first real pull. Nothing estimated
except where it says so.

## What "regex" means

A regex is a pattern for finding text, like Ctrl+F with wildcards. The owner-name step uses one to
look for a cue word (`owner`, `founder`, `medical director`) sitting next to something shaped like a
person's name (`Titlecase Titlecase`), and pulls the name out.

It is free and instant, and it is **literal**: it only finds what the pattern describes. Measured on
60 live sites it finds a real owner on **28%** of them, at **94% precision** after the title
blocklist. Where it fails is a page that says "Meet Dina, who opened the spa in 2019", with no cue
word anywhere near a capitalised pair.

That is the gap Claude fills: reading the same page and answering "who runs this business". Measured
on the 12 sites where the regex found nothing, **Claude found a real owner on 9, or 75%**, for
**$3.10 per 1,000 sites**. The two together reach roughly **82%**.

The order matters and is not an accident: the regex runs first because it is free, and Claude only
sees the pages it could not answer.

## What it costs, measured

| Step | Unit cost | Per 10,000 businesses pulled |
|---|---|---|
| Maps pull, Business Listings (**built**) | $0.012/query + $0.00036/record | **$3.72** |
| Maps pull, Maps SERP (**not built**, 18x cheaper) | $0.002 per 100 records | **$0.20** |
| Qualification, `claude-sonnet-4-6` | $0.77 per 1,000 | **$7.69** |
| Site crawl for emails and names | free, it is our own code | **$0** |
| Claude owner names (**not built**), on the ~28% that survive | $3.10 per 1,000 sites | **$8.68** |
| MillionVerifier | $0.00178 per address | **about $8.90** |
| | | **about $25 to $29** |

Qualification on `claude-haiku-4-5` would be **$2.56 per 10,000** instead of $7.69. Worth testing on
one batch before assuming Sonnet is needed to tell a med spa from a nail salon.

## What 10,000 businesses actually yields

From the first real pull, 50 businesses in Dallas:

```
pulled                     50
dropped free, no website   15      by rule, no model call, no cost
qualified as a fit         14      28% of the pull
```

And from the 60-site crawl sample: an address is found on **58%** of the sites that get crawled.

```
10,000 pulled  ->  ~2,800 qualified  ->  ~1,600 with an address  ->  ~1,700 sendable
```

IMPORTANT: **a pull of 10,000 gives roughly 1,700 sendable addresses, not 10,000.** To reach 10,000
sendable you need to pull somewhere near **55,000 to 60,000 businesses**, which costs roughly $145 to
$165 all in and is a few days of crawling rather than an afternoon.

That is reachable. Measured the same day, inside a 2,500km radius of the US centre:

```
medical_spa                                    63,854
medical_spa + facial_spa + skin_care_clinic   156,301
dentist + cosmetic_dentist                    385,549
```

So the market is there. The limit is the crawl, not the list.

## The throughput limit, stated plainly

IMPORTANT: **the site crawl cannot do 10,000 sites on Vercel cron.** The tick has a 240 second budget
and processes 25 leads at a time, and one slow site can take several seconds. That path is built for
a few hundred leads a day, not tens of thousands.

For a big run the crawl belongs on the local machine, where concurrency is a number you choose rather
than a timeout you fight. `bun run medspa:owners` is the existing precedent. At concurrency 20 and
about 5 seconds a site, 16,000 sites is roughly an hour.

## How to run it today

Everything here works right now, with no new code.

**1. Pull a metro.** In `#srt-scraper`, either form works:

```
pull maps medspa | Dallas TX | med spa | limit 500
get me med spa leads in Dallas TX
```

`limit`, `radius <km>` and `via <source>` are optional, in any order. `help` prints what each arm
does. Do not wrap the command in backticks, though it survives it now if you do.

**2. React to the estimate card.** Nothing is bought before that. The card shows the source, the
metro, the categories and the cost.

**3. The pull lands and qualification runs.** You get a drop-review card listing what was kept and,
grouped by reason, what was dropped. `dropped.csv` is attached so the reasons read in bulk.

**4. React again to release the crawl.** This is the free step: each site is fetched once for the
owner's name and the best address.

**5. React a third time to release MillionVerifier.** Before that card, junk is rejected for nothing:
bad syntax, disposable domains, duplicates inside the run, and domains with no MX at all. The card
says how many, so the saving is visible rather than claimed.

**6. `sendable.csv` arrives**, with everyone already contacted removed.

To cover a market, repeat step 1 per metro. Twenty metros at `limit 500` is 10,000 businesses.

## Answering the bounce question

**MillionVerifier is exactly the tool for this, and it is already in the pipeline.** The confusion is
worth clearing up, because it changes what to do with the result.

MV returns one of four answers, and the awkward one is `catch_all`. That means the mail server accepts
**every** address it is offered, so the verifier cannot prove the mailbox exists. It is not a bounce
and not a guarantee. Measured across 31 med spa and dental domains, about **52%** sit on
infrastructure that behaves this way (Microsoft 365 and security gateways), and **6%** have no MX
record at all, meaning mail to them bounces no matter what anyone says.

The **6% is caught for free before the upload**, by the MX pre-check. That is the step that kills the
guaranteed-bounce tier, and it is live.

For the rest the rule now depends on where the address came from, which shipped today:

- **An address the crawl FOUND may be `catch_all` and still send.** Somebody published it on their own
  website, so the mailbox exists; the verifier simply could not add to what the page already said.
- **An address the guess rung INVENTED must come back `valid`.** A guess on a catch-all domain is
  unproven, and sending it is mailing a mailbox nobody has evidence exists. The bounce is charged to
  your sending domain, not to the guess.

So the 52% figure is about what MillionVerifier **can determine**, not about before or after it. It
runs on all of them. On about half it can only say "this domain accepts everything", and the pipeline
now treats that answer differently depending on whether the address was found or guessed.

## What to build next, in order

1. **Claude owner names.** The regex reaches 28%; Claude takes it to about 82% for $3.10 per 1,000.
   Every step downstream, free or paid, needs a name. This is the highest-leverage thing left.
2. **The Maps SERP source.** $0.02 per 1,000 against $0.37, and 98 of 100 records carry a website
   against 70%. One more entry in a dispatch that already handles two vendors.
3. **Re-measure the guess rung.** It reaches 15% of sites today. With names at 82% it should reach
   roughly 48%, and that number decides whether a paid finder is worth buying at all.
4. **Only then, a finder.** Hunter Starter is $34 a month for 2,000 found and is the only major vendor
   with no resale clause. Buying it before step 1 means paying for lookups on the 72% of leads that
   have no name yet.
