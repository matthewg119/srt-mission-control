# Build prompt: the review tool, the drafting workflow, and a per-client workspace

A build prompt for a fresh session. Everything in the "ground truth" blocks was read in the repo on
2026-09-07, not remembered. Line numbers may drift; the symbol names are right.

**Repo:** `Mission control 2.0/srt-mission-control`. Work in your own git worktree. Run
`git branch --show-current` before every commit. Read `docs/lanes/CONTRACT.md` and `CLAUDE.md`
first. `main` is at `7a0ebe4` or later.

**Read `docs/prompts/offers-pipeline.md` before starting.** The offers half of requirement 4 below
is already specced there in detail, including the four structural problems. Do not re-derive it.

---

## What Matthew asked for, in his words, numbered

1. The review tool should be a **Typeform-style page template**: one question at a time, full
   screen. Every review page we generate for every client uses that format.
2. **Lock in the link where their reviews get sent**, set inside Mission Control.
3. The **"Write a page" button** in Mission Control should stop opening an inline form and instead
   **fire a message into the drafting channel**.
4. That Slack flow is a guided workflow, in this order: **offer, then avatar, then the headlines and
   the questions of the strategy** (the targeted keywords we post against). Every client goes
   through it at onboarding so the mapping is right.
5. **Creating a new avatar is an option inside that workflow**, not a new channel.
6. **Every Mission Control button that starts something must offer the next steps** once clicked.
   Nothing should dead-end.
7. **Each onboarded client gets its own channel**, carrying all of it: offers, avatars, workflows,
   pages, concierge settings, lead magnets. Always a list of every option, so anything can be set
   up from there.
8. The hub built at step 15 **looks nothing like his real website**.

---

## Requirement 8 first, because it is a misunderstanding and not a bug

**Ground truth.** `src/lib/hub/skin.ts` header, verbatim:

> ‼️ THE MARKUP IS NOT THEMABLE AND MUST NEVER BECOME THEMABLE. Every field below lands in a CSS
> custom property or a class name. Nothing here is markup, nothing here is copy, and there is
> nowhere to put either. That is not squeamishness: the hub's whole product is being crawled and
> quoted, and the JSON-LD, the heading order and the canonical NAP block in hub-bodies.tsx are what
> make that true.

The screenshot lane exists and is live: `src/lib/hub/skin-vision.ts`, driven from the step 15
thread, alongside four named templates in `HUB_TEMPLATES` (`document`, `clinic`, `editorial`,
`bold`). Pasting a screenshot reads **colours, corner radius, column width and type scale** off it.
It cannot and must not change layout.

So the hub will never look like his website, by design. **Do not "fix" this by making the skin carry
markup.** The thing that mirrors a client's own site already exists and is a different step:
`site_replica` (step 18), `src/lib/clients/site-replica.ts`, which reads their nav and rebuilds
every section. If Matthew wants the hub to feel closer to his brand, the honest levers are the
Theme panel (his logo, accent, font, extracted from his homepage) and the four templates.

**What IS worth building here:** the review tool currently has no skin at all. See requirement 1.

---

## Requirement 1: the review tool as a Typeform template

**Ground truth, and the hard rail.** `src/lib/hub/review-assemble.ts` header, verbatim:

> THERE IS NO MODEL IN THIS PATH. Not for drafting, not for cleanup, not for tone, not for spelling.
> That is the single most important line in the spec and the reason this file is pure string work
> with no imports.
>
> FTC 16 CFR Part 465 and the Rytr fact pattern: a tool that GENERATES review content its user did
> not write is the thing being regulated. A tool that REFORMATS what she typed is not.

`CLAUDE.md` states it again as an invariant: **no model goes near `review-assemble.ts` or the review
tool.**

