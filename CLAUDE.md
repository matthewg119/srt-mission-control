# SRT Mission Control — Project Reference

## Quick Start
- **Dev:** `bun run dev` → http://localhost:3000
- **Build:** `bun run build` (uses Node.js under the hood)
- **Deploy:** Push to git → Vercel auto-deploys
- **Live:** mission.srtagency.com

## What This Is
Internal operations portal for SRT Agency (business financing brokerage). AI-first — the AI Office Manager is the core feature, not a side feature.

## Tech Stack
- Next.js 14 (App Router) + TypeScript + Tailwind CSS v3
- Supabase PostgreSQL (hosted)
- Anthropic Claude API (claude-sonnet-4-6) with tool use
- Zoho CRM v5 (OAuth refresh token flow)
- Microsoft 365 (email via Graph API, OneDrive for file storage)
- Vercel deployment

## Architecture

### AI Office Manager (the core)
- `src/lib/ai.ts` — `runConversationWithTools()` handles Claude tool loop (up to 5 iterations)
- `src/lib/ai-tools.ts` — 16 tools: pipeline queries, deal management, email, templates, activity
- `src/app/api/chat/route.ts` — Web chat endpoint (used by dashboard)
- `src/app/api/telegram/webhook/route.ts` — Telegram endpoint (same AI, same tools)
- `src/lib/telegram.ts` — Telegram Bot API client

### `callClaudeJSON` — the shared JSON generator (`src/lib/claude-calls.ts`)
Every structured generator in the app goes through it, so its recovery behaviour is worth knowing
before adding a new one. Three escalating recoveries, in order:

1. **Transient status** (429/529/5xx) → exponential backoff, then fall back across models.
2. **`stop_reason: "max_tokens"`** → retry once at double the budget, capped at 8000.
3. **Validation failure** → ONE correction retry (2026-08-04). The model gets its own rejected
   answer back plus `describeInvalid()`'s reason, and is asked to fix only what is wrong. Same move
   `draft-linter.ts` makes for drafts. It exists because discarding an otherwise-correct generation
   over one wrong field is this helper's most expensive failure mode.

`camelizeKeys` is the ready-made `coerce` for any camelCase schema. Models drift into snake_case
with no warning and for no reason: the intel brief returned `why_it_hurts`, and therefore
`horror_stories` / `night_questions`, on a run whose research was perfectly good, and the whole
generation was thrown away over it.

Two optional hooks make step 3 work, and a generator with a non-trivial shape should supply both:
- **`coerce`** repairs a near-miss *before* validation (a 0-based index where the schema wanted
  1-based, a number sent as a string). Return the input untouched for anything ambiguous.
- **`describeInvalid`** names the failed check. Without it the error is "failed validation" plus
  `cleaned.slice(0, 500)` — and the broken field is rarely in the first 500 characters, which is
  exactly why the `pick: 0` bug below looked like correct output.

**The correction retry is skipped when `tools` are present**, deliberately. The assistant turn would
have to replay the `server_tool_use` / `web_search_tool_result` blocks verbatim and only text blocks
are kept, so the rebuilt conversation would be malformed — and it would re-run every search. It is
also skipped when the response text is empty, since the API rejects an empty assistant turn.
**Consequence: `coerce` is the ONLY defence a tool-using generator has**, so `intel-brief.ts` leans
on it harder than anything else does.

### CRM Integration
- `src/lib/zoho.ts` — Zoho CRM v5 API client (leads CRUD, PDF attachment, search)
- `src/lib/microsoft.ts` — Microsoft Graph API (email, OneDrive, OAuth)
- `src/config/pipeline.ts` — Two pipelines: New Deals + Active Deals

### Lead Capture (from srtagency.com)
- `src/lib/lead-intake.ts` — **the shared inbound-lead stack.** `ingestLead()` does
  Supabase contact upsert → Zoho lead (search-then-create, never duplicates) → #hot-leads
  top-level post + detail reply in that thread → Speed-to-Lead, and returns the contact id.
  `enrichLead()` appends to a lead that already exists (Zoho note + same-thread reply).
  Used by `/api/leads/funnel`, `/api/audit/public-intake` and `/api/leads/facebook` —
  add new funnels here rather than copying the sequence a fourth time.
- `src/app/api/leads/funnel/route.ts` — /aivisibility funnel → ingestLead
- `src/app/api/leads/facebook/route.ts` — Meta Lead Ads webhook → ingestLead + auto-audit.
  Verifies X-Hub-Signature-256, then acks inside Meta's **5-second** window and does all
  work in `waitUntil` (a slow response gets the app unsubscribed from the Page).
  Website comes from the form's field ids: set the question's Field ID to `website` in
  Ads Manager, otherwise the route resolves it from `GET /{form_id}?fields=questions{key,label}`.
- `src/app/api/leads/capture/route.ts` — Contact form → Supabase contact + deal
- `src/app/api/leads/application/route.ts` — Apply form → progressive capture (25% create + Zoho + Slack, 100% enrich + PDF + OneDrive + Zoho)

### Dashboard Pages
- `/dashboard` — BrainHeart overview with recent activity
- `/dashboard/pipeline` — Kanban board
- `/dashboard/chat` — AI Office Manager chat interface
- `/dashboard/templates` — SMS/Email templates
- `/dashboard/automations` — Stage-based automation rules
- `/dashboard/settings` — API keys, AI config, knowledge base

## Database Tables (Supabase)
| Table | Purpose |
|-------|---------|
| contacts | Source of truth for all contacts |
| deals | Pipeline deals with stage, pipeline, amount |
| deal_events | Event timeline (stage changes, etc.) |
| deal_notes | Notes per contact/deal |
| message_templates | SMS/Email templates per pipeline stage |
| automation_logs | Log of automated actions (SMS, email, stage moves) |
| system_logs | General event log (lead captures, errors, Slack notifications) |
| chat_conversations | Chat session metadata |
| chat_messages | Individual chat messages (web + Telegram) |
| integrations | API configs (AI priorities, Microsoft 365 tokens) |
| knowledge_entries | AI knowledge base (custom context for the Office Manager) |
| scan_sessions | Public /scan funnel: session → report link, rate-limit ledger, domain cache |

## Environment Variables
```
ANTHROPIC_API_KEY=         # Claude API
ZOHO_CLIENT_ID=            # Zoho OAuth Client ID
ZOHO_CLIENT_SECRET=        # Zoho OAuth Client Secret
ZOHO_REFRESH_TOKEN=        # Zoho OAuth Refresh Token
MICROSOFT_CLIENT_ID=       # Azure AD App Client ID
MICROSOFT_CLIENT_SECRET=   # Azure AD App Client Secret
MICROSOFT_TENANT_ID=       # Azure AD Tenant ID
NEXT_PUBLIC_SUPABASE_URL=  # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY= # Supabase service role key
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Supabase anon key
SLACK_BOT_TOKEN=           # Slack Bot token
SLACK_HOT_LEADS_CHANNEL=   # Slack channel ID for lead notifications
SLACK_CEO_CHANNEL=         # Slack channel ID for CEO pulse reports
TELEGRAM_BOT_TOKEN=        # Telegram bot (from @BotFather)
TELEGRAM_USER_ID=          # Allowed Telegram user ID
NEXT_PUBLIC_APP_URL=       # https://mission.srtagency.com
META_CAPI_TEST_CODE=       # Preview/Development ONLY. On Production it routes every CAPI event into
                           # Events Manager > Test Events, where Meta ignores it for optimization,
                           # attribution and reporting — and returns 200, so nothing ever errors.
                           # getConfig() in meta-capi.ts hard-disables it when VERCEL_ENV=production.
META_ADS_TOKEN=            # System-user token with ads_management (Custom Audience sync). NOT META_CAPI_TOKEN.
META_AD_ACCOUNT_ID=        # Numeric ad account id (route prefixes act_). Used to create the exclusion audience.
META_AUDIENCE_ID=          # "SRT - CRM Master Exclusion" audience id (from /api/admin/create-exclusion-audience)
META_ADS_API_VERSION=      # Optional, defaults to v21.0
FB_APP_SECRET=             # App Secret. Signs Lead Ads webhooks (X-Hub-Signature-256).
FB_WEBHOOK_VERIFY_TOKEN=   # Must match the Verify Token in App Dashboard → Webhooks → Page.
FB_PAGE_ACCESS_TOKEN=      # System User token w/ leads_retrieval. ALSO needs Leads Access granted to the app.
IMAGE_GEN_ENABLED=         # "true" re-enables AUTO image generation; unset = prompt-first mode (Matthew pastes the images in Slack)
IMAGE_PROVIDER=            # Image provider override; code default is openai (gpt-image-2 DIRECT from OpenAI)
POV_IMAGE_PROVIDER=        # POV/workflow-path override; code default openai
OPENAI_API_KEY=            # gpt-image-2 (ALL image generation + edits)
OPENAI_IMAGE_QUALITY=      # Optional: low | medium | high (default high)
HF_CREDENTIALS=            # Higgsfield key — Seedance 2.0 ANIMATION ONLY (images no longer route through it)
SLACK_FOLLOWUPS_CHANNEL=   # #followups_channel id. Home of the Follow-Up Operator digest.
OUTREACH_MAILBOX=          # matthew@srtagency.com. The mailbox whose Sent Items are swept.
OUTREACH_EXCLUDE_DOMAINS=  # Optional comma list. srtagency.com is always excluded.
MAPS_PULL_ENABLED=         # Unset = Google Maps prospecting stays PAUSED. "1" resumes it.
AUDIT_SIGNATURE_NAME=      # Outlook signature BLOCK name for audit pitches. Default "AI Ops"
                           # (its rendered content reads "Matthew Garcia / AI Visibility - SRT",
                           # so naming it after the content would not find it).
OUTREACH_SIGNATURE_NAME=   # Who cold outreach is SIGNED by, two plain lines. Default "Matthew
                           # Garcia". Different thing from AUDIT_SIGNATURE_NAME above.
OUTREACH_SIGNATURE_AGENCY= # Default "SRT Agency".
SRT_PAYMENT_URL=           # Where they pay. The Loom v2 close ("click the link I sent over") and the
                           # delivery email both carry it. UNSET IS HANDLED, not ignored: the script
                           # prints a correction instead of the close, PRE-FLIGHT says NO PAYMENT
                           # LINK SET, and the delivery email flags it. Set it before recording.
AUDIT_AUTOSEND_ENABLED=    # Unset = lead pitches NEVER send themselves. "1" arms the timer.
AUDIT_AUTOSEND_MINUTES=    # Optional, default 5. Only meaningful when the above is on.
SCAN_IP_SALT=              # Salt for hashing /scan client IPs. Optional but SET IT: the default
                           # is a constant, which makes the ip_hash column a rainbow-table away
                           # from being a plaintext visitor log.
```

## Image generation rules (2026-07-03)
- ALL images: gpt-image-2 via the direct OpenAI API. Higgsfield = Seedance animation only.
  Soul stays banned for generation (Vargas belief-drop excepted, explicit provider).
- Kill switch: `IMAGE_GEN_ENABLED` unset/false pauses every AUTOMATIC generation path loudly
  (`ImageGenPausedError` -> Slack paused note). Workflow sessions then run PROMPT-FIRST:
  final prompts post as copy blocks, Matthew pastes the images, pasted = approved + saved
  to the workflow's reference library (`content_examples`, labels `approved_manual`).
- ONE deliberate exception (2026-07-27): reacting ✅ on Hook Studio's scene-prompt card
  generates those images even while paused (`generateSceneImages` in `src/lib/reel/hook-studio.ts`,
  the only caller of `GenerateImagesOpts.allowWhenPaused`). The switch governs unattended
  spend; a reaction is Matthew explicitly asking. Nothing else may pass that flag — if a
  second caller ever needs it, that is the signal to make the switch three-valued instead.
- Session approval chain: copy ✅ -> idea N (mandatory) -> picture ✅ -> prompts ✅ ->
  images (paste or auto+✅) -> animation `motion N` ✅ -> song -> render ✅ -> drop final
  MP4 -> variations card. See docs/SOP-content-workflow-session.md.

## CRM Master Exclusion Sync (Meta)
Daily cron pushes every Zoho lead + contact (hashed email/phone/name/zip/city/state) into
a Meta Customer List audience set as an EXCLUSION on acquisition ad sets, so Meta stops
re-serving ads to people already in the CRM. Idempotent (add-only, no diffing).
- `src/lib/meta-audience.ts` — Marketing API client (create audience + push users)
- `src/app/api/cron/crm-exclusion-sync/route.ts` — daily sync (08:00 UTC)
- `src/app/api/admin/create-exclusion-audience/route.ts` — one-time audience bootstrap
- Zoho full-table scan: `listAllRecords()` in `src/lib/zoho.ts`

One-time setup: (1) create a Meta System User, assign the ad account with Manage, generate
a token with `ads_management` → `META_ADS_TOKEN`; (2) accept Custom Audience Terms at
`business.facebook.com/ads/manage/customaudiences/tos/?act_<AD_ACCOUNT_ID>`; (3) hit
`/api/admin/create-exclusion-audience` once → paste id into `META_AUDIENCE_ID`, redeploy;
(4) in Ads Manager set the audience as an Exclude on each acquisition ad set.

## SRT Audit Engine v2 (2026-07-22)
`/audit https://website.com` in Slack (optionally `| City, ST | competitor1, competitor2`,
both always optional) kicks off an AI-search-visibility audit for any business vertical —
zero vertical-specific hardcoding anywhere in this feature.
- `src/lib/audit-engine/site-research.ts` — fetches homepage + up to 2 inner pages, pulls
  schema.org LocalBusiness/Organization JSON-LD (best city signal).
