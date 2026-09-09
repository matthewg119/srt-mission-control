# Unblock SRT's step 16 and finish the onboarding

A prompt for a fresh session. Everything in a **Ground truth** block was measured against
production on **2026-09-09** and is quoted, not remembered.

**Repo:** `Mission control 2.0/srt-mission-control`. `main` is at `2dc6fcf` and deployed.
Work in a worktree; run `git branch --show-current` before every commit.
Read `docs/lanes/CONTRACT.md` and `CLAUDE.md` before writing code.

---

## Ground truth: step 16 is NOT broken, and that matters before you touch anything

Matthew says he is "parked on step 15". **The step he means is `hub_preview`, which is 16.**
`offer_proposed` was inserted at position 10 on 2026-09-08 and everything after it moved by one.
Talk to him in step KEYS, or run `stepNumber()` before you use a number.

Resolved by slug (`srt-agency-llc`, never a pinned id):

```
bunx tsx --env-file=.env.local scripts/_srtid.ts
871f51be-26a1-4a85-a18a-6df0ce82395f   SRT Agency LLC
```

`bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts 871f51be-...` says, verbatim:

```
--  hub_preview          not_yet  2 hosts attached, theme not confirmed
--  review_tool_preview  not_yet  The theme has not been confirmed, so the review tool would
                                  render in SRT's default colours
```

And the record behind it:

```
domain              srtagency.com
subdomain           learn
theme               {"accent":null,...,"confirmedAt":null,"confirmedBy":null,...}
hub_skin            null
hub_skin_candidates null
themeConfirmed()    false
client_hosts        2 rows, both carrying vercel_attached_at
hub_preview row     status awaiting_me, anchor 1788809813.517139, card 1788809827.705589
```

> ‼️ **THE VERIFIER IS WORKING. DO NOT "FIX" IT.** Half of `hub_preview` already passes: the
> hostnames are attached. The other half is `themeConfirmed()`, which reads
> `theme.confirmedAt !== null` and nothing else, and it is null because nobody has pressed
> confirm. `hub-setup.ts:62` states the rule: "CONFIRMED is a person looked at it and said yes".
>
> The failure mode to avoid here is obvious and tempting: making the step tick without the
> confirmation. That is a green tick over unchecked work, which `docs/lanes/CONTRACT.md` calls
> the worst bug this design can have. **There is no override and there must not be one.**

**One decision unblocks two steps.** `review_tool_preview` (17) is refusing on the same
`themeConfirmed()`. Confirming the theme clears both.

---

## Task 1: fix the card I damaged, and it is my fault not his

On 2026-09-09 step 16's card was re-rendered from a local shell to show Matthew the new
next-step footer. That shell had no `CLIENT_LINK_SECRET` (it is Vercel-only), so
`previewLinkLine()` took its null branch and wrote this into his real card:

> *No shareable the hub link could be minted*: CLIENT_LINK_SECRET is not set on this environment,
> so nothing can sign one. Set it and this prints a URL.

A true sentence about the wrong environment, sitting in a card he reads as being about
production. The preview link that belongs there is missing.

**The fix is to make production re-render it**, not to edit it from a shell again:

- Pressing any button on the card re-renders it through the production function. That is the
  whole fix, and it is also the live test that the new build is serving.
- `scripts/_refresh-one-card.ts` now refuses to run with a localhost `NEXT_PUBLIC_APP_URL` or a
  missing `CLIENT_LINK_SECRET`, so it cannot repeat this. Read its header before using it.

> ‼️ `reference_step_card_rebuild_env` records this trap and it has now bitten twice. A card
> rendered locally carries the local environment into Slack, silently: Slack accepts the message
> and what is left is a line of text that is simply wrong until something re-renders it.

---

## Task 2: get the theme confirmed, and there are two doors

**Door one, the one that has always worked.** The Theme panel on the client board:
`/dashboard/clients/871f51be-26a1-4a85-a18a-6df0ce82395f#theme`. `POST` to
`api/clients/[id]/theme` with the confirm action writes `confirmedAt` (`route.ts:133`).
`theme-form.tsx:101` records that "I am keeping the defaults" was deliberately made a
confirmable choice, because otherwise `hub_preview` could never complete for a client who liked
the default palette.

**Door two, shipped 2026-09-08 and NEVER EXERCISED WITH A REAL SCREENSHOT.** Paste a screenshot
of a page whose look he wants into step 16's thread. `skin-vision.ts` reads tokens off it,
`hub-skin.ts` offers **three** variations, and `pick 1` / `pick 2` / `pick 3` chooses one.

> ‼️ **`pick n` SETS `theme.confirmedAt`, WHICH REVERSES THE RULE EVERY OTHER SKIN WRITE FOLLOWS.**
> `writeSkin()` CLEARS `confirmedAt` on every write, deliberately, so a changed look can never
> reach a client's domain unconfirmed. The pick is the one exception, and the reasoning is
> written down twice: in `confirmSkinPick`'s header and in `docs/2026-09-08-skin-candidates.sql`.
> Choosing one of three rendered previews IS a person looking at it. **Do not extend that
> exception to anything else.** `template <name>` and `skin reset` still clear it.

