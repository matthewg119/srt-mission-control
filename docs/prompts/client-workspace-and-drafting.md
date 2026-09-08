# Build prompt: review tool, page-design picker, drafting workflow, per-client workspace

A build prompt for a fresh session. Everything in a **Ground truth** block was read in the repo on
2026-09-07 and is quoted, not remembered. Line numbers may drift; symbol names are right.

**Repo:** `Mission control 2.0/srt-mission-control`. Work in your own git worktree. Run
`git branch --show-current` before every commit. Read `docs/lanes/CONTRACT.md`, `CLAUDE.md`, and
`docs/specs/SRT-Review-Tool-BUILD-SPEC-v2.md` before writing code. `main` is at `d5a1443` or later.

**Also read `docs/prompts/offers-pipeline.md`.** The offers half of requirement 5 is specced there
in detail, including four structural problems. Do not re-derive it.

---

## Before you write any code

Four of these requirements collide with decisions that are written down in the repo with their
reasons. Your first output is not code. It is a short note saying, for each one, whether you are
reversing it and why, or whether the reason still holds and Matthew needs to hear it:

1. `review_destination` is documented as **a name and never a link**. He wants a link.
2. **Per-client channels were retired on 2026-08-20.** He wants one per client.
3. **No model in the review content path**, "not for drafting, not for cleanup, not for tone, not
   for spelling." He wants Hemingway-style grammar feedback on the review.
4. **There is no keyword volume source in the client lane.** He wants the 99 most searched terms.

---

## 1. The review tool, rebuilt as a chat

Today it renders four stacked textareas in unstyled default CSS while the hub beside it is themed.
Files: `src/app/hub/[host]/reviews/review-tool.tsx` (server) and `review-client.tsx` (client, 499
lines). Read the whole header of `review-client.tsx` before touching it. It is the negotiated
history of this exact feature.

### The flow, screen by screen

1. **Stars.** Unchanged.
2. **Mic priming, new.** Immediately after the stars, before any question: say what is about to
   happen and get the permission out of the way. Copy, close to Matthew's words: *"Next you will
   speak your review. It helps us understand what our clients actually need. Please accept the
   microphone permission on the next screen."* A spinner sits at the bottom reading **"waiting on
   microphone approval"**. A **Next button appears after 3 seconds** so anyone blocked, denied, or on
   a browser without the API is never stuck.
3. **The questions, as a chat.** One at a time, arriving as message bubbles as though a person is
   asking. A **green microphone button with an idle animation** inviting the tap: press, speak, and
   the transcript lands as her message. **A chat bar under it** so she can type instead. Yes/no
   shaped answers get tappable chips.
4. **The end screen.** Everything assembled, with the readability highlights, the attestation, the
   copy button and the destination link.

### Ground truth: the mic, and why it is this API

`review-client.tsx:62-81`, verbatim:

> ‼️ ON HER DEVICE, AND THAT IS THE WHOLE REASON IT IS THIS API AND NOT OUR TRANSCRIBER.
> `src/lib/clients/voice-notes.ts` has a working `transcribeAudio()` that posts bytes to OpenAI
> whisper-1. It must NOT be wired in here, and the argument is the schema comment on
> `review_tool_submissions`: that table has deliberately no column for a name, email, phone, IP,
> user agent or session id, and the ABSENCE OF THE COLUMN IS THE ENFORCEMENT. Uploading a
> customer's recorded voice, from a page on a client's own domain, is precisely the category of
> thing that table is built to be unable to hold. A voice is more identifying than any of the
> fields it refuses to store.
>
> The browser's SpeechRecognition keeps the audio on her phone. Nothing reaches our servers,
> nothing is recorded, and there is nothing to delete afterwards.
>
> Feature-detected on the client only. Chrome and Safari have it behind two different names;
> **Firefox has neither. Where it is absent the button is simply not rendered** and the keyboard is
> exactly as it was, no fallback, no upload path, no apology.

