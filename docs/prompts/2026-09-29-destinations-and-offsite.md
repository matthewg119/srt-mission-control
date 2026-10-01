# Destinations, off-site and the tool lane — one build

Three plans merged because they are one plan. Part I decides the URL a page lives at. Part III
decides what the page IS and what it offers. Part II sends people to it and earns the links.
Build Part I first or every link Part II creates points at a host that is about to change, and
build Part III before Part II or there is nothing worth linking to.

Read this whole file before touching anything. The corrections in §0 exist because the session
that wrote this plan read 355-commit-old code for its first ten minutes.

---

## §0 — The checkout, first, before anything

The primary checkout at `Mission control 2.0/srt-mission-control` was stranded on
`feat/review-workflow-onboarding`: 0 ahead, 355 behind, every commit already in origin/main.
It was stuck there because `_wt-magnet-finish` held local `main`, and git refuses to check out a
branch that is live in another worktree.

Before writing a line:

1. `git fetch origin`
2. Confirm the working tree's two modified files are already upstream. They were: the `id`
   tie-break in `listMagnetsFor` is byte-identical in origin/main. Discard them.
3. Release local `main`, get onto origin/main, and build in a FRESH worktree off origin/main.
4. Verify: `git rev-list --left-right --count HEAD...origin/main` must print `0  0`.

Do not skip step 4. Every wrong claim in the planning session traced to a stale read.

Facts established while triaging, so nobody re-derives them:

- `feat/keyword-decisions` (in `_wt-kwstrategy`) is 0/0 with origin/main. Matthew is working
  there on step 12 keywords. **Do not touch that worktree.** Rebase onto whatever it lands as.
- `feat/free-first-upsell` is 1 ahead / 0 behind, dated today. The only other live branch.
- `feat/headline-first`, `feat/three-offers` and `feat/concierge-avatars` carry three commits
  each whose subjects all match commits already in origin/main (`fae93d3`, `05e27b0`, `e7172c5`).
  They are duplicates. The mascot / headline-first work already landed on main.

---

## §1 — Locked decisions. Do not relitigate.

| Decision | Status |
|---|---|
| Every client gets a subdomain, always | Base AEO product, unchanged |
| DNS collected on the call | step `dns_records`, unchanged |
| Subfolder decided AFTER the call | $499/mo full-SEO upsell, phone only |
| Export available to everyone, always | Free, no access needed |
| CMS mode | Not built until a client offers an Editor account |
| `site_replica`, `review_card_pdf`, `cards_printed` | Kept |
| AI Referral Engine | Stays on `reviews.{domain}` |
| Path word | `/learn` |
| Forum / blog-comment posting | **Never. See §7.** |
| The evidence gate | **Kept. It is already waivable. See §6.** |
| Per-page lead-magnet invention | **Deleted.** `lead_magnets` wiped, nothing live (§10b) |
| Tool pages | Component registry, not an iframed artifact (§10e) |
| A tool page | The **eighth** page, its own slot beside the seven (§10d) |
| Tool ideas | Generated **per client**, fresh; vertical library offered as reuse (§10c) |
| Patient-page default offer | **Book a consult**, until a skin vendor is keyed (§10f) |
| AI Skin Concierge vendor | **Not in this build.** A config value plus one adapter, later |
| `angles auto` | **Already does per-keyword ideation. Do not build a second one** (§10c) |

**The model: destinations, not modes.** No `delivery_mode` enum. Destinations are `client_hosts`
rows (subdomain / subfolder / cms), a client can hold several, and Export is not a row — it is
always on. `clients.default_destination_id` only pre-selects the picker.

---

# PART I — DESTINATIONS

## §2 — Phase 1: Export + destination picker

Ships alone, touches no middleware.

The hook point is `src/lib/hub/publish-page.ts` — the single publisher, with the Day-0 wall and
the quality gate in one ordering.

- Add `destinationId` to `publishPage()`. Resolve it inside that function.
- Picker UI on the board's Hub panel and the Slack drafting card. Lists every wired destination
  plus Export. No default pre-ticked when more than one exists.
- Export variants off `renderPagePreview()` in `page-preview.ts`: body-only HTML, markdown,
  standalone JSON-LD, whole-set zip, and a one-page "paste this here" sheet.
- Export writes no `client_pages.status` change. A file is not a publication.

**One page gets one home.** Publishing the same page to a subdomain and a subfolder is duplicate
content on two hosts we control.

## §3 — Phase 2: the `siteUrl()` keystone

