# LANE 1 — Screenshots become evidence

**Read `docs/lanes/CONTRACT.md` first.** Three other sessions are working in this same
checkout right now. Stay inside your file list.

Migration file: `docs/2026-08-25-lane-1-screenshots.sql`.
Write-up when done: `docs/lanes/RESULT-lane-1.md`. **Do not touch `CLAUDE.md`.**

---

## What is wrong

Matthew screenshots from Chrome with the address bar in shot. The URL is right there in the
picture and he is being asked to retype what it already says. He filed five and was told
they "name no platform I recognise", twice, and had to re-post with the platform typed in.

Live state on the client: **18 files in step 5's thread, 13 attributed across 10 distinct
platforms, 5 attributed to nothing.** Every one is `image.png`.

Meanwhile step 8's grid is a form on a dashboard nobody wants to fill in, and step 14's PDF
reads "0 confirmed findings to correct, with 18 platforms still unchecked" on a client whose
thread holds eighteen screenshots of those very listings.

Matthew: *"the review audit it will be better if we can just send screenshots inside of slack
and it groups them all automatically and creates the report, that section in mission control
seems hard to use."* And: *"help me so step 14 actually reads the images and creates the good
report from the screenshots we sent before. I want it to work with screenshots because this
says nothing was found."*

---

## 1A. Read the platform off the screenshot, not out of the message

> **TEXT FIRST, VISION ONLY ON A MISS, AND THE ORDER IS THE WHOLE RISK CONTROL.**
>
> `src/lib/call-coach/resolve-target.ts` already records the doctrine for this exact shape:
> *"The Chrome tab URL is tried FIRST and skips the vision call entirely. A URL cannot be
> misread; a screenshot can."* Vision confirms, it does not decide. It also bounds the cost:
> 18 screenshots per client is 18 model calls if it fires unconditionally, and most of them
> are already answered by a word in the message.

- `resolvePlatformsFromText` (message text to platform, pure, word-boundary matched)
  **stays, unchanged, and stays FIRST.**
- New `src/lib/clients/screenshot-read.ts`. Model it line for line on
  `src/lib/call-coach/identify-lead.ts`, which is the same job: Haiku
  `claude-haiku-4-5-20251001`, `temperature: 0`, `callClaudeJSON` with `images`, a
  TRANSCRIBE-DO-NOT-INFER system prompt. Returns
  `{ urlText: string | null, legible: number, evidence: string }`.
  A model that returns a URL it is unsure of is **treated as zero matches, never as a weak
  yes**. `legible` measures how clearly an address bar is on screen, not how confident it is
  about the business, exactly as `identify-lead.ts` defines its `confidence`.
- The bytes are already stored: `client_docs.storage_ref` in the private `onboarding`
  Supabase bucket. **Read from there, not by re-fetching from Slack.**

### The domain map is its own field and it is not derived

> **`platform.url` IS NOT A DOMAIN MAP AND DERIVING ONE FROM IT COLLIDES.**
>
> `google`'s url is `google.com/maps` and `chamber`'s is `google.com/search`. `bing` is
> `bing.com/maps` while a Bing web search is `bing.com`. A naive hostname map files a chamber
> of commerce screenshot as Google Business Profile, which is a green tick over a platform
> nobody looked at.

- Add `domains?: { host: string; pathPrefix?: string }[]` to `PresencePlatform` in
  `src/config/presence-platforms.ts`, next to `aliases`, **so there is still ONE list.**
- New pure `resolvePlatformFromUrl(url: string): string[]`. Match **most-specific-first**,
  and where two platforms share a host the `pathPrefix` is **required, not preferred**.
- **`chamber` gets no `domains` entry at all**, with a comment saying why: its search surface
  is a Google search page, so its address bar is indistinguishable from any other Google
  search. Unmappable from a screenshot is the honest answer, and the same reasoning applies
  to anything else whose surface is a general engine.
- It returns `[]`, one key, or more than one. **More than one is a real answer** and the
  caller must not take the first.

### The three writers, and the predicate all three need