So: **keep `SpeechRecognition`, do not wire in `transcribeAudio()`, never construct a
`MediaRecorder`, never upload audio.** "The audio gets recorded and turned into text" happens
entirely in her browser.

**Priming the permission without holding a stream.** Either start `SpeechRecognition` and abort it
in the same tick, or call `getUserMedia` and stop every track immediately. Never hold an open stream
behind the spinner. Where `navigator.permissions.query({ name: "microphone" })` is supported, use it
to resolve the spinner the moment she grants; treat an unsupported query as unknown and fall back to
the 3 second timer.

**On a browser with no SpeechRecognition, skip screen 2 entirely.** Do not show a permission
interstitial for a capability that cannot be used. Go straight to the chat with the text bar and no
mic button, exactly as the file already does today.

### Ground truth: it must LOOK like the onboarding chat and must NOT work like it

`src/app/onboarding2/chat-bubble.tsx` is the shape to copy: full bleed, message bubbles, tappable
answers, three animated dots while it waits, two or three messages arriving staggered rather than at
once (`BUBBLE_GAP_MS` in `lib/onboarding2/texting.ts`). `CHAT_UI` in `src/config/onboarding2.ts`
holds its copy, and records that the waiting state is three dots and never a sentence claiming what
the model is doing.

**Reuse the look. Do not reuse the engine.** That component is driven by `runConversationWithTools`.
The review tool has no model in it and must not gain one. Its "chatbot" is a scripted walk of the
four fixed `REVIEW_QUESTIONS` in order: no generation, no branching on what she says, no network
round trip per turn. That is what keeps it on the right side of the FTC line, and it also makes it
instant, so there is no thinking delay to cover. The typing indicator is therefore a deliberate,
short, honest pause between scripted bubbles, not a wait for anything.

### Ground truth: nothing may branch on the rating

`review-client.tsx:23-36`, verbatim:

> THE STARS ROUTE NOTHING. Gating is a rating that decides whether she sees the public review link.
> Here every value 1 to 5 reaches the same questions, the same editable box and the same
> destination links... THE PRIVATE NOTE IS BELOW THE LINKS AND OFFERED TO EVERYONE. It adds a
> channel; it removes none. Conditioning it on a low rating would rebuild the gating funnel
> exactly. THE ATTESTATION GATES THE COPY BUTTON AND NOTHING ELSE.
>
> `scripts/_probe-review-gating.ts` asserts the first two by rendering the component at every rating
> and diffing the output. **If you add a branch that reads `rating`, that probe fails, and it is
> supposed to.**

The new priming screen and the new chat must be identical at 1 star and at 5. Run that probe.

### Ground truth: the FTC line, and the Hemingway pass

`src/lib/hub/review-assemble.ts` header, verbatim:

> THERE IS NO MODEL IN THIS PATH. Not for drafting, not for cleanup, not for tone, not for
> spelling... FTC 16 CFR Part 465 and the Rytr fact pattern: a tool that GENERATES review content
> its user did not write is the thing being regulated. A tool that REFORMATS what she typed is not.

And `review-client.tsx:11-21` records that Matthew already asked once for reviews rewritten to a
sixth-grade reading level with an emotional hook, was told why not, and chose two things instead:
the on-device microphone, and **"a READABILITY HINT that POINTS at long sentences and never supplies
different ones."** Both already exist. "Neither may quietly become the thing that was declined."

So the Hemingway end screen extends a hint that is already there, in one shape only:

- **Deterministic, in-browser, zero network, pure string work.** `src/lib/hub/readability.ts`
  exists; start there.
- **Highlight only. It never proposes replacement text.** A red box saying "this sentence is hard to
  read" is feedback on her writing. A red box saying "try this instead" is a tool generating review
  content.
- **Nothing auto-applied.** Submitting unchanged stays one tap.
- `REVIEW_QUESTIONS`, `QUESTION_SET_VERSION` (`v3`), `assembleLabelled()` and `assemblePlain()` stay
  byte-identical. If you want to edit `review-assemble.ts`, stop.

