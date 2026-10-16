# Brief: an algorithm that turns four answers into a review that reads like a person wrote it

Written 2026-10-15 for a fresh session, and for pasting into claude.ai or ChatGPT.

Everything from `## COPY FROM HERE` down is self-contained: it assumes no access to this repo.
The part above it is for whoever is driving.

---

## For whoever is driving: why this brief exists

Three versions have each fixed the previous one's worst symptom and exposed the next.

| | what it did | what it got wrong |
|---|---|---|
| v6 | four questions, each answer its own sentence | read like a form: `Great.` sitting alone |
| v7 | joined two answers, carried one verb | one-word answers still sat bare |
| v8 | a frame per question, 324 shapes, random per walk | frames are chosen by WORD COUNT, which is not a grammar |

**The measured defect, from Matthew's own walk-through on 2026-10-14.** He answered the nerves
question `Not being able to resist the whole session`. Output:

```
Got filler with sofia today. Not being able to resist the whole session. I needed a new job. ...
Got filler with sofia today. I needed a new job, and not being able to resist the whole session. ...
```

Both read as nonsense, and the cause is one line. The frame `"I was nervous about "` fires only on
answers of **1 to 6 words**; this answer is **8**. The ceiling's own comment says *"Seven or more is
already a sentence and gets nothing added"*, and that assumption is false: this is a gerund phrase,
not a sentence. **A word count is standing in for a grammatical question it cannot answer.**

With the frame it would have read `I was nervous about not being able to resist the whole session.`
which is both correct and exactly what she meant.

‼️ **AND HER OWN UNJOINED VERSION READS JUST AS BADLY**, which is the part worth sitting with:

```
Got filler with sofia today. I needed a new job. Not being able to resist the whole session. ...
```

The joiner did not create this. It failed to fix it. The defect is older than every joiner and it
starts at the question.

---

## COPY FROM HERE

I need help designing an algorithm. Please think divergently first and converge second: give me
several genuinely different approaches before recommending one.

### What the product is

An in-clinic review tool. A patient finishes an appointment, the front desk hands her a tablet or
she scans a QR code, and a short chat asks her a few questions. At the end the tool shows her a
review assembled from her own answers, she edits it if she likes, ticks a box confirming it is
hers, and taps one button that copies it and opens the clinic's Google listing so she can paste it.

**The four questions are fixed and identical for every clinic.** Verbatim:

1. `motivation` — "What made you start looking for a place like this?"
2. `nerves` — "What were you nervous about?"
3. `walkout` — "How did you feel walking out?"
4. `friend` — "What would you tell a friend who is on the fence about coming in?"

Two more facts are collected first and used only for the opening line: the service she had, and who
treated her. The opening line is `"Got {service} with {provider} today."`

### The hard constraints. These bound the solution space and are not negotiable.

This is a regulated surface, so the interesting part of this problem is what the algorithm is
**forbidden** to do.

1. **No new facts, ever.** The output may contain only (a) words the patient typed and (b) words
   taken from the fixed question she was answering. No adjective, adverb, treatment, result,
   duration, price, staff name or claim that she did not type. This is FTC 16 CFR Part 465, which
   bans disseminating a review that misrepresents a consumer's experience; the FTC's Rytr case
   turned on a generator producing "material details unrelated to user input".
2. **Nothing may be dropped.** Every answer she gives must appear. An algorithm that decides which
   of her statements to keep is choosing what her review says, and the statement it drops could be
   the complaint.
3. **Nothing may be moved within an answer.** Her words inside one answer must stay contiguous and
   in her order. Relocating a word across answers changes what it modifies: moving "honestly" from
   "like myself again, honestly" into a sentence about nerves is a sentiment shift made entirely
   out of her own words.
4. **A complaint must survive undiluted.** If she answers the walkout question with `a bit sore and
   the wait was long`, that must come out intact and must not be absorbed, softened, or reframed as
   a feeling. This is the single most important test case.