Replace all eight hardcoded `https://${host}/` literals with `siteUrl(destination, slug)`:
`layout.tsx:42`, `jsonld.ts:42`, `page.tsx:43`, `[slug]/page.tsx:32` and `:37`,
`sitemap.xml:37,42`, `robots.txt:53`, `llms.txt:49`.

Canonical, OG, sitemap, llms.txt and JSON-LD all flow from this one function. Nothing else in
Phase 2.

**This is the interconnection point with Part II.** Every outreach email and every directory
submission links to `siteUrl()`. If this is not done first, Part II ships links to a host that
changes under them.

## §4 — Phase 3: subfolder plumbing

- `resolveSite(siteKey)` beside `resolveHost()` in `resolve.ts` — same `toHubClient`, second key.
- Route `/s/[siteKey]/[[...slug]]`, allowed on the internal middleware branch only, gated on a
  `HUB_PROXY_SECRET` header, `x-robots-tag: noindex` on our copy.
- `logHubHit` files under the destination's `public_origin` + `base_path`, not the proxy host.
- Per-destination `robots.txt` / `sitemap.xml` / `llms.txt` under `/learn/`.

## §5 — Phase 4: the crawler-door check

Two things, one code path.

**Pre-flight**, added to step `site_dns_intel`, runs for **every** client: fetch their root
`robots.txt`, parse it for the ten AI agents, then make a real request with a GPTBot UA against a
live page to catch a WAF. Output goes in the call pack as sales intel — "your site currently
blocks ChatGPT" is a strong opener.

**Recurring probe**, subfolder clients only: the same two checks on a schedule, posting to the
client's Slack thread **when the door closes**, not on every pass.

**Gate:** a subfolder destination cannot be wired while the probe is red. Frame it for the sale —
fixing it is week one of the $499, not a blocker to it.

Why this matters even for subdomain clients: on a subdomain we generate `robots.txt` and own the
hostname, so zero crawler hits means our content is not interesting yet. On a subfolder the file
lives on a server we do not control and a plugin update can rewrite it overnight, so zero hits
means that **or** the door closed, and you cannot tell which. The probe removes the ambiguity.

## §5b — Phase 5: SRT Agency pilot

We own both ends. `srt-agwb` is on `deploy/three-offers`, 0/0 with its origin/main — clean.
Its `robots.txt` already names GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended
and Applebot-Extended with `Allow: /`, and `/learn/` is not in its Disallow list.

Two rewrites into `srt-agwb/vercel.json`, alongside the five families already proxied:

```json
{ "source": "/learn", "destination": "https://mission.srtagency.com/s/srt-agency" },
{ "source": "/learn/:path*", "destination": "https://mission.srtagency.com/s/srt-agency/:path*" }
```

Then one line into `srt-agwb/robots.txt`:
`Sitemap: https://srtagency.com/learn/sitemap.xml`

`/_next/:path*` is already proxied, so assets need nothing. **Test `cleanUrls: true`** — it is on
in that config and may strip trailing segments through the proxy.

---

# PART II — OFF-SITE

## §6 — The gate becomes a flag, without losing the gate

**Correction to record before building: the waiver already exists.** Do not rebuild it and do not
remove the block.

- `publish-page.ts:112` — `waivable: e.reason === "blocked"`. A never-run or stale gate is
  correctly not waivable; the answer there is to press Check.
- `waiveGate()` in `page-gate.ts` requires a reason of at least 10 characters, records the actor,
  and posts it to Slack. `waiveDay0` is the same shape.
- Slack button at `app/api/slack/actions/route.ts:664`. Dashboard at `hub-form.tsx:406`.

The only defect is that the refusal does not SAY any of this. Today it reads as a wall and the
way through is discoverable only if you already know the button is there.

**Build:**

1. The block message names both ways forward in the same message: *Publish anyway, with a reason*
   and *Ask for a source*. Two buttons, same card.
2. The second button starts the `quote_request` workflow below.
3. Nothing about `isFirstParty()` changes. It is the one place that decides what counts as
   evidence, and a second copy of that list is how "the client said this" and "a model wrote
   this" quietly become the same fact.

## §7 — The hard line on link acquisition

Quoted from `src/lib/clients/harvest.ts`, which predates this build:

> DOES NOT POST: anywhere, ever, to any forum, as anyone. That ban is canon and predates this
> file. There is no posting code path here and one must not be added.

**No automated forum posting, blog commenting, profile spamming, or reciprocal link swaps
anywhere in this build.** Two reasons and either is sufficient: it is already banned in this
codebase, and scaled link exchange is what Google's link spam policy names.

