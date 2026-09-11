# One strategy per client: the offer is the root, 9 pages are ready before the call

A build prompt for a fresh session, written 2026-09-11 from two sessions' findings. Everything below
was checked against the repo and prod that day. Line numbers drift; symbol names do not.

## Goal, in Matthew's words

"I want 9 pages ready before we actually even talk to the customer on the phone." "We need to make
sure the keywords are directly correlated with the offer that the customer wants to sell." "Help me
combine these ideas and make them all feed off each other and be interconnected so we can run the
whole strategy as 1 for each customer."

So one chain, per client, in this order, every link feeding the next:

```
prep call (offer locked)  ->  keywords aimed at that offer  ->  page plan: 1 pillar + 8 supports
  ->  9 full drafts, each with a magnet that frames the anchor offer  ->  pages linked to each other
  ->  hub + review tool + concierge previews, all openable with NO DNS  ->  the onboarding call
  ->  DNS added on the call  ->  Day 0  ->  publish
```

## Repo and where to work

`Mission control 2.0/srt-mission-control`. **Continue in the worktree
`C:/Users/matth/Desktop/Code/_wt-page-plan`, branch `feat/page-plan`.** It holds an UNCOMMITTED
build from 2026-09-11 (below) that this work sits on top of. First act: read `git diff` there, run
its probe, and commit it on `feat/page-plan` as its own commit before changing anything else.

