# Addendum: the keyword step (read with 2026-09-11-one-strategy-per-client.md)

Written 2026-09-11, after the main prompt. It REPLACES the keyword half of workstream B and adds a
delivery step. Everything else in the main prompt stands.

## The gap, in Matthew's words

"We need to find at least 200 keywords around the offer from variations on how it could potentially
be said." "In what step are we going to select the keywords? I don't see it in any step and we need
to select them, right?"

He is right. Today no step selects keywords. The studio's `keywords` command prints a ranked list
(`buildKeywordSet`, capped at 99) and nothing saves it; the page plan then picks from it on its own.
And the only link from a phrase to the offer is `offerBonus()`, a whole-string substring match that
"AEO Services for med spas" almost never satisfies.

## Decision D8: a keyword step, approved by a person, between the prep call and the page plan

New order of the chain:

```
offer_proposed -> offer_locked (prep call: offer + terms) -> avatar_harvest (deep research aimed at
the LOCKED offer) -> keyword_set (NEW: expand to 200+, merge with the market's evidence, approve)
-> page_candidates -> page plan (1 pillar + 8, drawn ONLY from the approved set) -> 9 drafts
```

Check `blockedBy` for every step you move: a step must sit later than everything it names, keys are
never renamed, phases stay contiguous. If `avatar_harvest` cannot wait for the lock without breaking
the cascade, have its KEYWORDS block re-issued for the locked offer when the lock changes the
treatment, and say which you did.

## What the step does

### 1. Expand: at least 200 variations of how the offer can be said

One model call per audience (two calls if one cannot return 200 cleanly), from: the locked
treatment, the offer TERMS captured on the prep call, the positioning, the confirmed avatar and
their research brief, the city when the business is local, and the audience (`owner` or `patient`
from `concierge_configs`). Target counts per category below; the floor is **200 unique query-shaped
phrases after dedupe and the filter**. A category that comes back short is re-asked for that
category alone, not the whole batch.

**Patient audience** (a med spa; offer = one treatment, e.g. lip filler):

| Category | Target | Shape |
|---|---|---|
| Naming variants | 25 | the treatment, synonyms, brand and product names customers use, common misspellings, with and without the city |
| Near me, local, voice | 25 | "where can I get lip filler near me", "best lip filler in Charlotte", "open Saturday" |
| Price and financing | 20 | "how much is lip filler", "lip filler cost per syringe", payment plans |
| Fear, safety, objections | 25 | "does lip filler hurt", "is it safe", "lip filler gone wrong", "can it be dissolved" |
| Comparison | 20 | "lip flip vs filler", brand vs brand, "med spa vs dermatologist for filler" |
| Process, what to expect, aftercare | 20 | swelling, recovery, first appointment, how long it takes |
| Candidacy | 15 | "am I a good candidate", age, skin type, "first time" |
| Results and longevity | 20 | "how long does lip filler last", before and after, natural look |
| Choosing a provider | 20 | "best injector", "how to choose a med spa", reviews, credentials |
| Conversational AI prompts | 20 | whole questions as people dictate them to ChatGPT or Siri |

**Owner audience** (SRT itself; offer = AEO services for med spas):

