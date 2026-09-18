# The resources engine, the funnel thread, and the rerun that knows what it holds

A build prompt for a fresh session, written 2026-09-18. Four workstreams, in the order they should
be built. W1 is what the end-to-end test is waiting on; W2 is nearly free; W3 is the biggest and the
one with real revenue behind it; W4 is a design pass.

**Read first:** `CLAUDE.md`, `docs/DATA-AND-WORKFLOWS.md`, `docs/prompts/2026-09-19-final-rerun-and-owed.md`.
Two repos are in play:

| Repo | Serves | Local |
|---|---|---|
| `srt-mission-control` | `mission.srtagency.com`, the onboarding brain, the API | `C:\Users\matth\Desktop\Code\_wt-concierge-toggle` (branch `feat/north-star-2`) |
| `srt-agwb` | **`srtagency.com`**, the marketing site and `/resources` | `C:\Users\matth\Desktop\Code\srt-agwb` (pushes to `main`) |

**Already done, do not redo:** the direct-POST spam fix on `srt-agwb/api/invisible-lead.js`
(commit `c795107`). `renderedAt` is required, stage `email` on a scan funnel needs a website or a
scan, and there is a per-IP ceiling.

---

## W1. The rerun that reads what it holds and asks for what is missing

**The ask, verbatim:** *"our onboarding brain can read the data it has and if we are missing
anything post it directly in the rerun or even suggest to rerun a previous step to make sure we
have all the data we need."*

`rerunStep()` in `src/lib/clients/step-rerun.ts` touches **only** `client_delivery_steps` (verified:
no deletes, no other table). It resets the row, runs the runner or posts the card, and continues the
board through `reachableCursor`. What it does not do is say anything about what the step is missing.

Everything needed already exists and is already wired:

- `gapsFrom(ctx, stepKey)` — what this step declares it needs, and what is absent (`step-gaps.ts`).
- `gapLines(g, max)` — those gaps rendered for a card.
- `gapPromptsAvailable(g)` — **pure**, which prompts this step could hand back, with no model call
  and no `buildContext`. Built precisely so a card can offer the door without paying for it.
- `suggestionsFor(ctx, stepKey)` — what is worth doing next, each carrying a `basis` naming the rows
  it counted (`suggestions.ts`).
- `buildFinalPrompt` — the whole-lead prompt (`final-prompt.ts`).

**Build:** when a rerun posts its card, append what the step is missing, which earlier step writes
each missing field, and the command that fills it. `stepsBlockedBy` / `stepsNeeding` in
`step-needs.ts` already invert the dependency, so "rerun step 12 first, it writes the keywords this
step needs" is a lookup rather than a guess.

**Rules that bind here:**
- **D7.** It proposes. A rerun must never silently rerun a previous step on the strength of a gap.
- **D9.** Every line cites the rows it read. `_probe-suggestions.ts` asserts each basis matches
  `/client_[a-z_]+|page_[a-z_]+|STEP_NEEDS/` and is deliberately **not** a digit.
- **D6.** `reachableCursor` stops at the first non-auto step. "Continue" is never "post seven cards".
- A card body over 3,000 characters fails the **whole** message. Everything through `bodySections()`.

**Probe:** extend `_probe-step-rerun.ts` — a rerun of a step with a known gap names it, names the
step that writes it, and never claims a number no row produced.

---

## W2. Thread the funnel into #hot-leads

**The ask:** *"I want to get notifications in slack when someone completes this funnel... just reply
as threads so we have the continuity as they fill the thing."*

**This is wiring, not building.** `appendLeadFollowup` in `src/lib/clients/lead-intake.ts` already
exists and has **zero callers**. Its own doc comment: *"Append a follow-up to a lead that already
exists: a timeline note plus a reply in the same #hot-leads thread."*

The six stages already arrive from the site: `email`, `full`, `nosite`, `channels`, `qualify`,
`booked` (`srt-agwb/api/invisible-lead.js`, the `STAGES` array). `ingestLead` returns `threadTs`
and `contacts.slack_thread_ts` already holds it.

**Build:** first stage for a contact creates the lead and the thread; every later stage calls
`appendLeadFollowup` so the thread reads as one conversation filling in. Verified live: the thread
already exists on every contact (`slack_thread_ts` is set, channel `C078ANUFJP4` = `#hot-leads`).

‼️ **Matthew's own observation is the acceptance test:** a visibility-funnel lead gives a
**website first**, then an email. If a thread ever opens with an email and no website on `home` or
`invisible`, either the guard in `c795107` regressed or a new funnel needs its own source value.

---

## W3. The resources engine: categories, weekly headlines, and the same thing for every client

This is the one with money behind it. Measured on the `srt-agwb` Vercel analytics, last 30 days:
**15 visitors, 11 of them on `/resources/payroll-software-medical-practices-2026` alone**, referrers
including `google.com` (4) and **`chatgpt.com`**. One answer-first guide is carrying the site.