5. **No behaviour may vary by star rating.** She rates the visit earlier in the walk. No path,
   wording or ordering may differ for a 1 versus a 5. Steering happy customers toward the public
   review and unhappy ones elsewhere is review gating, which Google prohibits outright and which
   would get the listing penalised.
6. **No language model at runtime.** The assembly must be a pure, deterministic function: same
   answers in, same review out, no network call. A model may be used OFFLINE to author candidate
   templates, which are then checked and committed as literals. The reason is testability as much
   as law: a rule table can be swept by an automated test over thousands of cases, and a model's
   output cannot.

### What exists today, so you do not redesign it from scratch

Assembly is a pure function over a table of literals.

- **A frame per question.** Each question has 2 to 3 fixed prefixes. Examples:
  - motivation: `"I started looking because of "`, `"What made me start looking was "`
  - nerves: `"I was nervous about "`, `"What I was nervous about was "`
  - walkout: `"I walked out feeling "`, `"Walking out, I felt "`, `"I felt "`
  - friend: `"If you are on the fence, "`, `"If you are on the fence about coming in, "`
- **The fence that makes this legal.** Every content word in a frame must already appear in that
  frame's own question, allowing inflection (`start`→`started`, `feel`→`felt`). Plus a closed list
  of function words (`i me my you your it is am are was were be been a an the of to for in on at
  and if that this what`, plus `because` for the motivation question only, because that is the one
  question that asks for a cause). An automated test fails the build on any frame using a word
  outside those two lists. A question is fixed, identical for every clinic, and written before any
  patient answered anything, so it cannot flatter a visit.
- **When a frame fires.** 1 to 6 words, one sentence only, no conjunction anywhere in the answer,
  and the first word is not a pronoun that would create a double subject. Otherwise the answer is
  emitted as she typed it, capitalised, with a full stop.
- **A merge.** The motivation and nerves answers, when adjacent and both four words or more, become
  one sentence joined by `", and "`. Only `and` is allowed: `but`, `so`, `because` and `which is
  why` each assert contrast or causation between two answers that she did not assert.
- **Six curated sentence orders**, not all 24 permutations, because most permutations read like a
  shuffled deck. Five of the six close on the recommendation.
- 3x2x3x3 frame choices x 6 orders = **324 distinct reviews**, with a random one chosen per walk so
  a clinic's profile does not fill with reviews sharing a skeleton.

### The three failure modes I need solved

**1. Length is standing in for grammar, and this is the big one.**

The 1-to-6-word rule is a proxy for "is this a fragment that needs a frame, or a sentence that does
not?" The proxy fails in both directions:

- `Not being able to resist the whole session` (8 words) is a gerund phrase and gets NO frame, so it
  lands in the review as a bare fragment, or glued to the previous answer with `", and "` where it
  reads as nonsense. With the frame it would read `I was nervous about not being able to resist the
  whole session.` which is correct.
- `The food` was refused by an early version because it starts with "the", which was treated as a
  clause opener. In the nerves frame a determiner is exactly the right next word.

The real question is: **what grammatical shape is this answer, and which frame fits that shape?**
Right now the algorithm asks "how long is it?"

**2. The merge discards the frames.** When motivation and nerves merge, neither gets its frame, so
the merge actively removes the context that makes a short answer legible.

**3. The reviews still read as generated** even at 324 shapes, because every one of them is the
same four slots in a different order with a different prefix. A human review has uneven sentence
lengths, sometimes one long sentence and one short, and does not mention all four topics.

### What I want

An algorithm producing **at least 52 arrangements that each read like something a person actually
wrote**, within every constraint above. Variety is the easy half and I have it; the hard half is
that each arrangement is genuinely good English for the answers it is given.

### Please give me

1. **Three to five genuinely different approaches**, not variations on the current one. For each:
   the core idea, a worked example using the sample answers below, what it would get right that the
   current design gets wrong, and how it could fail.
