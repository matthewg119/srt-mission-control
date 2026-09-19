# Label it, link it, and stop throwing away what we already bought

A build prompt for a fresh session, written 2026-09-14 after the batch drafting flow shipped
(`a1e3a9e` on main). Every number below was measured against the repo and the production database on
2026-09-14. Line numbers drift; symbol names and row counts do not.

## Where the work is

```
cd "C:\Users\matth\Desktop\Code\_wt-page-plan"      # git worktree, branch feat/page-plan
```

`origin/main` and `feat/page-plan` are both at **a1e3a9e**. The tree is clean.

Also read `Mission control 2.0/srt-mc-colony` once. It is the SAME repo on branch `feat/colony`, and
W1 is about merging it.

## The sentence that reframes the whole build

**The premise was that we discard the data we pay for. We do not. We store it and never label it,
link it, or read it back — and in three specific places we do throw it away, all three inside one
function.**

| Where | What is there | What reads it |
|---|---|---|
| `audit_runs` | **2,880 rows. 1,860 with the raw ChatGPT answer**, 1,368 citation sets, 1,329 recommendation sets | one rank re-derivation, one report view |
| `market_mentions` | 3,279 rows, already a labelled extraction of who ChatGPT names instead | `ammo/supply.ts` |
| `audit_reports` | 103 rows with `website`, `vertical_slug`, `buyer_persona`, `competitors`, `prompts`, `score`, `site_signals` (90), `intake_answers` (46) | **only 1 of 103 has `client_id`** |
| `client_datasets` | Exactly the right shape: `kind, cache_key, params, payload, provider, cost_usd, hit_count, expires_at` | **nothing on main. Zero inserts, ever** |
| `fanout_runs` / `fanout_queries` / `fanout_citations` | Tables exist in production | **zero inserts, ever** |

## W1. Adopt `feat/colony`. First, because it is the biggest unlock.

Three commits, ten files, last touched **2026-08-31**, same repo, same origin, **no separate Vercel
project**, and **zero rows written by any of it**.

`docs/2026-09-02-market-dataset.sql:14` refused to reuse `client_datasets` because those tables
"belong to a live lane rather than being abandoned". **That judgment is now falsified**: fourteen
days, zero inserts, no deploy. Rewrite that comment rather than deleting it.

From `9b8c7f4`, verbatim:

> run-prompts.ts filtered the Responses API output down to type === "message" and dropped every
> web_search_call item on the floor. Each one names a search the engine actually ran to answer the
> prompt. **101 reports and 1,820 successful runs were paid for and discarded.**

From `1eb5f28`:

> The queries were discarded on every audit ever run, but the citations never were, so
> **~11,000 citation rows across 101 reports cost nothing to recover.**

**This is still happening on every audit run today**, because the branch is unmerged.

| File | What it does |
|---|---|
| `src/lib/data/dataset-cache.ts` | `getOrFetch()` fronts every paid pull: reads `client_datasets` first, calls the provider only on a miss or expiry, records `cost_usd`. `cacheKeyOf()` sorts object keys so `{a,b}` and `{b,a}` are one question. `client_id` NULLABLE throughout: a vertical-wide pull belongs to no client. Degrades to a live fetch and logs to `system_logs` rather than failing a caller |
| `src/lib/audit-engine/fanout-store.ts` | Writes `fanout_runs` / `fanout_queries` / `fanout_citations`. Logs and swallows a missing column instead of failing the row |
| `run-prompts.ts` (+60), `run-batch.ts` (+15) | The capture itself |
| `scripts/_backfill-fanout-citations.ts` | Dry by default, idempotent per report |
| `docs/2026-08-31-colony-and-fanout.sql` | **Already applied to production. Not on main.** Live schema drift |

**Do:**

1. Cherry-pick the three commits onto `feat/page-plan`, resolving against the current
   `run-prompts.ts` / `run-batch.ts`.
