# Make `reviews.{clientdomain}` look like a product somebody paid for

A prompt for a fresh session. Everything in a **Ground truth** block was measured against this
worktree on **2026-09-28** and is quoted, not remembered.

**Repo:** `Desktop/Code/_wt-kwstrategy`, branch `feat/keyword-decisions`, level with `main`.
Read `CLAUDE.md` first, then `src/app/hub/[host]/hub.css`'s header and
`src/app/hub/[host]/universes.css`'s header. Both explain the rules before you change anything.

---

## What this is

Matthew, 2026-09-28: *"the review website is really simple right now and I want it to look nicer
... some more variations ... so it looks professional and clean."*

This is a LOOK change on a page whose BEHAVIOUR is a compliance rail. The behaviour is not on the
table. The whole job is: same semantics, same guarantees, better design, offered as variations he
can pick between.

---

## Ground truth: the files

| what | where |
|---|---|
| the page | `src/app/hub/[host]/reviews/referral-engine.tsx` (server, 178 lines) |
| the classic client | `src/app/hub/[host]/reviews/referral-engine-client.tsx` (915 lines) |
| the v2 chat client | `src/app/hub/[host]/reviews/virtual-agent-client.tsx` (685 lines) |
| the theme | `src/app/hub/[host]/hub.css` (1,321 lines), tokens under `.hub-root` |
| the six looks | `src/app/hub/[host]/universes.css` (284 lines) + `src/lib/hub/universes.ts` |
| assembly, no model | `src/lib/hub/review-assemble.ts` |

Existing universe keys: `blueprint`, `atelier`, `magazine`, `brutalist`, `noir`, `botanica`.

Classes the review page already renders: `rev-stars`, `rev-stars-row`, `rev-note`, `rev-primary`,
`rev-prime`, `rev-hint`, `rev-waiting`, `rev-spinner`, `rev-msgs`, `rev-msg`, `rev-composer`,
`rev-bar`, `rev-send`, `rev-skip`, `rev-mirror`, plus the shared `hub-head`, `hub-eyebrow`,
`hub-lede`.

---

## ‼️ Ground truth: five things that must not change, and the probes that hold them

These are not style preferences. Four of them are enforced by a probe that runs in CI.

1. **NO MODEL IN THE PATH.** Not for drafting, not for cleanup, not for tone, not for spelling.
   `review-assemble.ts` imports nothing. FTC 16 CFR Part 465 regulates a tool that GENERATES review
   content its user did not write; one that REFORMATS what she typed is not regulated. This repo has
   a Claude call in nearly every other feature and the reflex will be to add one here.

2. **NO GATING, AND THE RATING MUST NOT ROUTE.** Every rating reaches the same review link. A
   private box that appears only under a low rating, in place of the public link, is the gating
   funnel this tool refuses to be. `scripts/_probe-review-gating.ts` fails the build if any code path
   branches on the rating, and it reads the STYLESHEET too: no rule may hide the destination links or
   the private note.

3. **NO PII COLUMN EXISTS, AND THE ABSENCE IS THE ENFORCEMENT.** `review_tool_submissions` has no
   column for a name, email, phone, IP, user agent or session id. Do not add a "who left this"
   field to make a card look better. The submit route must never read `x-forwarded-for`.

4. **ON SCREEN LABELLED, IN THE COPY BUFFER NOT.** `assembleLabelled` and `assemblePlain` are
   separate functions and are deliberately not derived from each other. The labels are ours; the
   sentences are hers, and what reaches Google contains no SRT-authored text at all.

5. **THE MIC IS ON-DEVICE ONLY.** `SpeechRecognition` in the browser. Do NOT wire
   `transcribeAudio()`: a voice is more identifying than any field the table refuses to store.

Also: **no em dashes anywhere in copy** (house rule, `hasBannedDash()`), and **Spanish is not
machine-translated** on this surface.

## ‼️ Ground truth: how a "variation" is built here, and it is NOT a rewrite

`hub.css`'s header states the rule that decides this whole job:

> **TWO WRITERS, AND THEY OWN DIFFERENT VARIABLES ON PURPOSE.** `themeStyle()` (`src/lib/hub/theme.ts`)
> writes `--hub-accent`, `--hub-accent-soft` and font-family. That is the CLIENT's brand, read off
> their own homepage. `skinStyle()` (`src/lib/hub/skin.ts`) writes everything else. That is OUR
> format. The sets are disjoint, so neither can quietly beat the other.

and `universes.css`'s header states the rest:

> **SEMANTICS FIXED, LOOK FREE.** Every rule styles markup that already renders. Nothing may hide a
> semantic element or reorder it for a reader: no `display:none` or `visibility:hidden` on the
> masthead, a heading, the answers, the NAP or the body. `content:` is allowed only on
> `::before`/`::after`. **EVERY SELECTOR STARTS `.hub-root.hub-u-<key>`**, two classes, so a universe
> beats the template without `!important` and cannot touch a page in another universe.
> `_probe-hub-universes.ts` reads this file and holds both lines.

**So a new look is a new universe plus tokens. It is not a new component tree.** If you find
yourself editing `referral-engine-client.tsx` to change how something LOOKS, stop: the markup is
the contract the probes read, and the CSS is where a look lives.

‼️ **`--hub-measure`, `--hub-base` and `--hub-radius` were literals once and every variant had to
restate them in four places, including inside `.rev-mirror`, where a 1px disagreement moves the
highlight off the words it belongs to.** Any layout number a variant might move is a variable.

