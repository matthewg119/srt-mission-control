# Claude Code — Continuation: from the hub to a real onboarding

> **Paste the block below as the first message of the new session.** It replaces
> `SRT-ClaudeCode-Kickoff-Onboarding-Runner-v3.md` as the opener, because that kickoff asks the
> session to report on things that have now been measured, and it points at a schema this repo
> does not have. Runner v3 is still the specification for WHAT to build; this reconciles it to
> what is actually in the repo. Do not paste Runner v3 verbatim first — read the section on the
> `tenants` collision below and you will see why.

---

```
Continuing the client-hub build for SRT Mission Control.

Branch: feat/client-hubs, worktree ../srt-mc-hubs, based on
feat/client-comms-whatsapp. HEAD 6606fd9 "The client hub serves learn. and
reviews." bun run build exits 0. Read the "client hub" section at the END of
CLAUDE.md before anything else; it documents every trap below.

Another session owns feat/client-comms-whatsapp and is merging origin/main
(the Zoho cutover) into it. DO NOT TOUCH THAT BRANCH.

# WHAT IS ALREADY BUILT AND WORKING — do not rebuild any of it

- src/middleware.ts: hostname-first, deny-by-default. A client-controlled host
  reaches the hub tree and nothing else. Verified by request: every /api/*,
  /dashboard, /login, /onboarding, /r/* returns a bare 404 on a hub host, and
  mission.srtagency.com/hub/* 404s the other way.
- src/lib/hub/host-classify.ts, resolve.ts (host -> client, cached, tagged),
  pages.ts, jsonld.ts, review-assemble.ts, vercel-domains.ts.
- src/app/hub/[host]/: index, [slug], robots.txt, sitemap.xml, llms.txt,
  not-found, and the review tool. Indexable, canonical on the client host,
  LocalBusiness + QAPage JSON-LD.
- public/robots.txt is DELETED. It disallowed GPTBot, OAI-SearchBot,
  PerplexityBot, ClaudeBot and Google-Extended BY NAME and was served on every
  hostname the deployment answers for. Its content now lives in
  src/app/robots.txt/route.ts for the internal host only.
- Vercel domain attach: reads back the REAL per-domain CNAME target and writes
  it into client_dns_records. For this project that is
  4fddd1b501fe6565.vercel-dns-017.com, NOT cname.vercel-dns.com, so
  HUB_CNAME_TARGET's default was wrong for every client.
- Board: a Hub panel with Attach hostnames, a page writer seeded from the
  audit's 20 questions, and publish/unpublish that ticks first_page.
- Migration docs/2026-08-18-client-hub.sql is APPLIED to production:
  client_hosts, client_pages, review_tool_submissions.

# SIX THINGS I MEASURED. Correct me if any is wrong, then stop and plan.

## 1. THE `tenants` COLLISION — read this before touching Runner v3

Runner v3 and A2 write to `tenants.day_0_archived_at`, `tenants.market_center`,
`tenants.market_radius_mi`, `tenants.vertical`, `tenants.primary_avatar`,
`tenants.question_substitutions`, `tenants.slack_channel_id`, `tenants.lead_id`.

`tenants` EXISTS in this database and it is NOT that table. It has five
columns — id, slug, name, created_at, api_token — one row, and it is SRT-the-
agency's own API-token record. CLAUDE.md says so explicitly: the client table
was named `clients` *because* a one-row `tenants` table already existed.

So a session following Runner v3 literally either ALTERs the API-token table or
creates a second, competing client table. Both are bad and the second is worse,
because everything already built reads `clients`.

TRANSLATION TABLE, use it everywhere. Runner v3 -> this repo:
  tenants                 -> clients
  tenant_hub.site_intel   -> a new jsonb column on clients, or a small
                             client_site_intel table. NOT tenant_hub.
  hub_pages               -> client_pages (BUILT). hub_pages.scope from A1
                             D-P5a becomes client_pages.scope.
  onboarding_tasks        -> new. See item 6.
  ai_baseline             -> audit_reports + audit_runs already carry most of
                             this. run_label / excluded_from_scorecard /
                             engines[] do not exist yet and are needed for
                             A2 D-P14 and D-P16.
  onboarding_docs         -> new. Nothing stores onboarding evidence today.
                             client_docs exists in the 2026-08-16 migration and
                             has ZERO references in src/ — decide whether to use
                             it or supersede it, and say which.
  review_tool_submissions -> BUILT, same name.
  client_corpus           -> does not exist. The review spec's second write
                             target is not built; v1 writes submissions only.

THESE DO NOT EXIST AT ALL: tenant_hub, ai_baseline, nap_discrepancies,
question_bank, page_candidates, hub_pages, onboarding_tasks,
competitor_candidates, lead_avatars, citation_sources, harvest_runs,
client_corpus, onboarding_docs, question_set_versions, prompt_library.

That is fifteen tables. Runner v3 is not an increment on a built schema; most of
Build Prompt v4's schema was never built. Tell me your read on that before
planning, because it changes the size of this enormously.

## 2. I BUILT A PATH THAT VIOLATES THE DAY 0 WALL — Runner v3 says stop and tell you

Runner v3's one hard rail: nothing lands on a client-controlled property until
photograph_2 is archived, enforced on every write path, and "if you find a path
where a page could publish with day_0_archived_at NULL, STOP AND TELL ME."

I built exactly that path. POST /api/clients/[id]/hub action page_publish sets
client_pages.status='published' and the page is immediately live and indexable
at learn.{clientdomain}. There is no day-0 column anywhere and no check.

I am not going to quietly add a gate and call it done, because where the column
lives depends on item 1 and what counts as archived depends on the engine
question in item 4. It is the first thing to fix and it needs your decision.

## 3. PRODUCTION IS RUNNING PRE-REVERSAL CODE — that is your Slack message

You onboarded SRT and Slack said "open #srt-search-retrival-tactics-w8i and add
matthewmzts@gmail.com as a single-channel guest." Per-client Slack channels and
guest invites were deleted 2026-08-20 — on feat/client-comms-whatsapp, which is
NOT DEPLOYED. origin/main still imports ensureClientChannel from
client-channel.ts and still prints that invite line. Nothing is broken in the
new code; production is just old.

It also means the live row carries the full-host subdomain bug. There are now
TWO SRT rows in clients:

  39cf0f95-3aae-4bc8-bcee-043023d6f175  srt-agency               subdomain='learn'
  f1051b52-8a7e-4e13-95d8-9f5caf3072b1  search-retrival-tactics  subdomain='learn.srtagency.com'

The first is mine, made by direct insert to test the hub; client_hosts and the
real CNAME target hang off it. The second is your live onboarding, made by
production's older chooseSubdomain, which wrote the full host — the exact bug
CLAUDE.md documents. Its Hub panel will show nothing.

Decide which row survives and tell me. subdomainLabel() already reads either
shape safely, so the wrong one is cosmetic UNTIL something composes a hostname
from it. Note the slug also carries a typo, "retrival", and it is in the Slack
channel name permanently.

## 4. ONE ENGINE. Runner v3 item 3 asked for the number; it is one.

AuditEngine = "openai" and Perplexity was dropped 2026-08-05. Gemini and Google
AI Overviews have no client in this repo at all. OPENAI_API_KEY is not even in
.env.local locally, and CLAUDE.md records the audit engine as blocked on OpenAI
credits.

Consequences you have already written down and should now act on:
- A2 D-P16 and Runner v3 §4: a one-engine run is never labelled photograph_1
  for a paying or pilot client.
- Runner v3 §18: the SRT test tenant's baseline relabels to run_label
  'test_run', excluded_from_scorecard = true.
- Runner v3 §4: "Do not run client one's Photograph I until I have said in
  writing which engine count I am accepting as the baseline." That decision is
  still open and it blocks client one, not this build.

## 5. ZERO PRESENCE-SWEEP AND ZERO GEOCODING KEYS

Runner v3 item 2 asked which are keyed. None:
  GOOGLE_PLACES_API_KEY  not set      BING_MAPS_KEY      not set
  FOURSQUARE_API_KEY     not set      YELP_API_KEY       not set
  REDDIT_CLIENT_ID       not set
Only OUTSCRAPER_API_KEY and ANTHROPIC_API_KEY exist.

So, plainly:
- §6's automated presence tier has FOUR providers and none is keyed. Built
  today it is eighteen manual platforms, not "4 of 18 done automatically".
- §15 / A2 D-P13, the 10-mile market check, needs a geocoder to get
  market_center. There is no Places key. THE MARKET CHECK CANNOT BE BUILT until
  one exists. It is a decided lock with no way to enforce it.
- §9's Reddit harvest needs credentials and, per A1 D-P11, its terms verified
  before it ships.

Do not build against any of these. Tell me which keys you want and I will get
them, or tell me the manual-only version is worth shipping first.

## 6. THE DOCS THE KICKOFF TELLS YOU TO READ ARE MOSTLY NOT IN THE REPO

In docs/specs/: SRT-AEO-Onboarding-v2-PILOT.md, SRT-Question-Sets-v1.md,
SRT-Artifact-Templates-v1.md, SRT-Review-Tool-BUILD-SPEC-v2.md. That is all.

MISSING: SRT-Pilot-Amendment-A1-Volume-and-Harvest.md,
SRT-Pilot-Amendment-A2-Market-Audit-Bridge-Universal-Set.md,
SRT-ClaudeCode-Build-Prompt-v4.md, SRT-AEO-Delivery-Offer-v2.md,
SRT-Ops-Manual-v1.md, SRT-Doc-Registry-v2.md, and all three Onboarding Runners.

A1 and A2 are ratified canon and A2 §4 carries universal_v1 character for
character. Runner v3 §4 says seed it from A2 §4 — impossible without the file.
Put A1, A2 and Runner v3 in docs/specs/ before I plan §4 onward. Build Prompt v4
matters less now that item 1 shows its schema was never built, but say whether
it exists anywhere.

# WHAT I WANT FROM YOU FIRST

Report on the six above — correcting anything I got wrong — then plan ONE thing
and stop: the Day 0 wall (item 2), including which table the column lives on
given item 1, and every write path it has to gate. It is the smallest piece, it
is already violated, and its answer settles the naming question for everything
after it.

Do not plan the step engine yet. Do not touch the presence sweep.

# THEN, IN THIS ORDER, ONE AT A TIME, STOPPING AFTER EACH

1. Day 0 wall on clients, gating the hub publish path.
2. Reconcile the two SRT rows; delete or merge whichever I say.
3. Preview before live. Runner v3 5f/5g wants the hub and the review tool
   viewable BEFORE the call on our own infrastructure, noindex, no client DNS.
   client_pages already has draft vs published, so this is a preview host or a
   token-gated preview route plus a noindex rule — NOT a second hub. The
   review-spec rule is absolute: a preview submission must never reach
   review_tool_submissions, gated on the HOST and not a flag.
4. Hub theming. Runner v3 5g wants the review tool to read as the clinic's own
   page — logo, palette, fonts — with copy and flow identical for every client.
   Nothing extracts a theme today and there is no theme column.
5. onboarding_docs + Slack file capture. This is the load-bearing piece for the
   whole manual half: screenshots replying in a task thread become evidence
   without anyone filing anything. The repo has NO Slack file capture and no
   interactive buttons for onboarding (slack/actions handles audit and client
   drafts only). This is genuinely new work.
6. The step engine, as client_onboarding_tasks. Runner v3 §2, 33 rows, one
   constant in one file. Note it must coexist with the EXISTING two step lists,
   which CLAUDE.md is emphatic are different altitudes: client_onboarding_steps
   is the 8 client-facing pilot stages, client_delivery_steps is the 14
   operational ones. A third list needs a stated reason for existing and a
   stated relationship to those two, or the board grows three counters that
   disagree.
7. Only then the measurement work: run_label / engines[] /
   excluded_from_scorecard on audit_reports, the audit->client bridge (A2
   D-P14), competitor shortlist, findings doc, call sheet PDF.

# GROUND RULES THAT DO NOT MOVE

- Official APIs only. No scraping, no headless browsers against sites whose
  terms prohibit it.
- Six concurrent clients. Do not build a workflow engine.
- Vocabulary in every artifact: named / not named / named alongside / named
  instead. Never ranked, position, #N, top result.
- No model in the review tool path, ever. No staff-name field. No column that
  could identify a reviewer.
- The hub MUST stay indexable. /r/[slug] and /v2 are noindex and are the wrong
  pattern to copy.
- Nothing generates client-facing page copy unattended.
- Env vars are HUB_VERCEL_*, never VERCEL_* — Vercel reserves that prefix and
  refuses custom vars using it.
- bun run build exits 0. Branch. Show me before any push or deploy.
- If something will not work, say so. Do not work around it silently.

# DELIBERATELY DEFERRED — do not action

- Two root layouts via top-level route groups. It would move all eighteen route
  folders and collide with the merge in flight. The hub overrides the app-wide
  noindex per page instead, which is the /scan precedent and it works.
- PILOT §10.3 line 189 carries a reviews. edit inside a range another doc calls
  canon. Matthew is aware.
- NO_CUSTOMER_INFO_LINE says "patient" and "treatment"; SRT has no patients.
- prompt_library does not exist. classify.ts generates 20 questions per audit
  and those are what run. Never describe "pick from the 100" as working.
```