2. **Commit the migration file to main even though it is already applied.** A production table with
   no migration file on the deployed branch is exactly how a second table gets written for the same
   thing. That is how we got here.
3. Run `_backfill-fanout-citations.ts` dry, read the counts, then `--write`. ~11,000 rows, $0.
4. Two restraints from `9b8c7f4` that must survive the merge: no
   `include: ["web_search_call.action.sources"]` (unsupported values 400 the request, and sources
   duplicate `url_citation`), and the fanout is NOT a column on `audit_runs` (PostgREST rejects an
   insert naming a missing column, and `run-batch`'s delete-then-insert would wipe it).
5. `pdf/kit.ts` in `5dbaae7` is an unrelated palette change that repaints every prospect-facing PDF.
   Decide it deliberately.

**Then make `getOrFetch()` the ONE door for every paid pull in the repo** — the audit engine,
DataForSEO, MillionVerifier, the concierge scan, any research call. Then
`select kind, sum(cost_usd) from client_datasets group by 1` is a real number, which is the literal
answer to "use those credits we spend to label the data".

## W2. Three things thrown away inside one function, and they are the foundation doc

All three die in `src/lib/audit-engine/run-audit-pipeline.ts`, which already computes them:

1. **The site crawl.** `researchWebsite()` runs at `:202`, is distilled into `site_signals`
   (`:373-380`) and `robots_check` (`:392-399`), and **dies as a local when the function returns at
   `:488`**. `draft-page.ts:458-462` documents the identical loss. This is the single richest
   description of what a business actually sells, and it is what W5's "rearrange the site around the
   offer" needs.
2. **The paid `BusinessIdentity`.** Built at `claude-research.ts:531-544`, held at
   `run-audit-pipeline.ts:205`, and only `city / state / cityConfidence / alternates / websites /
   tradingName` are ever read. `identity.services[]` is the closest thing in the pipeline to "what
   they sell"; `identity.competitors[]` is the only list of REAL competitors a source named (the
   existing `audit_reports.competitors` column holds the classifier's *hypotheses*, per its own
   schema comment, and `prior-report.ts` already misreads it). `claude-research.ts:333-341` calls
   this "the most expensive generation in the pipeline".
3. **The classification envelope.** `classifyBusiness()` returns `is_local` and `city_confidence`;
   the insert at `:403-431` does not list them. So a null `city` on `audit_reports` means three
   different things at once: not local, not found, or name-mode run.

**Storage, and none of it costs a new fetch:**

- `alter table audit_reports add column if not exists site_crawl jsonb;` — but **do not store
  `homepageHtml`**: it is raw markup, it is the largest field, and `detectSiteSignals` already
  distils it into the existing column.
- `alter table audit_reports add column if not exists identity jsonb;` — ‼️ **never merge
  `identity.competitors` into the existing `competitors` column.** Two different meanings.
- `alter table audit_reports add column if not exists classification jsonb;` — the WHOLE return
  verbatim, one column not two, so the next field the classifier learns needs no migration. Same
  reasoning `site_signals` and `crawl_block` already use.

**Promotion, not direct writes.** At `intake_received`, promote the blob into `page_sources` through
the EXISTING `recordWebsiteSnapshot()` (`page-evidence.ts:315`), with `source_date` set to the CRAWL
date, not the promotion date. ‼️ **Do not write `page_sources` directly from a prospect scan**:
`page_sources.client_id` is `not null references clients(id)`, a prospect has no client row, and
relaxing that would make every `.eq("client_id", …)` read and `isFirstParty()`'s evidence count
prospect-aware. One jsonb column is a far smaller blast radius.

### Link what exists to the client it belongs to

`audit_reports.client_id` is set on **1 of 103**. Measured: **13 more are linkable today**, and all
13 are SRT's own audits of srtagency.com (scores up to 10, 2026-07-27 to 2026-08-27). The other 89
are prospects who never became clients; those stay null and that is correct.