---

## The work

### W1 . Look at it before designing anything

Run the hub locally and open the reviews page for a real client, in both clients (classic and v2
chat). Screenshot each state: the star row, a question mid-walk, the assembled mirror with the
highlight, the destination handoff, and the empty/no-destination state. **The redesign is judged
against these, so capture them first.**

### W2 . Three variations, as universes, not as opinions

Build **three** new universe keys alongside the six that exist. Each must be a coherent position,
not a palette swap, and each must be nameable in one sentence. Suggested starting points from the
references below, and Matthew picks:

- **a quiet document** — near-white canvas, hairline rules, one accent, generous measure. The Geist
  / Linear position: restraint, precise typography, almost no decorative colour.
- **a warm card** — soft surface, rounded radius, a little depth, friendlier for a patient or a
  homeowner reading it on a phone after an appointment.
- **a confident brand block** — the client's own accent used at full strength in a band, larger
  display type, the review tool reading as part of THEIR site rather than a tool bolted on.

Each one ships with its `universes.ts` entry, its `universes.css` block, and a screenshot.

### W3 . The two states the current page does worst

Measured while reading it, and worth fixing in every variation:

- **The star row is the first thing on screen and carries no explanation.** She does not know what
  happens after she taps. One line of copy under it would carry the whole experience, and it costs
  nothing because it is not a claim about her.
- **The handoff is the moment the product either works or does not** — "Copy and go" plus the
  destination link. It currently reads as a form ending. It should read as the point of the page.

### W4 . Mobile first, and actually check it

This is read on a phone, standing in a car park, after an appointment. Check the composer with the
keyboard up, the mirror with the highlight, and the destination buttons with a thumb.

---

## References to look at, and what to take from each

| what | link | take |
|---|---|---|
| review + rating screens from real apps | https://mobbin.com/explore/web/screens/reviews-ratings and https://mobbin.com/explore/mobile/screens/reviews-ratings | how shipped products lay out a star row and a submit. Free tier, login needed to browse deeply |
| the rating → submit flow end to end | https://mobbin.com/explore/mobile/flows/reviewing-rating | the sequence, not the pixels |
| conversational forms, one question at a time | https://www.jotform.com/blog/conversational-form-design/ and https://aidaform.com/templates/conversational/ | the v2 chat client IS this pattern. Progress, pacing, and what a "next" affordance should look like |
| Typeform, the pattern's origin | https://automationatlas.io/tools/typeform/ | why one question at a time reduces abandonment |
| Vercel Geist, the restraint position | https://www.designsystems.one/design-systems/vercel-geist and https://seedflip.co/blog/vercel-design-system | a near-white canvas, hairline borders, a very narrow palette. 40 colour tokens, 9 radii, 12 spacing values |
| Vercel tokens spelled out | https://designmd.cc/benchmarks/vercel | concrete token values to borrow the DISCIPLINE from, not the brand |
| UI kits and current patterns | https://muz.li/inspiration/best-ui-kits/ | breadth, quickly |
| review-screen concepts | https://www.behance.net/search/projects/customer%20review%20ui | concepts rather than shipped work. Treat as mood, not as evidence |

‼️ **Do not copy Vercel's monochrome wholesale.** This page carries the CLIENT's accent, read off
their own homepage by `themeStyle()`. The thing worth stealing is the discipline: few decisions,
applied absolutely. A variation that ignores `--hub-accent` is a variation no client can use.

---

## Definition of done

- Three new universes, each with a `universes.ts` entry, a `universes.css` block, and a screenshot
  of the reviews page in it on a phone viewport.
- `bun --no-env-file run scripts/_probe-review-gating.ts` green, and **proved it can still fail**:
  plant `setRevealed(true)` inside `answerGate`, watch it fail with `found: setRevealed`, remove it.
- `bun --no-env-file run scripts/_probe-hub-universes.ts` green.
- `bun --no-env-file run scripts/_probe-hub-skin.ts` and `scripts/_probe-review-evidence.ts` green.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` and `bun run build` green.
- No new column on `review_tool_submissions`. No model import under `reviews/`.
- Any SQL pasted in full in a fenced ```sql block, never a file path, never run from the session.

## Traps, each already paid for once

1. ‼️ **CRLF.** `_probe-review-gating.ts` sliced a function with `indexOf("\n  }\n")` and returned
   `-1` on every Windows checkout, so `slice(start, -1)` took the whole rest of the file and it
   reported a gating leak that did not exist. It passed in CI, because Linux checks out LF. Fixed
   2026-09-28 by normalising in `read()`. Third instance of this trap in this repo.
2. ‼️ **The probes read the STYLESHEET, not just the code.** A CSS rule that hides the destination
   links or the private note fails the gating probe. That is deliberate: a gate built in CSS is
   still a gate.
3. **`.rev-mirror` is pixel-coupled to the textarea behind it.** The highlight is a mirrored div; a
   font, padding or line-height change in one and not the other moves the highlight off the words.
4. **One root layout.** `globals.css` owns `:root` with the app's dark theme and `layout.tsx`
   hard-sets `font-family` inline on `<body>`, which is why everything is scoped under `.hub-root`
   and re-declares rather than inherits.
5. **`public/robots.txt` is deleted on purpose.** A file in `public/` is served for every hostname,
   including the client's. Do not add one back while working on hub pages.