**Read that as a line around the CONTENT path, not around the CSS.** Changing the form from four
stacked textareas to one question per screen is presentation. It touches no answer, invents no text,
and must leave `REVIEW_QUESTIONS`, `QUESTION_SET_VERSION` (`v3`), `assembleLabelled()` and
`assemblePlain()) byte-identical. If your change makes you want to edit `review-assemble.ts`, stop:
you have crossed the line.

Files: `src/app/hub/[host]/reviews/review-tool.tsx` (server) and `review-client.tsx` (the client
component that previews the assembly as she types). The preview-as-you-type behaviour is load
bearing and isomorphic on purpose: what she reads and what is stored come from the same function.

Things a one-question-at-a-time rewrite must not lose:
- Every question is skippable. The current copy promises "Answer whichever you like and skip the rest."
- The Spanish notice (`Estas preguntas aún no están disponibles en español`) and whatever drives it.
- "Speak instead" on every question.
- The star rating, and `docs/…review-rating.sql` non-routing review stars: stars do **not** route
  anybody anywhere. See `project_booking_first_onboarding2` and the review-workflow lane.
- `noindex`. `reviews.` is the review tool only and is never indexed.

**Give the review tool the skin the hub already has.** It is served on `reviews.{domain}` off the
same client record, and today it inherits nothing. Reuse `skin.ts` and `theme.ts` rather than
inventing a second styling path; that is the whole reason those two files are disjoint sets of CSS
variables.

## Requirement 2: locking the review destination

**Ground truth, and there is a deliberate decision to confront before you build.**
`clients.review_destination_primary` already exists, is written at
`src/app/api/onboarding/save/route.ts:193`, and is read by `review-tool.tsx:31` and
`artifacts/call-sheet.ts:557`. There is also a `review_workflow` jsonb bag.

`src/lib/onboarding2/delivery.ts:200-202` says of it:

> The column, alongside the bag above. Both already have readers; see the note by
> `reviewWorkflow.destinations` for why this is **a name and never a link**.

Go read that note before adding a URL column. Matthew is explicitly asking for a link, so either the
reason no longer holds and you record why in the migration header, or the reason still holds and you
tell him plainly what it is. Do not quietly add a `review_destination_url` next to a column whose
own documentation says it must not be one.

Wherever it lands, it needs a control on the client board, next to the Theme and Hub panels in
`src/app/dashboard/clients/[id]/page.tsx`.

## Requirements 3 to 6: the drafting workflow

**Ground truth.** The Slack page studio already exists: `src/lib/clients/page-studio.ts`, channel
`SLACK_PAGE_STUDIO_CHANNEL` (default `C09QPHZGPUY`, `#aeo-seo-page-drafting`), opened by typing
`page <client>`. Claiming a page there already drafts five magnets
(`page-studio.ts:430-432`). `magnet more` at `:845` drafts more.

The dashboard's "Write a page" opens an inline form instead, whose save path is
`savePage` in `src/lib/hub/pages.ts:184-253`, reached through the `page_save` action in
`src/app/api/clients/[id]/hub/route.ts`. **That path drafts no magnets at all**, which is the gap
`docs/prompts/offers-pipeline.md` already documents. Requirement 3 fixes it by construction: if the
button hands off to the studio, there is one drafting path instead of two.

**The order Matthew wants is offer, then avatar, then headlines and questions.** Build it as a
resumable session in the studio thread, not as one giant modal:

- **Offer.** Pick one of this client's offers, or one of the stock offers. Client offers are the
  subject of `docs/prompts/offers-pipeline.md`; read it. The stock set is the seven library rows in
  `lead_magnets` where `client_id IS NULL`. `rungOf()` in `src/lib/concierge/magnets.ts` already
  scores client rows above library rows.
- **Avatar.** Pick one, or create one. `avatar_briefs` is keyed `(vertical, avatar_slug)` and is
  **shared across clients on purpose**: the second med spa aiming at laser hair removal gets the
  first one's deep research instead of paying for the run again. `times_reused` counts that. So
  "create a new avatar" means adding a `(vertical, avatar_slug)` row and running the deep research
  once, and every later client in that vertical inherits it. `client_avatar_runs` is the per-client
  side. The research itself is step 10 `avatar_harvest`: `prompt` hands back the prompt to paste
  into claude.com, `run` does it here on Haiku for about a dollar. Reuse both, do not write a third.
- **Headlines and questions.** `question_bank` is global by vertical (63 rows, all
  `vertical='aeo-agency'`, `avatar` NULL on every one) and `page_candidates` is per client with
  `themeOf()` clustering and `deriveIdeas()`. The `[treatment]` substitution in that chain is the
  hook for the offer chosen in step one, and `lead_magnets.treatment` is the axis it should light
  up. Read the offers prompt: that axis is currently dead at all six query sites.