2. **An honest assessment of whether the question wording itself is the better lever.** A question
   that invites a fragment produces a fragment. "What were you nervous about?" invites "not being
   able to resist the whole session". A question like "Finish this sentence: before I came in, I
   was nervous about ___" invites an answer that needs no frame at all and can never be out of
   context. This earlier version of the product already learned once that a bad output was a symptom
   of a badly shaped question, and fixed the question rather than the assembler. Tell me if that is
   the answer again, and what it would cost.
3. **A recommendation**, with the reasoning, and what you would build first.
4. **The test cases you would hold it to**, including the complaint case above.

### Sample answers to work with

```
A  service: lip filler    provider: Sarah
   motivation: I kept putting off doing anything about my smile lines
   nerves:     I was worried it would look overdone
   walkout:    Like myself again, honestly
   friend:     Just go, they talk you through everything

B  service: botox         provider: Sarah
   motivation: wrinkles
   nerves:     bruising
   walkout:    good
   friend:     go

C  service: filler        provider: sofia      <- the one that reads badly today
   motivation: I needed a new job
   nerves:     Not being able to resist the whole session
   walkout:    Like a new man
   friend:     Dont overthink it

D  service: a cleaning    provider: Dana       <- the complaint. Must survive intact.
   motivation: I had been meaning to get my teeth looked at for years
   nerves:     I was nervous about the needle
   walkout:    a bit sore and the wait was long
   friend:     worth it but book the first slot of the day
```

### Do not propose

- Calling a language model at the moment a patient is looking at the screen.
- Dropping, shortening or summarising any answer she gave.
- Reordering words inside one of her answers.
- Anything that behaves differently depending on her star rating.
- Per-clinic wording. One table serves every client, so there is one thing to audit.

## COPY TO HERE

---

## Directions worth exploring, for the session that picks this up

Written down so the next session does not start from a blank page. These are sketches, not
decisions, and the brief above deliberately does not include them so that whoever is asked gets a
chance to think of something better first.

**A. Shape-first instead of question-first.** Classify the answer's grammatical shape, then choose a
frame that fits that shape, with the question supplying only the vocabulary. Shapes are a short
closed list: bare noun (`wrinkles`), noun phrase (`the food`), adjective or complement (`good`,
`like a new man`), gerund phrase (`not being able to resist the whole session`), imperative (`just
go`), full sentence (`I kept putting off...`). The table becomes two-dimensional, question x shape,
and every cell is still fenced by the same rule. This fixes defect 1 at its root, because the frame
is chosen by what she typed rather than by how long it is.

**B. Fix the questions, not the assembler.** The cheapest and most likely correct answer. A
sentence-completion prompt (`Before I came in, I was nervous about ___`) returns an answer that is
already framed, already in her voice, and impossible to render out of context. The product has
learned this lesson once already: three near-identical worry questions were producing junk, and the
fix went into the question set rather than into the assembler. The cost is a new question set
version and a walk-through to confirm the chat still reads naturally.

**C. Review archetypes instead of permutations.** A library of shapes copied from reviews people
actually wrote (the before-and-after, the reassurance, the recommendation-first), each with slots
and its own connective rules. Variety comes from archetypes rather than from factorial ordering, so
every pattern reads well by construction instead of by luck.

**D. Generate and score.** Produce every valid assembly, score each for readability (sentence length
variance, fragment detection, repeated openers, total length) and show the best. Selecting among
outputs that are all already valid invents nothing, and it is the honest version of "if it sounds
weird, show a different one" that does not require dropping any of her words.

**E. A tiny part-of-speech lexicon.** Enough closed-class vocabulary and suffix rules to tell a
gerund from an imperative from a noun phrase, with no model and no dependency. This is what approach
A needs underneath it, and it is a few hundred lines.

**F. Offline model-authored frames.** Already specified in
`docs/specs/SRT-Review-Wording-Generator-PROMPT.md`: a model proposes candidate frames at authoring
time, the fence and a human check them, they ship as literals.

The two that compose best are **B and A**: fix the questions so most answers arrive framed, and use
shape detection for the ones that still do not.