- `src/lib/audit-engine/classify.ts` — one Claude call (generic system prompt, no per-vertical
  branches) returns business_type, `is_local` (false for online/national/B2B businesses —
  no city/geo-modifiers forced onto them), city (+ confidence, only when is_local), buyer_persona,
  20 buyer-language prompts across 4 blocks, and hypothesized competitors.
- `src/lib/audit-engine/pdf-scorecard.ts` — branded one-page PDF scorecard (jsPDF, same header/
  palette as `pdf-generator.ts`), `src/lib/audit-engine/email-assistant.ts` — the email
  drafters, grounded in `Desktop/AEO aduit/SRT_Audit_SOP_Universal.md` + `SRT_Sales_Letter.md`,
  and `src/lib/audit-engine/thread-assistant.ts` — the Slack-thread router. Wired into
  `src/app/api/slack/events/route.ts` gated by `channel === AUDIT_CHANNEL_ID` first (cheap
  check before any DB lookup). Every draft is posted for Matthew to review. **Cold outreach is
  never sent automatically.** The ONE lane that can send unattended is the public free-audit
  lead pitch, and only when `AUDIT_AUTOSEND_ENABLED=1` — see "Instant lead pitch" below. It
  ships with that switch unset, so today nothing sends itself.

### Cold outreach: PRE-PITCH, then PITCH (2026-07-29) — read before touching email 1
A cold prospect never asked for any of this, so a finished audit does **not** post finished
pitch emails any more. Three stages, and they must not bleed into each other:

| Stage | Who writes it | Carries links / price? |
|---|---|---|
| **permission** — email 1 + nudges 2 to 5 (D0/D+1/D+2/D+4/D+7) | `PERMISSION_SEQUENCE`, `draftPermissionEmail`, `outreach-intake.ts` | **No.** One finding, one ask: "mind if I send it over?" |
| **reveal** — fires when they say yes | `draftRevealMessage` | **Yes.** Report link, the free redesign concept, the Loom, the price, all at once. |
| **belief** — the original ladder + objection replies | `BELIEF_SEQUENCE`, `draftSequenceEmail`, `draftObjectionReply` | Yes. Unchanged, post-reveal only. |

Email 1's only job is to earn a "yes, send it." An email that shows the loss AND links the
audit AND names a price AND asks for 15 minutes makes five asks of a stranger and lands in
spam. `prePitchRules()` states the constraints and `enforceLinkPolicy()` makes the link rule
structural, the same way `noDashes()` enforces the em-dash ban.

**The one-link exception (2026-07-30).** Permission-stage email 1 may carry **exactly one**
link, and only when it is the free redesign built for that prospect (`redesign_url`). The
report link, the Loom, pricing and calendar links all stay behind the yes. The distinction is
the point: a redesign link is *the finding made tangible* and costs the reader nothing to look
at, while a report link is *homework we are asking them to do*. Enforced as a **count, not a
whitelist** — `LinkPolicy` is `none` / `redesign_only` / `any`, so a URL nobody anticipated
(a Calendly, an invented link) fails exactly the way the report link does. Anything stripped is
reported in Slack above the draft, never silently. Nudges 2 to 5 get `none` even when a
redesign exists: they are bumps on a thread that already carried it.

The single-ask rule is absolute and survives the exception. Email 1 ends with one question and
one only. No price, no meeting request, no "worth 15 minutes", no secondary CTA, even with the
redesign link present.

**Voice and shape** live in `PERMISSION_EXAMPLE_WITH_REDESIGN` / `..._NO_REDESIGN` (few-shot),
`VOICE_RULES` and `PARAGRAPH_RULES`. What made the early drafts read like a bot was shape, not
word choice: one sentence per paragraph with a blank line between each. `format-guard.ts`
enforces the mechanical half (capitalize sentence starts, strip emphasis) and, when the
detector trips, runs ONE reflow pass whose output is accepted only if its **word multiset is
identical** to the input's. That check is what makes "change not a word" structural rather than
hopeful; a reflow that edited anything is discarded and noted in Slack.