The backfill is the small half. **Nothing sets this link at provisioning time.** Fix it where a
client is provisioned from a prospect (`provision.ts`, `adoptAuditClassification` in
`baseline-scan.ts`) so the count never drifts again. This is also the answer to Matthew's
*"if a lead is getting onboarded we must already have data from that customer, since we literally
just did an AI visibility scan for them."* The data is there. The join is not.

## W3. Audiences at the CLIENT level. SRT is not a med spa.

There are already **three** buyer shapes live and the preset layer holds **two rows**
(`medspa_owner_ai` with 20 voc quotes, `pest_control` with 0):

| Client | Its buyer | Preset today |
|---|---|---|
| `srt-agency-llc` | a med spa OWNER | `aeo-agency-med-spa` → `medspa_owner_ai` |
| a med spa (the target majority) | a PATIENT | **none. No seed anywhere is patient-facing** |
| `la-casita-tacos-pupusas` | a DINER | **none. No `vertical_slug` at all** |

**What the probe found, and it is worse than "two presets for three shapes":**

- `DEFAULT_VERTICAL_ID = "pest_control"` (`verticals.ts:135`). Not a neutral default: a full
  **Spanish-language termite kit** with beliefs, an offer sheet, POV scenes and a camera look.
- `seedFor()` (`:888-890`) falls through to it for any id not in the four-entry seed map. **This is
  the literal `8886b3f` mechanism and it is still in place.**
- `loadVertical()` (`:979-993`) returns `seedFor()` on every miss — no row, empty table, DB
  unreachable, unknown id — and a clean "no row" **logs nothing at all**.
- `mergeRowOverSeed` (`:928-977`) fills every NULL column from the seed. A taco restaurant row with
  only id/name/style_token populated **comes back speaking Spanish about subterranean termites**.
- Seven fields are hard-assigned from the seed and can NEVER be set from the DB (`:966-973`):
  `scenes, scene_variations, style_version, visual_rules, image_negative, setting_law,
  approved_numbers`. For an unknown id, that seed IS pest control.
- `CLIENT_VERTICAL_AVATARS` (`:867-871`) is a **three-key hardcoded map, all three agency slugs, all
  three pointing at `medspa_owner_ai`** — the ONLY bridge between the client namespace and the avatar
  namespace. **A real med spa client classified `medspa` is not a key**, so it gets null: zero shared
  quotes, zero approved numbers. The intended majority has no preset.
- `Vertical.audience` is typed `string`, enumerates only `homeowner | pest_owner | business_owner`
  (**no patient, no diner**), and **is dead**: merged in `mergeRowOverSeed`, never read by any
  generator. It looks like a control and is not one.
- **The `Vertical` type is POV-reel shaped.** Twelve of ~24 fields describe how to photograph a reel
  (`wearer_role`, `style_token`, `soul_id`, `scenes`, `setting_law`, `drop_mode`,
  `slack_drop_channel_id`). A restaurant audience must invent a camera grade to exist at all.
- `MEDSPA_OWNER_AI.visual_rules` (`:791-809`) hardcodes *"EVERY image is photographed inside this med
  spa"*. SRT maps to it and is an agency, not a clinic.
- `approved_numbers` exists on exactly one seed. Everywhere else "backed, not banned" collapses back
  to "banned" — the documented 2026-09-13 failure, unchanged for any new vertical.

The one place the schema forces a decision loudly instead of silently: `verticals.style_token` is
`text NOT NULL` with no default, so a non-visual audience cannot be inserted without someone
choosing. That is the better failure and the model to copy.

### The design that survived

**`client_audiences` as a first-class per-client row**, seeded once from a preset and owned by the
client thereafter. The key move is splitting the overloaded word "audience" in two:

- **STANCE** — structural: does the buyer buy *from the client*, or *from the seller*. Stays a closed
  two-value column using the strings already stored (`owner` / `patient`), so
  `lead_magnets.audience` and the concierge firewall are untouched.
- **VOCABULARY** — `patient` / `treatment` / `clinic` / `consultation`. Becomes **data on the
  client's own row**, not a code constant. This is what lets a taco restaurant say `diner` / `dish`
  / `restaurant`.