What is permitted and is what gets built:

- Submitting our own or a client's listing to a directory. We are the business; that is a
  listing, not a link scheme.
- Emailing a human to ask for inclusion, a quote, or a correction — as a **reviewed draft**.

Every outreach email routes through the existing `outreach/opt-out.ts` and
`outreach/suppression.ts`, and carries a physical address and a working opt-out. CAN-SPAM is not
optional and the rails already exist.

## §7b — Page formats: the link asset is a page type, not a side lane

**This section exists because the rest of Part II was wrong on its own.** Off-site work was first
specced as a lane running beside the page plan. It is not. The page plan is where we decide what
a client gets written, and a page that earns links is a KIND of page. If the format axis gains no
new shapes, nothing in §8 to §10 ever produces a page worth linking to.

**What exists today.** `src/config/post-formats.ts` is the written-page format axis, keyed as
`post_format` on `page_plan`, `page_angles` and `page_dataset`. Five formats:

| id | what it is |
|---|---|
| `answer_first` | one question, answered, then what the reader needs to act on it |
| `list` | ranked list: how many, what ranked them, the items, what was left off |
| `comparison` | exactly two subjects, named axes, a verdict per axis and one overall |
| `decision_guide` | the decision, the options, what decides it, the steps, who should not |
| `teardown` | a claim, who says it, what is true in it, what is not, what to do instead |

`SHAPES_PER_PAGE = 3`. Each format declares a `dataset` of required fields, and a required field
with no answer is recorded **MISSING** on `page_dataset`, never invented.

**The gap:** there is no `review`, no `roundup`, no `tool`, no `data_study`. `teardown` is a claim
teardown, not a product review. Nothing can build an interactive asset at all.

**And the system already knows when it needs one.** `keyword-strategy-rules.ts` computes
`DominantPageType` from the SERP read — `blog | service_page | price_page | booking | directory |
tool` — and `dominantPageType()` returns `"tool"` when the result shape is products
(`keyword-strategy-rules.ts:421`). The keyword lane can already say "this query wants a tool" and
the page plan has no way to make one. Close that.

**Build: four new formats.** Same record shape, same digit-free rule, same probe.

| new id | shape | why it earns a link |
|---|---|---|
| `roundup` | Best N of a category for one named buyer. **Includes tools and services that are not ours.** Named inclusion criteria, one line per entry on what it is best at, and what was excluded and why. | Everyone listed has a reason to link to it, and the reason is honest: they are in it. |
| `review` | One subject, hands on. Who it is for, who it is not for, what it costs, what breaks. Verdict required. | The subject links to it, and the avatar reads this before buying. |
| `tool` | An interactive asset on the hub: calculator, quiz, checklist, template. **This one is not only a format — it is a PILLAR TYPE with a real interactive page. See Part III.** | The asset that gets linked without being asked. `DominantPageType = "tool"` already points here. |
| `data_study` | Original numbers we actually measured. Method stated, sample stated, limits stated. | The strongest link magnet there is, and we already hold audit data nobody else has. |

**The avatar gate, which is the constraint that decides whether this is useful or filler.** A
format is offered for a page only when the audience row makes it plausible that this buyer would
search for, read, or download it. A roundup of tools a med spa owner would never open is not a
link asset. The audience row and the SERP read together decide which of the nine shapes are
eligible for a keyword; the three offered are picked from those, never from all nine.

**The join to §8 to §10, which is the whole point:**

1. Every subject named on a `roundup`, `comparison` or `review` page is a **backlink prospect
   that is already qualified**. We listed them, so the email is not a favour ask. Those subjects
   are written into `offsite_targets` with `kind = 'listed_subject'`.
2. **A MISSING field on `page_dataset` is a person to email.** A `roundup` with no "what ranked
   them", a `review` with nothing on cost, a `data_study` short a number — each is a named gap,
   and `quote_request` (§10) already exists to fill it. The gate stops guessing and starts asking.
3. `tool` pages are what we submit to the directories in §9. A hub carrying tool pages belongs in
   an AI tool directory; a hub carrying five service pages does not.

**Nothing here may invent a claim.** Every rule the angle lane enforces still holds: a number must
appear in what the model was given, a guarantee is only ever the client's own words, no em dash,
and the three shapes offered must be genuinely different ideas rather than three rewordings.

## §8 — Link targets out of the audit corpus

**The data is already collected on every audit and thrown away.**