If you cannot build the highlighter without a model call, do not build it. Say so.

### Everything else the rewrite must keep

- Every question skippable. The copy promises "Answer whichever you like and skip the rest."
- The Spanish notice (`Estas preguntas aún no están disponibles en español`) and whatever drives it.
- The attestation gating the copy button, and the private note offered to everyone, below the links.
- `reviews.` stays `noindex`.
- `review_tool_submissions` gains no column for a name, email, phone, IP, user agent or session id.
- The live isomorphic preview: what she reads and what is stored come from the same function.

### The skin, and three variations

It is served on `reviews.{domain}` off the same client record and inherits nothing today. **Reuse
`skin.ts` and `theme.ts`** so it carries the client's own look, the same tokens the hub uses. Do not
invent a second styling path.

Build **three visual variations** of the chat flow to pick from, and **make the plain default look
good on its own**, because that is what everyone sees before anybody picks.

## 2. The review destination link

**Ground truth.** `clients.review_destination_primary` exists, is written at
`src/app/api/onboarding/save/route.ts:193`, and is read by `review-tool.tsx:31` and
`artifacts/call-sheet.ts:557`. There is also a `review_workflow` jsonb bag.

`src/lib/onboarding2/delivery.ts:200-202` says of it:

> The column, alongside the bag above. Both already have readers; see the note by
> `reviewWorkflow.destinations` for why this is **a name and never a link**.

Read that note. Matthew wants a real URL, per client, set in Mission Control, that the finished
review page offers as "copy this and go leave it". Either the reason no longer holds and you record
why in the migration header, or it still holds and you say so. Do not quietly add a
`review_destination_url` beside a column whose own documentation forbids being one.

Wherever it lands it needs a control on the client board, beside the Theme and Hub panels in
`src/app/dashboard/clients/[id]/page.tsx`, and it must be readable by the review tool.

## 3. The page-design picker: screenshot in, three variations out

This is the change to how step 15 completes, and it repeats at step 18.

**What Matthew wants:** upload an image of the ideal page. An automation returns **three
variations**. He picks one. That pick becomes **the default page design for every page drafted for
that client from then on**, and it is one of the datasets that hangs off a client alongside their
offers, avatars and magnets. The current look stays available as the default for anyone who does not
pick.

### Ground truth: this is legal, and the schema is why

`src/lib/hub/skin-vision.ts` header, verbatim:

> ‼️ IT RETURNS TOKENS. IT CANNOT RETURN MARKUP, COPY OR A LAYOUT, AND THE SCHEMA IS WHY. `SkinRead`
> has no field for HTML, no field for a headline, no field for a section order and no field for a
> CSS rule. This is the same enforcement `HubTheme` uses, the type, not a sentence in a prompt.

It runs on Haiku, returns one `SkinRead` (template + radius + measure + base size + a one-line
`reading`), reports an `accentSuggestion` it never writes, and everything is re-validated by
`readSkin()` in `skin.ts` before storage. Four templates ship: `document`, `clinic`, `editorial`,
`bold`.

**So three variations means three token sets, not three layouts.** Vary template choice, ground
colours, radius, measure and type scale around what the image reads as. Render all three as real
previews, side by side, and let him pick. Nothing about `hub-bodies.tsx`, the heading order, the
JSON-LD or the canonical NAP block changes in any variation. If you find yourself wanting a fourth
template, adding one is a code change on purpose.

- **Step 15 (`hub_preview`)** already accepts `template <name>` and a pasted screenshot in its
  thread. Extend that to produce three, and make the pick the thing that satisfies "theme
  confirmed", instead of today's bare confirm.
- **Step 18 (`site_replica`)** is where a screenshot of their real site belongs, because that step
  already reads their nav and rebuilds every section. Offer the same three-variation pick there.
- **Persist the pick** as the client's page design so `draft-page.ts` and the studio use it for
  every later page. `clients.hub_skin` is where a skin already lives; decide whether the three
  candidates need their own table or whether storing the chosen one plus the `reading` is enough,
  and justify it.