This lane is the highest-value thing to test live, because it has never run against a real
image. `hub_skin` and `hub_skin_candidates` are both null on this client, so whatever happens
will be a first run. Watch for:

- Does `skin-vision.ts` come back with usable tokens, or refuse?
- Are the three variations actually different from each other? A variation is three TOKEN SETS
  and never three layouts, and `SkinRead` has no field for markup, copy or section order.
- Does `pick n` set `confirmedAt` in the same write, so he does not then have to go and confirm
  the design he just chose?

**Ask Matthew which door he wants before doing either.** Confirming a theme is a decision about
what a client's pages look like, and it is his to make, not something to tick to clear a board.

---

## Task 3: walk him forward, and say what each step is waiting on

Once the theme is confirmed, 16 and 17 both clear. The rest of what is outstanding, measured:

```
--  concierge_preview  not_yet  no row exists
--  site_replica       not_yet  their site has not been read
--  dns_records        not_yet  learn CNAME ready, reviews CNAME ready, @ TXT pending
--  subdomain_live     not_yet  `learn` is ready, not verified (reviews CNAME ready, @ TXT pending)
```

`dns_records` and `subdomain_live` want the **@ TXT record** added at the registrar. That is
work only Matthew can do, and `formatDnsRecords()` in `hub-setup.ts` prints the values.

> ‼️ **`concierge_configs` HAS ZERO ROWS IN PRODUCTION** and that is why `_probe-concierge-lane.ts`
> reports two failures. It predates this work and is a DATA problem, not a regression. If you fix
> anything there, fix the data.

Every card now prints a `*Next:*` block derived from `DELIVERY_STEPS`, so the board should tell
him what follows without being asked. If a card does not, that is a bug worth chasing:
`scripts/_probe-next-steps.ts <clientId>` walks all 41 and fails on a confident wrong answer as
well as a missing one.

---

## Also untested live, if he wants to exercise it while you are here

`review` in `#aeo-seo-page-drafting`, shipped 2026-09-08. Drop a screenshot of a customer review
into a `page <client>` thread. The vision read has never seen a real screenshot.

> ‼️ **THE THING TO WATCH FOR IS TIDYING, NOT INVENTING.** A model handed a review fixes its
> spelling, because that is what being helpful looks like everywhere else, and a corrected quote
> is a quote WE wrote under a real customer's name. `review-quote-read.ts` spends most of its
> system prompt on this. If the transcription comes back cleaner than the screenshot, that is the
> bug, and it is a prompt fix rather than a code fix.
>
> `draft-page.ts` already verifies the other half: a draft citing a `CUSTOMER_REVIEW` ref must
> reproduce a run of that review's own words or it fails validation.

---

## Invariants. None of these has been loosened and none may be.

A green tick over unchecked work is the worst bug this design can have · `verified_source` is
`system` or `thread`, no third value, **no override** · the tool proposes and a person confirms ·
ambiguity stays null and says so · one anchor at a time, Slack internal only, **edit anchors and
never re-post**, because Slack orders by post time and a delete-and-repost moves a step to the
bottom permanently · `slackFetch` returns `{ok:false}` and never throws · a card body over 3,000
chars fails the whole message, so use `bodySections()` · the Day 0 wall goes before
`setPublished`, which has one caller · a step must appear LATER in `DELIVERY_STEPS` than
everything in its `blockedBy` · `STEP_VERIFIERS` stays exhaustive · `skin.ts` and
`skin-vision.ts` carry tokens only · `clients.ops_channel_id` is **write-once**: every anchor
stores a bare ts, so moving it orphans a whole board · no em dashes · **paste every migration as
a fenced sql block in chat, never a file path.**

---

## Verification

```
bun run build
bun run scripts/test-onboarding-artifacts.ts                     668 checks
bunx tsx scripts/_probe-step-verify.ts
bun run scripts/_probe-step-numbers.ts
bunx tsx --env-file=.env.local scripts/_probe-hub-skin.ts
bunx tsx --env-file=.env.local scripts/_probe-ops-channel.ts
bunx tsx --env-file=.env.local scripts/_probe-next-steps.ts 871f51be-26a1-4a85-a18a-6df0ce82395f
```

> ‼️ Without `--env-file=.env.local` the probes return nothing at all. Not an error. Nothing.

`_probe-page-gate` (2) and `_probe-concierge-lane` (2) fail and have failed since before this
work. Do not chase them as regressions.

Then prove it:

- Step 16's card carries a real preview link again, not the CLIENT_LINK_SECRET line.
- `themeConfirmed()` is true, because a person confirmed it.
- `hub_preview` and `review_tool_preview` both go green, by their own verifiers.
- Every card still offers its next step.