`audit_runs.citations` is `string[]` — every URL every engine cited, written by `run-prompts.ts`
and `run-batch.ts`. `harvest.ts` reads it (filtered by `BASELINE_ONLY` from `run-labels.ts`),
fetches up to 40 pages, extracts phrases, and stores **only a count** in
`harvest_runs.sources.citations`. The URLs are discarded.

**`citation_sources` does not exist.** It is named in a comment in `harvest.ts` and nowhere else.
Do not write against it.

Build:

- New table `offsite_targets`: `client_id`, `domain`, `example_url`, `times_cited`,
  `first_seen_run_id`, `kind`, `status`, `notes`. Rolled up by domain, not by URL.
- Classify `kind` deterministically first — directory / listicle / forum / review_platform /
  news / competitor / client_own — by domain and path shape. A model only for the leftovers.
  Same doctrine `harvest.ts` states for its scores: a number that moves on its own makes the
  day-30 comparison meaningless.
- Exclude the client's own domain. `engines_cited_site` is already computed in `finishReport`.
- Surface it in the audit report (`report-view.ts`) as a section: **"Where the engines get their
  answers."** This is the answer to "is this in the AI visibility audit" — the data was, the
  section was not. It is sales intel and the link target list in one place.
- It runs for every prospect audit, not just signed clients. SRT's own targets come from SRT's
  own audits.

## §9 — Foundation listings

**Two registries, not one tier.** A med spa does not belong on theresanaiforthat.com and SRT has
no NAP problem. One table with a tier flag produces a card telling a clinic to list on an AI
directory.

- `src/config/presence-platforms.ts` — unchanged. 19 local-citation platforms, NAP consistency,
  `CORE_SIX` / `EXTENDED`, `SWEEP_GATE_COUNT = 4`. Do not add rows to it.
- **New** `src/config/foundation-platforms.ts` — the 138 launch platforms, SaaS directories, AI
  tool directories and review sites. Same record shape: `key`, `label`, `submitUrl`, `type`,
  `dr`, `costCents`, `needsAccount`, `minutes`, `note`.

New table `listing_submissions`: `owner_kind` ('client' | 'srt'), `owner_id`, `platform_key`,
`status` (`missing` → `queued` → `submitted` → `live` → `rejected`), `submitted_at`, `live_url`,
`verified_at`, `cost_cents`, `notes`.

Weekly verifier re-checks `live_url` and flags a listing that vanished. A listing that went away
is the same class of fact as a NAP mismatch and gets reported the same way.

**The message comes from one place.** Every submission's description is generated from
`offer_locked` (offer / terms / outcome / price / guarantee) plus the audience's `short offer`
document in `audience_documents`. Never retyped per directory. That is the whole point of the
consistent-message argument — an inconsistent footprint teaches the engines an inconsistent
answer — and the source of truth already exists.

SRT is itself a client on this board (`srt-agency-llc`), so SRT's own 138 run through the same
machinery with `owner_kind = 'srt'`. Do not build a second system for us.

## §10 — Three workflows, no new steps

All go in the existing registries. `src/lib/clients/workflows/registry.ts` has two entries today
and was built for exactly this. Definitions are code, runs are rows. Everything produces drafts;
nothing sends, publishes, or touches a property someone else controls.

| Workflow | Registry | What it does |
|---|---|---|
| `offsite_targets` | client | Reads `audit_runs.citations` **and every subject named on a published `roundup` / `comparison` / `review` page**, ranks by domain, writes `offsite_targets`. Feeds the renamed step 15. |
| `citation_outreach` | client | One draft email per target, written from `offer_locked`, queued into `outreach_send_queue` with new `kind = 'offsite'`. First contact stays a reviewed draft. |
| `quote_request` | client | For a claim the gate blocked: drafts an ask to a named person for one quotable sentence. The reply files back as a `page_source`, `source_type = 'EXTERNAL_RESEARCH'`, `collected_via = 'outreach_reply'` (new enum value). Never `AI_DERIVED`. |
| `srt_foundation_listings` | **ops** | SRT's own 138. Ops registry, not client — `client_workflow_runs.client_id` is NOT NULL and an ops run stored there is invisible to `workflowRuns()`. |

`outreach_send_queue` has a CHECK on `kind` (`nudge` / `pitch`). Adding `offsite` is a migration,
not a code change. Mailbox rotation, pacing, suppression, opt-out and the ReachInbox reply webhook
are reused as they are.

---

# PART III — PAGES, TOOLS AND OFFERS