Other sessions share the main checkout. Never `git add -A`. Run `git branch --show-current` before
every commit. Read `CLAUDE.md` and `docs/prompts/offers-pipeline.md` (Matthew's 09-07 brief: "every
offer gets its own page, keyword-derived sub-pages beneath it, and a lead magnet per page") before
writing code. This build is that brief, made concrete.

### What the uncommitted 09-11 build already does (do not rebuild)

- `docs/2026-09-11-page-plan.sql` (**NOT RUN YET**): `page_plan` table, `lead_magnets.frames_key`,
  `page_magnet_candidates.frames_key`, `client_pages.outline`.
- `src/lib/clients/page-plan.ts`: `selectPlan` (pure, spread across themes), `framePages` (one
  model call that words chosen pages, keyword must come from the set), propose/approve/drop/swap/edit.
- `offers.ts` `setAnchorMagnet`: the first writer of `offer.magnetKey`. The anchor is the one offer
  every page's magnet frames (SRT: `visibility_scan`, asset `https://srtagency.com/scan`).
- `magnet-drafts.ts` anchored mode: five FRAMINGS of the anchor instead of five unrelated offers.
  `magnets.ts` `deliveryUrlFor`/`anchorOf`/`framesKeysOf`: a framing hands over the anchor's asset
  and chain; the engine excludes an anchor once a framing of it was delivered.
- `draft-page.ts` `draftOutline` + `outlineFaults`; `draftPage` follows an outline when given one.
- Page studio: `anchor:`, `plan ...`, `outline`, gap walk (`evidence_topic = gap:G1`), `undo`,
  `add:`, digit guard, digits claim by plan rank.
- `page-candidates.ts`: shared `offerBonus()`, and stale candidate rows are pruned every run.
- Probes: `scripts/_probe-page-plan.ts` (all green), `_probe-page-studio.ts`, `_probe-magnet-drafts.ts`.
- tsc and `bun run build` were green.

## Decisions already made by Matthew (do not re-ask)

| # | Decision |
|---|---|
| D1 | **Lock the offer BEFORE the call**, via a new prep-call step (workstream A). |
| D2 | **9 pre-call pages: 1 pillar + 8 supports.** The pillar is the offer page. |
| D3 | **Full drafts, no gaps**, written from what is on file. Drafts only; nothing publishes before Day 0 and the gate. |
| D4 | **Every page's magnet is the anchor offer in disguise** (SRT: the AI visibility audit). |
| D5 | **Previews first, DNS later.** Hub, review tool and concierge must all be viewable before the call with no DNS. Client DNS is added ON the call, as today. |
| D6 | **Mic permission is requested on the tap** that leads to voice (the Next button), never on a later spinner. Applies to every voice surface from now on. See memory `feedback_mic_permission_on_tap`. |
| D7 | Drafting pages belongs to the ONBOARDING workflow (delivery steps), not only the Slack page studio. The studio is where a person finishes them. |

Defaults you may take without asking, stated here so they are decisions and not accidents:
- On the call the drafts are shown by screen-sharing the internal dashboard preview. The tokenised
  client link stays draft-free (existing rule in the preview code).
- The 9 are month one. A1 (`docs/specs/SRT-Pilot-Amendment-A1-Volume-and-Harvest.md`) sells 4+4
  (Core) or 8+8 (Complete) a month and tags anything above the sold count `over_delivery`. If the
  scope column does not exist yet, add it with this build and tag page 9 onward on a Core client.
- URLs stay flat. `HUB_SLUG` in `middleware.ts` forbids a slash and that is a security rule about
  hostnames a client's registrar controls. Hierarchy is expressed with links and BreadcrumbList,
  not nested paths.

---

## Workstream A: the prep call, and the offer locked before any page exists

**Why.** `offer_locked` is step 23, blocked by `call_booked`, so today every page candidate, the
keyword set and the plan are built on a PROPOSED offer read off an intake field. For SRT that
proposal was the top line of a services menu. Matthew: "lets lock the offer before the call, give me
a reminder to call the client in any step to call them and ask what the offer is and say we are
getting prepared for our call, this will increase show rates."

Build:
1. Move `offer_locked` (KEY UNCHANGED, renaming orphans rows) to right after `offer_proposed` in
   `DELIVERY_STEPS`, drop `call_booked` from its `blockedBy`, relabel it as the prep call. It must
   stay later than everything in its `blockedBy` (`_probe-step-verify.ts` asserts it; violating it
   silently stops the whole board). Phases must stay contiguous.
2. Its card is a call reminder: the client's name and phone as a `tel:` link, a RingOut button if
   the existing RingOut path can be reused for a client row (look for the speed-to-lead RingOut code
   before building anything), and a short script with these beats: we are preparing your preview for
   our call; which ONE service do you want more of; what do your customers call it; how do you want
   to be known for it. No em dashes in the script.
3. The answer is typed into the step thread: `offer: <what they sell> | <positioning>` already works
   there (`handleOfferThreadReply`, `OFFER_STEPS`). Add a way to capture **offer terms**: the words
   customers use for it (e.g. `terms: lip flip, lip filler, lip injections`). Store them on the offer.
   They are what makes keyword relevance real (workstream B).
4. `custom_question_set`, `page_candidates` and everything downstream that reads the offer must be
   blocked by `offer_locked`, not `offer_proposed`, and must re-run when the lock changes.
5. Verifier: system tier, `isLocked(offer)`. A lock with no terms is still a lock, but the card says
   the keyword match will be weaker.

## Workstream B: keywords that are about the offer, not about the vertical

**The measured problem.** Relevance is a +10 bonus when the normalised phrase CONTAINS the whole
normalised treatment string (`offerBonus` in `page-candidates.ts`). For SRT the treatment is "AEO
Services for med spas", which almost no phrase contains verbatim, so in practice nothing is aimed at
the offer. For a med spa, "Lip filler" works; "Russian lip technique" does not.

Build an offer-relevance test, deterministic, no model, used by the plan:
- A phrase is ABOUT the offer when it contains the treatment or any offer term (normalised), OR it is
  one of the offer-independent buying shapes (price, "is it worth it", "does it hurt", "near me",
  booking) asked about the offer. Keep one definition, export it, probe it.
- The plan's pillar keyword is the offer plus the city when the business is local.
- All 8 supports must pass the relevance test. When the corpus cannot supply 8 relevant phrases, the
  plan says so and proposes fewer, and names what to do (run the deep research KEYWORDS block for
  this offer). It never pads with vertical questions. A short honest plan beats a padded one.
- Keep the existing ranking otherwise: SCORE_TERMS in `page-candidates.ts` (intent x10, ln(1+freq)
  x4, objection +12, not named by any engine +15, in own reviews +8) plus the offer bonus.
- Do NOT add DataForSEO volume. `keyword-set.ts`'s header explains why (Google Ads volume is the
  wrong denominator for conversational questions) and Matthew accepted it.

## Workstream C: the pillar and the links (traffic from page X to page Y)

**What exists.** The hub index is a flat list; each page links only back to the index
(`src/components/hub/hub-bodies.tsx`). `draft-page.ts` bans links inside `answer_md` and that ban is
enforced in code on purpose (a model inventing a citation as a link). Keep the ban.