Mechanism-explanation nuance: the reference email *does* explain mechanism, concretely and
about work already done for them ("an FAQ built around the questions engineers ask, your
certifications marked up so ChatGPT can cite them"). What is banned in email 1 is the abstract
lecture ("AI engines don't answer from memory, they retrieve and cite 3 to 5 names"). A
stranger did not sign up for a seminar.

**Vertical hygiene.** `marketFactsFor(report)` gates the "230 million health and wellness
questions" stat in CODE on `business_type`/`vertical_slug`/`buyer_persona`. It used to ship
unconditionally on the objection path, which is the default branch for any free text in an
audit thread, so a control panel shop could be told about health questions. A prose guard
("fits health verticals only") is not a guard. The compliance line says "customers, clients"
and never "patients", and `classify.ts` carries an industrial `buyer_persona` example alongside
the clinic one because that persona is piped verbatim into every outreach email.

Consequence: the fixed 5-minute-video `CTA_LINE` does **not** appear in cold email 1. It still
applies to the reveal, the belief ladder, and the public-lead lane.

The one exception is `draftInitialEmail`, used only for public free-audit leads
(`requester_email` set) who filled out a form and asked for the report. For them sending it IS
the fulfillment, so there is no permission to earn and that path is untouched.

**The intake step** (`src/lib/audit-engine/outreach-intake.ts`): when a cold audit finishes,
`finishReport` posts an intake card instead of drafts — four hardcoded slots (recipient's name,
their email, anything to mention or keep out, is a free redesign in play) plus one or two
questions Claude writes from that report's actual findings. Matthew answers in free text in the
thread and gets **one** finished draft. The answers are stored verbatim in `intake_answers` and
passed to every later drafter as instructions that outrank the generic guidance; they are never
parsed into fields, because a parser that guessed would drop half the instruction.

**Thread commands** on a finished report (`handleAuditThreadReply`, keyed on `outreach_stage`):

| Reply | Does |
|---|---|
| free text at `awaiting_intake` | the intake answers → one email 1 draft |
| **paste your call notes** | the post-call email: written from what the OWNER said, one ask, "can I send the video". Auto-detected, see below |
| `1` / `send it` | Outlook draft, To = `prospect_email ?? requester_email` |
| `loom` (bare, no url) | starts the 3-step recording wizard: 20 prompts + PRE-FLIGHT + pick the customer, then the picture, then the script `.txt`. `loom <url>` still stores the video |
| `script` | rebuild the script `.txt` for the customer already picked |
| `nudge 2` .. `nudge 5` | next pre-pitch touch, still link-free |
| `redesign <url>` / `loom <url>` | stores the asset for the reveal |
| `reveal` (optionally `reveal $299/mo, setup waived`) | the hand-everything-over message |
| `email 2` .. `email 5` | the old 3-option belief ladder (post-reveal) |
| anything else, any stage | `runAgentTurn()` → the reasoning agent reads the thread and answers |

> ‼️ The last row used to be two rows: "free text at `drafted` revises that draft in place" and
> "free text at `revealed` → objection replies". Both have been false since `b92c6a2` (see "The audit
> thread REASONS now"). Revision is now `edit_draft`, chosen by the agent; the objection drafter is
> only a fallback when the agent throws at `revealed`. The `reveal $299/mo` example above is also
> illustrative, not a real offer.

- `src/lib/audit-engine/site-signals.ts` — the "one thing on your site working against you"
  hook (stale copyright year, no viewport, http, no schema, no phone), computed from the
  homepage HTML `site-research.ts` already fetched. No extra request. Stored on
  `audit_reports.site_signals` and surfaced as an intake suggestion. Takes the **newest**
  copyright year on the page, never the first match, so a stale year in one template is not
  reported as "last updated" when a current one exists elsewhere.
- Outreach columns: `docs/2026-07-29-audit-outreach-intake.sql` (add-only),
  `docs/2026-07-30-audit-thread-unique.sql` (unique index on `slack_thread_ts`).
- `src/lib/company-identity.ts` — `companiesConflict()`, shared by `lead-intake.ts` and
  `finish-report.ts`. It answers "do these two records positively describe DIFFERENT
  companies", and only fires when **both** sides carry the field, so the funding funnels
  (which pass no website) match exactly as they always did. `findContact` used to match on
  phone-OR-email alone and then overwrite `business_name`/`website`, so a shared front-desk
  line or one person handling two businesses collapsed them onto one contact and the audit
  result landed in the wrong `#hot-leads` thread.
- `src/app/api/audit/slack/route.ts` — the slash-command endpoint (register `/audit` in the
  Slack app config pointing here — that step isn't code). Low-confidence city is the ONLY
  path that asks Matthew a follow-up question; everything else resolves automatically.
- `src/app/api/audit/process/route.ts` — internal batch worker (`AUDIT_INTERNAL_SECRET`
  header), 4 prompts × 2 engines (OpenAI Responses API `web_search` + Perplexity `sonar`)
  per batch, self-chains via `waitUntil` + fetch until all 20 prompts are done.
- `src/lib/audit-engine/run-prompts.ts` — the no-fabrication rule lives here: a failed call
  can only resolve to `status:"no_data"`, never a guessed mention.
- `src/app/r/[slug]/page.tsx` (+ `/live` screenshot mode) — public branded report, `noindex`,
  no auth (slug obscurity only). `src/app/r/[slug]/live/page.tsx` gives one-tap links to run
  each prompt live in ChatGPT/Perplexity/Google AI for manual screenshots.
- Tables: `audit_reports`, `audit_runs` — see `docs/2026-07-22-audit-engine-v2.sql`.
- `#ai-visibility-audits` Slack channel is created once via `slack.createChannel()`
  (`src/lib/audit-engine/audit-channel.ts`) — paste the logged id into `AUDIT_CHANNEL_ID`
  after the first run, same convention as `SLACK_CEO_CHANNEL`/`SLACK_HOT_LEADS_CHANNEL`.

### Pitch pipeline v2 (2026-08-03) — belief seeding, the linter, the crawler check
Specs vendored into `docs/specs/`. Migrations: `2026-08-03-pitch-v2.sql`,
`2026-08-03-niche-briefs.sql`, `2026-08-03-brief-and-transcript.sql`.

**Draft shape was inverted, deliberately.** `format-guard.ts` used to treat one-sentence
paragraphs as the bot tell and reflow them into 2-4 sentence blocks. Every draft was then
hand-split before sending, so the rule was backwards: `needsReflow()` now fires on **dense**
paragraphs (3+ sentences) and the reflow *splits*. `wordBag()`'s multiset check is unchanged and
still discards any reflow that edited a word — splitting only moves line breaks. `VOICE_RULES`
also bans the concession opener, meta-transitions ("the reversal is what I wanted to flag"),
and dates or week-stamping in the body. `stripAgencyLine()` drops the plain-text agency line at
Outlook conversion only, because Outlook renders the signature block underneath.

**The close is a constant, not a prompt instruction** (`PERMISSION_CLOSE`). Every permission-stage
email ends with exactly these two paragraphs, appended by `ensurePermissionClose()`:

> I recorded a 4 min video with the breakdown, it is yours to keep either way.
>
> Want me to send it over?

The give lands BEFORE the ask, so the ask is the last thing read and costs nothing to say yes to,
and the length is stated because "a video" is an unknown commitment while "4 min" is an instant
decision. It is code rather than a prompt line because the model rewrote it every time it was
merely asked, and a hand-edit once shipped "I recorded a video full breakdown is yours to keep
either way" — two sentences collapsed into one. `prePitchRules()` rule 3 now tells the model to
**stop after its last finding**; anything it writes that is trying to be the close is stripped, so
a revision cannot talk the ask out of the email. Linter rule `missing-close` rejects a draft that
lost it, or that aims more than one question mark at the reader. Length label:
`VIDEO_LENGTH_LABEL` in `src/config/pitch.ts`. `PERMISSION_EXAMPLE_NO_REDESIGN` is a real sent
email and ends with an explicit STOP marker for the same reason.

**Two belief axes, and they compose.** `BELIEF_SEQUENCE` (unchanged) is which EMAIL comes next in
the post-reveal ladder. `BELIEF_SEEDS` (B1 to B6, from `SRT_Belief_Seeding_Module.md`) is which
single belief a given draft installs. Every cold draft prints three pre-sell lines, one belief
each; `seed 1-3` splices the chosen one above the ask, re-lints, and writes a SEED LOG. The
ledger lives on `audit_reports.seed_ledger`, **not** by re-parsing Slack, so an edited message
cannot lose an entry. A belief already installed is never offered again — except on the objection
branch, where the broken link is re-seeded on purpose.

**The linter rejects, it does not warn** (`draft-linter.ts`). Two auto-retries, feeding the
rejection reasons back into the drafter, then it posts the failure instead of the draft. Rules:
one belief exactly, draft-1 length, the site tease, banned jargon, absolutes, unfilled
`{variables}`, re-seeded beliefs. Word lists in `src/config/pitch.ts`. `GEO`/`AEO`/`SERP`/`LLM`
are matched **case-sensitively** so "Georgia" does not trip the jargon rule.

> ‼️ The "something on your own site" tease has **two** possible backers and needs only one:
> a `site_signals` finding (stale copyright, missing markup — what the shipped hook has always
> meant) **or** a `robots_check` verdict of `devastating`. Gating it on robots alone rejects
> every legitimate draft.

**Training bots are not search bots** (`robots-check.ts`). Blocking `GPTBot` or `Google-Extended`
is a TRAINING opt-out and does **not** remove them from today's answers. Only a blocked
`OAI-SearchBot` / `PerplexityBot` / `Claude-SearchBot` earns "your site blocks ChatGPT" — saying
it otherwise is caught by anyone technical in five seconds. `robots_check` is tri-state exactly
like `site_signals`: null (never ran, no claim allowed), `[]` (clean, beat is CUT), findings.
`analyzeRobotsTxt()` is pure and honours real precedence: stacked `User-agent:` lines share one
rule block, and a bot's own group overrides `User-agent: *`.

**Niche-level, cached 30 days** in `niche_briefs`, keyed on `vertical_slug` falling back to
`business_type`. Two landscapers have the same avatars; only the scorecard differs, so prospect
#2 in a vertical is instant. `avatars` = 3 worst / 3 best / the pick (recurring > big one-time >
volume; "more customers" is never a valid pick; a reposition is flagged because it IS the angle).

**`pick` counts from 1, and the model does not reliably know that** (2026-08-04). It returned a
zero-based index and took out two live prospects: a fully correct set (3 worst, 3 best, right keys,
not truncated) was thrown away because one field read `0`. `validate` was right to reject it —
`formatAvatarsCard` does `best[pick - 1]`, so `0` reads `best[-1]` and crashes — so the fix is the
contract, not the check: a `schemaHint` (which lands in the SYSTEM prompt, unlike the shape example
that used to sit on the last line of the user message), the rule stated in words, and `coerceAvatars`
mapping `0` to `1`. Anything still outside 1..3 is left to fail, because clamping a `7` would
silently pick a customer the model did not choose and `pickWhy` would describe someone else.
`brief` = the rest of the intel brief, researched with the server-side `web_search_20260209` tool.
Supplying `tools` to `callClaudeJSON` disables the Haiku fallback, which does not support that tool
version.

> ‼️ **Reddit-first is dead and must not be re-added** (2026-08-04). Reddit blocks Anthropic's
> crawler, so `allowed_domains: ["reddit.com"]` is now rejected at request validation:
> `400 ... The following domains are not accessible to our user agent: ['reddit.com']`. It is not a
> transient status, so nothing retries it, and every `brief` failed outright. The guarantee had to
> invert: `blocked_domains: BRIEF_BLOCKED_DOMAINS` (`src/config/pitch.ts`) plus prompt steering
> toward owner-to-owner talk. A blocklist is genuinely weaker than an allowlist, so
> `sourceDomains()` reads the hostnames back off the URLs the brief was required to cite and the
> Slack card prints them: a brief built from trade press must never be mistaken for one built from
> owners talking to each other.

**The dream-lead image** (`dream-lead.ts`). `image` writes the paste-ready ChatGPT prompt using
the picked avatar's own `aiQuestion`, with the preset chosen by trade (SPLIT_SCREEN medical/dental
/aesthetic · BOOKING_ALERT hospitality · INBOX_FORM commercial/B2B · PHONE_ALERT everything else).
The preset regexes are **prefix matches with no trailing `\b`** — adding one silently breaks every
stem in the list. It refuses without `client_name`, never prints a dollar figure, and never names
a competitor who failed them. On camera the image is the TARGET ("the exact kind of inquiry we
point at your phone"), never a lead that arrived: AI generates the future, screenshots the present.

**The delivery email is gated on the transcript** (`delivery-email.ts`), per the playbook. No
transcript in-thread, no draft — the email quotes two timestamps and figures the reader can check,
and without it both are invented. `looksLikeTranscript()` is mechanical (length + 3 or more distinct
timestamps) precisely so it cannot be talked into passing.

**Transcript for tone, report for numbers** (rebuilt 2026-08-04). The two are handed to the model
separately and labelled that way, because the one failure this email cannot survive is a figure that
disagrees with the PDF attached to it. Where they conflict the report wins and the conflict is
FLAGGED, never smoothed over. Rules live in `delivery-guards.ts` as pure functions, not in the
prompt — a prose guard is not a guard:

| Guard | Rule |
|---|---|
| `competitorsWhereAbsent` | the money-gap number. **NOT `view.mostRecommended`** — see below |
| `spokenPromises` | customers / jobs / leads / revenue. Flagged in the transcript, REJECTED in the draft |
| `numberConflicts` | "N out of 100", "N of 20", "came up N times" diffed against the report |
| `verifyStamp` | a stamp the model returns must literally appear in the transcript |
| `replyPhrase` | the exact words he told them to reply with, or null and a flag |

> ‼️ `competitorsWhereAbsent` and `view.mostRecommended` are different numbers and must never be
> reconciled. `mostRecommended` counts `audit_runs` ROWS, so a competitor named by both engines on
> one prompt counts 2, the ceiling is 40, and it never checks whether the client appeared — right
> for "who owns the answers", which is why `email-assistant.ts` renders it as "cited 6x". The
> delivery email says "came up in N of the questions you're missing from", which has to survive the
> prospect opening the report and counting, so it is prompt-level, absent-only and excludes branded
> prompts.

**It replies on the real thread.** `microsoft.createReplyDraft` (Graph `/createReply`, factored out
of `sendReplyHtml` so there is one implementation) leaves the reply as a DRAFT for review. Graph
writes the `Re:` subject and the `In-Reply-To` / `References` headers, which is the only supported
way to thread: Graph rejects `conversationId` on POST /messages and `internetMessageHeaders` only
accepts `X-` prefixed keys. `pending_drafts[].replyToMessageId` carries it through the existing "1"
picker, so nothing else about that flow changed.

`resolveReplyAnchor` (`reply-anchor.ts`) finds the message to reply to: `outreach_prospects`, then
`outreach_touches` (append-only, **scoped by `prospect_id`** — that table is not keyed by email, and
filtering it on direction/channel alone returns some other prospect's thread), then a live
`searchMessagesWithAddress`. That last one is not an edge case: the first two are written by the
daily Sent Items sweep, so they are empty between sending email 1 and the next morning, which is
exactly when a Loom gets recorded. No anchor found is not fatal — it sends as a new message and says
so in the flags.

**FLAGS are Spanish and Slack-only**, never part of the email: promises the video made, figures the
video got wrong, an invented timestamp, no payment link configured, a thread that could not be found.
`Sin flags.` when clean.

> The missing-reply-phrase flag is **gone as of v2** (2026-08-16). The recording now sends them to
> the payment link, so a video with no reply phrase in it is the normal case rather than a gap.
> `replyPhrase()` is still called and still honoured verbatim when the video did name one, because a
> video that said "reply let's do it" and an email that says something else is the same broken
> promise it always was. It just no longer flags its own absence.

### Call notes → the post-call email (`notes-email.ts`, 2026-08-16)

Paste the notes from a phone call into a finished audit thread and it drafts the email that asks for
the yes on the video. No command word: the paste IS the command, the same way a Loom transcript is.

Email 1 is written from the AUDIT, and has to be, because at that point nobody has spoken to the
prospect. The moment there has been a call that stops being the best material available. Before this,
the notes went nowhere: a real block of them was pasted into a live thread, fell through every branch
into the reasoning agent, and produced nothing usable.

> ‼️ **THE NOTES OUTRANK THE AVATAR SET.** Same doctrine as `intake_answers`, and the live case is
> the argument: the niche set picked "The Corporate Film Program Buyer" while the owner had spent
> the call explaining he needs to hire TECHNICIANS, not find customers. A draft off the generic pick
> would have been well-researched and about the wrong problem, which is worse than a generic one
> because it proves nobody listened.

Four context sources, each labelled separately in the prompt so the model knows what may supply what:
the pasted notes verbatim (authority), the rest of the Slack thread (`readAuditThreadNotes`, at a
3500-char budget rather than the coach's 800 — that cap exists to protect a call brief's score and
does not apply here), the real mailbox (`readThreadTruth`, so it does not reintroduce itself
mid-conversation), and `reportContext` as the only source of numbers.

The ask is `PERMISSION_CLOSE`, appended by `ensurePermissionClose()`, so this inherits the single-ask
rule and linter rule `missing-close` for free. Still permission stage: no price, redesign link only.

> ‼️ **Router placement is load-bearing in BOTH directions** (`thread-assistant.ts`). BELOW the
> `awaiting_intake` branch, because there a long multi-line paste is the intake answers and nothing
> else — you cannot have notes from a call with someone you have not emailed yet, and moving it up
> would eat email 1 for every prospect whose answers ran long. ABOVE `runAgentTurn`, which is the
> branch it takes messages FROM, so the gate has to be something a model cannot argue past.

`looksLikeCallNotes()` (`notes-guards.ts`) is mechanical for that reason: 180+ chars AND 3+ non-empty
lines AND no `<@Uxxx>` mention. A one-line revision, a bare `draft` and a pasted objection all fail
it. The mention exemption is the escape hatch and the recovery: a message addressed to the assistant
is never notes, so a misroute costs one retyped message rather than a lost capability.

Three guards, all pure functions, all Slack-only, because notes mix three things the drafter cannot
reliably separate on its own:

| Guard | Catches | Why it is not email content |
|---|---|---|
| `spokenPromises` (reused) | "one extra client makes back the investment" | not a claim this business makes |
| `callbackCommitments` | "regresa sabado 22 quiere que lo llame", "call him back thursday" | HIS calendar. An email saying "as I mentioned I'll call Saturday" is a commitment a drafter made, not a person |
| `outOfScopeAsks` | ads / anuncios / hiring / staffing / social / website builds | we sell two tiers. The email may REPOSITION that work toward what they asked for, never offer the thing itself |

`outOfScopeAsks` dedupes by matched PHRASE, not by line: notes circle the same subject for five lines
while he thinks it through, and five bullets saying "he asked about ads" is a flag block nobody reads
to the end. `callbackCommitments` dedupes by line, because two callbacks are two things he owes.
Bare `personal` is deliberately NOT a staffing match (it is "his personal cell" in English); it needs
a quantifier in front of it.

The reposition is the point and it is honest: the questions we make a business findable for do not
have to be buying questions. Someone who wants to be found by future employees is the same work
pointed at a different question. Promising to run their job ads is not, and `offerBlock()` hands the
model `OFFER_TIERS` as a closed list so "can you also do X" has a definite answer.

## /scan — the self-serve public funnel (2026-08-05)
`srtagency.com/scan` (Vercel rewrite → `mission.srtagency.com/scan`). Paste a URL, watch six
agent steps run, trade an email for the report. It is a FRONT END over the audit engine — no
new pipeline, no second copy of anything. Migration: `docs/2026-08-05-scan-sessions.sql`.

| Step | Backed by |
|---|---|
| 1 research · 2 competitors · 3 questions | `runAuditPipeline()` (research → classify → row) |
| 4 ask the engines | `/api/audit/process`, counted off `audit_runs` |
| 5 score · 6 report | `audit_reports.status = done` → `/r/[slug]` |

**`scan_sessions` exists because the row arrives too late.** `runAuditPipeline()` spends 15-30s
on `researchWebsite()` + `classifyBusiness()` BEFORE it inserts its `audit_reports` row, and the
page needs an id to poll within ~200ms of the paste. The session row is created first, returned
immediately, and linked via `report_id` once the pipeline gets that far. It also carries the
rate-limit ledger (`ip_hash`) and the cache key (`domain`).

**Steps are DERIVED, never asserted.** `buildStatusPayload()` reads `activeStep` off the report
row and a count of `audit_runs` — same no-fabrication rule as `report-view.ts`. A stalled
pipeline stalls the UI. The `revealed` counter in `scan-run.tsx` is presentation only: steps 1-3
all become true in one poll (that chain writes nothing until the end), so the card walks them a
beat apart, clamped so it can never run ahead of what the server confirmed. Do not "fix" a
seemingly-stuck step with a timer.

> ‼️ **`onReportCreated` is why the stepped UI exists at all.** `runAuditPipeline()` does not
> return when the report row is inserted; it **awaits** the kick-off fetch, and
> `/api/audit/process` runs every batch and then `finishReport` before responding. So its return
> value arrives minutes late. Setting `scan_sessions.report_id` from that return value (the
> original build) meant the page showed a step-1 spinner for the entire run and then jumped to
> the score: steps 2 to 6 were unreachable code. The callback fires right after the insert, ~15s
> in. Anything else that needs the row id early must use it too, not the return value.

> ‼️ **`fetchCache = "force-no-store"` on every /scan route, and it is load-bearing.**
> supabase-js calls the global `fetch`, which Next patches, so reads land in the DATA cache.
> `dynamic = "force-dynamic"` governs the ROUTE cache and does not cover it. Symptom when
> missing: the DB has `report_id` set and `status: running`, and the status endpoint keeps
> answering `researching` / step 1 from a snapshot seconds old. On `/claim` it is worse than
> cosmetic, since a stale "not yet claimed" creates a second contact, Zoho lead and Slack thread.

**The email gate is asked DURING the run, not on the score screen, and that is not a conversion
tweak.** `finish-report.ts` reads `requester_email` off the report row when the run ENDS, and the
drafted email, the scorecard PDF and the ✅ Send it / ✋ Hold card all hang off it. An address
supplied after `status: done` is inert: it writes a column nothing reads again. Moving the gate
back to the end silently switches the whole fulfilment lane off while still displaying "we email
the scorecard too". `skipsIntakeCard()` also covers `scan`, so a scan lead gets fulfilment rather
than a cold permission-stage intake card.

**The status payload deliberately carries no `slug`.** `/r/[slug]` is unauthenticated, so
returning it from a public endpoint would hand out the report while the UI politely asks for an
email. `GET /api/scan/[id]/claim` issues the URL, and only for a session that already has a
`contact_id`.

**This is the only unauthenticated route in the app that spends money** — one classify plus 40
engine calls per accepted request. Three gates, cheapest first, and they must stay in this order:
`normalizeTarget()` (junk + private hosts, no DB) → `findCachedSession()` (same domain within 7
days returns the old session) → `countRecentScansForIp()` (3/IP/day). `failed` sessions are
deliberately excluded from the cache: a site that was down an hour ago deserves a real retry.

> ‼️ This is the **only** place an arbitrary user-supplied URL gets fetched server-side. Every
> other crawler entry point is fed a domain from Zoho, Outscraper, or a form behind a shared
> secret. Two halves, and they are split for a mechanical reason: `normalize.ts` is pure and
> isomorphic because `scan-form.tsx` imports it for inline validation, so a top-level
> `dns/promises` import there fails the browser bundle and tsc will not catch it. The resolver
> check lives in `public-host.ts` (server only). A literal blocklist alone is not a defence
> against a resolver: `169.254.169.254.nip.io` has a dot and a real TLD and passes every text
> check, so `assertPublicHost()` resolves the name and rejects private answers, failing closed.
> `isPrivateIp` and `isPrivateHost` must stay separate predicates: the latter rejects ALL bare
> IPs as "not a business website", and feeding resolved addresses through it rejects every
> domain on earth.
>
> `clientIpFrom()` reads `req.ip` / `x-vercel-forwarded-for`, never `x-forwarded-for[0]`. Vercel
> APPENDS the real IP to a client-supplied header, so index 0 is the attacker's own string and
> the per-IP cap is bypassed by rotating it. `hashIp()` never stores a raw IP: that column is a
> rate-limit ledger, not a visitor log (`SCAN_IP_SALT`).
>
> The read-then-insert race is closed in the DATABASE, not the check: a partial unique index on
> `domain where status in ('researching','running')` (`docs/2026-08-05-scan-sessions-unique.sql`).
> On conflict, `start/route.ts` re-reads and hands the loser the winner's session, so the race
> resolves into a cache hit. `findCachedSession()` also drops sessions stuck in `researching`
> past `RESEARCH_TIMEOUT_MINUTES`, because `audit-watchdog` only knows about `audit_reports` and
> would otherwise leave a dead row serving the same infinite spinner to everyone for a week.

**Client/server split.** `src/lib/scan/steps.ts` holds `SCAN_STEPS` + the wire types and imports
NOTHING server-side; `session.ts` holds everything touching Supabase. Importing `SCAN_STEPS` from
`session.ts` in the client component dragged `supabaseAdmin` and `node:crypto` into the browser
bundle (129 kB → 3.66 kB after the split). Keep them apart.

**Theme.** `src/app/scan/scan.css`, scoped to `.scan-root`. Token values and naming are explee.com's
(shadcn naming, `--radius .625rem`, Geist Sans + Geist Mono via the `geist` package, forced dark),
with `--accent-brand` swapped to SRT reef `#00C9A7`. Scoped because the root layout owns `:root`
AND hard-sets `font-family` inline on `<body>`, which is why `.scan-root` re-declares it.

**Every scan posts a prompt drop into `#ai-visibility-audits`** via `runAuditPipeline`, so the
channel is now fed by strangers, not just `/audit` runs. The rate limit plus the domain cache is
what bounds that. `lead_source = "scan"`; the email gate calls `ingestLead()` and back-fills
`requester_email` onto the report only when it is still blank — a report already belonging to a
lead is never reassigned.

## /v2 — the srtagency.com rebuild, PREVIEW ONLY (2026-08-05)
`mission.srtagency.com/v2`. An explee-styled rebuild of the marketing site, built to be looked
at and argued about, not shipped. **The live site is untouched**: srtagency.com is still the
static `srt-agwb` repo, nothing there links here, and the layout carries `noindex, nofollow`
plus a sticky PREVIEW ribbon so a half-finished rebuild can never be mistaken for the real one
or outrank it.

Shares one design system with `/scan`: `v2/layout.tsx` applies **both** `.scan-root` (the token
block, from `scan/scan.css`) and `.v2-root` (sections, from `v2/v2.css`). The hero embeds the
real `<ScanForm/>`, so the demo's input actually runs a scan.

**Everything factual on the page is lifted from the live site, deliberately.** Pricing and all
six FAQ entries are verbatim from srtagency.com's `FAQPage` JSON-LD; the three statistics are the
cleared ones from `llms.txt`, each rendered with its citation inline. That is so the preview
cannot quietly promise something the real site does not.

> ‼️ **The testimonials section renders a visible placeholder, not testimonials.** Explee runs a
> carousel in that slot and there are no real client quotes to put in it. Nothing was invented.
> A fabricated testimonial on an agency whose entire pitch is "you can verify this yourself" is
> the one thing that would sink the pitch, so the slot stays empty until real quotes exist.

Copy constraints, same as the rest of SRT's output: no em dashes, no outcome claims (verifiable
visibility only, never customers or revenue), no statistic without a source.

`body:has(.scan-root)` in `scan.css` repaints the body: `globals.css` sets `#0B1426` on `body`,
so overscroll and any gap past the content showed Mission Control navy behind the black page.

## SRT Follow-Up Operator (2026-07-31)
Everything after the pitch is sent. `#followups_channel` used to carry the Google Maps clinic
scrape; it is now the operator's home. A digest posts at 09:00 ET (`0 13 * * *`,
`/api/cron/followup-digest`) with HOT / CALL LIST / EMAIL DUE / WAITING, and every prospect
gets its OWN thread there.

**Two threads per prospect, on purpose.** The audit thread in `#ai-visibility-audits` keeps the
report, the scorecard and the intake conversation, and `audit_reports.slack_thread_ts` carries a
UNIQUE index that belongs to it. The operator thread lives on
`outreach_prospects.slack_thread_ts`, its own column with its own partial unique index. Each
links to the other; neither fights the other's schema.

- `src/lib/followup-operator/sent-sweep.ts` — reads Outlook **Sent Items** via
  `microsoft.listMessages`, so pitches Matthew types himself are tracked too, not just drafts
  this system generated. Idempotent on `graph_message_id`: the window deliberately overlaps the
  previous run and a re-seen message leaves the clock alone. It filters on `receivedDateTime`,
  not `sentDateTime`, because `listMessages` hardcodes `$orderby=receivedDateTime desc` and
  Graph rejects a filter and sort on two different date properties.
- `src/lib/followup-operator/cadence.ts` — turns `PERMISSION_SEQUENCE[].day` from a prompt
  label into real scheduling. `stepOffsets()` derives `[0,1,2,4,7]` from the sequence itself, so
  editing the ladder in `email-assistant.ts` reschedules the operator with it. Due dates anchor
  on `first_sent_at`, never on the last touch, so a nudge approved two days late does not drag
  the whole ladder.
- **Never two channels on one prospect in one day.** `hasOutboundTouchToday` gates the digest;
  a prospect already touched today silently moves to tomorrow. The single exception is an
  unanswered call, logged with `metadata.counts_as_touch = false`, because a call nobody picked
  up is not a touch that landed and the text and email after it are the whole point of dialing.
- Unrecognized recipients enroll as `confirmed = false` and are **never** scheduled or drafted
  for until Matthew taps ✅ Track (`fo_track` / `fo_ignore` in `api/slack/actions`).
- `src/lib/followup-operator/operator-rules.ts` — the doctrine as constants, same precedent as
  `VOICE_RULES` / `PARAGRAPH_RULES`. `bannedPhraseWarnings()` catches "just checking in" and
  friends in CODE and surfaces the hit above the draft, the way `linkWarning()` does. Text
  number is 336-833-2303, NOT the NAP number.
- Tables: `outreach_prospects`, `outreach_touches`, `outreach_sweep_state` —
  `docs/2026-07-31-followup-operator.sql`. `outreach_touches` is append-only, which is what
  `audit_reports.pending_drafts` never was (it is overwritten on every draft).

**Maps prospecting is PAUSED.** `pull-trt` / `enrich-trt-emails` are out of `vercel.json`, and
`pull-trt`, `pull-medspa` and both `outscraper-*` webhooks return early unless
`MAPS_PULL_ENABLED=1`. Their Slack fallback moved from `SLACK_FOLLOWUPS_CHANNEL` to
`SLACK_CEO_CHANNEL` so a replayed Outscraper callback can never post into the digest channel.
Nothing was deleted; re-add the two cron entries and set the env var to resume. `outscraper.ts`
now reads `json.errorMessage` first — Outscraper returns `{"error": true, "errorMessage": "..."}`
and the old code coerced that boolean to `"true"`, which is why every failed pull logged a bare
`true` for a week with no diagnosable cause.

### The Loom wizard (2026-08-01, rebuilt 2026-08-04)
Reply `loom` in a finished audit thread. Three steps, because each decision changes the next:

| Step | Reply | What comes back |
|---|---|---|
| 1 | `loom` (or `loom $499, 45 days`) | the 20 prompts exactly as run (blank line between each so they paste into a temporary chat without merging), PRE-FLIGHT, and the 3 worst / 3 best customers as a menu |
| 2 | `1` / `2` / `3` | six image ideas for that customer, one line each (`image-ideas.ts`) |
| 3 | `1` .. `6` | the paste-ready image prompt, then the read-aloud script as a `.txt` upload |

Plus `script` to rebuild the `.txt` without redoing the wizard, and `cancel` to drop a
half-finished menu.

**A bare digit means different things at different moments, and the order is load-bearing.**
`audit_reports.loom_state` (`docs/2026-08-04-audit-loom-state.sql`) holds the pending menu, and the
`/^([123])$/` email picker is guarded on it (`loomPending`) rather than being moved. Null state,
which is what every pre-wizard row has, means a digit still creates the Outlook draft. Step 3 sets
the stage to `"done"` rather than clearing the row, so `script` still knows who the recording is
aimed at while the digits go back to meaning email. Same precedent as `drop-studio.ts`, where a
digit is read against `job.stage`.

**The six-beat timing sheet is gone.** It was six-word bullets written on the theory that Matthew
improvises better than he reads; in practice it meant re-deciding the same pitch's wording every
recording. `loom-script.ts` renders his own script instead, filled from this run's data, read out
loud with screenshots pasted over the top. What survives in Slack is PRE-FLIGHT, because it carries
the things a script cannot: DO NOT OPEN WITH, which engines returned data, the branded-prompt count.

#### Template v2 (2026-08-16)

The script the wizard writes is now v2. Structural, not cosmetic:

| | v1 | v2 |
|---|---|---|
| the score | mid-script, after a build-up | **first thing said** |
| best customers | one, named | **all three, read out as their card labels** |
| the middle | one "what we do" paragraph | **3 pillars: Findable / Familiar / Freshness** |
| the offer | one paragraph | **3 numbered commitments** |
| price | one line, both tiers | both tiers **plus `TIER_CONTRAST`**, what actually separates them |
| urgency | none | an either-or beat, **said twice**, bookending the pillars |
| the close | "reply with let's do it, I'll send an invoice" | **the payment link**, then invitation link, then `ONBOARDING_WINDOW` |

> ‼️ **THE THREE PILLARS ARE CONSTANTS AND MUST NOT BECOME PROMPT MATERIAL.** Two of them are
> carried by a story about a real person: the Florida operator whose own reviews were quoted to
> recommend his competitors, and Matthew's wife booking a laser appointment off a review ChatGPT
> surfaced at a barbecue. A model asked to "tell a client story for this niche" does not decline for
> lack of one, it invents a client, on camera, in a pitch whose whole basis is "you can verify this
> yourself". Same no-fabrication rule as `run-prompts.ts`, applied to speech. `LOOM_PILLARS`,
> `LOOM_COMMITMENTS` and `urgencyBeat()` live in `loom-script.ts`; the urgency beat is one function
> called twice so the two readings cannot drift into being different thoughts.

> ‼️ **The ROI line is spoken-only, on purpose** (Matthew's call). "Just one extra client a month
> will very likely make back the investment" is a `DELIVERY_BANNED_PROMISES` hit and downstream
> behaviour is already correct: `spokenPromises()` catches it in the transcript, FLAGS it in Slack,
> and the delivery email declines to repeat it. The video cannot unsay it, the email can decline to
> put it in writing. Do not "fix" the drafters to match the script, and do not copy the sentence
> into one.

**`PAYMENT_LINK` is tri-state and both callers handle it.** `SRT_PAYMENT_URL` unset is a real state,
not a config error to paper over: the script prints a `!!` correction instead of the close, PRE-FLIGHT
prints `NO PAYMENT LINK SET` instead of a checklist item, and the delivery email flags it and writes
`[LINK DE PAGO]`. Same discipline as `site_signals` and `robots_check`. A promised link that does not
exist is discovered by the prospect, after the recording, when nothing can be done about it.

**`TradeVoice.attract` was deleted with v2.** The best customers are now read out as their own card
labels, so the spoken plural rewording that fed "get in front of more X or Y" had nothing left to
fill. `avoid` stays, because "and keep you away from the sample hoarders" still needs it.

**`computeBeatSheetFacts()` is exported separately from `renderPreflight()`** so the script and the
card consume the same facts. Recomputing would mean a second price-tier Claude call and, worse, a
PRE-FLIGHT flagging one prompt as DO NOT OPEN WITH while the script opens on a different one.

**Two claims the script will not make.** The image is introduced as the TARGET, never as a lead that
arrived, matching the doctrine in `dream-lead.ts`. And there is no forecast of how many customers
this produces, because nothing in the pipeline measures or predicts one: `LOOM_CLIENT_COUNT_CLAIM`
in `src/config/pitch.ts` is null, and turning it on is a decision someone makes on purpose rather
than a sentence a model wrote. `LOOM_PRICE_LABEL` / `LOOM_START_WINDOW` are constants for the same
reason `PERMISSION_CLOSE` is: a video that says a different number than the invoice cannot be
walked back.

**The wizard never dead-ends on a failed avatar set** (2026-08-04). It used to stop after the
pre-flight and tell him to run `avatars` and try again, which landed on the same failure and left no
route to the picture or the script. Now it skips the menu and carries on against the customer
`buildDreamLeadPrompt` derives from the questions the business is ABSENT from — the pre-wizard
behaviour, which is sound. A failed niche set costs the three-way CHOICE, not the recording. The
stand-in is stored on `loom_state.derivedAvatar` rather than re-derived, so the picture, the script
and a later `script` all describe the same customer, and `avatarIndex` stays null because there was
no menu to pick from (claiming "customer #1" would imply a choice nobody made).

**`dream-lead.ts` gained two presets** that `choosePreset` will never pick automatically, `CRM_CARD`
and `TEXT_THREAD`. They are only reachable from the six-idea card or `image crm` / `image text`,
because neither is a safe default (not every owner runs a CRM, and a texted inquiry is a claim about
how that business takes leads). The divergence axis for the six is *where the inquiry physically
lands*, not what it looks like: six renders of a phone notification make the picker decoration.

**`redesign|loom <url>` now requires an actual URL** (`https?://`). It was `\S+`, so `loom $499`
stored "$499" as the recording's URL and ate the price override.

**The point of the file is `PROMPT_TRAMPA`**, the prompt where the business ranks best. The
prospect checks that one himself right after the video, so opening with it kills the video and
ignoring it makes the rest look staged. It is delivered early as a concession, and PRE-FLIGHT
flags it as DO NOT OPEN WITH before recording starts.

Four things it refuses to invent, each backed by a real gap in the data:
- **Rank.** There is no position column, and `recommended[]` order is incidental, not
  contractual, so index+1 there would be fiction. `deriveRank()` re-derives it from
  `raw_response`, the only place the ordered list actually exists, and returns null when it
  cannot. The beat then prints with no number rather than a plausible one.
- **Engines.** `enginesWithData(runs)` treats an engine with zero `status === "ok"` rows as not
  having run. `ReportView` cannot answer this because `engineCell` collapses "no run row" and
  "run failed" into the same `no_data`.
- **Branded wins.** A branded prompt returns the business for the trivial reason that it names
  it. `PROMPT_TRAMPA` is picked from organic prompts only. When `client_name` is null it
  **refuses outright**, because `buildAliases` then falls back to `business_type` and every
  prompt containing the category phrase would look branded.
- **Price tier.** Nothing in the pipeline records recurring-vs-one-time; only `block` and the
  prompt text exist. One Claude call infers it and PRE-FLIGHT labels the pattern line as a read,
  not a measured finding.

`site_signals` is handled three ways on purpose: a finding, `[]` (scan ran, site clean, so the
beat is cut), and `null` (never scanned, so no site claim is allowed). Those must not read the
same on camera.

**Every draft footer now prints the whole command menu** (`THREAD_COMMANDS` in
`thread-assistant.ts`, the single copy). The old footer named only "1", which left every other
command in the router undiscoverable unless you already knew it existed.

### The call script (2026-08-06) — `call` in a finished audit thread
Reply `call` (or `call: watched the loom, says price` to aim it) and the thread returns the phone
script to dial off, then a fenced COACH NOTES block on its own message.
`src/lib/audit-engine/call-script.ts`. Every other command in this folder produces something
WRITTEN; this is the only one whose output is spoken live, which is why it is bullets under 25
words rather than paragraphs.

**The three commands are one pipeline:** `loom` writes the recording, `call` is the follow-up
phone script, `close` is the selling script. **The VERB picks it and nothing else does.**

| | `call` (followup) | `close` (closing) |
|---|---|---|
| what they have | email 1, or the video with no reaction yet | they watched it and they're warm |
| the goal | earn "send it over", or find out if they watched it | remove one obstacle, then paperwork |
| price | **never quoted**, withheld from the brief entirely | quoted, no guarantee |
| sections | open, 3 points, the frame, the reply ask, 5 stalls, **+ a send-instead email** | 10 sections, 7 closes |

**The follow-up card is deliberately SHORT.** It carried three selectable openers, a "twenty
second why" and a flow section, and all three went: picking between framings in the first two
seconds of a live call is not a decision there is time to make, and once the card reads top to
bottom as the conversation, a separate flow section is the same content twice.

**Two lines are CONSTANTS, not prompt instructions** (`NOT_SELLING_LINE`, `REPLY_ASK_LINE`), the
same precedent as `PERMISSION_CLOSE`. The model rewrote both every time it was merely asked, and
always the same way: "I'm not selling you anything" became "I'm not here to sell you anything
today", which is a salesperson's sentence and lands as one, and the reply ask kept growing a
justification when the whole reason it works is that it is a tiny favour asked quickly.

**`points` is exactly 3 and the shape is fixed**: the number, then ONE of those questions made
concrete as a person the owner can picture, then why that customer beats the one they get today
(named against the anti-ICP). An owner cannot picture "visibility gaps"; he can picture a property
manager looking for rental turnover work. That is the whole call. They are spoken BULLETS, one
sentence and 20 words each (`MAX_POINT_WORDS`), enforced — a live run returned three sentences in
point 2, which is two of the three points crammed into one and unreadable off a phone.

`videoHasGoneOut()` is now one warning line in the header, not a section: `call` is the "they have
not seen it" call by definition, but the row cannot prove nobody pressed play, so the handoff to
`close` is stated once and dropped.

> ‼️ **`call` must never auto-escalate to closing, and it used to.** Keying off `loom_url` was
> wrong twice over: a stored recording proves the video was MADE, not watched, so it opened selling
> to people who never pressed play; and it made one word mean a gentle follow-up on Monday and a
> price conversation on Thursday, which is not a thing to discover with the phone already ringing.

The `followupEmail` on the follow-up card is the same job without the phone call, and it goes
through `lintSpoken`'s CONTENT guards with the speech: a price or a reach claim is no more
acceptable written down, and a sent email outlives an improvised sentence. It is deliberately NOT
in `followupSpoken`, only in `followupWritten`, because it is paragraphs and would fail the
one-breath word limit on every run the moment that limit became a rejection.

> ‼️ **The 25-word limit is REAL on `call`, and it used to be decorative.** A live card shipped
> with its own ":warning: 12 line(s) run past 25 words" printed on top of it, which is a note
> telling him it is unusable while he dials off it anyway. `followupSpeechProblems()` now fails
> the generation, so `callClaudeJSON`'s correction retry fires with the offending lines quoted back
> at the model by word count.
>
> **And it still cannot leave him with nothing.** That helper THROWS after its one retry, and the
> thread router turns a throw into "⚠️ Couldn't draft that" with no card. So `validate` is a
> closure that keeps the last payload whose SHAPE was right (`followupShapeOk`); if the retry still
> cannot get the lines short, `buildFollowupScript` catches, posts that script, and `lintSpoken`
> prints the warning banner above it. Zero extra API calls: it is what the retry already returned.
> A genuine shape failure has nothing kept and rethrows as before.
>
> `close` is unchanged and still WARNS only. It is read by someone who has already had the whole
> conversation once, and its seven closes are a much more expensive generation to re-ask for.

> ‼️ **`intake_answers` is filtered before it reaches the brief** (`usefulIntakeAnswers`). At
> `awaiting_intake` EVERY free-text reply is stored as the intake answer, so a word typed in the
> belief that it was a command is kept verbatim and outranks everything generic from then on. A
> live brief printed `MY NOTES: draft`, and the brief is the only grounding the live coach has for
> the whole call. It gates the WHOLE blob, never line by line: the real answer is four replies to
> the four intake slots, so it legitimately contains lines like `Fran`, an email address and `yes`,
> and a per-line word count would gut it. Applied in `buildCallFacts`, so `factsPrompt` and
> `buildCoachNotes` are cleaned by one call and cannot disagree about what Matthew said.

> ‼️ **The reply move is the point of a follow-up call.** Getting them to open email 1 and hit
> reply while he is still on the phone is what keeps everything after it out of spam, and it is
> the whole reason to dial rather than email again. It is section 4, starred, and `followupShapeOk`
> rejects a script that omits it.
>
> **It is spoken ONCE.** `REPLY_ASK_LINE` is the constant, and around it sit two NAMED fields,
> `whileTheyLook` and `ifTheyWont`. They were one `replyFallback` array whose first slot was
> described in prose, and the model restated the ask there every single time, so the card printed
> it twice. Three layers now: the prompt quotes the constant and bans the word "reply" in both
> slots, `restatesReplyAsk()` fails the generation into the correction retry, and
> `formatFollowupScript` drops any survivor. A named field is a stronger contract than "line 1".

> ‼️ **The follow-up brief WITHHOLDS the price rather than saying "don't quote it".** The COACH
> NOTES are read by a model that is trying to be helpful mid-call; a number sitting in its context
> is one it will eventually reach for when someone asks "how much". Absent beats forbidden.

**Openers diverge by ANGLE, not wording** — three phrasings of one sentence is decoration. They
open on a gift, a finding and a straight question, and fail differently, so a flat no on one leaves
the next call somewhere to go. The redesign opener is offered only when `redesign_url` exists and
is the strongest available: it leads with something already built and free, so there is nothing to
say no to.

**`lintSpoken` rejects invented reach.** "In front of 500 more people" is not measured anywhere in
this pipeline and is exactly the claim a prospect asks you to show your work on, which is fatal for
a pitch whose whole basis is "you can verify this yourself". The honest number is how many of their
buyers' questions they are absent from, and that is the one the script uses.

**The script is written by Claude; the COACH NOTES are built in CODE.** That split is the whole
design. The notes block is pasted into the SRT Call Coach extension, where it grounds every live
suggestion for the rest of the call, so one hallucinated figure there would not be one bad line,
it would be forty minutes of confident wrong coaching. `buildCoachNotes()` assembles it from
`computeWeightedScore` + `view.mostRecommended` + the absent organic prompts by hand and the model
never touches a number. Same no-fabrication rule as `run-prompts.ts`, applied to speech.

Grounded entirely in what is already persisted, so there is **no new table and no migration**:
ICP/anti-ICP from `niche_briefs.avatars`, the gap from `view.prompts` where `!isBranded &&
!appeared`, price from `LOOM_PRICE_LABEL` (or the `loom_state.price` override, because a video
that said $499 makes $499 the price on the call), what they have already seen from
`outreach_stage` / `loom_url` / `redesign_url`, and `intake_answers` as instructions that outrank
everything generic.

**When the Loom wizard already picked a customer, the call names THAT one.** `resolveAvatars()`
prefers `loom_state.derivedAvatar`, then `loom_state.avatarIndex`, and only then a fresh pick.
Switching customers would contradict the recording they just watched.

> ‼️ **Context has to come after a COLON, and the bare form is exact.** At `revealed`, free text
> is the PROSPECT talking, and "call me next quarter" is one of the most common stalls there is.
> A `call\s+(.*)` pattern eats that and hands back a script instead of the objection reply it
> needs. The branch also sits ABOVE the `drafted` free-text branch, or `call` reads as a draft edit.

**Seven closes, two responses each, never a third** — four circumstance stalls, two other-people,
one self, fixed rather than model-chosen so the card is numbered identically for every prospect
and he can jump to "number 5" mid-call without reading labels. `coerce` re-sorts whatever order
the model emitted back into `OBJECTIONS` order. A third response reads as pressure.

**There is no guarantee on this offer**, so `HARD_LINES` bans guarantee and risk-reversal language
outright, and `lintSpoken()` re-checks it in code along with promises of customers/revenue and any
suggestion to fund this personally. Findings post ABOVE the script, same as `linkWarning()`. On
`close`, over-long lines are still warned about rather than rejected, because a script with one
clumsy line still beats no script; on `call` they are rejected first and only warned about if the
correction retry could not fix them (see the box above).

### The audit thread REASONS now (2026-08-11)

Free text in `#ai-visibility-audits` used to fall through to "revise email 1 in place", and that
one branch produced six wrong answers in a row on a live thread, ending with a follow-up that told
a prospect who already had the video "I recorded a 4 min video, want me to send it over?".

Exact commands (`call`, `close`, `1`, `nudge 3`, `loom`) keep their fast path. **Everything else,
including every `app_mention`, goes to `thread-agent.ts`**, a real tool loop over the whole Slack
thread (`slack.conversationsReplies`). `ai.ts:runConversationWithTools` gained an optional 4th
argument so the loop is shared rather than forked; the Office Manager, dashboard chat and Telegram
are untouched.

`audit-tools.ts` wraps generators that already exist and are already governed, so `draft-linter`,
`format-guard` and `lintSpoken` all still apply. Big artifacts POST THEMSELVES and return a short
receipt, because making the agent re-emit a 3,000 token call script would triple every run and let
it paraphrase a card whose exact wording is the point.

> !! **The agent cannot send.** `microsoft.sendMail` and `sendDraft` are not imported by
> `audit-tools.ts` and must not be. The worst outcome of a bad reasoning run is a wrong draft
> sitting in Slack. Same doctrine as the price gate: absent beats forbidden.

> !! `edit_draft` uses a **dynamic import** of `thread-assistant.ts`. That file imports
> `thread-agent.ts`, which imports `audit-tools.ts`, so a static import there closes a cycle that
> builds in dev and fails on a cold module graph.

### `outreach_stage` drifts. The mailbox does not. (`thread-truth.ts`, 2026-08-11)

`outreach_stage` only moves when someone types a command, so it is routinely stale: Grey Seal sat
at `drafted` long after the email went out and the prospect said yes, and `ensurePermissionClose()`
therefore appended the permission ask to a follow-up. Every generator downstream inherited that.

`readThreadTruth(report)` / `readMailboxThread(email)` read the real conversation off Graph: what
was sent, whether they replied, what they said verbatim, days of silence. `derivedStage` **outranks**
the stored column and the disagreement is PRINTED, never silently corrected. Cached 10 minutes on
`audit_reports.thread_truth`.

- **Read for every lead, not just audited ones.** Whether we have contacted someone is a fact about
  the mailbox. The first cut gated it on a report existing and reported "nothing was checked" for a
  Zoho lead with three emails already sent.
- **`prospect_email` is null on plenty of live reports**, so the address resolves report ->
  `outreach_prospects` -> linked contact. A miss says "we cannot tell", never "they were not contacted".
- !! `loom_url` / `redesign_url` are NOT inputs to the stage and must not become inputs. A stored
  asset proves the video was MADE, not watched. Same trap `call-script.ts` already documents.

`followup-email.ts` is the drafter that was missing: they got it and went quiet, or they replied.
It never calls `ensurePermissionClose`. Its few-shot is a real sent email, **withheld unless the
link policy is `any`** because it quotes prices.

### Pricing is TWO TIERS (2026-08-11)

Core `$349/mo` and Complete `$499/mo`, both always available, differing in scope. `OFFER_TIERS` and
`OFFER_EXIT_LINE` in `src/config/pitch.ts` are the single source. The old "$499 with a $349 lever
you have to earn" model is gone, and with it `priceLeverUnlocked`.

What survived from the gate: **withholding on a follow-up call** (no figure is in the request at
all, because a number in a helpful model's context is one it will reach for), and the ban on
deriving a third number from the two. "Can you do better" is answered by Complete -> Core, which is
a smaller scope for a smaller number, not a discount.

`priceBlock(callType)` now takes the call type, not an unlock boolean.

> ‼️ **A price literal outside `config/pitch.ts` is the bug, not the number it holds.**
> `DEFAULT_REVEAL_TERMS` in `email-assistant.ts` hardcoded `$399 per month` and went on quoting it
> after this change, so every bare `reveal` handed a prospect a price that does not exist under the
> current offer and never did. Fixed 2026-08-16 by deriving it from `PRICE_CORE` / `PRICE_COMPLETE`
> / `OFFER_EXIT_LINE`. `TIER_CONTRAST` (added with Loom v2) lives there too and is the FRAMING, not
> the deliverables: `OFFER_TIERS[].includes` remains the contract.

### Call Coach knows who is on the phone (`src/lib/call-coach/`, 2026-08-11)

`POST /api/call-coach/identify` (screenshot + Chrome tab URL) and
`POST /api/call-coach/brief-for-record` (dual auth: coach key **or** `CRON_SECRET`, so the dialer
can call it). Both return one brief and write one `call_coach_sessions` row.

> !! **The Chrome tab URL is tried FIRST and skips the vision call entirely.** A URL cannot be
> misread; a screenshot can. That ordering is what makes wrong-lead risk manageable, and it means
> the common case costs nothing. Vision confirms rather than decides.

> !! **The screenshot is never persisted.** Not Supabase, not Slack, not a log line. It is a picture
> of whatever was on his screen. The first debugging instinct will be to save it; do not.

Nothing below `strong` auto-commits: weak/ambiguous returns candidates and the coach asks. Three
redundant layers guard a misidentification, listed at the top of `resolve-target.ts`.

`brief.ts` joins the two context builders that never spoke. `buildCoachNotes` is reused **verbatim**
rather than reimplemented, so there is one place that turns audit rows into speakable numbers. With
no audit the numbers block is a **negative assertion** ("NONE. Do not cite a score..."), because every
brief the model has seen had a score and an absent section invites it to supply one.

**Three live sources, read at scan time** (2026-08-11): Zoho (`buildZohoOnlyContext`), the Outlook
mailbox (`readThreadTruth` / `readMailboxThread`), and now the audit's **Slack thread**
(`slack-thread.ts`). Slack was the hole — `brief.ts` carried `slack_channel_id`/`slack_thread_ts`
only so the post-call wrap knew where to post, and never read a byte. Everything decided in
`#ai-visibility-audits` was invisible on the call unless a recognised command happened to persist
it to a column, and `intake_answers` was the only path in.

`readAuditThreadNotes` keeps **human** messages only — bot posts are the audit card, every draft and
every receipt, which are output rather than input — and drops bare command tokens (`1`, `call`,
`nudge 3`) because those are instructions, not context. Live read rather than write-through: no new
table, no backfill of the existing audits, and it cannot drift.

> !! **`THREAD NOTES` is appended LAST and capped at 800 chars, and both are load-bearing.**
> `clip()` and `/suggest`'s `MAX_BRIEF_CHARS` both truncate from the end, so whatever sits last is
> eaten first. Thread chatter is the most expendable thing in the brief and the measured numbers are
> the least — a brief that loses its score silently reproduces the bug directly above.

> !! **`findReport`'s website route used to scan the 50 most recent done reports and match
> client-side.** There were 44 done reports when that was found, and `/scan` lets strangers add to
> the table. At 51 the oldest silently stops matching, the brief prints "no audit has been run" for
> a lead we HAVE audited, and `callType` drops to cold. It now filters server-side on the
> normalized host, then still compares the host exactly so a substring collision cannot pass.

> !! **Zoho returns `""` for unset text fields, never null**, so every `??` chain over Zoho data is
> dead unless it goes through a `blank()`/`str()` guard. This shipped broken twice in one day: first
> `rec.Company ?? rec.Deal_Name` keeping the blank, then both routes returning their own
> pre-correction `target` instead of `brief.who`. The WHO line is what makes a wrong lead obvious in
> five seconds, so it is the one string here that must never be a shrug.

### Post-call wrap (`wrap.ts`, `wrap-card.ts`, 2026-08-11)

Call ends -> transcript is read back **from the database** (never from the request, or a client could
forge a call into a CRM note) -> Sonnet writes it up -> one card in that lead's audit thread.

On thumbs-up: claim the row, write ONE Zoho note, create an Outlook **draft**, print the draft into
the thread. `wrap_state` is a claim flag (`auto_send_state` precedent) and `zoho_note_at` is checked
separately, so a Graph failure plus a retry cannot double-write the note. Slack gets 200 in under a
second and the work runs in `waitUntil`.

- !! **NOTE ONLY.** No `updateLead`, no `Lead_Status`, no structured field, ever. Matthew's explicit
  call, and it is the edit someone adds later "for convenience".
- !! **Nothing sends.** `microsoft.sendDraft` is not imported by `wrap-card.ts`.
- The prompt states that speaker labels are reliable and the WORDS are not, which is true: labels
  come from which socket the audio arrived on, but live phone audio garbles numbers and mangles
  Spanish. So a heard figure is never written as confirmed, `nextStep` is null unless something was
  actually agreed, and `outcome: "unclear"` is an available answer.

Migration: `docs/2026-08-11-call-coach-lead-context.sql` (applied 2026-08-11).

### SRT Call Coach backend (`/api/call-coach/*`)
The Chrome extension lives in a SEPARATE repo (`Desktop/Code/live call coach srt`) and deploys
separately; this repo owns its prompt, its playbook and its auth. Routes: `suggest` (the prompt +
Claude Haiku 4.5 SSE proxy), `deepgram-token` (mints an ElevenLabs realtime token, the name is
legacy), `playbook` (GET bearer / POST `x-playbook-secret`), `session`, `transcript`.

**It is a sales coach, not the old MCA funding coach** (rebuilt 2026-08-06, widened 2026-08-10).
`STATIC_RULES` in `suggest/route.ts` is the doctrine: the three buckets,
isolate-before-you-answer, at most two closes per obstacle, stop selling on the yes. Every funding
reference is gone.

**THREE modes as of 2026-08-11**: `COLD`, `FOLLOWUP`, `CLOSE`. The extension sends an explicit
`callType`, resolved server-side by `call-type.ts` from the audit, the real mailbox and the CRM.
When it is absent the route falls back to `brief ? "close" : "cold"`, which is byte-identical to the
old `brief ? WARM : COLD` (a pasted brief WAS "the pitch already happened"), so a hand-pasted brief
and a deploy skew in either direction both keep working.

`FOLLOWUP` is the one that did not exist: an email went out, they have not engaged, and **nothing is
sold**. No price is in the request at all. Without it a follow-up dial inherited CLOSE and quoted
both tiers to someone who had not opened the email. **Do not try to infer the mode from the
transcript**, that is the bug this replaced.

**The pain gate outranks everything except HARD LINES.** No named pain, no report: no video, no
report, no implementation plan, no price until the owner has said something is wrong. The brief
satisfies it in WARM; nothing satisfies it in COLD except the owner saying it.

**CLOSER is the spine and it runs in order** (Clarify, Label, Overview, Sell, Explain, Reinforce).
All 3 suggestions target the CURRENT stage, three angles on it rather than three stages. Something
volunteered from a later stage is recorded as a letter-tagged note, not chased. **Two** exceptions
now: R (the moment they say yes, jump there and stop selling) and the status-quo brush-off.

### THE STATUS-QUO BRUSH-OFF — the second stage-discipline exception (2026-08-11)

*"I've got plenty of customers"*, *"we're doing fine"*, *"I'm all set"*, *"we get everything from
referrals"*. This is the owner rejecting the **premise**, not a stage sitting unfilled — and stage
discipline used to outrank it, so an unfilled stage C produced three flavours of the same pain
question. A live call got exactly that: three cards reading `C PAIN DISCOVERY`, `C CLARIFY INTENT`,
`C DIRECT PAIN` to a man who had just said he had plenty of customers.

The move is agree out loud, then shift the axis from **quantity to composition** (more of the ones
that make him money, fewer that cost him — which is already what `WHAT WE SELL` promises), then one
question that makes his claim checkable. Never argue with "I'm full"; never imply he needs volume.
On referrals, never call them weak: the referral that used to happen in person now happens inside
an AI. Two attempts maximum, then take the clean no.

A `status_quo` family was added to the playbook for the same reason — the closest prior entries
were `"not interested"` and `"send me some information"`, so the single most common objection to
this offer had no coverage at all.

**Three cards must differ by ANGLE, not wording.** Stated explicitly in `OUTPUT` now: three
rephrasings of one move is one card printed three times, and it leaves him nothing when the first
does not land. Give him moves that fail *differently*.

**THREE system blocks, and the order is load-bearing.** `CACHED_PREFIX` (= `STATIC_RULES` + the
full playbook) carries `cache_control` and must stay first and byte-identical; the `MODE` +
`CALL LANGUAGE` + `PRICE` block is second (it selects which half of the cached rules applies, so
it has to be read before the rest); the CALL BRIEF is third. Anything that varies per call belongs
in block two, never in `CACHED_PREFIX`. The brief is `callContext`, capped at `MAX_BRIEF_CHARS`,
and it is the pasted COACH NOTES from `call` above. It is framed as "the ONLY numbers that exist"
because without that the model rounds 37/100 into "under 40%" and invents a competitor.

> ‼️ **THE PROMPT CACHE WAS DEAD FOR MONTHS AND NOTHING COULD HAVE TOLD YOU** (fixed 2026-08-11).
> `STATIC_RULES` measured **3,952 tokens** against Haiku 4.5's **4,096-token minimum cacheable
> prefix**. A prefix under the minimum does not error — it silently reports
> `cache_creation_input_tokens: 0` and re-prefills at full price and full latency on every single
> suggestion of every call. The code comment asserted the threshold was 1024, which is *Sonnet's*
> number. **The minimum is not monotonic across generations**, which is the whole trap: Opus 5 /
> Fable 5 = 512, Opus 4.8 / Sonnet 5 / Sonnet 4.6 = 1024, Opus 4.7 = 2048, **Opus 4.6 / Opus 4.5 /
> Haiku 4.5 = 4096**.
>
> It was invisible because this route proxies `claudeResponse.body` through untouched and never
> parses `usage`, and the extension's SSE parser discarded everything that was not a text delta.
> The extension now logs `message_start` usage — that is the only cache-health readout that exists.
>
> The fix was folding the playbook in: `CACHED_PREFIX` is **8,550 tokens**, ~2x headroom.
> **If `STATIC_RULES` is ever trimmed, re-measure with `count_tokens`.**

**`ttl: "1h"`, not the 5-minute default.** Within a call the requests are seconds apart and either
would hold, but there are minutes between prospects and a 5-minute entry expires in every one of
them, paying a fresh write on the first suggestion of every call — the one he is waiting on with
the phone ringing. The 1h write costs 2x once and then reads all day.

**`MODEL` is one constant used by both the warm-up and the real request.** Caches are scoped per
model, so a warm-up naming a different model writes an entry nothing ever reads: no error, a
permanent 0% hit rate. Two string literals is exactly how that drift happens.

**`POST {warm: true}`** runs `max_tokens: 0` (prefill only, no output tokens billed) and returns
immediately. The extension fires it from `startCapture()` while the share picker is open. It must
**not** stream — the API rejects `max_tokens: 0` together with `stream: true` — and its system
block must stay byte-identical to the real one or it warms an entry nothing reads.

**`validateCallCoachKey` is cached in-process for 5 minutes** (`call-coach-auth.ts`). It used to
block every suggestion on a Supabase round trip before the Anthropic request was even opened.
Negative results are cached too, but a *transient* Supabase failure is deliberately not, or one
blip would lock the coach out for five minutes mid-call. Trade: revocation takes up to 5 minutes.

### NEPQ mechanics (`call-coach-nepq.ts`, 2026-08-11)

From Matthew's NEPQ / 7th Level follow-up guide. It is the **HOW a line is worded**, layered under
the CLOSER spine, which stays the **WHAT and the order**. They do not compete: CLOSER picks the
move, NEPQ decides whether it sounds like a salesperson. `NEPQ_BLOCK` sits in `CACHED_PREFIX`
between `STATIC_RULES` and the playbook — it modifies every line the rules produce, so it has to be
read before the playbook's example responses rather than after them.

Carried: the extra banned phrases (following up / checking in / circling back / is this a good time
/ do you have two minutes / let me ask you a question), neutral qualifiers, **"feel" never
"think"**, confused-clarifier objection handling (repeat their own words back as a two-word
question and stop), the slight push-away that produces self-persuasion, consequence questions being
late rather than early, and the follow-up open.

> **Deliberately dropped.** The guide is written for a human with a voice; a suggestion card is text
> read off a screen. Shuffling papers as a pattern interrupt, hand gestures driving tone, pitch and
> volume cannot be carried by a card. What survives is the part that is WORD CHOICE — the hedged
> recall that lands as confused rather than accusing, the neutral qualifiers, the openers. The
> retail / walk-in framework is out too: SRT sells over the phone.

**The follow-up open is the whole call.** `scriptBlock("intro", "followup" | "close")` now builds on
it: his name said like someone they already know, a **vague** recall of the last contact with a
question mark on it, their problem in their words, then *"did you give up on [the result], or what
actually happened?"* — as a shape, never verbatim. Being slightly unsure about the timing is the
point: it invites a correction, and a prospect correcting you is a prospect in a conversation.

**The Slack `call` script gets it too**, via `openerAngle()` in `audit-engine/call-script.ts`, and
`lintSpoken` now **rejects the tells in code**. A prose ban is not a ban — same lesson as the
em-dash rule and the price gate. On that card the opener *is* the call, so one "just following up"
costs the whole conversation.

### Requested scripts: the Intro and Close buttons (2026-08-11)
`requestKind: "intro" | "close"` on the request body. When set, `merchantUtterance` stops being
required (an intro fires before anyone has spoken) and the user message changes. **The output
contract is byte-identical** — still 3 suggestions x 3 continuations + `qualification` + `notes` —
which is the entire reason this rides on `/suggest` instead of a new route: the extension's
incremental SSE parser is shape-driven, so it needed no changes, and auth, streaming and the
cached prefix all came for free.

> ‼️ **`requestKind` is a SEPARATE AXIS from `callType`, not a fourth value of it.** `callType` is
> where the RELATIONSHIP is; `requestKind` is what he is asking for right now. A close on a cold
> lead is `cold` + `close`, which one enum could not express, and folding them would have forced a
> fourth `CoachCallType` and a fourth `priceBlock()` branch.

**The mode-specific script wording lives in `src/lib/call-coach-script-gate.ts`, not in the
prompt**, and that is the third time this codebase has had to learn the same lesson:

> ‼️ It started as conditionals inside `STATIC_RULES` ("on COLD open with this exact stem, on CLOSE
> never use it"). Measured over three runs each, the cold stem leaked into a close-stage intro
> **1 time in 3**. Adding a ‼️ and the words "ONLY to COLD" took it to **3 in 3**. The cause is
> structural: the same paragraph also said SUGGESTION 1 IS EXACTLY THIS LINE, VERBATIM, and a
> verbatim order beats a conditional — emphasis on the conditional is emphasis on the whole
> paragraph, including the part already winning. Moving it to a per-call block took it to **0 in
> 3**. **Absent beats forbidden**, same as `call-coach-price-gate.ts` and the follow-up COACH
> NOTES. A model cannot quote a line it was never given.

- **INTRO** — 3 openers, built from the CALL BRIEF: this business, what they sell, who buys, the
  city, the owner's name. On `followup`/`close` it is a re-open instead. Never pitches, never
  prices, never mentions a report. Returns `qualification` all-null and `notes` empty, because
  nobody has said anything yet.
- **CLOSE** — 3 reframes, stage discipline **suspended** for this request only (he pressed the
  button, so he gets closes for where the call is, not for the current CLOSER stage). On `cold` the
  target is getting the website handed over so the free implementation plan can go out, by three
  different routes (offer it, shrink it, de-risk it). On `followup` no figure exists. On `close` it
  is the one-to-ten, the isolate, and paperwork.

### The canned openers are gone (2026-08-11, same day they were added)

The first cut hardcoded a `COLD_STEM` every intro card had to begin with (*"Hey, I'm looking for
some help here,"*), a `COLD_OPENER` suggestion 1 had to reproduce verbatim, and a three-line close
"spine" to follow close to verbatim. Live result: scanning Orlando Amusement resolved the business,
the owner, the city and what they sell — and then the intro **discarded all of it** and printed the
same three cards it prints for everyone. The close came back as three paragraphs that differed only
in preamble and ended in the same sentence three times.

> ‼️ **Do not put a verbatim line back in this file.** The failure was never that the model writes
> bad openers. It is that a verbatim order outranks every personalization instruction sharing a
> block with it — the identical structural lesson the "absent beats forbidden" box above already
> records, applied one level down. A card Matthew could have written on a sticky note is worth
> nothing on screen; the only thing worth generating is the part that changes.

The fixed script now lives in the extension as a **read-only panel** he opens when he wants it.
It is never sent to a model, because a model only ever hands it back paraphrased worse.

> ‼️ **COLD DOES NOT MEAN "NO AUDIT", and the first patch for the fabrication problem below got
> this wrong.** It hardcoded `NO AUDIT HAS BEEN RUN` into both cold blocks. That is false for a
> whole branch of `call-type.ts` — the one its own comment calls *"the specific trap: a report
> finished, a draft was written, and nobody pressed send."* `cold` means nothing was **delivered**,
> not that nothing was **measured**.
>
> Orlando Amusements sat in exactly that state: `status: done`, score 44/100, `outreach_stage:
> drafted`, `first_sent_at: null`. So `brief.ts` handed the model the full numbers block while the
> script gate told it none of it existed, and the coach asked blind discovery questions about a
> lead we had already audited. That is what "why won't it use my audit" turned out to be.
>
> **The rule: `call-coach-script-gate.ts` may state what has been SENT, because the mode encodes
> that. It may never state what has been MEASURED, because only the brief knows.** Both cold blocks
> now defer to the brief's `NUMBERS I MAY CITE` section, which is explicit in both directions —
> real figures from `buildCoachNotes`, or a literal `NONE` from `zohoOnlyNumbers()`.

**Two failure modes showed up when the verbatim text was removed, both caught by testing against
the live API before shipping. Both guards are load-bearing:**

1. **It invented findings to sound specific.** With the script gone the model filled the space with
   *"I was looking at how Orlando Amusement shows up"* and *"here's what I'm seeing: your name isn't
   showing up, but your competitors are"* — on a lead where **no audit has been run**. The block now
   states the line explicitly with an allowed/banned pair: specific means **the question is about
   their business**, never a claim about what you found. Sell the LOOK, never the result of a look
   nobody took.
2. **It dodged the length rule with run-on sentences.** Told "one or two sentences", it returned
   single 71-word lines held together by commas. The cap is now stated in **words (30, question
   included)** with the dodge named, in `shared` so it binds all three close modes. Measured before
   and after on the same brief: 71/51/60 words → 29/31/33.
- ~~`filterRelevantPlaybook`~~ **is deleted** (2026-08-11). The playbook now lives in
  `src/lib/call-coach-playbook.ts` as a pre-rendered block inside `CACHED_PREFIX`. The `playbook`
  field is still accepted off the request body and deliberately IGNORED — reading it would put
  client-controlled bytes in the cached prefix, so one stale extension would re-write the cache on
  every request.

> ‼️ **The scorer was matching on STOPWORDS, and it cost a live call.** For *"I got plenty of
> customers I don't need that right now"* it returned, in order: "i need to talk to my partner"
> (0.57), "too busy right now" (0.50), **"that's a lot of money"** (0.40), "i need to run it by my
> boss" (0.375), "how do i know this works", "i want to think it over", and **"let's do it"**
> (0.33). The model was handed price-objection and closing-on-the-yes material for a prospect who
> had just said he was satisfied, and answered with three discovery questions. Sending all 29
> entries costs nothing now that they are inside the cached prefix.

**Every suggestion AND every continuation must end in a question mark.** The continuation half had
to be stated separately and emphatically; the general rule alone left statements in the
continuations on 2 of 3 runs.

> ‼️ **Never claim work that was not done.** A cold brief that says "no audit has been run" once
> produced *"we just ran an audit on your site"* — a lie the prospect catches on the same call. The
> HARD LINE now says it outright: on a cold call the implementation plan is something he is
> OFFERING TO BUILD. Offer to look, never claim to have looked.

**Offer knowledge** in `THE MECHANISM` comes from `Desktop/AEO aduit/SRT_Sales_Letter.md` and
`SRT_Loom_Script.md`, filtered to what transfers across verticals: the Gap, 6%-to-45% AI discovery,
~85% of citations off-site, "it is not an auction", "nobody built your business to be readable by
a machine", generic AI content does nothing.

> ‼️ **`SRT_AEO_Offer_Pack.md` is STALE and its numbers must not be used** (confirmed with Matthew
> 2026-08-11). It is a Jul 21 TRT-clinic doc quoting $499 setup / $299-for-life / $999 / $10k tiers,
> a "cited in 90 days or your management fee back" guarantee, and a Friday deadline. `config/pitch.ts`
> is authoritative: **Core $349, Complete $499, month to month, no setup fee, no guarantee.** The
> guarantee ban stays. Also excluded: the 230-million-health-questions stat, TRT/testosterone
> framing, "$99 telehealth", and "patients" as the default noun — the coach is vertical-agnostic and
> is being pointed at property companies, not clinics.

**Language is decided in CODE** (`src/lib/call-coach-language.ts`, pure, same precedent as
`delivery-guards.ts`). It scores the last 5 turns on Spanish/English function words plus Spanish
orthography and emits `CALL LANGUAGE: en | es | mixed`. A prompt line alone does not survive a
Spanglish call: one English sentence flips the model back and it stays there. Defaults to `en` on
thin evidence, deliberately, because sprinkling Spanish at an English-only prospect is a worse
failure than switching a beat late. Words common to both languages ("no", "me", "son", "solo") are
excluded from both sets rather than assigned to one.

> ‼️ **The $349 lever is a CODE gate, not a prompt rule, and it had to become one.**
> `src/lib/call-coach-price-gate.ts` decides whether the discount exists on this request;
> `priceBlock()` then writes the PRICE paragraph, and when it is locked **the string "349" is not
> in the request at all.**
>
> It started as a prompt rule ("never before an isolate plus two failed responses") and **leaked
> the number on the FIRST price objection in 2 of 3 live runs** — once as an entire "here's what I
> can do: 349 a month" card, with the invented figure "cuts the first year cost in half" attached.
> The cause is structural: the model reads its own 3 suggestions as an escalating sequence and
> helpfully supplies step three. No amount of emphasis fixed it; withholding the number did, 0/3
> leaks locked and 3/3 offers once unlocked.
>
> Same doctrine as the follow-up COACH NOTES, which already **withhold** the price rather than
> forbidding it: absent beats forbidden. A number sitting in a helpful model's context is one it
> will eventually reach for.
>
> `priceLeverUnlocked()` requires BOTH that the owner raised money twice AND that Matthew answered
> it twice after the first time. Owner-mentions alone would unlock on "how much" followed by
> "that's a lot", before anything had actually been tried. It reads the **full** history the
> extension sends, not the 5 turns rendered into the transcript, or the lever would re-lock the
> moment the objection scrolled out of the window. `MONEY_RE` covers both languages.
>
> $499/mo is the price either way. Locked, the only answer to a request for less is a smaller
> scope. Unlocked, $349/mo is real and stated as a real price, with the bans on invented deadlines
> and fake scarcity intact, and neither figure may be turned into a third one by arithmetic.

**The close checklist IS the six CLOSER stages** (2026-08-10): `clarify`, `label`, `overview`,
`sell`, `explain`, `reinforce`. They replaced `watchedVideo` / `mainGoal` / `mainConcern` /
`decisionMaker` / `budgetFit` / `nextStep`; the last two live on as letter-tagged `notes` entries
(`E: partner has to sign off`). Still exactly six, because the extension's grid, its additive
merge and its streaming parser are all shape-driven.

**The output contract changed 2026-08-11: `continuations` is now a SEPARATE top-level array**,
`[[{name,body} x3] x3]`, index-matched to `suggestions`. They used to be nested inside each
suggestion, and the extension only renders a card once its whole object closes — so card 3's text
waited on ~450 output tokens instead of ~120. Measured against the real parser, all three cards now
render by 33% of the stream. The prompt states the ordering requirement explicitly because the
model will otherwise nest them back out of habit.

> Ship both repos the same day. The extension prefers inline continuations when present, so an
> extension running ahead of this backend still works; a backend running ahead of the extension
> degrades to cards with no continuations.

> The extension deploys separately. On a skew its `mergeQualification` iterates its own key list
> and ignores unknown keys, so a mismatch shows a blank checklist rather than crashing. Ship both
> the same day anyway.

**Em dashes are stripped in the EXTENSION, not here.** This route proxies the Anthropic SSE stream
through untouched, and buffering it to rewrite text would cost the streaming TTFT the design
exists for. `speakable()` in the extension's `api-client.ts` does it where the JSON is already
parsed. The prompt also asks for no em dashes, but the code strip is the guarantee, and live runs
confirm the model still emits them anyway.

> ‼️ **`max_tokens` is 1400, up from 800, and the old value failed SILENTLY.** `qualification` and
> `notes` are emitted AFTER `suggestions` in the JSON, so a long response does not lose its third
> card, it loses the CHECKLIST and the NOTES entirely, and the extension's tolerant parser renders
> the surviving cards as if nothing happened. Real responses land at 660 to 840 output tokens, so
> 800 was clipping regularly. Spanish made it systematic: the same answer runs meaningfully longer,
> so a Spanish call would have shipped with a permanently empty checklist and no diagnosable cause.
> Nothing is billed for tokens that are not generated and TTFT is unaffected, so the headroom is
> free. Do not tighten this back to "save money".

**Fallback suggestions are prospect-agnostic on purpose.** They render when Claude is unreachable,
knowing nothing about who is on the phone, so anything specific would be a fabrication shown at
the exact moment nobody is checking. Pure mechanics only, no score, no price, no guarantee. There
is a second copy in the extension's `api-client.ts` for when this whole app is unreachable; keep
the two in step.

### Instant lead pitch (public free-audit leads only)
`src/lib/audit-engine/lead-pitch.ts`. A form lead ASKED for the report, so sending it is
fulfillment, not cold outreach — that is why this lane may send at all and why cold `/audit`
runs are untouched by it.

When `finishReport` finishes a report with `requester_email`, it drafts the pitch
(`draftInitialEmail`), signs it, attaches the scorecard PDF, stores `draft_message_id`, and
posts a card to the lead's `#hot-leads` thread with **✅ Send it** / **✋ Hold**
(`audit_send_now` / `audit_hold`). Send fires the stored Outlook draft via
`microsoft.sendDraft`, so what goes out is byte for byte what was reviewed, including any edit
made in Outlook first. A send also enrolls the recipient in the Follow-Up Operator, so the
ladder starts from a real send instead of waiting for tomorrow's sweep.

- **Signature:** `auditSignatureHtml()` reads the Outlook signature named by
  `AUDIT_SIGNATURE_NAME` (default `AI Visibility`) via `microsoft.getSignatureByName`, the same
  pattern as `submit-to-lenders.ts` and its "Submission" signature, falling back to
  `EMAIL_SIGNATURE_HTML`. Editable in Outlook without a deploy. Confirm the exact stored name
  with `GET /api/debug/signature?name=AI Visibility`.
- **Auto-send is built and OFF.** `AUDIT_AUTOSEND_ENABLED` unset = disabled, and while it is
  off the card has no countdown and nothing sends itself. When enabled, the row is stamped
  `auto_send_at = now + AUDIT_AUTOSEND_MINUTES` (default 5) and a `waitUntil` timer sends it;
  `flushDueAutoSends()` in the daily digest is the backstop for a timer lost to a cold start.
  Vercel Hobby crons are daily only, so the timer cannot be a cron — the ROW is the source of
  truth and the in-process timer is only the fast path.
- **`auto_send_state` is a claim flag** (`pending` / `sent` / `held`). `sendAuditPitch` claims
  the row with a conditional update BEFORE calling Graph, so the button, the timer and the
  backstop can all race and only one send happens. A Graph failure puts it back to `pending`.
- `microsoft.sendDraft` passes `rawResponse: true`: `/send` returns 202 with an EMPTY body, and
  parsing that as JSON would throw after a successful send and invite a duplicate retry.

## Channels Connected
- **Web dashboard** — mission.srtagency.com/dashboard/chat
- **Telegram bot** — same AI, same tools, via /api/telegram/webhook
- **Website forms** — srtagency.com contact + apply forms → /api/leads/*
- **Slack** — #hot-leads for new lead + application complete notifications

## Meta Ads Attribution Rule (IMPORTANT)
Meta Pixel and Meta CAPI events (Lead / CompleteRegistration / Purchase / DNQ) fire
**only** when the contact came from a real Meta ad click — i.e. `_fbc` cookie is
present OR `fbclid` was in the landing URL. `_fbp` alone does NOT count (the
Pixel sets `_fbp` on every visitor, including direct traffic).

This gate lives in `src/lib/metaAttribution.ts` (server) and
`srt-portal/src/lib/metaAttribution.ts` (browser) and must be checked before
every `sendEvent(...)` and every client-side `fbq("track", ...)` call.

### Tagged-link convention for non-Meta channels
When sharing portal links outside of Meta ads, always append a `utm_source` tag
so the lead's origin is recorded on the `contacts` row (columns: `utm_source`,
`utm_medium`, `utm_campaign`):

- **WhatsApp:** `https://portal.srtagency.com/?utm_source=whatsapp&utm_medium=dm`
- **Cold call follow-up SMS:** `https://portal.srtagency.com/?utm_source=cold_call&utm_medium=sms`
- **Cold call follow-up email:** `https://portal.srtagency.com/?utm_source=cold_call&utm_medium=email`
- **Organic/referral website CTAs:** already carry internal `source=` — no change needed.

These tagged links never fire Meta events, so they cannot inflate Ads Manager.

## Client onboarding and delivery (2026-08-16, comms rebuilt 2026-08-20)
`src/lib/clients/*`, `src/config/client-intake.ts`, `src/config/client-messages.ts`. A
paying client is a `clients` row; `startPilot()` claims it, seeds the 8 pilot stages, picks
the subdomain, mints the `/onboarding` token and emails it. Migrations:
`2026-08-16-client-onboarding.sql`, `2026-08-17-client-delivery-steps.sql`,
`2026-08-20-client-contact-preference.sql`, `2026-08-20-client-messages.sql`,
`2026-08-20-client-dns-records.sql`.

**Two step lists at different altitudes, and they are not the same thing.**
`client_onboarding_steps` is the EIGHT client-facing pilot stages that render on the board.
`client_delivery_steps` is the FOURTEEN operational steps SRT's own team works through,
several of which live inside one pilot stage. `DELIVERY_STEPS` in `delivery-checklist.ts`
owns the order; the DB stores only `step_key`, so a step can be reworded without a
migration.

### SLACK IS INTERNAL ONLY (2026-08-20) — this reversed three days after it shipped
`client-channel.ts` is DELETED. There are no per-client Slack channels and no guest
invites. Single-channel guests are free at 5 per **PAID ACTIVE MEMBER**, not per channel
and not a flat pool, so fifty clients meant roughly ten paid seats (~$870/yr) bought purely
to unlock guest capacity for a workspace with one human in it — and one misclick on the
invite screen bills someone as a full member.

> ‼️ **`clients.slack_channel_id` / `slack_channel_name` are KEPT and must not be dropped.**
> One client was provisioned before the reversal and really did have a channel. Nothing
> writes them; the dashboard renders them labelled "legacy Slack". `SLACK_HUB_BOT_TOKEN` and
> `SLACK_HUB_OWNER_USER_ID` are dead — out of `.env.example`, delete from Vercel.

`#onboarding-srt-aeo` (`SLACK_CLIENT_ONBOARDING_CHANNEL`), the ops thread
(`clients.ops_thread_ts`), the checklist message (`ops_checklist_ts`) and `#alerts-infra`
all STAY. Those were always internal and they are the point.

### Client-facing messages are DRAFTS, and nothing can send them
`client-drafts.ts` posts a draft into the ops thread with a `wa.me` link on it; a human
taps it. **The free WhatsApp Business app has no API, so there is no send path and no code
that pretends otherwise.** Do not reach for the WhatsApp Business Platform API to get
around it: Meta begins billing service messages 2026-10-01 and the free app being
unaffected is the entire reason for this design. `sent_at` is stamped by the *Mark sent*
button, i.e. by a person reporting what they did.

- **Copy lives in `src/config/client-messages.ts` and nothing else does.** Six entries,
  `guard()`-wrapped, shipping as `TODO:` placeholders. `isUnwritten()` makes a placeholder
  **refuse to post as a message** — it posts a note naming the key to write instead. An
  unwritten draft must be impossible to send by accident and impossible to miss.
- `CHANNEL_LINE` and `NO_CUSTOMER_INFO_LINE` are appended to the intro **structurally**,
  same precedent as `PERMISSION_CLOSE` / `NOT_SELLING_LINE`. The second one is the
  no-patient-information line; for a clinic that is a compliance line, not politeness, so
  it cannot be edited out by a rewrite of the copy above it.
- **ASK fires when its step becomes NEXT; NOTIFY fires when its step COMPLETES.** Getting
  that backwards asks for DNS records the day after they were added.
- `unique (client_id, draft_key)` is load-bearing, not tidy: a step ticked, unticked and
  re-ticked would otherwise post the same message three times.
- `hasBannedDash()` runs on the INTERPOLATED body. `guard()` catches a dash somebody typed
  at build time; only this catches one arriving through a token at runtime.
- The three monthly reports are three `draft_key`s sharing one `copyKey`, differing by
  `{dayLabel}` — which is derived server-side from the key, never accepted from a request,
  so a day-90 message cannot say "day 30".

### Phones: E.164 everywhere, live-formatted as typed
`formatPhoneUS()` in `clients/normalize.ts` (pure, isomorphic) formats to
`(336) 833-2303` and **absorbs a typed `+1` rather than duplicating it**; the save route
stores `normalizePhone()`'s `+1XXXXXXXXXX`. Before this, every funnel kept the raw string,
so `+13368332303` / `13368332303` / `3368332303` were three strings for one human — and
`findContact()` dedupes on an EXACT match, so one person became three contacts, three Zoho
leads and three Slack threads. `wa.me` takes digits only, so a non-E.164 number builds a
link to nobody; `waLink()` returns null rather than a broken link and the card says so.

> ‼️ **`/PDF` and the other funnels still have this bug.** Only `/onboarding` was fixed.
> There is no separate WhatsApp number and there must not be one: one number, asked once.

> ‼️ **`showWhen` on `FieldDef` is CLIENT-SIDE ONLY.** `/api/onboarding/save` loops
> `def.fields` unconditionally, so a `showWhen` field marked `required: true` is hidden on
> the client and 400s on the server — a dead end the client cannot get past. Any conditional
> field must be `required: false`. Also: a new step-1 column must be added to
> `STEP_1_COLUMNS` or it is silently dropped.

### DNS: three records, and `verified` is observed, never asserted
`dns-records.ts` + the panel on the client board. **Three records: two CNAMEs and one TXT.**
Say it that way — "CNAME and TXT" reads as two and that is where the count drifted before.
All three go in live on the call even though the `reviews.` host is unbuilt: an unattached
CNAME just does not resolve, and getting a client back into their registrar weeks later is
worse than a record idle for a fortnight.

- `added` (a human says they typed it) and `verified` (the resolver saw it) are **separate
  statuses**, and only `checkRecord()` may write the second. The gap between them is where
  a build silently stalls.
- NXDOMAIN maps to an internal `not_found` that is **never stored**. It is the normal state
  of a record added ninety seconds ago, and writing `mismatch` over `added` mid-propagation
  is worse than saying nothing.
- `host` is stored as the LABEL ONLY (`learn`, `reviews`, `@`). Registrars append the domain
  themselves, so a full name saves as `learn.clinic.com.clinic.com`.
- TXT answers are joined before comparing: >255-char verification strings arrive chunked.
- `resolveDnsProvider()` reads the nameservers to name the registrar, because "who is your
  domain with" is a question many owners genuinely cannot answer. Unknown NS returns
  `provider: null` with the nameservers still populated — a real answer, not a guess.
- `HUB_CNAME_TARGET` is a **default, not a truth**: Vercel issues per-domain targets for
  newer projects, so correct it per record from the Vercel dashboard.

### The audit gates the call
`renderChecklist` warns when `call_booked`/`call_held` is ticked while `baseline_scan` or
`findings_doc` is not. The call is where the screenshots and the avatar decision come from,
so holding it first means opinions instead of evidence. **Flags, never blocks** — same
doctrine as the market-overlap check and the Day-0 gate.

Day 30/60/90 reminders ride on `/api/cron/followup-digest` (`report-reminders.ts`) rather
than a new cron: `vercel.json` already carries 14 entries against a Hobby plan that
documents 2. Day 0 is the `day_zero_archive` step's `completed_at`, never signup; it falls
back to `intake_completed_at` **and says so in the reminder**. It nudges on an exact day hit
so it does not nag; the client board keeps a persistent `due` flag as the backstop.

> ‼️ **`prompt_library` does not exist.** The 100-prompt library from build prompt v4 §1 is
> unbuilt; `classify.ts` generates 20 questions per audit and those are what run. Anything
> describing "select from the 100" is describing a thing that is not there yet.