The restructure Matthew asked for on 2026-09-29. It replaces per-page lead-magnet invention with
a deliberate tool lane, and it changes what every page offers a visitor.

## §10b — What gets deleted, and the order it must happen in

**Delete:**

- The `draftMagnetsForPage()` call at `page-studio.ts:647`. A page draft must no longer mint five
  invented offers the moment `startPageDraft()` creates the row.
- The `magnets` and `magnet N pick M` commands from step 21 and from the page studio.
- `approveMagnetCandidate` and the `page_magnet_candidates` table.
- Every existing row in `lead_magnets`. **Confirmed safe: no lead magnets are live in front of
  visitors.** Verify that once against prod before the delete, then proceed.

Step 21's flow becomes: **ladder → pillar → supports auto → angles auto → headlines.** No magnet
step.

**‼️ ORDER IS LOAD-BEARING.** `concierge/chips.ts`, `for-client.ts` and `engine.ts` all read
`lead_magnets` to decide what to sell. Create the house offers FIRST, then wipe, then wire tools.
The other order leaves a live page with a CTA that opens a bot holding nothing.

**What survives and must not be touched:** `client_pages.lead_magnet_key` and
`client_pages.cta_line`. The per-page pointer is the right mechanism and already works; only what
fills it changes. `page-angles.ts:1100`'s note that nothing mints there stays true.

**The probes that will go red and must be rewritten, not deleted:**
`_probe-magnet-drafts.ts` (the approved-to-page invariant), and
`_probe-concierge-lane.ts` §9b, which asserts every active magnet's pill label is 28 characters
or under with no banned dash **across the whole table** — one bad row turns it red for every
client, so the house offers and every tool asset must pass it too.

## §10c — Ideas per keyword, and the tool is one branch

**‼️ CORRECTION, RECORD IT BEFORE BUILDING: `angles auto` ALREADY DOES PER-KEYWORD IDEATION.**
`page-angles.ts` writes three ideas per planned page — what it argues, the story, the belief it
installs, the two awareness stages — and the headline is generated from the pick. Do not build a
second idea generator beside it. Three things are missing and all three are small:

1. Its shape vocabulary has no `tool`.
2. It runs at step 21 on planned pages, not at keyword selection.
3. `asset_ideas` and `magnet_idea` on `keyword_serp_reads` do not feed it, so it re-invents
   ungrounded. Feed them in when they exist.

**Build a light pass at keyword selection**, after `keywords pick`, whose only job is to say what
SHAPE each chosen keyword deserves — `answer_first`, `roundup`, `comparison`, `review`, `tool` —
and to flag the one keyword that should become the tool. It reads the chosen keywords, the locked
offer and the avatar. **No SERP screenshot required**: `asset-ideas.ts` today only fires off a
screenshot read, and that gate has to come off. Ideas come FROM keywords, never the reverse.

**The 30 tool ideas are a filtered view of that pass, not a separate system.** Generated per
client from what they sell and who they sell it to, kept fresh rather than cached. The vertical
library below is offered as a suggestion at pick time, never as a substitute for generating.

The question the generator asks is Matthew's: **"what would we build to help this customer
achieve X?"** Simple or complex — a business-day date calculator is as valid as a dosing
estimator. Keep `asset-ideas.ts`'s existing discipline: every kind must be a thing with a door on
it. There is deliberately no `guide`, no `article` and no `post` in that list, and the absence is
the enforcement.

## §10d — The tool is the pillar

`tool pick 7` picks one. Before building, check the vertical library for a match and say so:
"med_spa already has a botox unit calculator — reuse and restyle, or build new?" A reused asset
is **restyled per client**, never served as another client's live page.

Two tables:

- `vertical_assets` — the library. `vertical`, `slug`, `kind`, `title`, what it does, `inputs`,
  `output`, `component_key`, `source_keyword`.
- `client_assets` — this client's instance. `client_id`, `vertical_asset_id`, `status`, `page_id`,
  theme overrides.

**For a tool pillar the tool page IS the pillar**, and `supports auto` writes support pages that
feed traffic to it. Non-tool pillars behave exactly as they do today. A `roundup` or `review`
(§7b) around a tool pillar is the support page that both sends traffic and earns the link.

**A tool page is the EIGHTH page, not one of the seven.** Step 21's verifier ticks on one pillar
plus six supports today; widen it to accept seven plus one tool, and make the tool its own slot
so a client can be shown a live tool on the call.

## §10e — Tool pages are a component registry