### W3a. New content categories, driven by the pillars we already build

Today `/resources` has five: Payroll & HR, CRM & Sales, AI Tools, AI Visibility, Marketing. Matthew
wants **formats**, not just topics: *"I want to make lists as one of the things we can use to create
content, comparison blogs and other divergent ideas."*

Add a format axis alongside the topic axis. Lists ("7 tools that..."), comparisons ("X vs Y for a med
spa"), decision guides ("how do you choose..."), teardowns, and the answer-first Q&A that is already
working. The payroll post is the template: a question as the H1, the answer in the first 60 words,
affiliate disclosure, then an on-this-page index.

‼️ **Drive it from the pillars, not from a fresh brainstorm.** `client_keywords` already carries
`role` (pillar/support) and an awareness stage per phrase, and `client_headlines` holds 33 generated
headlines per client. The format registry should take a pillar keyword and emit candidate headlines
per format, so the resources plan and the client page plan argue from one source.

### W3b. The weekly batch of 20

**The ask:** *"systematically once per week get headlines so we can select to make a batch of 20
posts, help me with those weekly messages in the onboarding pages as well with ideas for posts."*

A weekly Slack card: here are N headlines off the pillars, pick the ones you want, and the picks
become a batch. The precedent is step 21's headline lane end to end — `precall-headlines.ts` writes
33 and `headlines pick 4, 9, 12, ...` selects seven. Same grammar, different destination.

‼️ **`vercel.json` already carries 17 crons and the Hobby plan documents 2.** Read
`docs/prompts/2026-09-14-batch-drafting-production.md:173` before adding an 18th; fold this into an
existing weekly cron instead.

### W3c. The same engine for every new client

**The ask:** *"add this category for any new clients we get in the future so we build resources for
that ideal avatar, so we can use those as a hook for more content, and when they are inside we can
offer the lead magnet to convert them."*

The model is already there: `client_audiences` → `avatar_briefs` / `client_offers` →
`audience_documents` → `client_keywords` → `page_plan` → `client_pages`, and `lead_magnets` per
client. A client's resources plan is their avatar's pillars run through the same format registry,
with their magnet as the conversion step. **Do not invent a second content model next to the page
plan.** Extend the one that exists.

### W3d. The onboarding brain has to understand the whole strategy

The final prompt and the suggestion lane should both know that resources are a top-of-funnel hook
that feeds the magnet that feeds the offer. Today `suggestions.ts` argues about keywords, the ladder
and the board, and says page performance is **not measured**. That last one is still true and D9
still forbids arguing from a number nothing produced. **Resources traffic is the first real
performance signal available** — the Vercel numbers above are a measurement. Wire a real reader
before writing a suggestion that claims anything about it.

---

## W4. The resources look, and the preview variations

**The ask:** *"make sure the style of this page is matched with the new SRT Agency look from
srtagency.com, help me bring this resources page back."* And: *"use this layout as a potential
variation or an example of how I want the variations of the pages to generate when I click on the
step where we overlook how the pages we are going to post look and the review tool. This website is
more complete than those examples."*

Two halves:

1. **In `srt-agwb`:** bring `/resources` and the guide template onto the current site design (the
   dark nav, "Search Retrieval Tactics" wordmark, the ES toggle, the Free AI Audit button).
2. **In `srt-mission-control`:** offer this layout as a page variation at the preview step. The
   preview lane is `/preview/{token}?kind=site` and the hub templates are picked with
   `template <name>` in the step thread (`docs` and `project_hub_skin_templates` cover the four that
   exist). Add the resources/guide layout as a fifth, so step 21's preview and the review tool can
   show it.

‼️ The preview link scheme Matthew means by *"the opus lopus morpus corpus dropus soup of letters"*
is the **signed preview token** on `/preview/{token}` — `CLIENT_LINK_SECRET` mints it, and it is why
a preview opens before DNS exists. Keep using it; do not invent a second link format.

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx --env-file=.env.local scripts/_probe-final-prompt.ts
bunx tsx --env-file=.env.local scripts/_probe-step-rerun.ts
bunx tsx --env-file=.env.local scripts/_probe-suggestions.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
```

> A probe without `--env-file=.env.local` silently returns nothing. Not an error. Nothing.

`_probe-page-gate.ts` fails **two** checks today and both are pre-existing (`no_magnet` on a
throwaway page). Confirm the same two rather than assuming.

---

## Rules that have already cost a day each

- **One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather
  than throwing.** It shipped once this week and the feature silently did nothing while tsc, the
  build and every probe passed. Any lane that reads a table needs a live probe running the real
  select.
- **A guard a caller can switch off by omitting a key is not a guard.** That is exactly how ten spam
  contacts got in past a working honeypot.
- Write TypeScript containing regexes or escapes with the Write tool; heredocs and `sed` mangle escapes.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
