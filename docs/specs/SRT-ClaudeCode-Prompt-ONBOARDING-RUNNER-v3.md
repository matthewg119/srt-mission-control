# Claude Code — Onboarding Runner v3

**Supersedes:** Onboarding Runner v1 and v2. Delete both. This is the only onboarding paste.
**Status:** addendum to `SRT-ClaudeCode-Build-Prompt-v4.md`. Does not replace it. v4 still defines the schema, the hub, the funnel, the photographs and the review tool. This defines how an onboarding is DRIVEN, amends v4 §6, §7, §8, adds v4 §12 (step engine + Slack gates) and v4 §13 (audit to tenant bridge).
**Depends on (canon, read in the repo, never pasted):**
- `SRT-Pilot-Amendment-A1-Volume-and-Harvest.md` — ratified. Volume tracks, the harvest, tracked-set discipline. Changes `D-P5`.
- `SRT-Pilot-Amendment-A2-Market-Audit-Bridge-Universal-Set.md` — ratified. Market radius, audit to tenant separation, `universal_v1`, the four engines.
**Governed by:** `SRT-AEO-Onboarding-v2-PILOT.md` (highest, as amended by A1 and A2), then `SRT-AEO-Delivery-Offer-v2.md`, then `SRT-Ops-Manual-v1.md`.
**New in v3 vs v2:** findings-doc spec restored from v1 (§10) · Photograph I engine check (§4) · audit to tenant bridge (§14) · market definition + ZIP check (§15) · `universal_v1` seeded from the 20 Questions PDF, keyed by vertical (§4, A2 §4) · in-flight tenant migration (§18) · row count corrected — 20 numbered steps, 33 rows.

Start the session with `SRT-ClaudeCode-Kickoff-Onboarding-Runner-v3.md`. Paste everything inside the block below when Claude Code asks for it, after v4 §1–§11 are planned and approved.

> **Repo note, 2026-08-18.** This repo's session does NOT start from the kickoff above. It starts
> from `docs/SRT-ClaudeCode-CONTINUATION-hub-to-onboarding.md`, because the kickoff asks for
> reports on things that have now been measured and points at a schema this repo does not have.
> This file remains the specification for WHAT to build. Read the continuation doc's translation
> table before acting on any table name below: `tenants` is `clients`, `hub_pages` is
> `client_pages`, `ai_baseline` is largely `audit_runs`, `lead_avatars` is `niche_briefs`,
> `onboarding_docs` is `client_docs`, and `onboarding_tasks` is an extension of
> `DELIVERY_STEPS` / `client_delivery_steps` rather than a third list.

---