**Decided: a component registry, not an iframed artifact.** `client_pages.answer_md` is markdown
and an interactive calculator is not, so this is the one genuinely new piece of plumbing in the
whole build.

Each tool is a reviewed, deployed React component keyed by `component_key`, and the
`client_assets` row points at the key. Same doctrine the workflow registries already state:
**definitions are code, runs are rows.** An iframe to an external artifact was rejected because it
is an outside dependency on a page we are asking engines to trust, and it cannot be themed per
client.

A tool page still carries a normal `client_pages` row for its title, slug, meta and JSON-LD. The
component renders inside it. The publish gate, the Day-0 wall and `publishPage()` as the single
publisher all apply unchanged.

## §10f — What each page offers now

| Page | Offer |
|---|---|
| Client patient page | **Book a consult** — the interim default, decided 2026-09-29 |
| Client owner page, and srtagency.com | Free AI Referral Engine, or Free AI Visibility Audit |
| Tool page | That tool. The page IS the magnet |
| Tool page with a downloadable (PDF, sheet) | The concierge offers it, **on that page only** |

The AI Skin Concierge becomes the patient default the day a vendor is keyed. It is a value in
`concierge_configs.analysis_provider` plus one adapter file — a switch, not a rebuild. **Do not
build it in this pass.**

**‼️ TWO THINGS THE VENDOR WORK MUST CARRY WHEN IT HAPPENS, AND NEITHER IS THIS BUILD'S JOB:**
`analysis/provider.ts` returns SCORES, and "see how it looks after the procedure" is IMAGE
GENERATION — a different seam and a different vendor class. And every adapter must normalise to
**higher is better**: a vendor scoring severity and one scoring condition both return `acne: 82`,
and an adapter that forgets to invert tells someone with clear skin their face is in trouble, on
a clinic's own domain, under the clinic's name.

## §10g — The concierge follows the page

The bot must know which page it is standing on and sell what that page is about. A page whose
offer is a tool gets that tool; a page with a downloadable gets the download prompt on that page
and nowhere else. `chips.ts`, `for-client.ts` and `engine.ts` resolve from
`client_pages.lead_magnet_key` for the current page before falling back to the house offer.

**The embed on a client's own site.** Clients must be able to paste the widget into their own
website or subfolder, not only onto a hub subdomain. The embed is already a `<script src>` from
one concierge host, so what gates this is the allowlist seeded at concierge setup plus a snippet
they can copy. Same work as Part I's subfolder destinations — do them together.

---

# §11 — Where the two parts touch

Build in this order for these reasons, not because the numbers are sequential.

1. **`siteUrl()` before any outreach.** Every submission and every email links to it. Part II
   shipping first means links to a host that is about to change.
2. **Subdomain clients need off-site MORE.** A page on a subfolder inherits the client's domain
   authority; one on a subdomain starts at zero. Generate the target list for every client,
   prioritise it for subdomain ones — which is all of them at signing.
3. **The crawler door and the target list are one sales section.** "Here is who the engines cite,
   and here is whether they can even read you." Both land in the call pack, both come from the
   audit, neither needs a new data source.
4. **`offer_locked` is the single message source** for directory copy, outreach copy, and page
   drafts. One edit there changes all three. Nothing downstream may keep its own copy.
5. **`custom_question_set`, frozen at Day 0, is how off-site work is proven.** Do not add a
   separate backlink metric. The question is whether the engines changed their answer, and that
   set already measures exactly that.
6. **`page_sources` is the join between the gate and outreach.** A blocked claim is a reason to
   email someone; their reply unblocks the page. The blocker becomes the link engine.
7. **The tool pillar is what makes §9 make sense.** A directory will list a calculator. It will
   not list a service page. Until Part III ships a tool, the foundation listings have a thin
   thing to point at.
8. **`roundup` and `review` are the supports around a tool pillar.** "Best X calculators" that
   links to ours is simultaneously the support page, the traffic source and the link asset. One
   page doing three jobs is why §7b and Part III belong in one build.
9. **The concierge embed and Part I's subfolder work are the same job.** A client pasting the
   widget onto their own site and a client proxying `/learn` to us are the same conversation with
   the same person about the same access. Ship them together or ask twice.

---

# §12 — The step board: 41 → 36

**The board has 41 steps, not 40.** `DAY_ZERO_STEP_KEY` is a const, so a `key: "` grep miscounts
by one. Verify with `DELIVERY_STEPS.length` before and after.

