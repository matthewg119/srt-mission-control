# Prompt: generate more review wordings with Claude

Matthew, 2026-10-13: *"create a prompt that does all of this receives the information and creates a
few versions with claude based on the reference code randomizing and stuff creating a random
perfect pattern for the review, we just need 52 variations."*

## ‼️ READ THIS FIRST: Claude writes the TABLE, never the review

There are two ways to use a model here and only one of them is legal.

| | what it means | verdict |
|---|---|---|
| **Authoring time** | Claude proposes new wordings for `CARRIES`. A human and a probe check them. They are committed as literals. A patient's review is still assembled by a pure function from a fixed table. | **This document.** |
| **Runtime** | The walk sends a patient's answers to Claude and ships back what it writes. | **Never.** |

The runtime version is the thing FTC 16 CFR Part 465 reaches, it is what the Rytr complaint turned
on, and it would falsify the sentence printed under the box on her screen: *"We never add words you
did not say about your visit."* `src/lib/hub/review-assemble.ts` imports nothing and
`scripts/test-onboarding-artifacts.ts` asserts it, so the runtime version cannot be built by
accident. It would have to be built on purpose, and this file is not permission to.

**Everything below produces candidate strings for a diff somebody reviews.**

## What already exists, so you do not regenerate it

```
CARRIES          4 questions x 2-3 wordings each  = 54 wording combinations
SENTENCE_ORDERS  6 curated orders                 = x 6
REVIEW_SHAPES                                     = 324 distinct reviews
```

He asked for 52. The table is already past it. **Use this prompt when a wording reads badly, not to
hit a number.** Adding a third wording to `nerves` alone takes 324 to 486.

## The prompt

Paste this into Claude with `src/lib/hub/review-assemble.ts` attached.

---

You are adding wordings to a lookup table in a patient-review tool. You are **not** writing reviews.

A patient answers four fixed questions. The tool turns a short answer into a sentence by putting a
fixed prefix in front of it: `"great"` becomes `"I walked out feeling great."` Your job is to
propose more prefixes.

**The four questions, verbatim. These never change:**

1. `motivation` — "What made you start looking for a place like this?"
2. `nerves` — "What were you nervous about?"
3. `walkout` — "How did you feel walking out?"
4. `friend` — "What would you tell a friend who is on the fence about coming in?"

**THE ONE RULE THAT DECIDES EVERYTHING. Every content word in a prefix must already appear in that
prefix's own question**, allowing inflection (`start`→`started`, `feel`→`felt`/`feeling`). On top of
that you may use only these function words:

```
i me my you your it
is am are was were be been
a an the
of to for in on at
and if that this what
because        <- motivation ONLY. It is the only question that asks for a cause.
```

This is not a style guide, it is a hard fence. `scripts/_probe-review-v7.ts` section 1b fails the
build on any prefix containing a word that is in neither list. It is why the tool is defensible: a
question is fixed, identical for every clinic, and written before any patient answered anything, so
it cannot flatter a visit.

**Also required of every prefix:**

- 48 characters or fewer.
- Ends with a trailing space, or with `", "` if it ends on a comma.
- It must read naturally with a SHORT answer after it. Test each one against `great`, `wrinkles`,
  `bruising`, `go for it`, `a bad job`, `new skin`.
- `motivation` and `nerves` end in a preposition and take a noun phrase. `walkout` takes a
  complement. `friend` takes a clause or an imperative.
- No adjective, adverb, judgement or intensifier. Not `really`, `very`, `so`, `absolutely`,
  `great`, `amazing`, `lovely`, `highly`, `recommend`. These fail a second, separate word-list
  check.
- No clinical or medical word, no treatment, no body part, no result, no staff name, no price, no
  duration. None of these is in any question, so the fence already refuses them; do not test it.

**Do not propose:**

- Anything that asserts causation or contrast between two of her answers (`so`, `but`, `which is
  why`, `because` outside `motivation`). The tool joins two answers with `", and "` only, which
  asserts addition and nothing else.
- Anything that makes a double subject: `I walked out feeling I felt fine`.
- A different ORDER for her sentences. That is `SENTENCE_ORDERS` and it is curated separately.
- Anything that shortens, summarises, merges or omits one of her answers. Dropping an answer is
  the one thing the tool must never do, because the answer dropped could be the complaint.

**Output format.** A TypeScript fragment and nothing else, ready to paste into `CARRIES`:

```ts
motivation: [
  "I started looking because of ",
  // ... existing ones first, new ones after
],
```

For each NEW wording add a one-line comment giving the question words it is built from, so a
reviewer can check the fence by eye without running anything.

---

## After Claude answers

1. Paste the new wordings into `CARRIES` in `src/lib/hub/review-assemble.ts`.
2. `bun --no-env-file run scripts/_probe-review-v7.ts`

   Section 1b fails by name on any prefix using a word outside the question. **A failure here is
   the fence working. Do not widen `FUNCTION_WORDS` to make it pass** — that is the one edit that
   would quietly turn this into a rewriter, and the list is closed on purpose.
3. Read the sweep count. It multiplies automatically: more wordings means more cases, and all of
   them must still invent nothing and drop nothing.
4. Eyeball the output against a one-word answer. A prefix that passes the fence can still read
   badly, and the probe cannot tell you that. You can.
5. `bun --no-env-file run scripts/test-onboarding-artifacts.ts` and the rest of the list in
   `.github/workflows/checks.yml`.

## What this prompt deliberately cannot give you

- **Shorter reviews by dropping answers.** He asked for this: *"if a review sounds weird cut the
  half of it and leave it more focused on a pain."* A tool that decides which of her statements to
  keep is choosing what her review says, and the statement it drops could be the complaint. The
  honest levers for a shorter review are asking fewer questions, and the editable box she already
  has in front of her.
- **Per-clinic wordings.** One table for every client, which is what he asked for and what keeps
  one fence over one set of literals.
- **Randomised punctuation inside her own sentences.** Her commas and full stops are hers. What
  varies is where OUR prefixes put theirs, which is what `CARRIES` and `SENTENCE_ORDERS` already do.