> **BOTH SLACK EVENTS WRITE, AND ONLY ONE CAN SEE THE TEXT.** An upload with a comment fires
> a `message` (subtype file_share) carrying the text AND a `file_shared` carrying none, in no
> guaranteed order. `handleFileShared` goes through `files.info`. Whichever wins inserts the
> row; `attributePresenceDoc` backfills, and its `.is("presence_platform", null)` predicate
> is what makes it a backfill and **never a relabel**. The vision path is a THIRD writer into
> that same slot and needs the same predicate.

- `captureOnboardingFile` (the text path) additionally writes `presence_source_url` (null
  here; there is no URL) and `presence_attributed_by = 'message_text'`. Both columns already
  exist in production.
- New `attributeFromScreenshot(docId)` in `onboarding-docs.ts`: download from `storage_ref`,
  read, `resolvePlatformFromUrl`, and on **exactly one** match update with the same
  `.is("presence_platform", null)` predicate, writing `presence_platform`,
  `presence_source_url` (the URL read, **verbatim**) and
  `presence_attributed_by = 'screenshot_url'`.
- It fires only for files that came back unattributed, only on `presence_sweep_manual`, from
  `captureOnboardingUploads` and from the `[Re-check]` path.
- **Zero and two are both null and both say so in the thread.** Guessing which of two
  platforms a picture shows is not available.

### The copy has to distinguish the two tiers of evidence

A screenshot whose address bar was READ is weaker evidence than one a person NAMED, and the
thread tier's rule is that a line may only describe the artifact it found. Both the refusal
and the confirmation say which:

> Filed for 4 distinct platforms: Google Business Profile, Yelp (named in the message);
> Trustpilot, BBB (read off the address bar in the screenshot).

---

## 1B. Four platforms, and they are HIS four

Matthew: *"instead of being core 6 make it core 4 also let it let me post the 6 of my
preference and dont force me to do those specifically."*

The gate becomes **any four DISTINCT platforms he chooses, from all of them.** Not four named
ones, and not a subset of the current six.

> **DO NOT EDIT `CORE_SIX`. THE GATE AND THE TIER ARE DIFFERENT FACTS AND THIS IS THE TRAP.**
>
> `CORE_SIX` / `EXTENDED` are the REMEDIATION TIERS, and they are read far outside the gate:
> `citation-cleanup.ts` sorts core-six first and multiplies effort by it, `presence-pdf.ts`
> renders the two tiers separately, and findings section 3 goes to the client. CLAUDE.md is
> explicit: *"A core-six mismatch and a Manta mismatch are not equivalent and a client-facing
> document must not imply they are."* Cutting `CORE_SIX` to four would quietly redefine what
> "week one cleanup" means in a document a client reads.

- Add `export const SWEEP_GATE_COUNT = 4` and gate on the count of **DISTINCT attributed
  platforms of ANY tier**. The tiers keep meaning what they mean.

> **IT MUST STAY A COUNT OF PLATFORMS, NEVER A COUNT OF FILES.** CLAUDE.md records why the
> current gate is attributed rather than counted: *"every pasted Slack screenshot is
> image.png, so six shots of Yelp would have satisfied a six-platform gate."* Four is a
> smaller number, not a weaker rule. `presenceCoverageFor` already returns distinct keys;
> keep that and change what is counted, not how.

- `presenceCoverageFor` currently returns `coreCovered` / `coreMissing` and both names stop
  being true. **Rename against the new meaning rather than leaving a field called
  `coreMissing` holding something else.** Suggested shape:
  `{ covered, distinct, needed, short, byTier, bySource, unattributed, files }` where
  `bySource` splits `named` from `read`.
- Check every caller: `presenceRefusal` (step-engine), the `presence_sweep_manual` verifier
  (step-verify), `formatSweepCard` (presence-sweep), and anything in `presence-pdf.ts`
  reading coverage.
- **The refusal copy changes shape completely.** It currently NAMES what is missing, which is
  the whole point of a fixed set. With a free choice there is nothing to name, so it says how
  many distinct platforms are filed, which ones they are, and how many more are wanted. It
  must still say that **a screenshot of an empty search result is the evidence where a
  business genuinely has no listing** - that line is why "missing" is a finding rather than a
  gap.