| Change | Net |
|---|---|
| Merge `dns_records` + `subdomain_live` | −1 |
| Merge `review_request_configured` + `referral_engine_handed` | −1 |
| Delete `day_30_date` | −1 |
| Demote `time_log_entries` and `weekly_report` to digest nudges | −2 |
| Trim the DNS preview block out of `site_dns_intel`; it gets the crawler-door check instead | 0 |
| Rename `citation_cleanup_list` → off-site targets (listings to fix, listings to claim, cited sources to pitch) | 0 |
| Rename `citation_cleanup` → off-site executed | 0 |
| `pre_call_pages` label and verifier: seven pages **plus one tool**, the tool in its own slot (§10d) | 0 |
| **Total** | **41 → 36** |

Keep `site_replica` and `cards_printed`. **No new steps are added.** All off-site capability
arrives as workflows and as content inside two renamed steps.

**Wiring that a merge or rename will break if it is not done:**

- `LEGACY_STEP_KEYS` in `config/delivery-steps.ts` needs an entry for every retired key.
  `stepByKey()` resolves retired keys so a Slack card posted months ago still works when someone
  scrolls back and taps it. A merge retires a key.
- `STEP_ACTIONS` in `lib/clients/do-this-now.ts` is typed `Record<StepKey, StepAction>`, so a
  renamed step fails to compile until its bullets are rewritten. Rewrite them — do not copy the
  old ones across a rename.
- `_probe-do-this-now.ts` greps every backticked command in every bullet back out of `src/`.
  A card that names a command that does not exist fails the probe, by design.
- `STEP_VERIFIERS` is the same compile-enforced shape. A merged step needs a verifier that checks
  both halves.
- A step must sit LATER in the array than everything in its `blockedBy`. Probe-enforced.
- The presence sweep card must say four platforms close it. `SWEEP_GATE_COUNT` is already 4 but
  the card says "work down the platforms one at a time", and 19 platforms at 10–30 minutes each
  is roughly four unpaid hours per prospect.

---

# §13 — Migrations

Part I:

- `client_hosts.base_path`, `client_hosts.public_origin`.
- Relax `client_hosts_client_kind_key` (unique index on `client_id, kind` in
  `docs/2026-08-18-client-hub.sql:55`) so one client can hold a subdomain hub row and a subfolder
  hub row. `client_hosts_host_key` on `lower(host)` stays.
- `client_pages.destination_id uuid null` → `client_hosts(id)`.
- `clients.default_destination_id uuid null`.
- `client_crawler_probes` (`client_id`, `checked_at`, `robots_ok`, `waf_ok`, `agents_blocked`,
  `observed`).

Part II:

- `post_format` CHECK widened on `page_plan`, `page_angles` and `page_dataset` to allow
  `roundup`, `review`, `tool`, `data_study` (§7b). Check `docs/2026-09-18-post-formats.sql` and
  `docs/2026-09-22-dataset-suggestions.sql` for the existing constraint names before writing this.
- `offsite_targets` (§8), with `kind` allowing `listed_subject` as well as the corpus kinds.
- `listing_submissions` (§9).
- `outreach_send_queue` kind CHECK widened to allow `offsite`.
- `page_sources.collected_via` widened to allow `outreach_reply`.

Part III:

- `vertical_assets` and `client_assets` (§10d).
- `client_pages` gains `component_key` (null for every ordinary page) so a tool page can name the
  component that renders inside it (§10e).
- DROP `page_magnet_candidates`. DELETE every row of `lead_magnets`, **after** the house offers
  exist (§10b).
- Re-seed `lead_magnets` with the house offers only: book-a-consult for the patient lane, the AI
  Referral Engine and the AI Visibility Audit for the owner lane. Client-null and vertical-null so
  the ladder in `magnets.ts` treats them as wildcards — `NULL` means "any" on the ROW, never on a
  query.
- Orphan cleanup for the magnet wipe runs **after** the deploy, never before.

Orphan cleanup for the step merges runs **after** the deploy, never before.