Build, template-side:
1. `page_plan` gains `role` (`pillar` | `support`) and whatever you need to express which pillar a
   support belongs to (a client may later have more than one offer, so do not hardcode "one pillar
   per client"). Write the columns in the migration header with the reason.
2. The hub page template renders the links from the plan, never from the body:
   - pillar: a section linking every published support, with the support's working title as anchor text.
   - support: a "part of" link to its pillar at the top, and 2 related supports (same pillar,
     nearest theme) at the bottom.
   - the hub index leads with the pillar.
   - Only PUBLISHED pages are ever linked. A link to a draft is a 404 on a live client domain.
3. `BreadcrumbList` JSON-LD on supports (hub > pillar > page), next to the existing `QAPage`
   (`src/lib/hub/jsonld.ts`). Keep one `<h1>`.
4. Main site to hub: `docs/specs/SRT-AEO-Client-Onboarding-SOP.md:243` "the interlink is what passes
   authority in both directions". Hub to main already exists via NAP and `sameAs`. Record the main
   site to pillar link as a checklist item on the step where the hub goes live, with a verifier that
   actually fetches the client's homepage and looks for a link to the pillar URL. No green tick
   without the fetch.
5. Provider schema (`Person`/`Physician`) only from evidence on file (the `qualifications` interview
   topic, intake). Never invented. If nothing is on file, no provider node.
6. Every page carries its magnet (the anchor framing). The pillar's frame is the plainest statement
   of the anchor; supports frame it through their topic.

## Workstream D: the 9 drafts, written inside onboarding

Build a delivery step after the plan (and after the offer lock) that:
1. Proposes the plan: 1 pillar + 8 supports (`PLAN_SIZE` stays 20 for the studio; the pre-call plan
   is 9). Posts it in its step thread with `plan approve` / `plan swap N` / `plan drop N` working
   there too (reuse the studio's functions, do not copy them).
2. After approval, writes all 9 as FULL DRAFTS with `draftPage` from what is on file, saves each as a
   `client_pages` draft through the existing writers WITH its `evidence_map` (a drafted page must keep
   its map; see `SavePageInput.evidenceMap`), links each to its plan row, and mints the plan row's
   magnet frame as the page's magnet (the frame was approved with the plan; reuse
   `approveMagnetCandidate`, which holds the only insert into `lead_magnets` in `src/`).
3. Runs in waves inside the route's time budget and is resumable: a page already drafted is skipped
   on re-entry, never redrafted over edits. Check what `maxDuration` the runner has.
4. Posts one summary with the dashboard preview link and, per page, its keyword and how many claims
   have no source (those are what the gate will block later).
5. Verifier: counts the 9 drafts linked to approved plan rows. Thread tier is not acceptable for this;
   it is observable state, so system tier.
6. The call sheet (`call_sheet`) must read the plan and list the 9 so the call walks them.

A page whose evidence is thin comes out short. That is correct (rule 7 of the drafter's prompt) and
must not be "fixed" by loosening the gate.

## Workstream E: previews before the call, with no DNS

**Verified 2026-09-11.** `concierge.srtagency.com`, `learn.srtagency.com` and
`reviews.srtagency.com` are NXDOMAIN. But the internal host already serves `/w/[slug]` and
`/api/concierge/*` with no extra configuration (`src/lib/hub/host-classify.ts`, internal branch), and
a switched-off widget opens for a signed preview token (`src/lib/concierge/preview-grant.ts`, param
`pt`, HMAC with `CLIENT_LINK_SECRET`, 14 days). So previews need NO DNS. What is broken:

1. **Step 18 (`concierge_preview`) posts a dead link.** `step-engine.ts` builds it with
   `conciergeFrameUrl()` (`concierge-setup.ts`), which names `concierge.srtagency.com` and carries no
   token. Build the preview URL on the internal origin with a preview token, and check it answers
   before posting it (the site replica card already does this; reuse it).
2. **The loader points at the dead host.** `conciergeOrigin()` (`src/lib/concierge/origin.ts`) returns
   `concierge.srtagency.com` in production. On a PREVIEW render (a request carrying a valid preview
   token), `embed.js`, the frame and the tracked booking link must all name the internal origin, and
   all three must agree (the file's own header explains why). Live client pages must be unchanged.
3. **Confirm `CLIENT_LINK_SECRET` is set in production** (read through the Vercel REST API; see memory
   `reference_vercel_env_cli_gotcha`). Unset means every preview link is null.
4. **Step 17's green tick is false.** `step-verify.ts` returns "`<host>` answered a live request"
   having made no request (it checks the theme is confirmed and a host row exists). Make it observe:
   before DNS, fetch the tokenised preview URL; after DNS, fetch the real host. Never claim a request
   that was not made.
5. The one-time SRT infra record `concierge.srtagency.com` (a CNAME at GoDaddy; Vercel already has
   the host attached) is needed only when a widget goes LIVE on a client site. It does not block
   previews. Give Matthew the exact record in the final message; do not add it yourself.

## Workstream F: the review tool's microphone

`src/app/hub/[host]/reviews/review-client.tsx` and `review-tool.tsx`. The priming screen starts and
aborts a `SpeechRecognition` from a `useEffect` in the same tick, Chrome never shows the prompt, the
"waiting on microphone approval" spinner hangs, and the real prompt appears only on "Tap and speak".

Fix: call `navigator.mediaDevices.getUserMedia({ audio: true })` inside the Next button's click
handler (second screen), stop every track the moment the promise settles, and go straight to the
chat whether it was allowed or denied. The "One moment" screen shows only while the browser prompt
is open. Keep the review tool's rules intact: no model anywhere near it, no MediaRecorder, no stream
held open, nothing identifying stored (`review_tool_submissions` has no column for it on purpose).
Apply the same pattern to `src/app/onboarding2/chat-bubble.tsx` and `src/app/start/start-form.tsx`
if they have the same shape. Matthew likes the chatbot UI for reviews; do not change the look.

---

## Invariants. Do not loosen any of these.

- No em dashes, en dashes or double hyphens in any copy or model output (`copy-guard`). A `---`
  markdown rule is not a dash (`withoutRules()` in `draft-replica.ts`).
- `draft-page.ts`'s link ban in `answer_md`. Links come from the template.
- `setPublished` has exactly one caller, gated. The Day 0 wall and the evidence gate both stay.
- `STEP_VERIFIERS` stays exhaustive; a step appears later than everything in its `blockedBy`; step
  KEYS are never renamed; phases stay contiguous.
- A green tick is evidence, never a button press. `verified_source` is `system` or `thread` only.
- Reads of new columns stay tolerant, or the migration runs before the deploy. PostgREST fails a
  whole select on one unknown column, and in this repo that has silenced every studio thread and
  every widget before.
- `numberEvidence()` exists once. `setPublished` one caller. The only insert into `lead_magnets` is
  `approveMagnetCandidate`.
- Paste every migration as a full fenced sql block in chat. Never a file path.

## Verification

```
bun run build
bunx tsc --noEmit                      # use ./node_modules/.bin/tsc; npx finds no tsc here
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-page-studio.ts
bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
bunx tsx --env-file=.env.local scripts/_probe-cascade.ts   # throwaway client; proves the new order
```

Extend `_probe-page-plan.ts` with: the offer-relevance test (SRT and a lip filler fixture), pillar
plus 8 selection, "fewer than 8 relevant" refusing to pad, the link sets a pillar and a support
render (published only), and BreadcrumbList shape.

Then prove it live on `srt-agency-llc` resolved by slug, in this order: prep call card posts with the
phone; `offer:` plus `terms:` locks; candidates rebuild aimed at the offer; plan of 1 pillar + 8
proposes and approves; 9 drafts exist with maps and magnets; the step 18 concierge preview link
opens the widget from the internal host with no DNS; step 17 only goes green after a real fetch; the
review tool asks for the mic on Next.

## Known state you will meet

- SRT Agency LLC (`871f51be-26a1-4a85-a18a-6df0ce82395f`): offer locked "AEO Services for med
  spas" with positioning; avatar `med-spa-owner`; audience owner; anchor not yet set (set it to
  `visibility_scan`); 108 page candidates, most of the top ones pre-filter debris (the 09-11 prune
  clears them on the next step 14 run).
- Page `dfdd10c5` is a junk-question draft whose body is "1". Archive it; do not build on it.
- `question_bank` for `aeo-agency-med-spa`: 144 of 451 rows usable (measured 09-08). Deep research
  debris is filtered on read; nothing is deleted from that table, by doctrine.

## What to ask Matthew, only if the code forces it

- If a RingOut call to a CLIENT (not a lead) needs a new permission or number.
- If the relevance test leaves SRT with fewer than 8 supports: whether to run the deep research
  KEYWORDS block for the offer first, or ship a shorter plan.

End with: what shipped, the SQL to paste, the exact GoDaddy record for `concierge.srtagency.com`,
and what Matthew does next, in that order.
