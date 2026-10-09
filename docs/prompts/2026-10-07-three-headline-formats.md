# Three headline formats per page, and why the AEO one is currently wrong

Matthew, 2026-10-07, reading the headline card for SRT's eleven planned pages:

> "Why have I spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?" nobody would actually google this, or search it like that, this sounds too ai

He is right, and this document is the diagnosis plus the build that follows from it.

---

## 1. How a page headline is made today

Three engine constants exist and they must never be merged, because each has exactly one length contract and in one prompt the shortest always wins:

| constant | file | contract | reaches |
|---|---|---|---|
| `HEADLINE_SWIPE_*` | `src/data/reel/headline-swipe.ts` | 8 words or fewer | the on-screen title at the top of a reel |
| `DR_HEADLINE_ENGINE` | `src/data/reel/dr-headline-engine.ts` | 12 to 45 words | advertorial / VSL / paid ad, and now `page N ads` |
| `AEO_HEADLINE_ENGINE` | `src/data/reel/aeo-headline-engine.ts` | **no length rule at all** | every page H1 |

The page path is `generateKeywordHeadlines` (`src/lib/clients/client-headlines.ts:570`) → `headlinePrompt` (`:415`) → `loadAeoHeadlineEngine()`. Two code validators then decide what survives, and they matter far more than the prompt:

- **`isQueryShaped`** (`client-headlines.ts:167`) accepts a line only if it ends in `?` **or** begins with `i / i'm / my / we / our / am i / does anyone / is anyone / nobody / no one`.
- **`carriesKeyword`** (`@/lib/hub/keyword-placement`) rejects any line that drops the target keyword's content words.

## 2. Why the output reads as AI slop

**It is the engine working exactly as specified.** Three of its own rules produce the sprawl:

- RULE 1 ends with: *"or a bare confessional statement when that is how she actually talks."* That is the door every "I spent thousands on ads and still can't figure out..." walks through.
- RULE 3 says the emotional charge must come from *"raw pain wording"*, *"an identity or shame trigger inside the question"*, *"the vulnerability of the phrasing"*, and *"specificity of the frustration: the amount spent."*
- `headlineContext` feeds it up to 24 **voice-of-customer quotes**, which are Reddit confessions. The engine is told to rebuild a quote's SHAPE and keep its heat.

So the model is instructed to write a vulnerable, specific, first-person confession carrying the keyword. That is what it does. The result is a Reddit post, not a search.

**And nothing caps the length.** The DR engine says "12 to 45 words"; the AEO engine says nothing, so a confession plus a keyword plus a backed figure sprawls to 25 words. Real ChatGPT queries are 4 to 12.

**The real missing constraint is realism, not emotion.** Nobody types a 25-word confession into an answer engine. The engine optimises for how a line FEELS and never asks whether anyone would TYPE it.

## 3. The decision

Every headline run returns **three artifacts per page**, always, and they are stored and tracked separately so each accumulates its own traffic data:

| format | job | contract |
|---|---|---|
| **SEO title tag** | the `<title>`, what Google shows in results | 50 to 60 chars, keyword in the first 3 to 5 words, a year or a benefit word, no hype, no open loop |
| **AEO H1** | what an answer engine matches on and cites | the question a buyer would actually type, short and plain, optionally with a format suffix |
| **DR ad hook** | Meta, Instagram, cold email, Loom intros | 12 to 45 words, the existing `DR_HEADLINE_ENGINE`, already built as `page N ads` |

Matthew's own worked example, which is the target quality bar:

| keyword | SEO title tag | AEO H1 |
|---|---|---|
| how to get my med spa on chatgpt | How to Get Your Med Spa on ChatGPT (2026 Guide) | How Do I Get My Med Spa Recommended by ChatGPT? A 30-Day Plan |
| aeo agency pricing | AEO Agency Pricing: What Med Spas Should Pay in 2026 | How Much Does AEO Cost for a Med Spa, and What Should You Get for It? |
| ai search vs google search | AI Search vs Google Search: What Changes for Med Spas | AI Search vs Google Search: 5 Differences That Affect Your Bookings |
| chatgpt local business ranking | How ChatGPT Ranks Local Businesses (2026) | How Does ChatGPT Decide Which Local Business to Recommend? |
| facebook ads not working for med spa | Facebook Ads Not Working for Your Med Spa? Read This | Why Facebook Ads Stop Working for Med Spas, and What to Do Instead |

Note what changed from today's output: the shame is gone, the first-person sprawl is gone, the length halved, and a **format suffix** appeared ("A 30-Day Plan", "5 Differences That Affect Your Bookings") that promises the shape of the answer. The pain now lives in the meta description and the ad hook, which is rule 9 and rule 10 below.

## 4. Page creation rules (Matthew, verbatim, 2026-10-07)

1. One target keyword per page. Slug = keyword, short (e.g. `/get-med-spa-on-chatgpt`).
2. Title tag (SEO): keyword in the first 3-5 words, 50-60 chars, include year or a benefit word. No hype, no open loops.
3. H1 (AEO): phrased as the question the user would type into ChatGPT, or a direct statement that answers it.
4. First paragraph under H1: a 40-60 word direct answer to the question. No intro fluff, no withheld answer.
5. H2s: follow-up questions people actually ask (People Also Ask style), each answered in its first 1-2 sentences.
6. Use specifics everywhere: numbers, timeframes (30 days), steps, named tools, real prices or ranges.
7. Include an FAQ section at the bottom + FAQPage schema. Organization/LocalBusiness schema sitewide.
8. Show a visible "Last updated: [date]" and refresh top pages monthly.
9. Meta description is the ONLY place for a direct-response hook: 140-155 chars, pain + promise + soft CTA.
10. No emotional ad copy (ghosts, embarrassed, throwaway account) in titles or H1s. That language belongs in ads and emails.
11. Every page links to the free AI visibility scan (`srtagency.com/invisible`) and to 2-3 related pages.
12. `robots.txt` must allow GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended.
13. Third-party stats must name the source (e.g. "Ahrefs found AI visitors converted at 23x organic").

Rules 9 and 10 together are the resolution of this whole document: the pain is not deleted, it is **moved** to where it belongs.

## 5. Build priority

Buyer intent first: **how to get my med spa on chatgpt**, **aeo agency pricing**. Research-stage keywords (**ai search ranking factors**, **ai search vs google search**) earn authority and citations but will not book calls on their own.

## 6. The workflow this has to run inside

One keyword at a time, through the onboarding chat, for everything:

```
ask for headlines -> it asks WHICH KEYWORD
  -> work that one page: at least 6 headline/page concepts, each in all three formats
  -> only once 6 exist does the page move on
  -> skeleton
  -> and only when every page in the batch is ready does the deep research prompt go out
```

Two things that currently block this:

- **The plan proposal prints no numbers or letters**, so there is nothing to reply with. `plan_new`'s card has to number every row and say what to type.
- **Pasting raw phrases does nothing.** Matthew wants to paste Reddit-style phrases and have them recognised, filed as VOC, and *crumbled down* into what somebody would actually type into ChatGPT to find that answer. That translation step is the missing half of the realism fix: the quotes stay the emotional source, but a quote is never a headline.