```
# WHAT THIS ADDS

Build Prompt v4 defines the schema, the hub, the funnel, the photographs
and the review tool. It does not define how an onboarding is DRIVEN. This
adds that: a step engine, gated one step at a time, run from the client's
Slack channel, where automated work runs itself and manual work is posted
to me as an instruction I reply to with screenshots. It also joins the
audit channel to the tenant record (§14) and defines the market check (§15).

Read v4 first. Everything there still applies, especially the three rails.
Read A1 and A2 from the repo before touching a publish path, a question
set, or an avatar. They are canon. Do not paste them; read them.

# THE ONE HARD RAIL THIS PROMPT ADDS

DAY 0 IS A WALL. Photograph II (run_label 'photograph_2') archives BEFORE
any change lands on a CLIENT-CONTROLLED property.

What the wall blocks:
- Publishing a page at the live hub host
- Submitting a correction to Google, Apple, Bing, Yelp, RealSelf, Facebook
  or any directory
- Editing any field on the Google Business Profile

What the wall does NOT block, and never did:
- Building the hub, theming it, drafting pages, approving pages
- Showing the client a PREVIEW on our own infrastructure
- Registering Vercel custom domains, adding DNS, verifying Search Console
- Building the cleanup list
Preview and staging are ours. The wall is about their properties.

Enforce in code: `tenants.day_0_archived_at`, NULL until photograph_2 is
written. Every write path to a client-controlled property checks it and
refuses with a clear error naming the step that has to happen first. If you
find a path where a page could publish or a listing could be edited with
day_0_archived_at NULL, STOP AND TELL ME.

# 1 · THE CHECKLIST — 20 STEPS, 33 ROWS

One constant, one file. Slack rendering, the dashboard board and the step
engine all read from it. Numbered rows are steps; lettered rows are
sub-steps and are real tasks with their own status. 33 rows total. The
Slack counter reads "X of 33 done." Column 3 is who does it, column 4 is
the v4 stage.

MEASURE
 1  Intake received, canonical NAP locked, audit
    attached if one exists (§14)                  auto      intake
 2  Photograph I — universal_v1 across the
    keyed engines (§4)                            auto      photograph_1
 2b Site + hosting + DNS intelligence             auto      photograph_1
 3  Presence sweep — automated tier               auto      photograph_1
 3b Presence sweep — manual tier, screenshots     me        photograph_1
 3c Presence & consistency PDF report             auto      photograph_1
 4  Competitor shortlist -> I pick 3              me        photograph_1
 4b Review audit: client + the 3 I picked         auto      photograph_1
 4c Avatar phrase harvest — Reddit + forums       auto      photograph_1
 5  Findings doc written up and attached (§10)    auto      photograph_1

PREPARE — before the call, none of it touches their properties
 5b Avatar proposed in Slack, I confirm           me        photograph_1
 5c Custom question set drafted for approval      auto      photograph_1
 5d Page candidates scored, 100 for the call      auto      photograph_1
 5e Citation cleanup list built and ranked        auto      photograph_1
 5f Hub built, themed, PREVIEW live in Mission
    Control, theme confirmed by me                auto+me   photograph_1
 5g Review tool PREVIEW live, themed to match     auto      photograph_1
 5h Review card PDF generated                     auto      photograph_1
 5i Call sheet PDF generated and attached         auto      photograph_1

THE CALL
 6  Call booked                                   me        call
 7  Call held: NAP aloud, question set approved,
    consent confirmed, preview walked, pages
    selected from the 100                         me        call
 8  Access granted: GBP manager, Search Console,
    Analytics                                     me        call
 9  DNS: two CNAMEs and one TXT added by client   me        call

DAY 0
10  Photograph II archived — universal + custom.
    THE WALL.                                     auto      photograph_2

BUILD — unblocked by step 10, not before
11  GBP buildout: categories, services, photos,
    Q&A seeded from the baseline questions        me        build
12  Citation cleanup executed from the 5e list    me        build
13  Subdomain live, verified in Search Console    auto+me   build
14  First pages published — measured track first,
    tagged per A1                                 auto+me   build
15  Cards printed and handed to the clinic        me        build
16  Automated request configured in their booking
    system, or card_only recorded                 me        build
17  Review tool handed to the named person        me        build
18  Time log has entries from day 0               auto      build
19  Weekly Slack report firing                    auto      build
20  Day-30 report date set                        me        build

After 20 the tenant flips to 'rhythm' — a scheduled loop, not more
checklist (§16). After the pilot's day 90 it flips to 'renew', which for a
pilot is the pilot doc §13 close-out.

# 2 · THE STEP ENGINE

New table. Do not overload onboarding_steps — that stays as the v4 8-stage
board. This is the finer-grained task list under it.

onboarding_tasks
  id, tenant_id, seq numeric (so 5.5 can be inserted later), key (stable
  slug, e.g. 'presence_sweep_manual'), label,
  stage (v4 8-stage enum),
  mode ('auto' | 'manual' | 'auto_then_manual'),
  status ('blocked'|'ready'|'running'|'awaiting_me'|'done'|'error'),
  blocked_by text[] (keys), slack_message_ts, output_ref, error_detail,
  started_at, completed_at, completed_by

- A task is 'ready' only when every key in blocked_by is 'done'.
- 'auto' runs itself when ready.
- 'manual' and 'auto_then_manual' post to Slack and sit in 'awaiting_me'.
  They go 'done' ONLY when I click the button. Never infer completion from
  a file upload. Never auto-advance past a human.
- Seed all 33 rows at provisioning from the §1 constant, so the checklist
  and the engine can never drift apart.
- Every auto task is idempotent. Re-running writes a new output_ref and
  supersedes; it never duplicates rows in nap_discrepancies, ai_baseline,
  citation_sources, question_bank or competitor_candidates.

RLS on onboarding_tasks.

# 3 · SLACK IS THE UI

All posts to tenants.slack_channel_id. Never hardcode.

One checklist message per tenant, posted at provisioning, updated in place
with chat.update. Store its ts on the tenant. Keep the existing format
(stage headers, numbered rows, tick / dot, "X of 33 done."), extend to 33
rows driven by onboarding_tasks.

Tasks needing me post a threaded message with:
- imperative sentences and the EXACT string to search or paste. Never
  "check the listing." Always "Search Google for: Acme Med Spa Greensboro NC"
- buttons: [Done] [Skip — not applicable] [I hit a problem]
- [Done] on an upload task validates the expected file count landed in the
  thread; if not, it names what's missing and stays open.

Files uploaded in a task thread are captured via the Slack events API,
stored in Supabase storage, written to onboarding_docs against that task.
That is how screenshots become evidence without me filing anything.

Daily digest to #alerts-infra: tasks in 'error', and tasks 'awaiting_me'
longer than 48h.

# 4 · STEP 2 — PHOTOGRAPH I: THE QUESTIONS AND THE ENGINES

THE QUESTIONS. universal_v1 exists — it is the 20 questions of the lead
magnet, verbatim, with a fixed substitution table. Both are in A2 §4.
Seed universal_v1 for vertical 'med_spa' from A2 §4, character for
character. If SRT-Question-Sets-v1.md carries a fallback universal set
that differs, the A2 list wins and the fallback is retired — TELL ME
before you retire it. Materialize per tenant: substitute {city}, {state},
{treatment_primary}, {competitor_intake_1}, {concern}, {device_primary},
{client_name} from the tenant record and freeze the values in
tenants.question_substitutions. Store question_text AS RUN on every
ai_baseline row.

Universal sets are keyed by vertical. This build is med_spa. A tenant of
another vertical (the SRT test tenant is one — see §18) uses
universal_v1@{vertical}, frozen from the audit generator's 20 for that
niche at its first Photograph I. Nothing from a non-med_spa tenant enters
a med_spa case study.

THE ENGINES. The offer names four: ChatGPT, Gemini, Perplexity, Google AI
Overviews. v4 §6 asks you which are actually keyed. Answer that FIRST and
in writing. Photograph I runs universal_v1 across every keyed engine of
the four. Fewer than four is possible in the short term and must be
visible everywhere: the fidelity footer on every artifact reads
"N questions x M engines · {date} · {question set versions}", and M is
the number that actually ran. A one-engine run is never labelled
photograph_1 for a paying or pilot client — that is a prospect_audit-grade
run (§14). Do not run client one's Photograph I until I have said in
writing which engine count I am accepting as the baseline.

KNOWN TENSION, name it in your report: this build is official APIs only.
ChatGPT, Gemini and Perplexity have official APIs. As far as I know
Google AI Overviews does not. If that is still true, AI Overviews is a
MANUAL SAMPLED CAPTURE (screenshots on the findings doc, labelled
"sampled") and is not in the automated grid, and the footer says so:
"N questions x 3 engines automated + AI Overviews sampled." Do not
scrape Google to make it four. Do not present Gemini as AI Overviews.
Which of these is true decides an on-camera line, so it goes to Lina in
writing, not into a comment.

WHAT IT WRITES. ai_baseline rows: run_label 'photograph_1', tenant_id,
question_set_version, engines text[], question_text as run, per engine:
named / not named / named alongside / named instead, businesses_named,
cited sources -> citation_sources with run_id. Vocabulary is fixed here
and never changes: named, not named, named alongside, named instead.
Never ranked, position, #N, top result.

The headline "named in X of 20" follows Artifact Templates §3. If §3 does
not define how engines roll up into that count, define it as "named by at
least one engine," always print the per-engine grid under it, and tell me
you had to define it.

# 5 · STEP 2b — SITE, HOSTING AND DNS INTELLIGENCE

Extend the existing WHOIS/Lighthouse/robots work in audit-engine. Do not
add a module.

- WHOIS: registrar, created/expires, privacy on/off
- DNS: A, AAAA, CNAME, NS, MX, TXT at apex and www
- NS -> DNS PROVIDER. This is the important one. The registrar and the
  DNS host are frequently different, and the NS record is the truth about
  which UI the client has to open on the call. Map to a known provider:
  Cloudflare, GoDaddy, Namecheap, Route53, Google Domains/Squarespace,
  Wix, Bluehost, HostGator, Network Solutions, GoHighLevel, Hover, Porkbun.
- Hosting: reverse DNS + ASN/org on the A record, response headers
  (server, x-powered-by, x-vercel-id, cf-ray, x-generator)
- CMS fingerprint from HTML and asset paths: WordPress, GoHighLevel, Wix,
  Squarespace, Duda, Webflow, Shopify, custom
- MX -> mail provider (Google Workspace vs MS365 changes how the Search
  Console TXT verification conversation goes)
- SUBDOMAIN AVAILABILITY: resolve learn.{domain}, guide.{domain},
  reviews.{domain}. If learn. already resolves, set
  tenant_hub.subdomain_convention='guide' and log the exception on the
  tenant. This decision gets made here, before the call, never on it.
- Site inventory: sitemap + crawl -> URLs, titles, h1s ->
  tenant_hub.page_inventory
- Geocode the canonical address -> tenants.market_center. §15 needs it.
  Prefer the US Census geocoder or a static ZIP-centroid dataset over
  Places for this: market_center is stored for the life of the tenant,
  and Places lat/lng is (as I understand the terms) cacheable ~30 days.
  Store the place_id regardless — that may be kept.

Write to tenant_hub.site_intel jsonb.

PROVIDER-SPECIFIC CLICK PATHS. Maintain a lookup table keyed by DNS
provider giving the literal instruction printed on the call sheet:

  GoDaddy   -> "Open godaddy.com, sign in, My Products, find {domain},
                click DNS, then Add New Record"
  Cloudflare-> "Open dash.cloudflare.com, select {domain}, click DNS,
                then Add record. Set Proxy status to DNS only."
  Squarespace-> "Open account.squarespace.com, Domains, {domain},
                DNS Settings, Add Record"
  Wix       -> "Open manage.wix.com, Domains, {domain}, Advanced,
                Edit DNS"
  Namecheap -> "Open namecheap.com, Domain List, Manage next to {domain},
                Advanced DNS, Add New Record"
  ...

Unknown provider -> print the NS records and say so plainly rather than
guessing. Same lookup drives the GBP / Search Console / Analytics access
instructions in §13.

# 6 · STEPS 3, 3b, 3c — PRESENCE SWEEP

Two tiers, and they are NOT the same thing. Do not blur them.

CORE SIX — the findings gate, and the only tier we remediate in week one:
  Google · Apple · Bing · Yelp · RealSelf · Facebook

EXTENDED — informational only. Tells us where they stand on presence
consistency. Findings section 2 states it as context. Anything broken here
goes on the implementation list, NOT the week-one cleanup list:
  Foursquare · Yellow Pages · BBB · Nextdoor · Manta · Healthgrades ·
  NPI Registry · local chamber · MapQuest · Superpages · Hotfrog ·
  Citysearch

Every artifact must show which tier a finding came from. A core-six
mismatch and a Manta mismatch are not equivalent and the client-facing doc
must not imply they are. Both lists are keyed by vertical in config
(RealSelf, Healthgrades and NPI are med_spa rows); do not build a second
vertical's list now.

## Automated tier
Report which of these are ACTUALLY KEYED before building against them,
the same way v4 §6 asks about engines. Do not build against a key that
does not exist.
  - Google Places API (Text Search + Place Details). Return ALL results
    matching the name within 25 mi of canonical, not just the top one —
    duplicates only surface if you keep the whole result set. (25 mi is a
    duplicate-search radius. It is NOT the market radius — that is §15.)
    TERMS: as I understand Google Maps Platform terms, place_id may be
    stored indefinitely and most other Places content may only be cached
    ~30 days. So the evidence of record for a finding is the SCREENSHOT
    (manual task, or one I take from the listing URL the API gives me),
    not API text held for months. Verify the current terms and tell me
    what the sweep may keep, the same way you verify Yelp's.
  - Bing Maps Local Search API
  - Foursquare Places API
  - Yelp Fusion — IF a key exists AND its current terms permit this use.
    VERIFY, do not assume.

## Manual tier
Apple Business Connect, RealSelf, Facebook, and every Extended platform
without an API, plus anything the automated tier errored on. These have no
usable search API and several actively block automated querying. No
scraping, no headless browsers against sites whose terms prohibit it.

## The four states — presence is the easy half
  match      — name, address, phone all identical after normalization
  mismatch   — listed, at least one field differs
  duplicate  — 2+ live listings for one business on one platform
  missing    — no listing; record claimed Y/N separately for unclaimed

A business can be listed on all eighteen platforms and still fail.

## Normalization — pure functions, unit tested
- lowercase, strip punctuation
- street abbreviations both directions: St/Street, Ste/Suite/#, Ave/Avenue,
  N/North, Blvd/Boulevard, Dr/Drive, Rd/Road
- entity suffixes (LLC, L.L.C., Inc, Inc., Corp): compare BOTH with and
  without, and report which matched. Presence/absence is a real finding,
  not noise to normalize away.
- phone to E.164
Compare NORMALIZED. Report the RAW listed value always — the client-facing
doc has to show exactly what is live on the internet today.

nap_discrepancies gains: tier ('core_six'|'extended'),
source ('api'|'manual'), listing_url, claimed bool, screenshot_ref,
checked_by, checked_at, proposed_status, confirmed_status

NEVER auto-mark a listing verified. The tool proposes; I confirm.

## The Slack post — this replaces the CSV worksheet entirely

  Step 3 · Presence sweep — 4 of 18 done automatically
  Canonical: Acme Med Spa · 1200 W Market St Ste 200, Greensboro NC 27403
             · (336) 555-0142

  CORE SIX
  x Google — 2 listings, 1 DUPLICATE at a previous address
  x Bing — phone mismatch: listed (336) 555-0199
  ! Yelp — API returned 429, do this one manually

  Please do these manually. Search string, then screenshot:
  CORE SIX
   1. Apple Maps — search: Acme Med Spa Greensboro
   2. RealSelf — search: Acme Med Spa Greensboro NC
   3. Facebook — search: Acme Med Spa Greensboro
   4. Yelp — search: Acme Med Spa Greensboro NC
  EXTENDED (context only — findings, not week-one cleanup)
   5. Yellow Pages — search: Acme Med Spa Greensboro NC
   6. BBB — search: Acme Med Spa Greensboro NC
   ...

  For each: screenshot showing name, address and phone. If there is no
  listing, screenshot the empty search result — that IS the evidence for
  "missing."
  Reply in this thread, then hit Done.

  [Done] [Skip a platform] [I hit a problem]

After upload, post a compact table of proposed statuses with raw values
and ask me to confirm or correct each. Then 3b is done.

## Step 3c — the PDF
Same generator and visual treatment as the AI visibility audit report.
Contents: canonical NAP block · summary counts by status, core six and
extended separated · every finding worst-first (duplicates, wrong phone,
wrong address, name variants, missing) with canonical vs listed side by
side and the screenshot inline · which platforms were automated, which
manual, which skipped and why. A skipped platform renders as "not checked,"
NEVER as "no issues found."
Output to onboarding_docs, post to the channel. This PDF is Findings
section 2's evidence.

# 7 · STEP 4 — COMPETITOR SHORTLIST, 10 -> I PICK 3

Do not use the client's three guesses as the audit set. Use them as
candidates alongside who the engines actually named.

Ten candidates from:
- every distinct business in ai_baseline.businesses_named from Photograph I,
  ranked by how many of the 20 questions named them and across how many
  engines
- plus the 3 named at intake Step 2, flagged as such even if no engine
  mentioned them — that gap is a finding worth saying out loud on the call
- de-duplicate on normalized name + address
- exclude national chains and aggregator pages: consensus lock, not
  competitors (Integrity Law 7)

competitor_candidates — tenant_id, name, address, place_id, website,
  source ('baseline_named'|'client_intake'|'both'), times_named,
  engines text[], sample_questions text[], selected, selected_at,
  selected_by

Slack post: numbered list, each with name, website, address, how many of
the 20 named them, which engines, one example question. I Google each one
myself before picking, so give me the URL. Multi-select, exactly 3.
Nothing proceeds until 3 are selected.

# 8 · STEP 4b — REVIEW AUDIT

Runs automatically on my 3: review count, average rating, recency of most
recent review, owner response rate, themes in negatives. Same fields for
the client. That is Findings section 3. Read-only, official APIs where they
exist, manual screenshot task where they don't. Never a scrape.

# 9 · STEP 4c — AVATAR PHRASE HARVEST

Purpose: find what this clinic's actual avatar types, in their words, so
those phrases are TRACKED FROM DAY 0 rather than discovered in month two.
Governed by A1 D-P11 and D-P12.

Sources, read-only, keyed by vertical in config:
- Reddit, via the OFFICIAL API with our own credentials. VERIFY current
  terms permit this use before building. No scraping.
  med_spa subreddits: r/30PlusSkinCare, r/SkincareAddiction,
  r/PlasticSurgery, r/Botox, r/AskDocs (read only), plus city subreddits
  for {city}
- RealSelf Q&A
- Public forum threads surfaced by the engines' own cited sources —
  citation_sources already holds these, Photograph I's rows and, if an
  audit exists, the prospect_audit's rows (§14). Both are harvest input.
Search seeded from: intake Step 3 objections verbatim, the services
taxonomy, {city}, {treatment}.

REDDIT IS RESEARCH ONLY. We never post to Reddit or any forum, and never
as the client. This is already canon. Do not build a posting path.

Extract question-shaped and objection-shaped phrasings, dedupe, score:
  frequency_score          — how often the shape recurs
  commercial_intent_score  — 0 to 3
  avatar tag               — a1 / a2 / a3
  objection_phrase bool    — does it name a fear
Write to question_bank (GLOBAL, already in v4 §1) with source='harvest'
and harvest_run_id (A1 §6). Per-tenant substituted copies go to
page_candidates.

HARD SEPARATION, restating v4 and A1: question_bank and page_candidates
NEVER write to ai_baseline.question_set_version. The harvest feeds two
different places through two different tables — the custom TRACKED set
(via 5c, approved by the client on the call, then frozen) and PAGE
candidates (via 5d, regenerated monthly, never frozen). If you find a
path where the harvest could edit a frozen tracked set, STOP AND TELL ME.

# 10 · STEP 5 — FINDINGS DOC

Assembled from what steps 2-4c already wrote. Six sections, Artifact
Templates §2 order, no deviation:
  1 Where AI names other clinics in {city} instead of you — lead with the
    3-5 real UI screenshots, name the competitors, state "named in X of 20"
    with the per-engine grid under it
  2 Why — the nap_discrepancies log in plain language, core six first,
    extended labelled as context, the 3c PDF attached
  3 The review gap — client vs the 3 I selected
  4 The technical gap — from step 2b: no schema, crawlers blocked, no
    answer-shaped pages, one line each, no jargon
  5 The plan for the next 21 days — A PLAN. Never a priced fix list. For
    pilots nothing purchasable appears anywhere in this section.
  6 What we need from you — the access list, only the access list
  Fidelity footer: N questions x M engines · date · question set versions.

If a prospect_audit is attached (§14), section 1 may reference it as
"the audit you already saw" and nothing more. Its numbers are never
combined with Photograph I's.

Output PDF + markdown to onboarding_docs, post both to the channel.

# 11 · STEP 5c — THE CUSTOM QUESTION SET

Built from three inputs, per SRT-Question-Sets-v1.md and A1 D-P12:
  1. intake Step 3 — ideal patient, highest-margin treatment, the three
     objections verbatim, what patients try first
  2. the 4c harvest, ranked by frequency x commercial intent
  3. Photograph I's cited sources — what the pages that ARE cited answer

Counts: 20 (Core scope) or 60 (Complete scope). Composition target,
guidance not quota: ~40% objection- and fear-shaped, ~25% treatment and
procedure comparison, ~20% neighborhood/landmark/adjacent-city, ~15%
commercial.

Printed in full on the call sheet, under the materialized universal 20.
The client approves once and adds anything missing — that addition is the
point, not a formality. On approval, freeze as custom_v1 for that tenant.

Step 10 (Photograph II) runs universal_v1 + custom_v1 = Day 0. That is
how avatar-specific phrases get measured from day zero.

Later discoveries create custom_v2. They do NOT edit custom_v1. At the
next re-test, run both versions once so there is an overlap point,
otherwise the trend line breaks. custom_v2 questions carry their own
baseline date and the scorecard states it.

# 12 · STEPS 5b, 5d-5i — PREPARE

5b · AVATAR — v4 §5 as written, one addition from §14: if a prospect audit
exists for this business AND its niche_cache_key equals the tenant's
vertical, its avatars are posted alongside the v4 §5 proposal as
CANDIDATES, with their free-form labels, and I map one to a1/a2/a3 or
reject them. Nothing writes tenants.primary_avatar except my click.
Blocks 5c and 5d.

5d · PAGE CANDIDATES — 100, not 15.
Score the seeded prompt_library plus the 4c harvest against the confirmed
avatar using the v4 §7 formula. Surface the top 100 for the call, ranked,
grouped by avatar and by theme, each showing: the question, the avatar,
the score, whether any engine currently names the client for it, and
whether the phrase appears in their own reviews.
Deliver as a PDF for the call AND as a Slack multi-select so selections
write straight back to page_candidates.selected_for_month.
Publishing volume is governed by Amendment A1, not by this number. 100 is
a menu to choose from; what actually publishes and what it is tagged as
(hub_pages.scope 'measured' | 'over_delivery') is A1's decision. Read A1
before building the publish path.

5e · CITATION CLEANUP LIST — from nap_discrepancies, core six first,
ranked worst-first: duplicates, wrong phone, wrong address, name variants,
missing. Each row: platform, tier, canonical vs listed, the correction,
what access it needs, estimated minutes. A LIST. Nothing submits.
Corrections need GBP manager access (step 8) and are blocked by the wall
(step 10) regardless.

5f · HUB PREVIEW IN MISSION CONTROL.
Site scan and theme extraction per v4 §3. Hub built, themed, drafts
rendered. Served at an internal preview host on our own domain —
noindex, no client DNS, not the live hub host. The client sees exactly
what it will look like and asks for changes BEFORE anything goes live.
Theme confirmed by me in the dashboard before the preview is shown.
Vercel custom domains pre-registered for both client hosts so the CNAME
at step 9 resolves immediately.

5g · REVIEW TOOL PREVIEW.
Built per v4 §8 and SRT-Review-Tool-BUILD-SPEC-v2.md. Reachable at the
same internal preview host so it can be demoed on screen alongside the hub.

  THEMED, but only visually. The review tool takes the same theme object
  as the hub — logo, palette, fonts — so it reads as the clinic's page and
  not an agency page. The COPY, the four questions, the flow, the bullet
  labels, the destination links and every rule in the build spec are
  IDENTICAL for every clinic and are not themable. Visual theme per client;
  wording and structure never.

  Identical build to production. Do NOT create a separate demo mode with
  different copy.
  Demo text typed live on the call is fine. NEVER ship pre-filled sample
  patient answers — a fabricated patient review is precisely what this
  tool exists not to produce.
  Any submission from the preview host is DISCARDED. It does not write to
  review_tool_submissions and it does not write to client_corpus. Gate on
  the HOST, not on a flag someone can forget to set. If demo text can
  reach the corpus, the objection-phrase metric is corrupted and so is
  every AEO number built on it.

5h · REVIEW CARD PDF — v4 §8 card generation, so the physical card is on
screen during the call.

5i · CALL SHEET — §13 below.

# 13 · STEPS 6-9 — THE CALL SHEET PDF

Generated once 3c, 4b, 5b, 5c, 5d and 5f are done. Every value from the
tenant record. No placeholders, no blanks I fill in live.

  HEADER — clinic, owner, date, scope (internal), language
  Recording consent ask, first thing. The call is recorded with consent,
  for the timing log and for the "what do you actually do differently"
  quotes that feed answer pages.

  0-15 FINDINGS
    The 3-5 screenshots, printed. Competitors named instead, with counts.
    Named in X of 20, engines stated.

  15-20 CANONICAL NAP — read aloud field by field, each pre-filled from
    intake with a correction box:
    Legal name / DBA / Street / Suite / City / State / Zip / Phone /
    Website / Hours incl. holiday policy

  20-28 QUESTION SET — the universal 20 as materialized (substituted
    values visible, correction box next to each) and the custom 20 or 60,
    printed in full, space for additions. "Approve once. Add anything
    missing." A corrected substitution is logged; Photograph II runs the
    corrected text and the I->II delta on that question is marked
    not-like-for-like.

  28-43 ACCESS — per platform, the literal instruction with the real
    provider name from step 2b, plus the SRT email to invite:
      GBP:            "Open business.google.com, select {clinic}, Users,
                       Add, invite {srt email} as Manager"
      Search Console: "Open search.google.com/search-console, add {domain}
                       as a Domain property — that needs the TXT below"
      Analytics:      "Open analytics.google.com, Admin, Property Access
                       Management, add {srt email} as Editor"
      Yelp / Facebook / Bing / Apple as applicable
    Then the four blockers and what each costs:
      Unclaimed GBP — claim together, live, instant, credibility moment
      Old agency holds GBP — start Google's ownership request ON THE CALL,
        fixed 7-day wait, usually the long pole
      Duplicate GBP — file merge/removal, 2-3 weeks, start early
      Registrar unknown — already answered by 2b, printed below

  DNS — three records, real values, with the provider-specific click path
    from the 2b lookup:
      "{DNS provider} — {literal click path}"
      CNAME  learn.{domain}    -> {vercel target}
      CNAME  reviews.{domain}  -> {vercel target}
      TXT    {domain}          -> {search console string}
    Registrar is {X}. DNS is actually managed at {Y} per the NS records.
    Mail is {Z}. Never ask for registrar credentials — they drive.

  43-50 REVIEW MECHANISM
    Booking/messaging software from intake: ____
    Automated request lives in it, or card_only — circle one
    Destination: Google primary / RealSelf for procedure visits
    Named person for the review tool: ____ (a name, not "the front desk")
    Restate once: every patient, own phone at home, nothing offered,
    nobody prompted for a name
    Intake flags — lobby tablet? incentives? — if either was yes, it is a
    conversation here and it stops

  50-55 PREVIEW WALKTHROUGH
    Hub preview link. Review tool preview link. The card.
    Then the 100 page candidates — mark what they want first.

  55-60 CONSENT confirmed aloud, verbatim from pilot doc §16.4.
    Day-30 report date set.

  CAPTURE PAGE — one page holding everything I have to write down: NAP
  corrections, substitution corrections, named person, booking software,
  destination, access granted Y/N per platform, blockers hit, pages
  selected, day-30 date.

Also render as a live dashboard checklist so what I tick writes straight
to the tenant record. The PDF is the backup.

# 14 · AUDIT -> TENANT BRIDGE (v4 §13, governed by A2 D-P14)

The audit channel (#ai-visibility-audits) and the onboarding channel are
two systems about the same business at two different moments. Join them
on the business, and keep their numbers apart.

WHAT AN AUDIT IS. One engine (ChatGPT with web search), 20 prompts
generated for the SUBJECT'S niche, a 0-100 score, named-in-N-of-20, who
was named instead, cited sources, a PDF, a report URL. It is a prospecting
asset. It is NOT Photograph I: wrong engine count, and its question set is
the niche generator's, not universal_v1.

WHAT CARRIES ACROSS at provisioning (step 1), if a lead exists for the
same business (match on place_id, else domain, else normalized NAP):
- the run, as an ai_baseline row: run_label 'prospect_audit',
  engines ['chatgpt_web'], question_set_version 'audit_{niche}_v{n}',
  question_text as run, named/not named per question, businesses_named,
  cited sources -> citation_sources with run_id, score, pdf_ref,
  report_url, and excluded_from_scorecard = true — enforced in the
  scorecard query, not by convention. It never appears on a scorecard,
  in a re-test, in a case study, or in a fidelity footer as anything but
  itself.
- its cited sources, as harvest input only (§9).
- its avatars, as CANDIDATES for 5b — see the rule below.
Nothing else. The audit's score never seeds a trend line.

THE AVATAR RULE — subject-keyed, not taxonomy-keyed. The audit's avatar
generator is niche-keyed: run on a dentist it produces the dentist's
ideal patients, run on a roofer the roofer's, run on SRT itself
(niche_cache_key 'aeo-marketing-agency') it produces SRT's buyers with
retainer ranges. So the discriminator is the SUBJECT:
- audit avatars live in lead_avatars — id, audit_run_id, niche_cache_key,
  subject (place_id / domain / normalized NAP), avatars jsonb (the three
  worth chasing, the three to avoid, labels, descriptions, the "asks AI"
  prompt, retainer_range where the generator produced one), pick,
  generated_at, expires_at (30-day cache, as the bot already does)
- lead_avatars is read for a tenant ONLY where niche_cache_key equals
  tenants.vertical. A row cached under any other niche is never read for
  that tenant. Not "SRT's rows" specifically — any mismatch.
- ONE VOCABULARY. tenants.vertical takes its values from the audit bot's
  niche_cache_key, verbatim — no mapping table, or the rule above never
  matches and nobody notices. 'med_spa' throughout this document stands
  for whatever string the bot actually uses for med spas: find it and use
  it. The SRT test tenant's vertical is 'aeo-marketing-agency' because
  that is the bot's key.
- KNOW WHAT THE CACHE IS. The bot caches avatars per NICHE for 30 days,
  not per business — every med spa audited this month gets the same three.
  That is why they are candidates for 5b and never the answer; the
  clinic-specific avatar comes from v4 §5 (intake + their own reviews).
- the audit emits free-form labels; the tenant needs the fixed enum
  a1 nervous first-timer / a2 fixer-switcher / a3 maintenance buyer.
  The mapping is a human click in 5b. Never automatic.
- retainer_range is meaningless for a patient and never carries.
- lead_avatars never writes tenants.primary_avatar. Only 5b does.

WHAT NEVER CARRIES. The audit's "prompts as run" never become a tracked
set. The audit's score never appears next to a photograph. If you find a
join that lets prospect_audit rows into a scorecard, re-test, or
case-study query, STOP AND TELL ME.

Schema: lead_avatars (above); ai_baseline gains excluded_from_scorecard
bool default false; citation_sources gains run_id if it lacks one;
tenants gains lead_id nullable.

# 15 · MARKET DEFINITION AND THE ZIP CHECK (A2 D-P13)

A market is a 10-mile radius around the tenant's canonical address.
One clinic per market. Pilots hold a market exactly like paying clients.

- tenants.market_center (lat/lng, from 2b), tenants.market_radius_mi
  integer NOT NULL default 10. Changing a radius is an admin action,
  logged, and only ever follows the agreement — the number is not a
  dial.
- A market is HELD by any tenant with billing_status in
  ('active','pilot') — reuse the exact status list v4 already uses for
  "holds a seat"; if v4 has one, that list wins and tell me if it differs.
- Checkout ZIP check: geocode the entered ZIP to its centroid; if that
  point is within market_radius_mi of ANY held tenant's market_center,
  the market is held -> block checkout, offer the waitlist, no counter,
  no "how many seats" anywhere. Same check at intake for pilots.
- The check reads market_center, not ZIP equality. Two clinics in the
  same ZIP nine miles apart is one market; two ZIPs a mile apart is one
  market.
- Contract wording for the radius is a pilot-doc / agreement item, not
  yours. Build the number.

# 16 · AFTER STEP 20 — THE RHYTHM LOOP

Scheduled job, not checklist steps. Governed by Amendment A1 for volume.

WEEKLY
- Harvest run per tenant (§9 mechanism, same sources): surface 50 ranked
  page ideas to the client's Slack channel as a multi-select. I pick the
  week's set. Selections write to page_candidates.selected_for_month and
  generate drafts into the hub_pages review queue.
- Weekly report per Artifact Templates §4. Crawler activity leads AND is
  labeled a leading indicator in the same sentence. Never implies movement
  in AI answers a re-test has not shown.

MONTHLY
- Pages publish at the tier count as scope 'measured', preferentially
  covering tracked questions; everything above it as 'over_delivery'.
  Hours for the second track go to time_log category pages_over_delivery,
  excluded from the subscription total. (A1 D-P5a, D-P5b.)
- One GBP post per fortnight
- Review responses: negatives and objection-bearing reviews only, written
  per review, in language, never templates
- Outreach (Complete scope only) per v4 §10 — outreach log visible to
  the client, including non-responses; paid listings disclosed; no
  commissions, ever
- Regenerate page selection

DAY 30 / 60 / 90
- Re-run universal_v1 + custom_v1 (+ custom_v2 alongside if it exists),
  identical question_text, identical engines
- Scorecard per Artifact Templates §3. Vocabulary FIXED: named, not named,
  named alongside, named instead. Never ranked, position, #N, top result.
  Show questions that moved to not-named as well as to named.
- Confounds line every month: implementation yes/no, ads yes/no,
  over-delivery "{n} pages above the standard count this month, {N} to
  date" (A1 D-P5c)
- Fidelity footer on everything
- Short video. Flat months get a video and it says the month was flat.

# 17 · ERRORS

Auto task fails -> status 'error', error_detail populated, posted to the
client channel as a plain instruction, counted in the #alerts-infra digest.

  ! Step 3 · Bing Maps returned 401 (bad key).
  Do this one manually: search Bing Maps for "Acme Med Spa Greensboro NC",
  screenshot the listing, reply here.
  [Retry automatically] [I'll do it manually] [Skip this platform]

- An error NEVER silently advances a step or skips a platform.
- 429 retries with exponential backoff, 3 attempts, then it is my problem.
- 401/403 does NOT retry — that is a key problem and I need to know now.
- A skipped platform records the reason and renders as "not checked" in
  every artifact, never as "no issues found."

# 18 · IN-FLIGHT TENANTS — MIGRATION

Any tenant provisioned under the old 14-step checklist migrates in place.
Right now that is one: the SRT test tenant ("Search Retrieval Tactics",
srtagency.com, #onboarding-srt-aeo, vertical 'aeo-marketing-agency' — the
audit bot's key — not med_spa).

- Keep the tenant. Re-seed onboarding_tasks with the 33 rows. Replace the
  14-step checklist message in place with chat.update — same ts, new body.
- Old 1 -> new 1: done.
- Old 2 -> new 2: 'done' ONLY if the run used that tenant's universal_v1
  across the keyed engines. The run in the channel says "one engine,
  ChatGPT with web search" — that is prospect_audit-grade. Relabel it
  run_label 'test_run', excluded_from_scorecard = true, and leave new 2
  'ready'. Do not delete the rows.
- Old 3 -> 3/3b/3c · 4 -> 4/4b · 5 -> 5 · 6-14 -> 6-14. All 'blocked' or
  'ready' per blocked_by; nothing is inferred done.
- A test tenant of another vertical never enters a med_spa case study and
  never holds a med_spa market.

# CONSTRAINTS

- No new third-party services beyond API keys for the presence sweep,
  Reddit, and geocoding via the Places key already in play. Slack,
  Supabase, Vercel, existing PDF generation.
- Official APIs only. No scraping, no headless browsers against sites
  whose terms prohibit it.
- Six concurrent clients. Don't build a workflow engine — build 33 rows
  and a status field.
- The 33-row array is one constant in one file.
- Everything vertical-specific (universal set, harvest sources, directory
  tiers) is a config row keyed by tenants.vertical. med_spa is the only
  vertical built. Do not build a second one.
- RLS on onboarding_tasks, competitor_candidates, lead_avatars.
- Vocabulary in every artifact: named / not named / named alongside /
  named instead. Never ranked.
- bun run build passes clean. Branch. Show me before any push or deploy.

# HOW TO WORK

1. Report first: does the repo have Slack interactivity (buttons, events
   API, file capture)? slack-bot.ts has createChannel and inviteToChannel
   — say what else exists and what is genuinely new.
2. Tell me which of Google Places, Bing Maps, Foursquare, Yelp Fusion and
   the Reddit API are actually keyed and working. Do not build against a
   key that does not exist. Same question as v4 asks about engines.
3. Tell me which of the four engines (ChatGPT, Gemini, Perplexity, Google
   AI Overviews) Photograph I can run today. One number. If it is one,
   say so — §4 and §18 depend on the answer.
4. Confirm you can enforce the Day 0 wall in code, and show me where.
5. Read A1 and A2 and tell me if anything in them conflicts with what is
   already in the repo — especially D-P5 (volume), D-P13 (market), D-P14
   (audit bridge), D-P15 (universal_v1) — or with SRT-Question-Sets-v1.md.
6. Then plan §2 (the step engine) ONLY. Wait for approval.
7. One section at a time. Stop after each. Suggested order after §2:
   §4 -> §14 -> §15 -> §18 -> §5 -> §6 -> §7-§9 -> §10-§13 -> §16 -> §17.

Closed since v2: market is defined (A2 D-P13). The 20 Questions PDF exists
and is universal_v1 (A2 D-P15). Integrity Laws are numbered 1-12 in
PROJECT-CANON v4 §5 and that numbering is the one to cite.
Still open, and yours to raise only if it blocks you: Reddit API terms,
Yelp Fusion terms, the signable pilot agreement, the four-engine count.

If something here won't work, say so. Don't work around it silently.
```