- **Check what the presence PDF now says about unchecked platforms.** At a gate of six,
  twelve unchecked was already the normal state of a document Matthew shows a client. At four
  it is fifteen, and the PDF's honesty line about that has to still read correctly.

---

## 1C. Trustpilot, and the recommended four

Matthew: *"for the presence consistency make this options as the default and most important
ones and all of the rest you can leave the list with alll of them but are secondary."* The
four he means are **Google Maps, Yelp, Trustpilot, BBB**.

- Add `trustpilot` to `EXTENDED`. Both tier constants keep their MEANING; this is one more
  extended directory.
- `PLATFORM_COUNT` moves 18 to 19. A client seeded before this reads "18 of 19 seeded" from
  `nap_sweep`'s verifier, whose refusal already says to un-tick to re-seed, and
  `seedPresenceSweep` upserts with `ignoreDuplicates`. **Note it in your RESULT file; do not
  special-case it.**
- New `export const RECOMMENDED_KEYS = ["google", "yelp", "trustpilot", "bbb"]`, with a
  header comment stating in one sentence: **this is a display and suggestion concept, it is
  NOT a tier, and nothing in `citation-cleanup.ts` or `presence-pdf.ts` may read it.**
- `formatSweepCard` lists those four first under "Start with these four", then the rest of
  the core six, then extended. The gate text says any four distinct platforms close the step.
- Watch the 3,000-character card limit. The sweep card was already at 2,988 for a short
  business name and you are adding a nineteenth line.

---

## 1D. The review audit comes off screenshots (step 8)

Matthew: *"Review audit is good for the customer but not neccesary for competitors, so make
that optional, not for the subject clients reviews, those we need to pull at least 1."*

- `REVIEW_PLATFORMS` becomes **google, yelp, trustpilot, bbb**. RealSelf and Facebook leave
  the review grid and **stay in the presence sweep**. Intake already stores
  `review_destination_primary = 'trustpilot'` for the live client.
- **Competitors become optional.** The verifier requires at least one recorded row where
  `subject_type = 'client'`. Competitor rows are still seeded, because they are the work
  list, and they **never block**. The card says so in one line: *"Competitor counts are
  optional. The client's own are not."*
- New `src/lib/clients/review-read.ts`: vision over a review-listing screenshot returning
  `{ platform, subjectName, reviewCount, averageRating, mostRecentReviewAt,
  ownerRepliesInLastTen, listingUrl, legible, evidence }`.

> **`negative_themes` IS NOT READ BY A MODEL AND MUST NOT BE.** `review-audit.ts`'s own
> header says it: *"NO MODEL WRITES 'THEMES IN THE NEGATIVES' IN V1. It is the obvious place
> to put a Claude call and it is the wrong place. That sentence lands verbatim in a
> client-facing PDF, and a hallucinated theme in that document cannot be walked back."*
>
> A count, a rating, a date and a reply tally are **transcription**. A theme is a **summary**.
> Four of the five fields come off the picture; `negative_themes` stays null until a person
> types it, and the card asks for it in one line.

- **Proposals, not writes.** Your migration adds `proposed jsonb` and `proposed_source text`
  to `review_audit_rows`. Vision fills `proposed`. One **[Confirm these readings]** button in
  step 8's thread copies `proposed` into the real columns and stamps `checked_by`. That is
  the human action the doctrine requires, and it is one tap for a whole batch.
  `review_count` stays NULL until confirmed. `Number("")` is 0, which is the trap.
- **Grouping, which is the thing he actually asked for.** After a batch of uploads, ONE card
  in step 8's thread: a subject-by-platform grid showing filled / proposed / not recorded,
  plus what could not be matched. Matching a screenshot to a row is `resolvePlatformFromUrl`
  for the platform plus a fuzzy match of the read business name against the client and the
  selected competitors. Zero matches or more than one is filed and reported, never guessed.

---

## 1E. Step 14 reads the screenshots

- New `src/lib/clients/listing-read.ts`: vision over each attributed sweep screenshot
  returning `{ found, name, address, phone, listingUrl, claimed, legible, evidence }`.
- Feed it into the **existing** `compareListing(canonical, listed)` in `nap-compare.ts`.
  Do not write a second comparator. `canonicalFor(clientId)` gives you the canonical.