---

## Notes for Matthew, not for Claude Code

**The order of operations that will bite you.** Attaching a domain to the Vercel project points it
at the **production** deployment. `learn.srtagency.com` and `reviews.srtagency.com` are attached
now, so the moment a CNAME goes in at GoDaddy those hostnames serve whatever is on `main` — and
`main` has no hub. Attach early, add the DNS record **after** the hub is deployed to production.
Nothing resolves until the record exists, so there is no exposure today.

**What you can actually do end to end once the merge lands, the token is set and it deploys.** Start
a pilot, client fills intake, audit runs, the DNS panel reads out the *real* CNAME target, the client
pastes three records, the hub resolves, you write a page on the board, publish it, and the client gets
a WhatsApp draft with a working link. That is a complete narrow path and it is the one that was
missing.

**What "fully onboard a client" in Runner v3 still needs.** The 33-row step engine, Slack file
capture, the presence sweep, the competitor shortlist, the review audit, the Reddit harvest, the
findings doc, the call sheet PDF, hub theming, the preview host, the Day 0 wall, the market check,
and more than one engine. Roughly fifteen tables and five API keys. The hub was the thing blocking
*delivery*; this is the thing that makes delivery *repeatable*.

**The one decision only you can make, and it is not a build question.** Which engine count you accept
as a baseline, in writing. It is one today. A2 D-P16 and Runner v3 §4 both say a one-engine run is
never a photograph for a pilot client, so until you answer it, client one's Photograph I cannot run —
independent of anything Claude Code does.