**Also do the small honest fix Matthew asked for first: make the default look better.** The current
review tool default is unstyled. That is the baseline everyone sees before anybody picks anything.

## 4. Keywords: the 99 most searched, from the offer and the avatar

**Ground truth, and this is the requirement with no existing foundation.** From
`docs/prompts/offers-pipeline.md`:

> There is no keyword research. No volume API touches the client lane. Scores come from a
> deterministic hand-written formula plus a human pasting a `KEYWORDS` block into Slack.
> `src/lib/scraper/dataforseo.ts` exists but belongs to the lead-prospecting scraper and is billed
> per task.

What exists instead: `question_bank` (63 rows, global by vertical, `avatar` NULL on all of them),
`page_candidates` per client with `themeOf()` clustering and `deriveIdeas()`, the audit's 20 real
questions, and the avatar deep research.

**Matthew wants the 99 most searched terms, derived from the offer and the avatar's market
research, captured during the onboarding call.** Two honest ways to do that, and he needs to choose:

- **Wire `dataforseo.ts` into the client lane.** Real search volume, real per-task cost, multiplied
  by 30 onboardings a day. Price it out loud before building.
- **Derive from what we already have** and never call it search volume. The 20 audit questions plus
  `question_bank` plus the avatar research produce the market's own wording, which is arguably
  better for AEO than a keyword tool, because it is what people actually type at an assistant.

Say which you recommend and why. Do not ship something labelled "most searched" that is a model's
guess at popularity: that is a number with no provenance, and this codebase's whole posture is that
a claim carries how it was measured.

Wherever the list comes from, `lead_magnets.treatment` is the per-offer axis it should light up, and
`[treatment]` substitution in the page-candidate chain is the hook. Both are documented in the offers
prompt, and that axis is currently dead at all six query sites.

## 5. The drafting workflow: "Write a page" moves to Slack

**Ground truth.** The Slack page studio already exists: `src/lib/clients/page-studio.ts`, channel
`SLACK_PAGE_STUDIO_CHANNEL` (default `C09QPHZGPUY`, `#aeo-seo-page-drafting`), opened by typing
`page <client>`. Claiming a page there drafts five magnets (`page-studio.ts:430-432`); `magnet more`
at `:845` drafts more.

The dashboard's "Write a page" opens an inline form whose save path is `savePage`
(`src/lib/hub/pages.ts:184-253`) via the `page_save` action in
`src/app/api/clients/[id]/hub/route.ts`. **That path drafts no magnets at all.** Requirement 5 fixes
that by construction: the button hands off to the studio, so there is one drafting path instead of
two.

The order Matthew wants, as a resumable session in the studio thread, not one giant modal:

1. **Offer.** One of this client's offers, or one of the stock offers. Stock is the seven library
   rows in `lead_magnets` where `client_id IS NULL`; `rungOf()` in `src/lib/concierge/magnets.ts`
   already scores client rows above library rows.
2. **Avatar.** Pick one, or **create a new one right there**. He explicitly does not want a separate
   avatar channel.
3. **Headlines and the strategy questions**, against the keyword set from requirement 4.

### Ground truth: avatars are shared across clients on purpose

`avatar_briefs` is keyed `(vertical, avatar_slug)` and **has no `client_id`**
(`docs/2026-08-25-lane-2-avatar.sql:31-49`): the second med spa aiming at laser hair removal gets
the first one's deep research instead of paying for the run again, and `times_reused` counts it.
`client_avatar_runs` is the per-client side.

So "create a new avatar" means adding a `(vertical, avatar_slug)` row and running the research once,
after which every later client in that vertical inherits it. The research already exists as step 10
`avatar_harvest`: `prompt` hands back the prompt to paste into claude.com, `run` does it here on
Haiku for about a dollar. **Reuse both. Do not write a third researcher.**

## 6. Every button offers its next step

