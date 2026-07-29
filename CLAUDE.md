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
  palette as `pdf-generator.ts`), `src/lib/audit-engine/email-assistant.ts` — a 5-email
  belief-installation sequence grounded in `Desktop/AEO aduit/SRT_Audit_SOP_Universal.md` +
  `SRT_Sales_Letter.md` (the-gap → differentiation → risk-reversal → ROI math → close), and
  `src/lib/audit-engine/thread-assistant.ts` — a reply in the report's Slack thread ("email 2",
  or pasting what the prospect said) drafts the next email. Wired into `src/app/api/slack/events/route.ts`
  gated by `channel === AUDIT_CHANNEL_ID` first (cheap check before any DB lookup). Every draft
  is posted for Matthew to review — nothing is ever sent automatically.
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