| Category | Target | Examples to seed from (Matthew's own list, 2026-09-11) |
|---|---|---|
| Direct offer naming | 30 | AEO for med spas, answer engine optimization med spa, generative engine optimization, LLM optimization aesthetic clinics, ChatGPT SEO for med spas, AI search optimization cosmetic clinic, AI visibility audit med spa |
| Problem and pain | 30 | why isn't my med spa on ChatGPT, med spa not showing up in Perplexity, ChatGPT not recommending my clinic, losing patients to AI search |
| Outcome | 25 | get my med spa recommended by ChatGPT, show up in Google AI Overviews, rank in AI answers, med spa AI mentions |
| Vendor and buyer intent | 25 | best AEO agency for med spas, AEO consultant, hire an AI visibility expert, med spa AI marketing agency |
| Price and ROI | 20 | how much does AEO cost, is AEO worth it for a med spa |
| Comparison | 20 | AEO vs SEO, AEO agency vs doing it myself, AEO vs paid ads |
| How it works and timeline | 20 | how long until ChatGPT mentions my clinic, what does an AEO agency actually do |
| Trust and objections | 20 | is AEO a scam, will I lose my pages if I leave, does it touch patient data |
| Treatment-specific AEO | 15 | AEO for filler clinics, for Botox, for laser hair removal, for TRT clinics |
| Conversational AI prompts | 15 | what a clinic owner types into ChatGPT about being invisible |

The two tables are data, not code branches: keep one expansion function that takes the category
set for the audience, so a third audience is a new table rather than a new function.

### 2. Two uses, kept apart: QUERIES for pages, HOOKS for marketing

Matthew's own list mixed two things, and the answer he pasted said so: phrases people actually TYPE
OR ASK (page targets), and marketing lines ("5 new filler patients in 30 days", "30-day ChatGPT
visibility sprint", "your clinic isn't showing up on ChatGPT"). Every row carries `use`:

- `query`: something a person would type or dictate. Only these can become page target keywords.
- `hook`: ad headlines, email subject lines, landing copy. Stored, shown, exported for ads and the
  content engine, and NEVER a page target.

‼️ A hook that promises an outcome ("5 new filler patients in 30 days") may be stored as a hook only.
Pages never carry it: `draft-page.ts` rule 4 bans outcome promises, and CLAUDE.md's pitch doctrine
gates any guarantee to the ads tier (`guaranteeFor()`). Do not loosen either.

### 3. Provenance: a variation a model proposed is not evidence that anybody searched it

This repo's keyword doctrine (`keyword-set.ts` header, `phrase-quality.ts`) is that rankings come
from facts in the database, not a model's opinion. The expansion is the first model-written input to
keyword selection, so it must be labelled and scored as what it is:

| origin | meaning | scoring |
|---|---|---|
| `harvest` | lifted off pages the engines cited | full SCORE_TERMS |
| `research` | the deep research KEYWORDS block, with a source URL | full, volume only when a URL backs it |
| `expansion` | proposed by the model in this step | intent from its category only; no frequency term; ranks below an evidenced phrase for the same slot |
| `measured` | an expansion phrase put to an engine by `keywords check` | earns the +15 "no engine names them" term when it applies |

When an expansion phrase and an evidenced phrase normalise to the same thing, the evidenced row
wins and the expansion confirms it.

`keywords check` (optional, a button or command in the step thread): put the top N query-shaped
phrases (default 20) to the engines through the existing audit prompt runner
(`src/lib/audit-engine/run-prompts.ts`), and record whether the client was named. It spends OpenAI
calls; print the count and cost before running. Memory says the audit engine has been blocked on
OpenAI credits, so if the call fails, say that plainly rather than recording "not named".

### 4. The offer-relevance test comes from the expansion

The categories above are ALL about the offer by construction, so the expansion's naming variants and
the prep call's terms together are the offer vocabulary. The relevance test in the main prompt's
workstream B uses that vocabulary instead of the whole treatment string. A harvested phrase that
matches none of it is still stored but cannot be a pillar or support keyword.

### 5. Approval, in the step thread

Card: count per category, per use and per origin; the top 40 queries; the full list as a CSV
attachment (all 200+ rows: phrase, category, use, origin, score). Commands in the step thread:

- `keywords approve` approves the query set as shown.
- `keywords drop 12` / `keywords drop 12, 15, 40` removes rows by the numbers on the card or CSV.
- `keywords add: <phrase>` adds his own, origin `manual`, which ranks like evidence (he said it).
- `keywords more <category>` re-expands one category.
- `keywords check` as above.

Exact grammar, anchored, for the reason the studio records: anything that is not a command in a
thread that also takes dictation must fall through.

### 6. Storage and verifier

New table (in the same migration as the main prompt's changes, header explaining why it is a table
and not `question_bank`, which has no `client_id` and is shared by every client in a vertical):
`client_keywords (client_id, phrase, normalized, category, use, origin, score, currently_named,
approved, approved_at, approved_by, source_url)`, unique on `(client_id, normalized, use)`.

Verifier: system tier, at least 200 rows exist AND the query set is approved AND at least 9 approved
queries pass the relevance test (one pillar plus eight supports). Fewer than 9 refuses with the fix
("`keywords more <category>`, or add your own").

### 7. What reads the approved set

- The page plan draws ONLY from approved `query` rows. The pillar keyword is the top approved
  naming-variant query (plus the city when local); the 8 supports spread across categories, at most
  2 per category, so the 9 pages are not nine price pages.
- `buildKeywordSet` and the studio's `keywords` command show the approved set when one exists, with
  its provenance, rather than recomputing a different ranking.
- `hook` rows go to the content lane as material. Wiring that is out of scope for this build; store
  them and stop.

## Probes to add

- The SRT fixture: Matthew's pasted list (both of his lists) run through the filter and the
  classifier: every "5 filler patients in 30 days" style line lands as `hook`, every "why isn't my med
  spa on ChatGPT" style line as `query`.
- The floor: a 150-row expansion fails the verifier; 200 passes.
- Provenance: an expansion row never outranks an evidenced row for the same normal form, and never
  carries a frequency term.
- Relevance: "does lip filler hurt" passes for a lip filler client and fails for a Botox client.
- Grammar: `keywords drop everything` and "keywords matter less than people think" are dictation.

## Answer for Matthew's final message

State which step number the keyword step landed at, how many rows SRT's first run produced per
category, how many were approved, and the 9 keywords the plan chose.