House rule: every migration pasted in full into the session as a ```sql block, never as a file
path.

---

# §14 — Invariants the build must not break

- `publish-page.ts` stays the **only** publisher. Two grep checks require exactly one caller each
  of the gate assert and the Day-0 assert. The destination picker hooks **inside** `publishPage()`.
  Do not quote either call verbatim in a comment — the greps read source as text.
- No fourth `client_pages.status` value.
- Middleware stays deny-by-default. `/s/*` is an explicit allow on the **internal** branch only,
  never a relaxation of the external allowlist. That is the rule `HUB_API` exists to state.
- Cache keys for `/hub/{host}{path}` and `/s/{siteKey}/{path}` must stay disjoint.
- Step keys never change; labels are free. A rename means a new key plus a `LEGACY_STEP_KEYS`
  entry, never an edit in place.
- `isFirstParty()` in `page-evidence.ts` stays the single definition of what counts as evidence.
- Nothing in this build sends a first-contact email unattended.
- Nothing in this build posts to a forum, a comment section, or a profile.

---

# §15 — The ask, by platform (for sales, once Phase 3 lands)

| Their setup | What sales says |
|---|---|
| Cloudflare | "Add me as a Workers-only member on this one domain" — or paste the Worker we send |
| Vercel / Netlify | "Your dev adds two lines to `vercel.json` / `_redirects`" |
| Nginx / Apache | "Your dev adds one `proxy_pass` block" |
| Wix / Squarespace | Not possible → Export |
| **All of them, and it matters more** | "Your `robots.txt` must allow AI crawlers, and add one Sitemap line" |

---

# §16 — Order of work

1. §0 checkout. Verify `0  0`.
2. Phase 1 — Export + picker. Self-contained, no middleware. Ship it.
3. Phase 2 — `siteUrl()`. Eight literals. Nothing else.
4. **§7b the four new page formats.** Before §8, not after. Until `roundup`, `review`, `tool` and
   `data_study` exist, there is no page for the off-site lane to point at and no listed subject
   for it to read. This is the step that changes what a client actually gets written.
5. **§10b to §10g, Part III.** The house offers FIRST, then the wipe, then the shape pass at
   keyword selection, then the tool lane and the component registry. This is the part that
   changes what a client actually receives, and §7b's `tool` format is inert without it.
6. §8 off-site targets + the audit report section. Reads existing data, adds a table, risks nothing.
7. §6 gate wording + `quote_request`.
8. Phase 3 — subfolder plumbing, **with §10g's client-site embed snippet**. Same access ask.
9. Phase 4 — crawler door, pre-flight first, probe second.
10. §9 foundation listings + `srt_foundation_listings` ops workflow.
11. §10 `citation_outreach`.
12. Phase 5 — SRT pilot on `/learn`.
13. §12 step merges and renames. **Last**, because everything above adds content to steps that
    are about to be renumbered.
14. §17 the test script.

**Not in this build, deliberately:** the AI Skin Concierge vendor. Book-a-consult is the patient
default until one is keyed (§10f).

Rebase onto `feat/keyword-decisions` as it lands. Do not touch `_wt-kwstrategy`.

---

# §17 — The deliverable, at the very end

**After everything is built, committed and pushed — not before — write
`docs/ONBOARDING-TEST-SCRIPT.md` and commit it.**

It is a complete dry run of one fake client from intake to day 30, written so somebody can sit
down and type it without reading any other document. For every one of the 36 steps:

- The step number, key and label as they render on the card.
- Who acts: the system, Matthew, or the client.
- **The literal text to type into the thread**, verbatim, one command per message where the
  grammar demands it (`offer:` and `terms:` in one message saves neither).
- Which button to press, and what the card should say after.
- What the verifier checks, so a refusal can be read as information rather than a failure.
- What it unblocks.

Plus the tool walk-through, which is the new part of the onboarding and the part nobody has run:

1. At step 12, after `keywords pick`, the shape pass: which keyword deserves which shape, and
   which one is the tool. The exact command, and what comes back.
2. `tool pick N`, including the reuse prompt when the vertical library already holds a match.
3. Building it: the handback, what to paste where, and how the built component gets registered.
4. Seeing it live on its own page before the call — this is the preview Matthew demos.
5. `supports auto` writing the support pages that point at it.
6. Confirming a normal patient page offers book-a-consult and the tool page offers the tool.

Plus the off-site walk-through, in this order because each step feeds the next:

1. Planning a page and picking a `roundup` shape for it, with the exact command typed.
2. Naming the subjects, including ones that are not ours, and seeing them land in
   `offsite_targets` as `listed_subject`.
3. Hitting a MISSING field on `page_dataset` and turning it into a `quote_request`.
4. Hitting a blocked claim and resolving it **both** ways — waive with a reason, and ask.
5. Running `offsite_targets` and reading the new audit section.
6. Queueing a `citation_outreach` draft and approving it.
7. Submitting one foundation listing and verifying it went live.

Hand over the path to this file as the last thing in the session. Not a summary of it — the file,
committed and pushed.