`(vertical, avatar_slug)` — which already keys `question_bank` and `avatar_briefs` — becomes the
formal identity of a SHARED audience, so research sharing survives. And
**`src/config/verticals.ts` is cut out of the client path entirely**, which the probe costs at three
lines in one file.

A second approach, `client_offers` (each offer row carrying its own buyer), matches Matthew's
*"perfiles de compradores of each offer"* more literally and should be read before deciding. **Its
adversarial review did not run** (see "What did not finish").

Whatever wins must satisfy all four:

1. All three shapes express correctly with **no silent wrong default for any of them**.
2. `srt-agency-llc` is **not re-onboarded**. It has a confirmed avatar and 41 seeded board rows.
3. `question_bank`'s vertical-scoped sharing survives, or is given up with a written reason.
4. `clientAvatarVerticalId` keeps returning **null rather than a wrong default** —
   *"a wrong quote bank is worse than an empty one: an empty one is visible."*

## W4. The five stages of awareness

**Confirmed: nothing models awareness today.** A repo-wide grep for
`awareness|schwartz|unaware|problem_aware|TOFU|MOFU|BOFU` returns exactly **one** hit: a prose
sentence inside `PEST_CONTROL.avatar_summary` at `verticals.ts:160`.

Matthew numbers them **5 = problem unaware → 1 = most aware**, and wants every page and post built to
move a reader from 5 toward 3-4.

**Start at the cheapest possible place, which needs NO migration.** `audit_reports.prompts` is
already jsonb of `{block, prompt}` — add a third key, `awareness: 1..5`, to each of the 20 questions
the classifier writes. That turns **every scan ever run** into an awareness-stratified dataset.

‼️ **Ship the prompt change and the validator change in ONE commit.** `classify.ts:76` already hard-
rejects anything that is not exactly 20; put the awareness check in that same gate so there is one
gate, not two. A validator demanding a field the prompt never asks for rejects the classification,
and a rejected classification kills the run **after the crawl and the paid research call have already
been bought**.

Then the artifacts, three one-line adds:

```
client_headlines  + awareness_entry smallint check (between 1 and 5), + awareness_target smallint
page_plan         + awareness_entry smallint, + awareness_target smallint
client_keywords   + awareness_stage smallint
```

Two numbers per artifact, not one: where the reader starts and where the page leaves them.

A new SECTIONS entry in `deep-research-run.ts` asks the research to place the avatar on the five
stages with quoted evidence — prompt text only, no migration. ‼️ **Append it as the tenth, never
insert**, because `test-onboarding-artifacts.ts` asserts on section positions.