**Requirement 6 is the one most likely to be skipped, so treat it as acceptance criteria.** Every
button and every workflow step ends by printing what can be done next. The precedent is already in
the repo: the step 15 thread prints its four `template <name>` options plus the screenshot lane plus
the preview link plus the confirm link. Copy that shape. A card that completes and offers nothing is
the bug being fixed.

## Requirement 7: a channel per client

**Ground truth, and this reverses a documented decision.**
`src/lib/clients/onboarding-docs.ts:40`: "per-client channels were retired on 2026-08-20."
`docs/CONTINUATION-33-step-threads.md:87` and `docs/CONTINUATION-step-board-fixes.md:214`: "Slack is
INTERNAL only. There are no per-client channels and no guest invites."

Read both before you build. **The retired thing and the requested thing may not be the same thing.**
What was retired was CLIENT-FACING channels, and the blocker was that guest invites cannot be
automated below Enterprise Grid at any plan tier (see `project_client_onboarding_build` and
`src/lib/clients/provision.ts`, which still creates a private channel in the separate Client Hub
workspace). Matthew is asking for an INTERNAL per-client workspace channel that only SRT sees. That
is a different proposition and the guest-invite blocker does not apply to it.

But two real constraints do:

- **Volume.** The seat cap is gone and the target is 30 onboardings a day. That is 30 new channels a
  day, and `#onboarding-srt-aeo` already carries 39 step anchors per client. Say out loud what this
  costs at that rate before building it, including Slack tier limits on `conversations.create` and
  `chat.postMessage`, and whether the board should move into the per-client channel rather than be
  duplicated into it.
- **One anchor at a time.** `reachableCursor` in `step-engine.ts` is the single answer to what may
  appear, and all three schedulers gate on it. A per-client channel must not become a second,
  ungated surface that posts the whole backlog.

What the channel holds, per Matthew: offers, avatars, workflows, pages, concierge settings, lead
magnets, and **a list of every option so anything can be set up from there**. Build that index as
one pinned, re-rendered message, the same pattern as the board header (`refreshHeader` in
`step-board.ts`), not as a wall of posts.

---

## Invariants. Do not loosen any of these.

- **No model in the review content path.** FTC 16 CFR Part 465. `review-assemble.ts` stays pure
  string work with no imports.
- `skin.ts` is CSS custom properties only. The markup is not themable and must never become themable.
- A green tick over unchecked work is the worst bug this design can have. `verified_source` is
  `system` or `thread`, there is no third value and no override.
- The tool proposes, a person confirms. Anything a model reads off a screenshot lands in a
  `proposed_*` slot.
- Ambiguity stays null and says so. Zero matches and two matches are the same answer.
- One anchor at a time. Slack is INTERNAL only. Edit anchors, never re-post: Slack orders by post
  time, so a delete-and-repost moves a step to the bottom of the channel permanently.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything goes through `bodySections()`.
- The Day 0 wall: `page_publish` refuses while `clients.day_0_archived_at` is null, and the check
  goes BEFORE `setPublished`, which has exactly one caller.
- A step must appear LATER in `DELIVERY_STEPS` than everything it names in `blockedBy`.
  `scripts/_probe-step-verify.ts:80-89` asserts it. Violating it empties `reachableCursor` and
  silently stops the whole board for every client.
- `STEP_VERIFIERS` is `Record<StepKey, Verifier>` and must stay exhaustive.
- No em dashes anywhere. Paste every migration as a fenced sql block in chat, never a file path.

## Verification

```
bun run build
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts
```

Without `--env-file=.env.local` the probes return nothing at all. Not an error. Nothing.

Then prove it on SRT, resolved **by slug** (`srt-agency-llc`, never a pinned id): the review tool
renders one question at a time in the client's skin, the destination is set from Mission Control and
read back on the tool, "Write a page" lands a workflow card in the drafting channel, that card walks
offer to avatar to headlines, a new avatar can be created inside it, every card offers its next
step, and the client channel lists every one of those options in one pinned message.

`scripts/_reset-client-board.ts srt-agency-llc --dry` shows what a fresh rehearsal would touch if
you need to walk the whole thing again. It backs up before it deletes and takes a slug, not an id.