---

## Notes for Matthew and Lina, not for Claude Code

**Three things v3 changes that v2 didn't have.** (1) The audit and the onboarding are now joined on the business, with a wall between their numbers — the audit's single-engine run can never sit next to a photograph. (2) The market is a number now: 10 miles, centre on the canonical address, checked by distance not ZIP equality. (3) `universal_v1` is no longer a fallback waiting for a PDF; it is the PDF's 20, verbatim, with a fixed substitution table in A2 §4.

**The one thing to settle before client one:** the engine count. The offer says four; the SRT test run used one. Item 3 in HOW TO WORK forces that answer into writing before any client baseline runs.

**Why 33 and not 24.** v2's header said 24 but listed 33 rows once the lettered sub-steps were counted. The engine needs the true count or the Slack counter lies. Nothing was added or removed to get to 33.

---

## Repo answers to HOW TO WORK, measured 2026-08-18

These were the reports the prompt asks for, and they are answered so the next session does not
re-derive them. Full detail in `docs/SRT-ClaudeCode-CONTINUATION-hub-to-onboarding.md`.

1. **Slack interactivity: it all exists.** `src/app/api/slack/actions/route.ts` handles
   `block_actions` and `view_submission` with mandatory signature verification;
   `src/app/api/slack/events/route.ts` handles the Events API including `file_shared`;
   `slack.filesInfo()` / `slack.downloadFile()` / `slack.updateMessage()` are all in
   `src/lib/slack-bot.ts`. Genuinely new: routing a captured file to an onboarding task and
   writing `client_docs`.
2. **Presence-sweep keys: none.** Google Places, Bing Maps, Foursquare, Yelp Fusion and Reddit
   are all unkeyed. Decision taken 2026-08-18: ship the sweep manual-only, add providers later.
3. **Engines Photograph I can run today: ONE.** `AuditEngine = "openai"` (`types.ts:13`),
   `ENGINES_PER_PROMPT = 1`. Perplexity was dropped 2026-08-05; there is no Gemini client.
4. **The Day 0 wall can be enforced**, and where is now decided: `clients.day_0_archived_at`,
   gating `page_publish` in `src/app/api/clients/[id]/hub/route.ts` **before** its
   `client_messages` cascade. This is the one deliberate exception to the repo's
   "flags, never blocks" doctrine.
5. **Conflicts with A1/A2:** two market implementations disagree with each other and with D-P13
   (`src/lib/medspa/market.ts` uses `city|state` string equality, which D-P13 forbids);
   `SRT-Question-Sets-v1.md` carries a fallback universal 20 that D-P15 retires. Both recorded.
6. **The market check does not need a Places key**, because revised A2 §2 specifies the US Census
   geocoder. `checkMarket()` and `haversineMiles()` already exist.
