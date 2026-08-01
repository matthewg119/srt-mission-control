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
AUDIT_AUTOSEND_ENABLED=    # Unset = lead pitches NEVER send themselves. "1" arms the timer.
AUDIT_AUTOSEND_MINUTES=    # Optional, default 5. Only meaningful when the above is on.
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
| free text at `drafted` | revises that draft in place ("tighter", "drop the score line") |
| `1` / `send it` | Outlook draft, To = `prospect_email ?? requester_email` |
| `loom` (bare, no url) | the Loom recording plan: 20 prompts + a six-beat sheet. `loom <url>` still stores the video |
| `nudge 2` .. `nudge 5` | next pre-pitch touch, still link-free |
| `redesign <url>` / `loom <url>` | stores the asset for the reveal |
| `reveal` (optionally `reveal $299/mo, setup waived`) | the hand-everything-over message |
| `email 2` .. `email 5` | the old 3-option belief ladder (post-reveal) |
| free text at `revealed` | treated as the prospect talking → objection replies |

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

### The Loom beat sheet (2026-08-01)
`src/lib/audit-engine/loom-beatsheet.ts`. Reply `loom` in a finished audit thread and the agent
computes the recording plan from that run's real data: block 1 is the 20 prompts exactly as run
(blank line between each so they paste into a temporary chat without merging), block 2 is a
six-beat sheet at a 4:00 target. Bullets of six words or fewer, because Matthew improvises
better than he reads. Only four things are quoted verbatim: the competitor line with its count,
the score line, the price and start-time line, and the CTA.

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