- Write `proposed_status`, `raw_name`, `raw_address`, `raw_phone`, `listing_url`,
  `screenshot_ref` (the doc's `storage_ref`). **Never `confirmed_status`.**

  > Runner v3 section 6: *"NEVER auto-mark a listing verified. The tool proposes; I confirm."*
  > A row whose `confirmed_status` is null reads as `not_checked` regardless of what the
  > comparison proposed. That is what stops a string comparison sending somebody to edit a
  > client's live Google listing.

- Step 14's card lists the proposals worst-first with a **[Confirm all as read]** button and
  a link to the per-row panel. Confirming writes `confirmed_status` and `checked_by`.
- The cleanup PDF then has real findings instead of "Nothing to correct yet".
- `citation_cleanup`'s verifier refuses on `not_checked` FIRST, before it looks at anything
  else, and its card already says so. Keep that ordering.

---

## 1F. Step 15's theme link, and a preview a client may actually see (16, 17)

Matthew: *"Step 15 needs to give me the link to confirm the theme in mission control."* And:
*"since step 17 is before the call we need mission control to host the preview of the reviews
page and learn page hub to show to the client in the call."*

- **Step 15.** `hub_preview`'s card ends with `Confirm the theme: {boardUrl}#theme`. The
  theme panel has no `id` today (only `review-handover` does), so add `id="theme"` to it in
  `src/app/dashboard/clients/[id]/page.tsx`. That one attribute is the only edit you make to
  that file.
- **Steps 16 and 17.** `reviewPreviewUrl()` is a `/dashboard/` path and the page calls
  `notFound()` without a session, so a logged-out visitor gets a 404 rather than a login
  screen. Step 16's card already says out loud that it cannot be handed to a client. So add a
  **tokenized read-only preview**: `/preview/[token]` rendering the hub index and the review
  tool in the client's theme, `noindex`.
  - Reuse `signOnboardingToken` / `verifyOnboardingToken` in `src/lib/clients/token.ts` with
    a `preview` scope rather than inventing a second token scheme.
  - Add the route to the middleware allowlist the same way `/onboarding` is. **Read
    `src/middleware.ts`'s header before touching it** - it is deny-by-default as an allowlist
    of hub paths, and it is the most dangerous file in the repo.
  - **Submissions stay discarded.** The submit route takes the client identity only from
    `x-hub-host`, and middleware strips that header on internal hosts, so a preview
    submission has no client to write against. That guarantee is what `PREVIEW_DISCARD_RULE`
    states and it must remain true.
  - Steps 16 and 17's cards print that link and say it is safe to screen-share.

---

## Your file list

**Owned outright:** `src/config/presence-platforms.ts`, `src/lib/clients/presence-sweep.ts`,
`src/lib/clients/review-audit.ts`, `src/lib/clients/onboarding-docs.ts`,
`src/lib/clients/review-preview.ts`, `src/lib/clients/artifacts/citation-cleanup.ts`,
`src/lib/clients/artifacts/presence-pdf.ts`, plus new `screenshot-read.ts`,
`review-read.ts`, `listing-read.ts`, and the `/preview/[token]` route.

**Shared, your arms only:**
- `step-engine.ts`: cases `presence_sweep_manual`, `review_audit`, `citation_cleanup`,
  `hub_preview`, `review_tool_preview`, plus `presenceRefusal` and `presenceCoverageFor`.
- `step-verify.ts`: verifiers `presence_sweep_manual`, `review_audit`,
  `citation_cleanup_list`, `citation_cleanup`.
- `slack/events/route.ts`: the existing onboarding-channel **files** branch only
  (`captureOnboardingUploads`).
- `slack/actions/route.ts`: new `review_confirm_readings`, `cleanup_confirm_all`.
- `page.tsx`: add `id="theme"` to the existing theme panel. **No new panel.**
- `middleware.ts`: one allowlist entry for `/preview`.

---

## Done means

The five unattributed screenshots **still sitting in step 5's thread on the live client**
resolve from their address bars with nobody typing anything.

**If they cannot, say which and why rather than lowering the gate to pass.**