Treat this as acceptance criteria, not a nice-to-have. He called it out specifically, and it is the
thing most likely to be skipped.

Every Mission Control button that starts something, and every workflow card that completes, ends by
printing what can be done next. **The precedent is already in the repo:** the step 15 thread prints
its four `template <name>` options, the screenshot lane, the preview link and the confirm link, all
in one card. Copy that shape. A card that completes and offers nothing is the bug being fixed.

## 7. A channel per client, holding everything

**Ground truth, and this reverses a documented decision.** `src/lib/clients/onboarding-docs.ts:40`:
"per-client channels were retired on 2026-08-20." `docs/CONTINUATION-33-step-threads.md:87` and
`docs/CONTINUATION-step-board-fixes.md:214`: "Slack is INTERNAL only. There are no per-client
channels and no guest invites."

**Read both before building, because the retired thing may not be the requested thing.** What was
retired was CLIENT-FACING channels, blocked because guest invites cannot be automated below
Enterprise Grid at any plan tier (see `project_client_onboarding_build` and
`src/lib/clients/provision.ts`, which still creates a private channel in the separate Client Hub
workspace). Matthew is asking for an INTERNAL channel only SRT sees. The guest-invite blocker does
not apply. Two real constraints do:

- **Volume.** The seat cap was removed on 2026-09-07 and the target is 30 onboardings a day. That is
  30 new channels a day, on top of 39 step anchors per client in `#onboarding-srt-aeo`. Say out loud
  what that costs against Slack's `conversations.create` and `chat.postMessage` tiers, and decide
  whether the board should MOVE into the per-client channel rather than be duplicated into it.
- **One anchor at a time.** `reachableCursor` in `step-engine.ts` is the single answer to what may
  appear and all three schedulers gate on it. A per-client channel must not become a second,
  ungated surface that dumps the whole backlog.

What it holds, per Matthew: offers, avatars, workflows, pages, concierge settings, lead magnets, and
**a list of every option so anything can be set up from there**. Build that index as one pinned,
re-rendered message, the same pattern as `refreshHeader` in `step-board.ts`, not as a wall of posts.

---

## Invariants. Do not loosen any of these.

- **No model in the review content path.** FTC 16 CFR Part 465. `review-assemble.ts` stays pure
  string work with no imports. No model may propose review text, and no recorded voice may leave the
  visitor's device.
- `review_tool_submissions` has no column for name, email, phone, IP, user agent or session id. The
  absence is the enforcement.
- `skin.ts` and `skin-vision.ts` carry tokens only. The markup is not themable and must never become
  themable. The type is the enforcement, not a sentence in a prompt.
- A green tick over unchecked work is the worst bug this design can have. `verified_source` is
  `system` or `thread`, there is no third value and no override. A thread-tier line may describe
  only the artifact it found, never the fact it stands for.
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
- `copy-guard`'s dash ban, and a `---` markdown rule is not a dash (`withoutRules()` in
  `draft-replica.ts`; the ten proving cases are in `scripts/_probe-page-gate.ts:195-222`).
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

Then prove it on SRT, resolved **by slug** (`srt-agency-llc`, never a pinned id):

- The review tool renders one question at a time, in the client's skin, stars first, mic permission
  asked once before question one, keyboard always reachable, and nothing rendered on Firefox that
  cannot work there.
- The end screen shows the assembled review with deterministic readability highlights, no suggested
  replacement text, a copy button, and the client's destination link.
- A screenshot dropped in step 15's thread returns three previewable variations, and picking one
  both completes the step and sets the design future pages draft against.
- "Write a page" in Mission Control lands a card in `#aeo-seo-page-drafting` that walks offer, then
  avatar, then headlines, with a working "create a new avatar" branch.
- Every card offers its next step.
- The client channel lists every option in one pinned message.

`scripts/_reset-client-board.ts srt-agency-llc --dry` shows what a fresh rehearsal would touch if you
need to walk the whole board again. It backs up before it deletes and takes a slug, not an id.