**Compose with what exists, do not duplicate it.** `theme` (`themeOf`) and `keyword_category` already
exist, and the four *focus* categories are **price, fears, comparisons, how it works**. Note the
tension and write it down: `gbp-social-posts.ts` deliberately **converges** on those four, off
Matthew's own instruction, while the outline rule added 2026-09-14 requires a page to **diverge** from
them (5 of every outline's headings must be about something else). That is coherent — a post answers a
buying question, a page must go past it — but it is coherent by luck right now.

## W5. Several avatars per offer

Today a client carries **one** confirmed avatar (`primary_avatar`, `primary_avatar_slug`, slots
`a1/a2/a3` are candidates). Before changing it, work out precisely what is keyed on the single
confirmed avatar: `question_bank.avatar`, `avatarBriefFor(vertical, avatarSlug)`,
`reuseAvatarResearch`, `headlineContext`, `clientAvatarVerticalId`. Research sharing across clients
in a vertical hangs off that key and is what makes the second med spa cheap.

## W6. The foundation doc, call-1 bulletpoints, and pricing

The plan should produce **bulletpoints ready to show on call 1**, to upsell:

- **$349/month** page generation, targeting N avatars over 12 months.
- **12 months up front: 20% off = $3,300/year**, all pages built at once so they compound.
- **Bonus on the annual: the AI Concierge**, otherwise **$199/month**.

**None of those numbers exist in code.** Grep the repo and `CLAUDE.md` first — four tiers are
documented, plus a `$900` and a `$499` in prose — and reconcile rather than adding a fifth scheme. A
price that drives behaviour belongs in one constant naming who set it and when; a price in a prompt
is copy.

`preCallPagesCardLines` is what the plan shows today. The call-1 view needs the avatars covered, the
stages covered, the 12-month build-out, and the pricing reminder line.

## W7. The AI Concierge, and the compliance surface

Measured truth, so nobody designs against an imagined product:

- There is a **skin-analysis provider seam** (`concierge/analysis/provider.ts`) with a canonical
  numeric shape. **The vendor is not chosen. Only `mock.ts` exists.** Picking one is
  `concierge_configs.analysis_provider` plus one adapter file — deliberately not a refactor.
- **There is NO before/after image generation and no face simulation.** What exists is
  photo → numeric skin scores → conversation → recommendation → lead handoff. The imagined
  *"AI shows how your face will look after the treatment"* is a new build.
- `provider.ts` carries a CONVENTION, not a fact: **higher is better, all of them, no exceptions.** A
  vendor scoring severity and one scoring condition both return `acne: 82`. An adapter that forgets
  to invert tells someone with excellent skin their face is in trouble, on a clinic's domain.
- **Nothing persists or logs the image bytes** in the provider. Retention is `purge.ts` alone.
- `concierge_scan_ledger` (`provider, ok, http_status, latency_ms, cost_usd`) exists and is empty. It
  should be fed through `getOrFetch()`.

**The compliance surface needs a healthcare lawyer, not a model.** This deep-dive did not complete
(session limit). Map at minimum: treatment recommendation without a licensed provider; **biometric
data** (a face photo is a biometric identifier under Illinois BIPA — which carries a private right of
action — Texas CUBI, and Washington's My Health My Data Act); HIPAA business-associate status and a
BAA; **before/after imagery, where a SIMULATED after-image is a STRONGER claim than a real one**, not
a weaker one, under FTC typicality and state medical-board advertising rules; minors; corporate
practice of medicine. This repo already takes FTC 16 CFR 465 seriously in the AI Referral Engine — that is
the standard to hold the rest to. `clients.consent_results`, `consent_recorded_at` and
`testimonial_disclosure_required` exist; find what writes them.

Concierge onboarding is **optional** and gets its own Slack channel and workflows. It is not a
prerequisite for pages.

## W8. The scraper becomes the brain: qualify, enrich, suppress, and never buy twice

Matthew, 2026-09-14: he wants the scraper to feed the same context layer, so that by the time a lead
is onboarded *"we must already have some sort of data from that customer, since we literally just did
an AI visibility scan for them."*

`#srt-scraper` already runs two workflows on a dropped CSV (contact cleaning; company scoring) on one
stage machine, one picker, one 5-minute cron (`src/lib/scraper/lane.ts`). **Workflow C is a third arm
off the same `awaiting_workflow` picker**, in this order, and the order is the point:

```
awaiting_workflow → qualifying → qualified → [bulk drop-reason review, ✅]
  → enriching → verifying → catchall_recheck → suppressing → done
```

1. **Qualify** — one `callClaudeJSON` verdict per company against a written ICP, returning
   `{keep, reason}`. **Runs BEFORE any enrichment spend**, because roughly half the file was always
   going to be dropped. ‼️ **There is no "skip qualify" path.** The initial state after the picker
   resolves to Workflow C is `qualifying`, unconditionally.
2. **Enrich** — a provider waterfall (one source is ~50-60% coverage, a stack is 85%+), env-gated,
   degrading to "not enriched" rather than throwing, the same posture `MILLIONVERIFIER_API_KEY` and
   `DATAFORSEO_LOGIN` already take. Each provider records its own attempt so a later swap does not
   lose the trail.
3. **Verify** — target <1% bounce.
4. **Re-verify catch-alls** — catch-all domains say "valid" and then bounce. ‼️ Copy `mx.ts`'s
   `MxVerdict` **tri-state**: a re-check that fails to resolve is "still unknown", never "valid" and
   never "bounces".
5. **Strip role addresses** — reuse the existing `ROLE_PATTERN` in `rules.ts`, do not re-derive one.
6. **Suppress** — a different check from in-file dedup. This is "contacted by us, ever".

**Two human checkpoints, both required.** Drop reasons posted in bulk, grouped and counted the way
`junk.csv` already reports them, **before enrichment spend** — because a few thousand rows cut for one
reason is a signal the ICP is wrong, and that has to be visible before the money goes. And the
standing `✅` gate before anything that costs money, at any size.

**Suppression is a new shared helper, not scraper-only**, because *nothing in this repo answers "has
this email or company been contacted by us, ever, across every channel."* It must query
`outreach_prospects` / `outreach_touches` (by email AND by domain), `clients` (a row is the
authoritative "paying client" signal), the CRM pipeline (`src/config/pipeline.ts`, Active Deals), and
an opt-out flag — **check whether an opt-out table already exists before building one.**

> ⚠️ **"Domains already exhausted in previous campaigns" is ambiguous and must be confirmed before
> being built.** The illustrative case — one prospect receiving three campaigns from three of our
> sending domains — argues that the key is the **prospect/company across every campaign**, not the
> sending domain. Confirm with Matthew; do not guess.

**Never buy the same data twice.** This is W1's `getOrFetch()` applied to the scraper, and the repo
already has the precedents: `niche_briefs` caches per-vertical research 30 days; `findCachedSession()`
reuses an audit report for the same domain within 7 days; **DataForSEO `task_get` results are free to
re-collect for 30 days** and `_backfill-gbp-serp.ts` already exploits that; MillionVerifier guards on
`mv_file_id` so a retried cron tick cannot double-buy. Workflow C must check for a recent
`audit_reports` row for a domain **before** doing its own research, rather than re-buying what
`/audit` already paid for. Matthew's "only run once per year on a duplicate" is a TTL on the same
cache, not a separate mechanism.

**And the scraped row must speak the existing taxonomy**, not a parallel one: tag by `vertical_slug`,
`business_type` and avatar slug, the same vocabulary `adoptAuditClassification` writes, so a qualified
company can later be matched to an avatar exactly the way an onboarded client is, and campaigns can be
built per-avatar. This is the same axis W3 is redesigning — **build W8's tagging AFTER W3 lands**, or
it will encode the assumption W3 exists to remove.

New pieces: `src/lib/scraper/qualify.ts`, `src/lib/scraper/enrich.ts`, a shared suppression module,
and `docs/<date>-scraper-qualify-workflow.sql` following the one-dated-file-per-slice convention.
Print `~0.7 of the raw pull survives` on the summary card as a **planning number, not a promise**.

Open questions to resolve with Matthew: the exhausted-domain meaning; the enrichment provider (Clay /
Prospeo / Hunter / Apollo); whether an opt-out table exists; and where Workflow C's clean output hands
off.

## What is already built. Do not rebuild any of it.

| Thing | Where |
|---|---|
| Per-client social posting | `clients/workflows/gbp-social-posts.ts` — GBP posts + captions from the locked offer, approved keywords and numbered evidence. Drafts only |
| The per-client workflow layer | `clients/workflows/registry.ts`, `client_workflow_runs`, `run_client_workflow` / `get_client_workflow_runs`. Definitions are CODE, runs are ROWS |
| Extract-and-backfill a paid dataset | `scripts/build-market-dataset.ts` — dry by default, idempotent upsert, **never calls a model**. The template for every extraction here |
| The paid-pull cache | `src/lib/data/dataset-cache.ts` on `feat/colony` |
| Page-level training corpus | `clients/page-dataset.ts` — captures drafted / edited / published |
| The batch drafting flow | `page-batch.ts`, `batch-research.ts` |
| The scraper stage machine, picker and dedupe | `scraper/lane.ts`, `filter.ts`, `rules.ts`, `mx.ts`, `dedup.ts` |

## Decisions. Do not re-litigate.

| # | Decision |
|---|---|
| D1 | Research stays a MANUAL paste-back, both passes. Chosen 2026-09-14 over API automation |
| D2 | Onboarding is always 1 pillar + 6 supports |
| D3 | `scope: "over_delivery"` stays at `rank >= 9`. A contract, not a batch size |
| D4 | The gate blocks on EVIDENCE and only warns on style |
| D5 | `clientAvatarVerticalId` returns null rather than a wrong default. Preserve everywhere |
| D6 | Nothing publishes before the Day 0 wall and the quality gate |
| D7 | The board cursor is ONE AT A TIME; `runReadyAutoSteps` is gated on `reachableCursor` |
| D8 | Qualification is always Workflow C's first stage. No skip path |
| D9 | Nothing that costs money runs unattended, at any size |

## Verification

```
bunx tsx scripts/_probe-aeo-headlines.ts
bunx tsx scripts/_probe-dr-headlines.ts
bunx tsx scripts/_probe-headline-page.ts
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-page-studio.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts   # 2 failing until step 18 runs
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx --env-file=.env.local scripts/_probe-market-ammo.ts
bunx tsx scripts/_probe-step-verify.ts
bun run scripts/test-onboarding-artifacts.ts
./node_modules/.bin/tsc --noEmit
bun run build
```

Add `scripts/_probe-fanout.ts` from `feat/colony` after W1.

## Gotchas that have bitten before

- `_probe-page-gate.ts` reports **2 failing** and it is a DATA state: `concierge_configs` is empty so
  `checkMagnet` is block-tier. It clears when step **18** runs. Do not "fix" it.
- `NEXT_PUBLIC_APP_URL` in `.env.local` is `http://localhost:3000`. **Never run a step generator
  locally** — it posts localhost links into production Slack. Seen live 2026-09-12.
- One unknown column fails the WHOLE PostgREST select, and supabase-js RETURNS the error rather than
  throwing, so a try/catch never fires. Read a new column in its own select.
- A HEAD against a table PostgREST does not know returns 404 with no body, which supabase-js reports
  as `{ count: null, error: null }` — indistinguishable from an empty table. Use a real GET for
  idempotency preflights. `1eb5f28` hit exactly this.
- ON CONFLICT infers by matching key expressions; a bare column list does not match a partial index
  (42P10). Use plain unique constraints.
- Resolve SRT by slug `srt-agency-llc`, never a pinned id. It has been re-onboarded twice.
- Never an em dash in copy or in anything a model writes.
- Deploy only by fast-forward push to main after `git fetch` confirms main has not moved. Never
  `git add -A`; `git branch --show-current` before every commit; stage by `:(literal)` paths.

## What did not finish, and is owed

Two research workflows ran on 2026-09-14. **16 of 47 agents died on a session limit.** What landed is
above. What did not, and must be redone in the new session:

- The **AI Concierge end-to-end truth** deep-dive and the **compliance surface** map (W7).
- The **awareness-stage design** against this codebase (W4 above is the framing, not the design).
- The **multi-avatar and call-pack** analysis (W5, W6).
- **All three critics** (coverage, contradiction, feasibility) on workflow 1.
- The **`vertical-generalise` design** and **all nine adversarial refutations** of the W3 approaches.

Journals, which carry the full per-agent returns:
`.claude/projects/c--Users-matth-Desktop-Code/06df4610-.../subagents/workflows/wf_ef344d9a-488/journal.jsonl`
and `.../wf_47e9ab31-bce/journal.jsonl`. Both workflows can be resumed with cached prefixes via
`Workflow({scriptPath, resumeFromRunId})` — the scripts are under `workflows/scripts/`.
