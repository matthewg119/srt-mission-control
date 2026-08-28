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
- `src/lib/crm.ts` — the single write-through point: `resolveLead()`, `resolveLeadCandidates()`,
  `getLeadActivities()`, `setLeadStatus()`, `addNote()`, `createTask()`, `logCall()`
- `src/lib/microsoft.ts` — Microsoft Graph API (email, OneDrive, OAuth)
- `src/config/pipeline.ts` — Two pipelines: New Deals + Active Deals

### Lead Capture (from srtagency.com)
- `src/lib/lead-intake.ts` — **the shared inbound-lead stack.** `ingestLead()` does
  Supabase contact upsert → timeline note → #hot-leads top-level post + detail reply in
  that thread → Speed-to-Lead, and returns the contact id.
  `enrichLead()` appends to a lead that already exists (timeline note + same-thread reply).
  Used by `/api/leads/funnel`, `/api/audit/public-intake` and `/api/leads/facebook` —
  add new funnels here rather than copying the sequence a fourth time.
- `src/app/api/leads/funnel/route.ts` — /aivisibility funnel → ingestLead
- `src/app/api/leads/facebook/route.ts` — Meta Lead Ads webhook → ingestLead + auto-audit.
  Verifies X-Hub-Signature-256, then acks inside Meta's **5-second** window and does all
  work in `waitUntil` (a slow response gets the app unsubscribed from the Page).
  Website comes from the form's field ids: set the question's Field ID to `website` in
  Ads Manager, otherwise the route resolves it from `GET /{form_id}?fields=questions{key,label}`.
- `src/app/api/leads/capture/route.ts` — Contact form → Supabase contact + deal
- `src/app/api/leads/application/route.ts` — Apply form → progressive capture (25% create + Slack, 100% enrich + PDF + OneDrive)

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
HF_CREDENTIALS=            # DEAD since 2026-08-25 (Higgsfield account closed). Only MOTION_ENGINE=seedance reads it.
MOTION_ENGINE=             # Still→MP4 engine; code default "veo" (ElevenLabs veo-3-lite). seedance/fal selectable.
ELEVENLABS_API_KEY=        # Animation (veo-3-lite) + B-roll voiceover. Replaced Higgsfield for video.
BROLL_VOICE_ID=            # Voice for `vo` in a B-roll drop thread; falls back to SOFIA_VOICE_ID
SLACK_FOLLOWUPS_CHANNEL=   # #followups_channel id. Home of the Follow-Up Operator digest.
OUTREACH_MAILBOX=          # matthew@srtagency.com. The mailbox whose Sent Items are swept.
OUTREACH_EXCLUDE_DOMAINS=  # Optional comma list. srtagency.com is always excluded.
MAPS_PULL_ENABLED=         # Unset = Google Maps prospecting stays PAUSED. "1" resumes it.
AUDIT_SIGNATURE_NAME=      # DEAD IN PRACTICE. Microsoft removed GET /beta/me/mailboxSettings/
                           # signatures ("Resource not found for the segment 'signatures'"), so
                           # getSignatureByName() always returns null and auditSignatureHtml() has
                           # ALWAYS taken the fallback. The real signature is
                           # PITCH_SIGNATURE_HTML in src/config/email-signature.ts — edit it THERE,
                           # in code, not in Outlook. Outlook signature BLOCK name. Default "AI Ops"
                           # (its rendered content reads "Matthew Garcia / AI Visibility - SRT",
                           # so naming it after the content would not find it).
OUTREACH_SIGNATURE_NAME=   # Who cold outreach is SIGNED by, two plain lines. Default "Matthew
                           # Garcia". Different thing from AUDIT_SIGNATURE_NAME above.
OUTREACH_SIGNATURE_AGENCY= # Default "SRT Agency".
SRT_ONBOARDING_CALL_URL=   # Where they BOOK. Replaced SRT_PAYMENT_URL on 2026-08-25: nothing is
                           # charged up front any more, so the Loom close, the delivery email and
                           # the audit report CTA all send them to the onboarding call instead of a
                           # checkout page. UNSET IS HANDLED, not ignored: the script prints a
                           # correction instead of the close, PRE-FLIGHT says NO BOOKING LINK SET,
                           # the delivery email flags it in Spanish, and PricingCta renders the
                           # offer with no button rather than a dead link. Set it before recording.
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
Daily cron pushes every CRM contact (hashed email/phone/name/zip/city/state) into
a Meta Customer List audience set as an EXCLUSION on acquisition ad sets, so Meta stops
re-serving ads to people already in the CRM. Idempotent (add-only, no diffing).
- `src/lib/meta-audience.ts` — Marketing API client (create audience + push users)
- `src/app/api/cron/crm-exclusion-sync/route.ts` — daily sync (08:00 UTC)
- `src/app/api/admin/create-exclusion-audience/route.ts` — one-time audience bootstrap

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

### The "No website" button (`no-website-pitch.ts`, 2026-08-19; Outlook lane 2026-08-20)

A business with a Google profile and nothing else is the best AEO lead SRT has, and pitching one
used to mean running the whole audit at it. This is the cheap version of the same conversation:
**three buyer questions and one permission email, about ninety seconds.** Right rail of the lead
page, under Loom, `action: "nowebsite"` on the existing workflow route. Run the real audit after
they say yes.

> ‼️ **IT DRAFTS INTO OUTLOOK AND REPORTS ON THE LEAD TIMELINE. IT DOES NOT POST TO SLACK**, and
> `formatNoWebsitePitchCard` is DELETED rather than kept beside `formatNoWebsitePitchNote`.
> #ai-visibility-audits is the AUDIT lane's channel, and this lead has no audit and can never have
> one — an audit needs a site to crawl. So the timeline said "the draft lands in
> #ai-visibility-audits" while the CRM showed nothing but a subject and a body, and the Outlook
> draft the lane was already placing was never linked from the page the button is on.
>
> The note prints, in this order: **the mailbox line first, in every state**, then the draft link
> per mailbox, then the questions and verdicts, then the angle, then the subject and body. The
> mailbox line leads because `No draft created: every mailbox is at its daily cap … Tomorrow.` is
> the single most important thing this note can say, and it used to be said only on a card nobody
> opened.

**Enabled by the ABSENCE of a website**, which makes it the only control in that panel a website
disables rather than enables. Every angle it can write rests on nothing describing this business
having been written by them, and that premise is false the moment a site exists. The route
re-checks and 400s, so the disabled state is not the guard.

> ‼️ **IT IS NOT A SECOND EMAIL PIPELINE.** `prePitchRules`, `PARAGRAPH_RULES`, `VOICE_RULES`,
> `STYLE_RULES`, `COMPLIANCE_RULES`, then `noDashes` + `enforceLinkPolicy` + `polishBody` +
> `ensurePermissionClose` + `ensureSignoff`, with `draftWithLint` gating the whole thing. All
> IMPORTED, none restated. The workflow route's own header says why: a button that assembles its
> own prompt bypasses the linter and the no-fabrication rules silently, and the failure looks like
> slightly worse copy rather than like a bug.

> ‼️ **FOUR ANGLES, PICKED BY THE EVIDENCE, and the gate is honesty not preference.** `substitute`
> (the engine named others, you were not among them) and `buying-question` assert that we ASKED an
> engine something, so `pickAngle` offers them only when an engine call actually returned data.
> When none did, it falls through to `written-by-others`, which rests solely on research. Same rule
> `run-prompts.ts` enforces with `status:"no_data"` and the call script enforces with "offer to
> look, never claim to have looked". `miniCheckContext` states the absence out loud in the prompt
> rather than staying silent about it, because absent beats forbidden.
>
> An absence angle is also skipped when the business actually DID appear in every answer. Writing
> "you were not in it" to someone who was is the one error the prospect corrects on the first line.

> ‼️ **A RESEARCH MISS IS THE FOURTH ANGLE, NOT A FAILURE** (2026-08-20). `researchViaClaude` used
> to collapse four outcomes into a bare `null` and the button gave up on all four, which is how
> JBR CRANE SERVICES produced two timeline notes and no email. `ResearchMiss` splits them, and the
> split is about **who the failure is about**:
>
> | miss | means | the button |
> |---|---|---|
> | `call_failed` | the request threw or timed out | fails, note says try again |
> | `unidentified` / `thin_profile` / `no_sources` | nothing public describes this business | drafts `nothing-to-find` |
>
> The second row is not an error, it is **the finding**, and the strongest one this lane carries.
> The old refusal — a pitch about a business we could not find is a pitch about a business that
> might not exist — is right for the AUDIT, where the whole report is built out of the profile. It
> is wrong here: the prospect is already a lead with a name, a phone and an email on the row, so
> their existence is not in question. What is in question is whether anything public describes
> them, and the answer came back no.
>
> `MiniCheck.identity` is therefore `BusinessIdentity | null` and `researched` is its flag.
> `pickAngle` gates in **BOTH** directions: `needsUnresearched` is skipped when research
> succeeded, and the three research-backed angles are skipped when it did not. One direction alone
> either invents the thing the email is built on or throws away everything research found.
>
> ‼️ **`NOTHING_TO_FIND_LINE` is a constant and the copy is deliberately narrow.** It may say a
> search could not assemble a description. It may **NOT** say they have no Google listing, no
> reviews, no directory entry, or that they are invisible — the premise of this whole lane is a
> business **with** a Google profile, so that is a sentence the prospect disproves from his own
> phone in ten seconds, on a pitch whose entire basis is "you can verify this yourself". Same
> discipline as `CRAWL_BLOCK_LINE`, which reports a refused request rather than concluding a site
> is invisible. `miniCheckContext`'s unresearched branch is thin for the same reason: name, city,
> and the fact that nothing came back. Nothing else is in the prompt to reach for.

> ‼️ **THIS LANE HAD NO REFERENCE EMAIL UNTIL 2026-08-20, AND THAT WAS THE BUG.** The audit lane
> gets `permissionExample()`; `draftNoWebsitePitch` was handed rules and no shape, so the shape was
> whatever the model felt like that run. Rules constrain what an email may CLAIM. Only an example
> constrains how it READS.
>
> It cannot borrow the audit lane's two examples either, and that is not taste: both are built on
> *"I ran X through the AI engines ... you came back in 10 of 20"*, which is a 20-prompt audit.
> This lane runs three questions and sometimes none, so the nearest reference available to it
> described work it had not done.
>
> `NO_WEBSITE_EXAMPLE` (`email-assistant.ts`) is a real sent email. **Five beats, one sentence
> each:** the question asked in the buyer's words with the category and city in it, the result
> flat and without adjectives, why that question matters, one line on why the engine had nothing
> of theirs, then it STOPS.
>
> **The count is stated as a number** because the word cap does not constrain it: a live draft came
> back at 118 words inside a 120-word budget and still ran to five paragraphs, the fifth being a
> second way of saying the fourth. One finding, four body beats.
>
> ‼️ **Beat 1 must be true for the angle in play.** Three angles really did put a buyer question to
> an engine and may say so. `nothing-to-find` did not, and keeps the rhythm with an honest first
> beat. The example teaches SHAPE; `miniCheckContext` decides what may go in it.

> ‼️ **THE GREETING IS APPENDED IN CODE** (`ensureGreeting`), same precedent as `PERMISSION_CLOSE`
> and for the same measured reason. The prompt told the model the first line was to be exactly
> `{name},` with no "Hi", no "Hello", no "Dear" — and a live draft opened **"Hey Ale,"** anyway.
> That one reads better, which is the point: a shape wanted on every email is not something to ask
> for once per run and hope for. Asked, it varies; appended, it does not. It is `Hey {first},`.
>
> Whatever the model wrote is stripped first, in either shape, so the email cannot greet twice — a
> paragraph counts as a greeting only when it is short AND ends the way one does. **No first name
> means NO greeting**, never "Hey there," and never the business name.

**The three questions are template-generated, not model-written.** `classify.ts` writes 20 because
an audit measures a whole buying journey; this measures one thing, and a template cannot invent a
question about a service they do not offer. It also makes two prospects in the same trade
genuinely comparable.

**`NAME_COMPETITORS_IN_COLD_EMAIL`** (`config/pitch.ts`) decides whether the competitor-naming
angles are offered at all. It is a different question from the standing rule that we never name a
competitor who FAILED the prospect: reporting who an engine returned is a fact about the engine
that the prospect can reproduce in thirty seconds, not a judgement about the competitor. Set it
false and those angles are simply never chosen; nothing else changes.

**`stripEchoedClose` exists because of a measured failure.** `prePitchRules()` tells the model not
to write the close by QUOTING both lines at it, and a live draft came back having reproduced them
verbatim in quotation marks mid-body; `ensurePermissionClose` then appended the real close
underneath, so the email said it twice and carried two question marks, which is itself a
`missing-close` linter failure. `CLOSE_ATTEMPT_RE` does not catch it because it anchors on the
first word and a line opening with a quote mark never matches. Rather than loosen a regex the
whole cold lane depends on, this strips only the exact echo.

**The Slack card prints the questions and the verdicts above the draft**, same reason the prompt
drop prints all 20: the email states one finding as fact, and the only way to see whether that
fact is right is to see what it came from. A refused draft is posted too, labelled as rejected,
never silently swallowed.

Probes: `scripts/_probe-no-website-pitch.ts` (synthetic checks: engines-answered, engines-silent,
and research-missed, plus the reverse gate that `nothing-to-find` is never picked for a researched
check) and `scripts/_probe-own-domain.ts` (19 real URLs).

### The "Email hook" button (`hook-pitch.ts`) — copy rewritten 2026-08-22
Four buyer questions and one permission email, sent BEFORE any audit is spent. Matthew rewrote the
copy by hand; `HOOK_EXAMPLE` in `email-assistant.ts` is that email and it is the reference now.

> ‼️ **THE HOOK LANE WAS BEING FED `permissionExample()`, A 20-PROMPT AUDIT EMAIL.** Exactly the
> bug `NO_WEBSITE_EXAMPLE` was created to fix, one lane over and unnoticed for longer. That
> reference is built on "you came back in 10 of 20", while this lane runs four questions and its
> own SCOPE block forbids calling anything an audit — so the shape it imitated described work it
> had not done, and the rules then told it not to say what the shape was saying. Eight beats now,
> one sentence each, and the rival line and site tease are the only two that may drop out.

- **The result line is a PERCENTAGE, and that reversed a deliberate rule.** `hookFractionLine` was
  renamed `hookResultLine` with the change, because a function called `fraction` returning a
  percentage is the exact drift these comments exist to stop. The old comment argued a fraction is
  reproducible and a percentage hides how small the sample is; that is still true and it is the
  cost. **Matthew's call, made with it stated. Do not flip it back without asking him.** The two
  ends are worded, never computed: "0%" reads as a rounding artifact, "100%" as a typo.
- **`hookPositioningLine` ends on a comma** and sits BEFORE the site tease. The comma hands off
  into `PERMISSION_CLOSE`, so the give answers the condition. It is prompt-pinned and
  code-VERIFIED (`positioningWarningFor`), **not** code-appended like the close: it sits before a
  conditional model-written paragraph, and splicing mid-body is what this repo refuses on the
  grounds that a bad splice is worse than a flagged one. It drops the state from the city, only
  here, because "in Bakersfield, CA," puts two commas in four words on a line that is read aloud.
- **`HOOK_PRETEXT_LINE` carries no asterisks any more.** It used to order `**(for another
  client)**` bolded onto the quoted search line, contradicting `PARAGRAPH_RULES` ("no asterisks,
  no markdown of any kind") in the same system prompt and forcing this to be the only pre-pitch
  lane passing `allowEmphasis: true`. It is now the plain opening sentence and the flag is back to
  `false`.
- **A rule and its exception in one breath is heard as the rule.** "Report" written as a carve-out
  buried in the SCOPE prohibition produced "Finishing up what comes back" and dropped the clause
  explaining why anyone ran the questions. Stated as its own permission line, the beat came back
  right. The report belongs to the OTHER client; none was ever built for this prospect.
- **`HookCheck.buyerPersona` was added because its absence was visible in the copy.**
  `classify.ts` always produced it and this lane never carried it, so beat 2 had nobody to name
  and every draft said "when someone in San Diego searches for". An owner pictures a homeowner and
  cannot picture someone.
- **Greeting:** `ensureGreeting` took an optional `fallback`, and the hook lane is the only caller
  passing one (`"Hello,"`). It opens on a pretext rather than on the finding, and a pretext with
  nothing above it reads as a fragment. Every other lane keeps the no-first-name-means-no-greeting
  rule untouched. `"Hello,"` is not `"Hey there,"`: it claims no familiarity and merges nothing.

### The "Follow-up call" button (`booking-script.ts`, 2026-08-22)
The third phone script, and genuinely a third one. `buildFollowupScript` earns "yes, send it over";
`buildCallScript` closes someone who watched the video; this one **books fifteen minutes and gets
an email address**, and that is the whole outcome. `BOOKING_EXAMPLE` is Matthew's own call,
transcribed.

> ‼️ **IT IS A SEPARATE FILE BECAUSE `CallFacts` IS AUDIT-SHAPED AND THIS LANE HAS NO AUDIT.**
> Score, absentPrompts, competitors, icp, price, tier and guarantee all come off a finished
> `audit_reports` row. This call follows the Email hook, which exists precisely so a report is NOT
> spent before somebody replies, so gating it on one would make the button unreachable on the
> leads it is for. It takes the numbers when they exist and says out loud that there are none when
> they do not (`zohoOnlyNumbers()` precedent: absent beats forbidden).

> ‼️ **`PriorContact` IS DECIDED IN CODE AND NOTHING ELSE MAY DECIDE IT.** Matthew's script says
> "my team emailed over a report with the whole 9 yards". True on exactly one of three states,
> the strongest line in the call, and it reads well enough that a model reaches for it every time.
> **`nothing_sent` wins over a finished report**, because the question is what the PROSPECT has
> seen: a report in our database that was never emailed cannot be recalled to them.
>
> | state | the `why` beat may say |
> |---|---|
> | `report_sent` | an audit was run AND mail went to this address. "my team emailed over a report" |
> | `hook_sent` | mail went out, no report exists. "ran some questions and emailed what came back" |
> | `nothing_sent` | nothing was sent. Everything is an OFFER, nothing is a follow-up |

- `SpokenIdentity` was split out of `CallFacts` so `lintSpoken`'s two most valuable checks — an
  invented sender domain and the rep naming a company we are not, the live Grey Seal failure —
  are reachable without an audit. Every existing caller satisfies it structurally.
- **`describeInvalid` has to cover its whole validator.** It described only the shape and returned
  "shape looked right" whenever the 25-word cap was what failed, so the correction retry got a
  rejection with no reason and answered "I cannot fix the error without knowing what the rejection
  reason was" — not JSON, so the parse threw, on every run. It now quotes the offending lines.
- Output lands on the **lead timeline, not Slack**: every other button here makes something to
  review and send, this makes something read off the phone while dialing, and the lead page is
  where that decision is made. Same call `formatNoWebsitePitchNote` made.
- Probe: `scripts/_probe-booking-script.ts` (the three states, the city trim, identity populated).

### The Instagram DM lane (`dm-pitch.ts` + `lib/instagram/`, 2026-08-25)

The same measured door knock as the Email hook, in a chat bubble, reached from a Chrome extension
sitting on an Instagram profile instead of from a CRM lead page. Separate repo for the extension
(`Desktop/Code/srt-ig-extension`, installed unpacked, so a reload in `chrome://extensions` is all a
change needs). One button: add the lead, run the scan, draft three DMs.

> ‼️ **IT IS A SEPARATE FILE FROM `hook-pitch.ts`, NOT A FLAG ON IT.** The SCAN is imported and never
> re-run differently; what differs is the SURFACE. An email carries a subject, a greeting, an
> appended `PERMISSION_CLOSE` and a two-line sign-off, and all four read as an email pasted into a
> DM. A boolean on `draftHookPitch` would have had to branch around each of them.

**Two lanes into one drafter.** `DmFacts` is a discriminated union, `hook` (there is a site, so
`runHookCheck` crawls it) or `nowebsite` (`runMiniVisibilityCheck`, name and city only). Deliberately
not one widened shape: a `?? ""` somewhere downstream would turn "we never looked" into "we looked
and found nothing".

**The variants differ in WORDING and never in CLAIM.** Three identical DMs read as a bot, which is
why `DM_OPENERS` exists; three different findings would be inventing two of them, since only one
thing was measured. The angle is picked once, from the scan. This is the deliberate inversion of the
"three cards must differ by ANGLE" rule the call-script cards are held to, and the reasoning is
written above `DM_OPENERS`.

**Five sentences, one question mark**, enforced by `draft-linter.ts` under `stage: "dm"`. `bodyOnly`
drops the greeting but `DM_CLOSE_LINE` ends in a period and counts, so the real budget is
finding + ask + close, plus one for the opener.

#### The no-website copy rebuild (2026-08-25)

Matthew read the draft for `leahskinmethod` and rejected it. It said she had no site of her own and
never said what happened when the engines were asked. Reading `ig_dm_runs.check_json` explained why:
`{"results": [], "identity": null, "researched": false}`. **Nothing had been asked.** Her CRM row
read `business_name: "Leah"`, `biz_city: null`, so research got a person's first name with no city,
missed, produced no trade, and the engine loop was skipped entirely. The limp copy was the symptom.

> ‼️ **THE RIVAL RULE WAS SATISFIED, NOT RELAXED.** `DmSubject.topRival` used to be hardcoded null on
> the no-website lane because that lane filled `named` via `namesFrom()`, a line-by-line regex whose
> own comment called it crude on the grounds that it only ever fed a prompt. Correct at the time.
> The fix was to give that lane the same `extractRecommendedBatch` pass the hook lane runs — filtered
> by `isClientName`, counted **once per answer** — and to **DELETE `namesFrom()`** rather than bypass
> it, so it cannot come back. A name good enough to steer a model is still not good enough to print
> in front of the person it is about.

> ‼️ **EACH RIVAL PRINTS ITS OWN COUNT.** Matthew asked for two names and wrote "Competitor 1 and 2
> shows up in 3 out of 4 searches". That is only true if BOTH appeared in the same three, and they
> usually will not have. One count stretched over two names is a false claim about at least one of
> them, and it is the kind a prospect checks in the thread he is reading it in. `DM_MAX_RIVALS_NOWEBSITE`
> is 2, `DM_MAX_RIVALS_HOOK` is 1 — the hook lane's one-rival sentence is copy Matthew signed off and
> widening it was never what he asked for.

> ‼️ **WHY THE ENGINE HAD NOTHING OF THEIRS IS A FACT ABOUT THE PROSPECT, NOT A PHRASING CHOICE.**
> His draft said "because your website is not visible", which for someone with no site at all
> describes a situation they do not have. `dmReasonLine` has three versions and `dmSubjectOf` derives
> which one from the scan that ran, never the model: `none` (no site anywhere), `booking_only` (there
> IS a page, it ranks, and it belongs to the software vendor) and `not_surfacing` (they have a site
> and it did not come back — the only case where his original wording is correct). Same failure class
> as `NOTHING_TO_FIND_LINE` claiming a business has no Google listing.
>
> `booking_only` is produced by the **"Only a booking link"** button on the panel (2026-08-25). It
> is the SAME lane and the same scan as "no website": a third `DmFacts.kind` would return null from
> `factsFromRow`, which 409s Regenerate and blanks the panel's evidence block, so the flag rides on
> `MiniCheck.bookingHost` instead and `dmSubjectOf` picks the sentence off it. The engines are still
> asked, because the finding is still that they did not come back.
>
> ‼️ **IT IS GATED ON `isBookingHost`, A SUBSET OF `NEVER_THEIR_SITE_HOSTS`, NOT ON THAT LIST.**
> The sentence tells the prospect the page belongs to their booking software. That is true of an
> Aesthetic Record or a Vagaro page and false of the Facebook, Yelp and Threads links sitting in the
> same set, and false in a way they correct on the first line. Directories that also take bookings
> (zocdoc, healthgrades) are deliberately excluded: somebody else writing about them is what
> `not_surfacing` already describes. The route re-resolves the host itself and never trusts the
> panel's string; a link that is not booking software degrades the run to `none`, which is weaker
> and still true.

**The finding folded from two sentences to one, and that was forced arithmetic.** The reason line
costs a sentence, the ask and the close take two more, and the opener is the fifth. With the old
two-sentence finding every `pretext` and `question` variant came to six and was rejected by
`dm-length`. `dmRivalLine` and `dmAbsenceLine` now join with "and", which is also how Matthew's own
draft reads. `dmPresentLine` is untouched and takes **no** reason line: all three explain an absence,
and that angle fires when they DID come back.

**The trade comes off their own Instagram bio** (`tradeFromBio`, one Haiku call, never throws). It
beats research because they wrote it, and it is what lets the questions run at all on a prospect
research could not identify. `shortTrade`'s job is preserved and is the whole reason this is a model
call rather than a substring: Leah's bio reads `BBL • Moxi • Morpheus`, which is device branding a
practitioner is proud of and not what a patient types. The validator is mechanical — 2 to 5 words,
lowercase, no digits, no `@`, no `#` — because a prose guard is not a guard. A rejected trade falls
back to research; a wrong trade is a worse question than no question.

> ‼️ **`researched` AND `enginesAnswered` ARE NOW GENUINELY INDEPENDENT.** `runMiniVisibilityCheck`
> used to return early on a research miss with `results: []`. Everything downstream must branch on
> the one it actually needs. `miniCheckContext`'s unresearched branch used to open "NO ENGINE
> QUESTIONS WERE RUN", which became a lie; the PROHIBITION is still right (that branch resolves to
> `nothing-to-find`, and an email that also reports an engine result is an email with two findings),
> so the rule stayed and the false statement of fact went. The results are withheld rather than
> shown, which is the same absent-beats-forbidden move the price gate makes.

**The city gate, twin of `needsWebsite`.** No site and no location returns `needsCity: true` **before
spending the scan**, and the panel asks for a business name and a city or ZIP, or "I don't know".
Gated on `!website` only: the hook lane reads the city off the pages it crawls, so asking there would
be asking a question that already has an answer. A ZIP is resolved to `City, ST` by
`resolveCityInput` or refused — never passed through, because every sentence that prints a city
splits it on the first comma and reads it aloud.

> ‼️ **A TYPED VALUE OVERWRITES THE CRM ROW; A SCRAPED ONE ONLY FILLS BLANKS.** `upsertContact`'s
> fill-blanks rule is right for a scrape and exactly wrong for a person correcting one. Without the
> inversion a wrong business name read off a profile is permanent — the row is never blank again, so
> every future press re-reads "Leah" and research keeps missing.

> ‼️ **A CITYLESS RUN MAY NOT EMIT A CITY-SHAPED SENTENCE.** "I don't know" runs national questions,
> so "when someone asks ChatGPT for laser skin treatments in your area" is a claim about a search
> nobody made. The fixed lines drop the clause themselves; the `dm-cityless` lint rule catches a
> model that reaches for it in prose. It is a PHRASE list, not a place-name detector — a detector
> over free text either rejects good drafts on a capitalised word or misses the one that matters.

**Two bugs this work sat on top of, both fixed:**

| Bug | Was |
|---|---|
| fabricated absence | `buildAliases(name, null)` returns `[]` for a name with no usable token, `isMentioned` then returns false, and that was recorded as `appeared: false`. "We could not look" written down as "they were absent", feeding a `missCount` that is now a printed claim. Now `null`, same guard as `hook-pitch.ts` |
| a paragraph in a chat bubble | `dmSubjectOf` read `identity.whatTheyDo`, a whole research sentence, and not even the string the questions were asked with (`shortTrade` was applied to the prompts and thrown away). `MiniCheck.trade` now stores what was asked |

**`check_json` is whatever shape `MiniCheck` had the day it was written**, and Regenerate rehydrates
it through `factsFromRow`. Rows from before this change carry no `trade` or `topRivals`, so that
function defaults them and `dmSubjectOf`/`pickAngle` both `?? []` as well.

- Probe: `scripts/_probe-dm-pitch.ts`, 85 pure checks, no network. **Its summary and `process.exit`
  must stay the last two lines of the file** — five checks once sat below them and never ran.
- Table: `ig_dm_runs` (`docs/2026-08-25-instagram-dm-lane.sql`). **Read the rows rather than
  reasoning about them.** That table is how the `threads` alias bug was found and how the empty
  `leahskinmethod` scan above was found, and it has beaten reading the code every time.

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

## /onboardingfree — the constraint quiz (2026-08-19)
`srtagency.com/onboardingfree` (Vercel rewrite → `mission.srtagency.com/onboardingfree`). The
quiz the free-build email promises after a prospect replies "Yes". **PUBLIC and untokenized**,
which is the whole difference from `/onboarding`: there is no `clients` row, identity is typed
on the last screen, and it is deliberately not resumable.

**No migration.** The submission is a `system_logs` row (`event_type = onboardingfree_intake`),
which is simultaneously the durable copy of the answers, the per-IP rate-limit ledger, and the
anchor the access screen reads its Slack thread ts back out of. `ONBOARDING_FREE_EVENT` lives in
`src/lib/onboarding-free/log.ts` and **cannot move into either route file**: Next validates route
module exports against a fixed list, so a `route.ts` exporting a constant fails `next build`.

> ‼️ **Q1 and Q2 are the owner's OPINION. Q3, Q4, Q5 and Q12 are the numbers that contradict it.**
> `computeVerdict()` (`src/lib/onboarding-free/verdict.ts`) is a PURE function, no model call, same
> precedent as `delivery-guards.ts`. It prints the stated constraint AND the verdict side by side
> and **never reconciles them** — the disagreement is the product. Priority order is
> `capacity` → `conversion` → `speed` → `top_of_funnel` → `unclear`, and the order is the argument.

> ‼️ **`capacity` is the guardrail and it outranks everything.** Booked out or needs to hire means
> selling customer-side visibility is wrong, because a saturated business does not produce the
> testimonial the free build was traded for. It **flags internally only** — the prospect sees the
> same normal ending, and the warning is on the Slack card. Same doctrine as the market-overlap
> check: flags, never blocks.

`money_maker` and `fewer_of` are the ICP and anti-ICP **in the owner's own words**. Every other
lane infers those from `niche_briefs.avatars`, which is a guess about the vertical.

- `src/config/onboarding-free.ts` — the single question set, read by the client AND the submit
  route. Answer labels are exported CONSTANTS (`NEED`, `CAPACITY`, …) because the verdict engine
  branches on those strings; a label reworded here and matched as a literal there is a verdict
  that silently stops firing. Every string is `guard()`-wrapped, so ranges are "0 to 5".
- `isVisible()` / `visibleQuestions()` are exported and **the server calls them too**. That is the
  opposite of `/api/onboarding/save`, whose `showWhen` is client-side only, so a hidden required
  field 400s with no way past it.
- Guards on `POST /api/onboardingfree/submit`, cheapest first, same order as `api/clients/start`:
  honeypot (silent 200) → time trap (2s) → per-IP ledger (`ONBOARDINGFREE_RATE_LIMIT`, default 5).
- Contact lookup is **read only** and matches the `phone_last10` / `mobile_last10` generated
  columns. It never writes or creates a contact; it only lets the card link a known lead.

> ‼️ **The submit route returns the ROW ID, never the Slack `ts`.** Handing a browser a real
> message timestamp would turn `/api/onboardingfree/access` into a way to post arbitrary replies
> into `#onboarding-srt-aeo` from anywhere. The id is an opaque uuid and the server looks the ts
> up itself. `metadata.access` doubles as the replay guard.

Card is built in CODE (`src/lib/onboarding-free/card.ts`), never by a model, same reason
`buildCoachNotes()` is: it is the framing the whole call gets planned around. Channel is
`SLACK_CLIENT_ONBOARDING_CHANNEL`; unset logs the card rather than throwing.

**Not wired, on purpose:** the answers do not feed the Call Coach brief and do not write to
`contacts` or `audit_reports`. The `system_logs` row keeps them queryable so either can be added
without re-asking anybody.

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

  > ‼️ **BOTH SWEEPS LOOP `outreachMailboxes()`, NOT `/me`** (2026-08-20), and that is what
  > makes the rotation's daily caps real rather than decorative. Mail sent from `submissions@`
  > lands in **that** mailbox's Sent Items and `/me` never sees it, so its `used` count stayed
  > at 0 forever, so it was never `full`, so once `matthew@` hit its cap **every** pitch drafted
  > from `submissions@` from then on, uncapped. A one-way door, not a rotation, and the exact
  > deliverability risk the caps exist to prevent. `reply-sweep.ts` has the same loop for the
  > other half of it: a prospect pitched from `submissions@` **replies into `submissions@`**,
  > so reading `/me` alone kept nudging people who had already answered and addresses that had
  > already bounced.
  >
  > Each touch is attributed to the mailbox it was actually found in, which is what
  > `mailboxHeadroom()` groups by. Dedup is unchanged: `message_key` is `internetMessageId`,
  > stable across mailboxes, so a message visible in two writes one row.
  >
  > **ONE watermark for the whole run, stamped after every mailbox.** `last_sent_scan_at` /
  > `last_reply_scan_at` are single columns on a single row; stamping per mailbox would let the
  > second mailbox's window start after the first had already consumed it. The per-message cap is
  > counted **per mailbox** (`scannedHere`) for the mirror reason: a shared cumulative counter
  > lets a busy first mailbox starve the second of its whole window, which is silent data loss
  > dressed up as a limit.
  >
  > Needs `Mail.Read.Shared` on the delegated token for every non-connected mailbox. A permission
  > failure throws, which leaves the watermark alone and re-reads the window next run — never
  > swallowed into "0 new messages", the exact shape of the three-week silent failure
  > `docs/2026-08-20-outreach-touch-key.sql` documents.
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
> yourself". Same no-fabrication rule as `run-prompts.ts`, applied to speech. `loomPromises()` and
> `urgencyBeat()` live in `loom-script.ts`; the urgency beat is one function called twice so the
> two readings cannot drift into being different thoughts.

#### Template v3 (2026-08-21) — guarantee-anchored, ChatGPT Ads lead

The evidence half of v2 is untouched. What changed is everything after the live demo.

| | v2 | v3 |
|---|---|---|
| the middle | 3 PILLARS, then 3 COMMITMENTS | **3 PROMISES**, each running Outcome, Trap, Work, Return |
| the ads | did not exist | **Promise 2**, and the only place the guarantee lives |
| the guarantee | none, banned everywhere | **`GUARANTEE_LINE`, on one tier**, gated by `guaranteeFor()` |
| price | 2 tiers | **4 paid tiers**, recommendation first, `ANNUAL_LINE` at the end |
| the ROI line | spoken-only banned-promise exception | **deleted** |
| length | 4 min | ~6 min |

v2 explained a problem (Findable) and then, ninety seconds later, gave the fix for it in a separate
COMMITMENTS block. v3 merges them so the fix lands while the problem is still in the room.

> ‼️ **PROMISE 2 AND THE GUARANTEE ARE ONE DECISION, AND IT IS THE TIER.** On `loom core` or
> `loom complete` the ads promise is not softened or reworded, it is **not rendered**, and neither
> is the BIG PROMISE beat. Selling a paid layer the invoice does not include is the same mistake as
> promising a 30 day return with no mechanism behind it. `_probe-loom-v3.ts` asserts that the
> strings "guarantee", "double your investment" and "999" appear NOWHERE in a non-ads render.

> ‼️ **THE BAN LIST WAS NEVER CATCHING THE CLAIM THIS OFFER RESTS ON.** `DELIVERY_BANNED_PROMISES`
> matched "double your revenue" and not "double your investment", so the exact guarantee sentence
> matched no pattern at all and passed on every tier. Found by the probe. The pattern is now in the
> list, banned by DEFAULT, and `spokenPromises(text, { allowedTier })` masks the **literal**
> approved constants before running the list. Exact-match masking is the design: a paraphrase
> ("we guarantee you'll make your money back") is still in the remainder and still fails. Never
> replace it with a lookaround in the config, which would license every paraphrase too.

> ‼️ **The promises are spoken as "Number 1/2/3", not "Promise 1/2/3", and the number is applied at
> RENDER time.** The word "promise" is a `DELIVERY_BANNED_PROMISES` match: v2 said it once, so a
> transcript flag meant something, and titling all three "Promise N" would put five expected hits
> in every transcript until nobody read the flag block. Render-time numbering is because Promise 2
> is dropped on a lower tier, and a baked-in number would have the script say "Number 1 ... Number
> 3" right after announcing two things.

> **The v2 ROI line is GONE.** "Just one extra client a month will very likely make back the
> investment" was a deliberate spoken-only banned-promise exception. It was a vaguer version of what
> the guarantee now says properly, with a number, a window, one tier and a stated remedy. Do not put
> it back beside the guarantee.

`loom_state.tier` (jsonb) is **DEAD as of 2026-08-25 and nothing reads it.** The field stays because
old rows are a true record of what those prospects were quoted; reviving it as an input would make a
bare `script` rebuild quote an offer that no longer exists. A hand-quoted `loom $499` is now the only
per-recording override that changes the offer, and it drops BOTH standard commitments with it: a
number agreed by hand does not drag the standard guarantee and free period along.

**`BOOKING_LINK` is tri-state and every caller handles it.** `SRT_ONBOARDING_CALL_URL` unset is a real
state, not a config error to paper over: the script prints a `!!` correction instead of the close,
PRE-FLIGHT prints `NO BOOKING LINK SET` instead of a checklist item, the delivery email flags it and
writes `[LINK DE AGENDA]`, and `PricingCta` renders the offer with no button rather than a dead
`href="#"`. Same discipline as `site_signals` and `robots_check`. A promised link that does not exist
is discovered by the prospect, after the recording, when nothing can be done about it.

**Two more constants are deliberately null and say so out loud.** `QUALIFIED_INQUIRY_DEF` is the
definition of the phrase that STARTS THE BILLING, and nothing in this pipeline can measure
"AI-sourced"; `FRESHNESS_STAT` is the "87% of citations are under 30 days old" line, which has no
source in this repo. Both print a warning in the script header until somebody fills them in, and the
freshness pillar makes its point without a figure in the meantime.

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

### Pricing is FOUR TIERS (2026-08-11, extended 2026-08-21)

Core `$349/mo`, Complete `$499/mo`, **Complete + ChatGPT Ads `$999/mo`** and **Enterprise from
`$4,999/mo`** (priced by location count; 10 = $4,999). All month to month. `OFFER_TIERS` and
`OFFER_EXIT_LINE` in `src/config/pitch.ts` are the single source. The old "$499 with a $349 lever
you have to earn" model is gone, and with it `priceLeverUnlocked`.

`RECOMMENDED_TIER` is the ads tier, and `priceForTier()` is the only way to turn a tier name into a
figure. Adding rungs did NOT reintroduce a lever: "can you do better" is still answered by stepping
DOWN, which is a smaller scope for a smaller number.

> ‼️ **STEPPING DOWN OFF THE ADS TIER DROPS THE GUARANTEE, AND THAT MUST BE SAID OUT LOUD** rather
> than discovered on the invoice. The guarantee is not a bonus attached to a price, it is what the
> paid layer pays for, so there is nothing to deliver it on a tier without ads. Both the closing
> script and the Call Coach price block state this.

What survived from the gate: **withholding on a follow-up call** (no figure is in the request at
all, because a number in a helpful model's context is one it will reach for — the guarantee is
withheld there too, and it matters more), and the ban on deriving another number by arithmetic.

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

**Three live sources, read at scan time** (2026-08-11): the CRM (`buildLeadSnapshot`), the Outlook
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

On thumbs-up: claim the row, write ONE CRM note, create an Outlook **draft**, print the draft into
the thread. `wrap_state` is a claim flag (`auto_send_state` precedent) and `crm_note_at` is checked
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

## `webinar` — the deck builder in #content-full (2026-08-22)
`src/lib/deck/*`, `src/app/api/content/webinar-deck/route.ts`. Post `webinar` in #content-full
with a webinar / VSL script pasted under it, or attached as a .pdf / .docx / .txt, and the thread
returns `deck.pptx` + `slide-plan.md`: white slides, Arial Black, purple on the payoff words, a
gray image zone where a visual goes, and speaker notes carrying VISUAL / PROMPT / SEARCH. He
uploads the pptx to Canva and records himself reading it. **No new table, no migration.**

Ported from `Desktop/Code/vsl-deck-builder` (a Claude Code project of Matthew's: python-pptx +
a parity script). The creative half is a Claude call; the mechanical half is code and makes no
creative decisions.

> ‼️ **RULE 1: THE SCRIPT IS SACRED, AND `parity.ts` IS WHAT MAKES THAT TRUE.** Every word
> reaches a slide word for word, in order. `runParity` diffs the two token streams with a Myers
> diff and NAMES THE SLIDE where drift starts — a bare word count only says *that* something
> moved, which across 90 slides is useless. The diff is then fed back to the model verbatim as
> the correction; a bare "try again" returns the same answer. Parity runs **per batch against
> that batch's own passage**, not once at the end, or every call is already spent by the time a
> drift is found and the diff spans four batches.

> ‼️ **THE FLOOR IS `mechanicalChunk`, AND IT IS WHY THIS CANNOT SILENTLY REWRITE HIS COPY.**
> A batch that will not come back verbatim after one diff-corrected retry is chunked by sentence
> boundary instead: no purple, no visual, but it only ever inserts slide breaks into the original
> string, so it cannot lose a word. A plain deck of the real script beats a pretty deck that
> dropped a sentence, and the Slack receipt says how many passages took that path.

**ALL-CAPS header lines are idea boundaries, never slides.** `HOOK / PROMISE + GUARANTEE`,
`THE THREE PROMISES`, `CLOSE` are how a webinar script is organized on the page, not words anyone
says. `splitSections` lifts them out, batches never straddle one, and each becomes the `section`
label in the speaker notes and the slide plan. They are stripped from the parity comparison too,
so a header can never be counted as a missing word.

> ‼️ **A BRACKET IS ONLY A DELIVERY CUE WHEN IT READS LIKE ONE.** `[pause]` goes to the notes;
> `[city]` and `[treatment]` stay ON the slide. Stripping every bracket put a blank gap in the
> middle of a sentence being read to camera (`lip filler in  "`, slide 7 of the med spa deck).
> A placeholder is spoken with the real word substituted, and a teleprompter is exactly where the
> presenter needs to SEE the bracket. Brackets go through the same `STAGE_WORDS` test parentheses
> already used, and whatever is dropped is reported in the receipt, never silently swallowed.

### The two pptxgenjs traps
python-pptx does not run on Vercel, so `render.ts` is a port onto `pptxgenjs`. Two of its
behaviours dictate the shape of `writeRuns`, and both were found by reading the dist bundle:

> ‼️ **IT EMITS AN `<a:pPr>` PER RUN, AND `CT_TextParagraph` ALLOWS ONE, FIRST.** `genXmlTextBody`
> calls `genXmlParagraphProperties` for every run and appends whatever comes back; its bullet
> branch ends in `else if (!textObj.options.bullet)`, which fires for a plain run with no options
> at all. A three-run paragraph gets three `<a:pPr>` and PowerPoint answers with the "found a
> problem with content" repair prompt. Multi-run paragraphs are not optional here — they are how
> a purple word sits inside a black sentence — so paragraph props ride the FIRST run only, none
> are set at shape level (each run inherits them from the shape before that check), and
> `stripStrayParaProps` removes the survivors from the zipped XML. The probe asserts one `pPr`
> per `<a:p>`; that check is what stops the next edit to `writeRuns` from bringing it back.

> ‼️ **`13.333` INCHES IS NOT 16:9.** pptxgenjs multiplies inches by 914400, so the usual value
> lands 235 EMU short of the canonical `12192000 x 6858000` and produces a non-standard size that
> importers letterbox. `SLIDE_W = 13.3333333` rounds to it exactly.

**Text is sized off character count, never autofit.** Neither library can measure text and
PowerPoint's shrink-to-fit only runs when PowerPoint itself opens the file, which Canva's importer
does not do. `SIZE_LADDER` is the one constant to edit for "tighter slides" / "bigger slides".

### The Claude call
> ‼️ **`MAX_TOKENS` MUST STAY UNDER `MAX_RETRY_TOKENS` (8000) IN `claude-calls.ts`.** That helper
> answers `stop_reason: "max_tokens"` by retrying once at double the budget, but only
> `if (requestedTokens < MAX_RETRY_TOKENS)`. Passing the cap itself does not "ask for the most" —
> it silently disables the only recovery for truncation, and the cut-off response then fails as an
> unparseable-JSON error whose message says nothing about length. Every batch of a live 1,119-word
> script failed that way at 420 words / 8000 tokens. It is 260 words / 4000 tokens now.

> ‼️ **`coerceBatch` REPAIRS THE DECORATION AND NEVER THE WORDS, and the asymmetry is the rule.**
> Slide TEXT is Matthew's copy: drift in it is caught by parity and sent back to the model.
> Emphasis and visuals are decoration this feature invented, so a malformed one is DROPPED rather
> than allowed to fail a batch whose words were perfect — two of four batches were being thrown
> away over a visual `type` the model spelled `stat_viz`. Dropping beats guessing: a visual whose
> type could not be read is one whose intent could not be read either, and a wrong sketch prompt
> in the speaker notes is worse than an empty one. Drops surface in the visual-density warning.

`describeInvalid` walks the whole validator and names the field that actually failed — the same
lesson `booking-script.ts` records. Its first cut returned a message about `visual.type` for every
rejection, so the correction retry was handed a reason that did not match the defect.

**Batches run four at a time.** Each is chunked and parity-checked entirely against its own
passage, so nothing about batch 4 depends on batch 3, and results are written back BY INDEX so the
deck stays in script order. Sequential, the med spa script took 154s; in waves it takes 28s, which
is what keeps a 5,000-word webinar inside the route's 300s budget.

### Reading the script
> ‼️ **NO MODEL RUNS IN `extract.ts`, and that is not an optimization.** A model asked to
> "transcribe this PDF" tidies punctuation, drops a stray line and fixes what it reads as a typo —
> every one of those is a parity failure at best and an unnoticed rewrite of his copy at worst.
> `unpdf` for PDFs, the existing `extractDocxText` for .docx, raw bytes for .txt.

**An attachment wins over typed text.** Slack turns a long paste into a `.txt` snippet on its own,
so `webinar` + attachment is the COMMON case, not the edge one.

> ‼️ **The branch sits ABOVE every other #content-full handler in `slack/events/route.ts`**, and
> it is the only one of them that accepts files. The top-level grammar below it is gated on
> `attachedFiles.length === 0`, so a script attached as a document would otherwise fall through to
> the media handlers and be read as content to render a reel from.

`slack.uploadFile` RETURNS `{ok:false}`, it does not throw. Unchecked, a missing `files:write`
scope or a channel the bot is not in produces a confident summary with no deck attached to it, so
the result is checked and the failure named.

**Measured on the med spa script** (1,121 words, 4 sections): 87 slides, 12 with visuals, parity
pass, 0 fallbacks, 28s. Probe: `bun run scripts/_probe-webinar-deck.ts` (no API calls — it covers
parity, section splitting, the bracket rule, the fallback and the rendered XML).

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
`client_delivery_steps` is the THIRTY-THREE operational steps SRT's own team works through,
several of which live inside one pilot stage. `DELIVERY_STEPS` in `src/config/delivery-steps.ts`
owns the order; the DB stores only `step_key`, so a step can be reworded without a
migration. It is declared `as const satisfies` and re-exported wide, which is what gives
`StepKey` its 33-literal union and makes the verifier map below provably exhaustive.

### One message per step, and a tick that means something (2026-08-22)
`src/lib/clients/step-board.ts` + `step-verify.ts`. Migration: `docs/2026-08-22-step-threads.sql`.

> ‼️ **THE SHAPE WAS THE BUG, NOT THE INFORMATION.** The pilot run put ~18 replies under one
> `ops_thread_ts` in ninety seconds because every emitter went through `notifyThread()`, which
> posts there and nowhere else. Nothing on screen corresponded to one step, so no step could be
> worked one at a time. Matthew: *"impossible to work on."*

- **Each step gets its own top-level message** (`client_delivery_steps.slack_anchor_ts`), posted
  when the step becomes reachable, in `DELIVERY_STEPS` order. Everything for that step lives in
  ITS thread: the instruction card and its buttons, the drafts, the artifacts, the screenshots,
  the refusals. **Edit, never re-post** — Slack orders by post time, so a delete-and-repost moves
  a step to the bottom of the channel permanently.
- **`notifyThread` is now only for client-level messages** (the `intro` draft, the day 30/60/90
  reports). Anything about a step uses `notifyStep()`, which CREATES the anchor rather than
  falling back to the header: a fallback is how the wall comes back one message at a time.
- **The 33-line checklist is deleted.** 33 messages plus a 43-line message listing the same 33
  steps is the wall printed twice. `headerText()` in step-board is the pinned replacement: count,
  the one next step, a link to it. **Its three warnings came across with it** (the Measure gate,
  out-of-order work, build-before-Day-0) because each is a statement about the steps TOGETHER
  and the per-step marks could never carry them. `ops_checklist_ts` is KEPT and stops being
  written, same treatment `slack_channel_id` got.

> ‼️ **A CHECKMARK IS EVIDENCE, NOT A BUTTON PRESS.** `setDeliveryStep` calls `verifyStep()`
> BEFORE the row write and writes nothing on a refusal. Two honest tiers and no third:
>
> | `verified_source` | mark | means |
> |---|---|---|
> | `system` | :white_check_mark: | the app observed real state (rows, a resolver answer, an HTTP 200) |
> | `thread` | :ballot_box_with_check: | a human put an artifact in the step's thread and the app read it BACK |
>
> A thread-tier line may only describe **the artifact it found**, never the fact it stands for:
> "confirmed by 1 photo in this thread" is true, "the cards are printed" is not something a photo
> proves. Same distinction `day_0_source` draws between `photograph_2` and `manual_step`.
>
> **THERE IS NO OVERRIDE.** A step that cannot be confirmed is not ticked and is not worked
> around. `verified_source`'s CHECK constraint has no third value, so a "mark done anyway" button
> would need a migration and would have to read this first. A refusal splits two ways:
> `not_yet` carries a `todo` and a `[Re-check]` button; `broken` carries a `fix` written to be
> pasted into Claude Code, and gets no button, because re-checking a code fault reproduces it.
>
> `STEP_VERIFIERS` is `Record<StepKey, Verifier>`, so a 34th step breaks the build until somebody
> says what evidence confirms it. `scripts/_probe-step-verify.ts` proves coverage in both
> directions and that a thread-tier verdict can never render as the green check.

**Three live bugs this surfaced, all fixed 2026-08-22:**
- **`postReadySteps` ran BEFORE `runReadyAutoSteps` and starved every `auto_then_manual`
  runner.** `postStep` parks a row at `awaiting_me` and `runReadyAutoSteps` only claims
  pending/blocked/ready, so `registerHubAndSeedDns`, `runHarvest` and `checkHubResolving` had
  **never executed on the normal path** — while the `hub_preview` card it had just posted said
  "the hostnames are attached to Vercel already". The card asserted the result of the runner it
  starved. Order reversed, plus an explicit `mode === "auto_then_manual" && status !== "ready"`
  guard, because ordering alone does not hold when `postReadySteps` is called on its own.
- **`uploadsFor` could never match anything.** Slack threads are one level deep, so a reply "to
  the card" carries the thread_ts of what the CARD was replying to. Every screenshot filed with
  `slack_thread_ts = ops_thread_ts` while this compared against `slack_message_ts`. It returned 0
  for every client, so `presence_sweep_manual` refused forever with "0 of 18 screenshots". It
  reads `slack_anchor_ts` now, which IS the thread. `clientForThread` resolves step anchors too,
  and fills `delivery_step_key` from which thread the file was dropped in rather than guessing.
- **`seedPresenceSweep` failed on every run since it shipped**, first one included:
  `onConflict: "client_id,platform,listing_url"` against an index keyed on the EXPRESSION
  `coalesce(listing_url,'')`. ON CONFLICT infers by matching key expressions, a bare column list
  does not match one, so it was 42P10 at PLAN time — never a data collision. Production had 0
  rows in `nap_discrepancies`. Fixed by dropping the `onConflict` option. **That fix caused a
  second failure and has itself been reverted — see below.**

### The first real run, and the ten things it found (2026-08-24)
Migration: `docs/2026-08-24-step-board-fixes.sql`. The one-message-per-step SHAPE was right and
is unchanged. What follows are defects inside it.

> ‼️ **`nap_sweep` HAS NOW FAILED TWO OPPOSITE WAYS AND THE FIX FOR THE FIRST CAUSED THE SECOND.**
> Removing the `onConflict` target cleared 42P10 and let the FIRST seed write eighteen rows. But
> with no target there is no arbiter to skip on, so the second seed was a plain INSERT of rows
> that already existed: `duplicate key value violates unique constraint`. The step sat in a
> terminal `error`. The production test that "proved" the earlier fix inserted a single row into
> an empty table and never exercised a duplicate at all.
>
> The index is now a COLUMN list, `(client_id, platform, listing_url) NULLS NOT DISTINCT`, and
> the `onConflict` target is back. **`NULLS NOT DISTINCT` is load-bearing and is not optional**:
> seeded rows carry a null `listing_url`, nulls compare distinct by default, so a PLAIN index on
> those columns would constrain none of them and every re-run would insert eighteen duplicates —
> which is exactly what the old warning here said. It was right about a plain index and wrong
> only about there being no way to write one. It is semantically identical to
> `coalesce(listing_url,'')`; only one of the two is inferrable from a column list.

- **`baseline_scan` read `clients.audit_report_id`, which NOTHING HAS EVER WRITTEN.** It was that
  column's only reader. The link is `audit_reports.client_id` and it is populated. So step 2
  refused for every client that had a real audit, and it took steps 7 and 9 down with it, both
  being `blockedBy: ["baseline_scan"]`. The same verifier also selected `visibility_score`, which
  does not exist (it is `score`) — PostgREST fails the WHOLE select on one unknown name, so that
  was a second fault hiding behind the first. Resolve by `client_id`, newest first, **no
  contact_id or domain fallback**: both can match a `prospect_audit`, and this is the baseline the
  day 30/60/90 numbers are measured against.
- **THREE COLUMNS HAD READERS AND NO WRITER.** `competitor_candidates.selected`,
  `review_audit_rows.review_count` and `nap_discrepancies.confirmed_status` were read by the
  verifiers, the review-audit seed, `citation-cleanup.ts`, `findings.ts`, `call-sheet.ts` and
  `presence-pdf.ts`, and written by nothing anywhere. Steps 7 and 8 could never be confirmed and
  their refusals pointed at board panels that did not exist. Now built:
  `/api/clients/[id]/{competitors,review-audit,presence-sweep}` plus their panels.
  `review_count` stays NULL until typed (`Number("")` is 0, which is the trap), and the presence
  route **never writes `status`** — that is the seed column; `confirmed_status` is the answer.
- **TWO GREEN TICKS OVER WORK NOBODY HAD DONE**, which is the most expensive bug this design can
  have. `citation_cleanup` counted `status = 'mismatch'`, but `status` is what the seed wrote and
  every other consumer reads `effectiveStatus` (`confirmed_status ?? 'not_checked'`), so it
  returned ":white_check_mark: no listings remain at mismatch" on a client where all eighteen were
  untouched. And `subdomain_live` passed `checkHubResolving()`'s `ok` flag straight through — that
  function returns `ok: true` for any client with a domain, correctly, because it is also the auto
  RUNNER and a runner that failed on propagation would park the step in `error`. The board read
  ":white_check_mark: subdomain_live" above the words "0 of 3 resolving". Both now read the real
  state; `subdomain_live` gates on the hub CNAME specifically.
- **`presence_sweep_manual` gates on the CORE SIX, attributed by name.** It demanded all eighteen
  screenshots while its own card called the extended tier "context only. Findings, not week-one
  cleanup". Matthew's call: six required, twelve optional. **A count alone was not enough** — every
  pasted Slack screenshot is `image.png`, so six shots of Yelp would have satisfied a six-platform
  gate. Attribution comes from the platform named in the message (`resolvePlatformsFromText`,
  pure, word-boundary matching so "yp" does not fire inside "type") and lands on
  `client_docs.presence_platform`. Zero matches and two matches both leave it null and say so in
  the thread: guessing which of two named platforms a picture shows is not available.
  > ‼️ **BOTH SLACK EVENTS WRITE, AND ONLY ONE CAN SEE THE TEXT.** An upload with a comment fires
  > a `message` (subtype file_share) carrying the text AND a `file_shared` carrying none, in no
  > guaranteed order. `handleFileShared` goes through `files.info`, which has no message text at
  > all. Whichever wins inserts the row; the message path backfills via `attributePresenceDoc`,
  > whose `.is("presence_platform", null)` predicate makes it a backfill and never a relabel.
- **The theme was an unconfirmable choice.** `themeConfirmed()` called `activeTheme()`, which
  returns null when nothing is OVERRIDDEN as well as when nothing is CONFIRMED, and the panel
  disabled Confirm on the same test. So a client happy with the defaults could never satisfy it
  and `hub_preview` could never complete, taking 16, 17 and 18 with it — while the panel said
  "the default palette, which is a fine place to start" directly above the disabled button.
  **Confirmed is `confirmedAt`. Has-overrides is `activeTheme`.** They are two different facts.
  `activeTheme()` is unchanged and must keep returning null for an empty theme, or the hub stops
  rendering its defaults. `review-preview.ts` was the second half of the same deadlock.
- **`error` was a terminal state with no way out.** `runReadyAutoSteps` claims only
  pending/blocked/ready and the board's checkbox can only send `complete:true` for an unticked
  row, so a failed runner parked forever. An amber **Retry** on the client board sends
  `complete:false`, i.e. the existing `reopened` transition — no new transition and no new state,
  and deliberately NOT a Slack button, because a `broken` verdict gets none on purpose.
  `setDeliveryStep` now clears `error_detail` on every transition; without that, `verifyStep`'s
  "a recorded error outranks not_yet" rule turns honest work-owed into a permanent code fault.
- **The general assistant posted at CHANNEL TOP LEVEL, in raw markdown.** The only onboarding-
  channel gate fired for a research paste and everything else fell through to
  `slack.postMessage(channel, reply)` with no `thread_ts`. One consolidated gate now owns the
  channel and **every branch returns**: research paste, files, a question in a step thread
  (answered via `notifyStep`, the only door), the header thread (`notifyThread`), and top level —
  which gets a `chat.postEphemeral` and no channel message at all, because there is no honest
  "the" thread to pick and a channel post is the wall coming back. `toSlackMrkdwn` lives in
  `slack-bot.ts`, not beside `toSlackBold` in `hook-pitch.ts`, so the Slack primitive does not
  depend on the audit engine. `conversationId` is now thread-scoped: `slack-${channel}` gave one
  client's step thread the last twenty messages from another client's.
- **`avatar_harvest` claimed work it had not measured.** `question_bank` has no `client_id`, so
  its count is per-VERTICAL and shared across every client ever harvested. The per-client evidence
  is `output_ref`, and the success line leads with it now.
- **The presence PDF could not say step 5 was SKIPPED.** It reads only `nap_discrepancies` and
  never `client_delivery_steps`, so a skipped sweep and an unfinished one rendered identically —
  and with the gate at six, twelve unchecked platforms is now the NORMAL state of a document
  Matthew shows the client on the call. It reads the step row and says so on its face.
  > ‼️ **The Slack skip copy cannot be pasted into that PDF.** `test-onboarding-artifacts.ts`
  > asserts the string `no issues found` appears NOWHERE in a rendered client PDF, in any casing,
  > *including inside a sentence disclaiming it*, and the Slack wording contains the phrase. Say
  > the same thing without it. The invariant is grep-able on purpose.
- **Step 3 prints the three DNS records too**, for reference (Matthew asked; both steps were
  working as built). Step 3 answers where and who, step 15 answers what to type, and he wants the
  whole DNS conversation in one thread while he is on the phone. `formatDnsRecords` gained a
  `preview` mode and is used a third time rather than copied. **It seeds nothing and prints no
  CNAME target**: step 3 is the step that DECIDES the subdomain label, and the true per-domain
  target is only known after `registerClientHosts` at step 15 — `hubCnameTarget()`'s fallback is
  measured WRONG for this project, and a wrong value on a row labelled `ready` is one somebody
  reads down the phone.

`scripts/_probe-cascade.ts` proves the cascade on a THROWAWAY client, because it cannot be proved
on a real one: `_debug-post-all-steps.ts` forced anchors out for all 33 steps ignoring `blockedBy`,
and `postStepAnchor` short-circuits on an existing anchor. It refuses to run against the
production channel.

### Making the 33 steps runnable by a person (2026-08-25)
No migration. The one-message-per-step shape and the two evidence tiers are unchanged. This pass
is about what the cards SAY, and about two steps nobody could ever have ticked.

> ‼️ **`clients.vertical_slug` AND `clients.business_type` HAD FOUR READERS AND NO WRITER**, and
> the cost was a poisoned shared corpus rather than a visible error. `classify.ts` works the
> answer out on every audit and `run-audit-pipeline.ts` stores it — on `audit_reports`. Nothing
> copied it to `clients`. So `harvest.ts`, `research-intake.ts`, `custom-question-set.ts` and
> `page-candidates.ts` all took their `?? "med_spa"` fallback, for every client that has ever
> existed. Measured: forty correctly-extracted phrases about how to choose an AEO agency, filed
> under `med_spa`, on a client whose audit had answered the question perfectly.
>
> **`question_bank` has no `client_id`.** It is keyed `(vertical, normalized)` and shared across
> every client in a vertical forever, so the next real med spa would have inherited those phrases
> as their tracked question set and there is no per-client key to unpick them by.
>
> `adoptAuditClassification` (`baseline-scan.ts`) is the writer, hooked into `setDeliveryStep`
> where `baseline_scan` completes — **not** inside `startBaselineScan`, because a report can also
> be attached by hand and confirmed with Re-check, which is the path a re-onboarding takes.
> **It writes only over NULL**, at the database with `.is(...)` and not just in the read: a human
> correcting a vertical outranks the classifier, and a re-run must not re-file an existing client
> into a different corpus mid-pilot.
>
> **The four fallbacks REFUSE now** (`verticalFor()`, harvest.ts). Matthew's call with both
> options stated: a step parking in `error` with a fix line costs one Re-check, a silent wrong
> write costs a corpus. Only two of the four were reported; the other two are the READ side of
> the same bug, which is worse because building a question set out of somebody else's corpus
> looks right.

**Two steps could never be confirmed by anybody, and they failed the same way:** a verifier
pointed at evidence the step does not produce, so honest finished work read as outstanding.
- **29 `review_request_configured`** read `clients.review_request_mode`, which had two readers
  and no writer. Its refusal said "Set it on the client board" and there was no such control.
- **32 `weekly_report`** used `artifactOnRecord`, which demands `output_ref` plus a `client_docs`
  row. `runWeeklyReports` writes a `client_weekly_reports` row and calls `autoCompleteStep`,
  which lands on that verifier, gets `not_yet` and writes nothing — every week, forever. Its
  `todo` told you to re-tick to re-run a generator that does not exist and cannot: the step is in
  `ROUTE_COMPLETED` because it is a PREDICATE about ongoing behaviour. It counts the reports now.

**The Review handover panel** (`/api/clients/[id]/review-workflow` + `review-workflow-form.tsx`)
is the missing writer for `review_request_mode`, `review_owner_name` and
`review_workflow.google_url` / `.realself_url`. That last pair is why **the review tool's "Post on
Google" button has never appeared for any client**: `destinationsFor()` has always read those keys
and intake step 4 collects `destinations` as a multiselect of display LABELS. Every customer got
the fallback hint telling her to go and find the review page herself.
- **The bag is MERGED, never replaced.** `review_workflow` is intake step 4's jsonb and owns ten
  other keys; `save/route.ts` assigns the whole bag, so a replace here deletes the intake answers
  the call sheet is built from.
- A URL is parsed and must be `https:`, or refused. `review-tool.tsx`'s rule is unchanged and is
  the reason: **absent beats wrong, never synthesise a link**, because a guessed review URL sends
  a real customer to somebody else's business.
- `review_destination_secondary` still has zero readers. Left in place, noted here rather than
  dropped.

> ‼️ **STEP 27 `first_page` HAD A CARD THAT COULD NEVER BE POSTED**, and it is the same shape
> `day_zero_archive` was in one pass earlier. It declared `mode: "auto_then_manual"` with no
> `auto` flag and no `AUTO_RUNNERS` entry. The only writer of `status: "ready"` is
> `runReadyAutoSteps`, gated on a runner existing; `postReadySteps` skips `auto_then_manual`
> unless the row is `ready`. So the good copy in `instructionsFor` was dead on the normal path
> and had only ever appeared because `_debug-post-all-steps.ts` calls `postStep` directly.
>
> It is `mode: "manual"` now — publishing happens on the board, behind the Day 0 wall, so there
> was never anything to run. **`unreachableAutoSteps()` is widened to read `mode` as well as
> `auto`**, which is what let this slip: `auto` says the system TICKS it, `mode` says whether it
> waits, and a step declaring either needs something behind it. The test suite asserts the set is
> empty and that no `auto_then_manual` step lacks a runner.

**One anchor at a time** (`reachableCursor`, step-engine.ts). `ensureReachableAnchors` used to
post every step whose blockers were clear: two at intake, then four, then two. All three
schedulers gate on the cursor now, and **all three must** — `postStep` calls `anchorTsFor`, which
CREATES an anchor, and a runner's `note` goes out through `notifyStep`, which does the same. The
leak that would have been missed is `hub_preview`: its only blocker is `intake_received`, so
gating the anchor function alone still puts step 15's top-level message in the channel at intake.

> ‼️ **THE WALK BREAKS ON THE FIRST WAITING STEP WHETHER OR NOT IT IS REACHABLE**, and the
> obvious version gets this wrong. Walking PAST a blocked waiting step, on the reasonable grounds
> that it is not workable, lets a later one leapfrog: at intake everything between
> `presence_sweep_manual` and `hub_preview` is blocked, so the walk reaches step 15 and anchors
> it. Breaking is safe because a blocker is always an EARLIER step, so it has already been seen.
>
> **What it costs, stated once so nobody rediscovers it as a bug:** work that could legitimately
> happen in parallel is serialised. `call_booked` has no `blockedBy` at all — it used to appear
> at intake so the call could be booked while the scan ran, and it now waits for step 18. Matthew
> asked for calm over throughput. If the serialisation bites, widen the function; do not bypass
> it in one caller.

`headerText`'s "the one next step" line is now the whole board, so its `next` picks the first
WORKABLE unresolved step rather than the first unresolved one — a header naming a step the
channel is not showing leaves nothing on screen and nothing explaining why.

**Phases are three: before / during / after the call.** `Measure` + `Prepare` (1-18), `The call`
(19-22), `Day 0` + `Build` (23-33). Step order, numbers, `blockedBy` and `gate` are untouched.
Nothing keyed on the literal `"Day 0"` — the wall keys on `step.gate` and `DAY_ZERO_STEP_KEY`.
**Phases must stay CONTIGUOUS in `DELIVERY_STEPS`**: `delivery-checklist-form.tsx` groups with a
running-string sentinel, not a `groupBy`, so a phase reappearing renders its header twice. The
test asserts contiguity. `headerText` prints three counts, derived by grouping rather than from a
literal list, so a rename is one edit.

**Cards say what to do and link what already exists.** `instructionsFor` now receives the step's
row and has `outputRefsFor` / `docForStep` / `docLink`, because **no case in that switch read
`output_ref`**, so no step ever showed the artifact an earlier one produced. Six manual steps
(19, 20, 24, 25, 29, 33) posted a label and three buttons and nothing else. The links that matter
most: 23 links the **AI Visibility Scorecard PDF** (Matthew asked by name; it is an upload against
step 2, so it comes from `client_docs`, not `output_ref`), 25 links step 14's cleanup PDF and
leads with the `not_checked` count because that is what its verifier refuses on first, 27 links
step 13's candidates and the `client_pages` drafts, 28 links step 17's PDF and the REAL reviews
host, 11 links step 9's brief, 33 computes day 30 from the Day-0 stamp and says so when there
isn't one. `docLink` returns null rather than a dead link.

> ‼️ **A CARD BODY OVER 3,000 CHARACTERS FAILS THE WHOLE SLACK MESSAGE**, and the sweep card was
> already at 2,988 for a short business name. The name is interpolated into all eighteen search
> strings, so "Greensboro Aesthetic and Wellness Institute" goes over — `invalid_blocks`, no card,
> and `postStep` returns early, leaving an anchor with no instructions and no buttons. Found by
> the cascade probe, whose client name carries an epoch. `bodySections()` splits ON LINE
> BOUNDARIES, never mid-line: these bodies are search strings, URLs and DNS values that get
> pasted, and a value split across two blocks is a value somebody pastes wrong.

> ‼️ **THE PINNED HEADER'S "Full checklist" LINK HAS BEEN A 404 SINCE IT SHIPPED.** It built
> `/dashboard/clients/{slug}` and that page queries `.eq("id", id)` against a uuid column, so a
> slug is a CAST ERROR rather than a miss: the query throws, the page gets null and calls
> `notFound()`. The one navigation aid on the header went nowhere and it read as a permissions
> problem. Every board link is built from `client.id` now, header and cards alike.

**Step 31 `time_log_entries` gets a thread note, not a card.** It is `mode: "auto"` so
`postReadySteps` skips it, but nothing runs itself either — `/api/clients/[id]/time-log` ticks it.
A [Done] button would be a button whose press the verifier can refuse, over work that is not a
button press.

**The top 3 competitors are pre-picked** (`applyDefaultSelection`). Matthew: *"I didnt really pick
any competitors, just make sure it auto selects the top 3 most mentioned from the audit."* It
no-ops the moment anyone has chosen, and it does NOT tick the step — he still presses Done and the
verifier still counts `selected` rows, so the evidence rule is untouched.
- **A zero-mention intake guess is never a default.** `isExcludedFromShortlist` drops aggregators
  and chains at build time; this is a different filter. The live case is a client who typed `"a"`
  into the competitor box. It stays on the shortlist, because a client naming businesses no engine
  has heard of is itself a finding.
- **A tie-break is never printed as a ranking.** On the first real client, two candidates had 2
  mentions and then FIVE were level at 1, so picks 2 and 3 were a coin toss. `tieAtCutoff` counts
  them and the card says so.
- `competitors/route.ts` now SETS then CLEARS. Clear-then-set left a client with **zero**
  selections whenever the set errored or the partial-match guard tripped, both of which return a
  4xx after the clear has committed, with no transaction to roll it back — while the response said
  nothing had changed.

`setDeliveryStep` **returns the verdict on success too**. It always declared `verdict?: Verdict`
and only ever returned one on refusal, so `_probe-cascade.ts` had an assertion about step 2's
evidence tier that could not have gone green on any run.

#### The review tool: a microphone and a readability hint, and still no model

> ‼️ **MATTHEW ASKED FOR REVIEWS REWRITTEN TO A 6TH-GRADE LEVEL WITH AN EMOTIONAL HOOK ADDED, AND
> THAT IS THE ONE THING THIS TOOL CANNOT DO.** It is generating review content the customer did
> not write, attributed to her, on the client's Google profile: FTC 16 CFR Part 465, the Rytr fact
> pattern. **He was told why and chose the readability hint instead. Do not reopen it.**

- **The microphone is on-device only.** `SpeechRecognition` / `webkitSpeechRecognition`, dictating
  into the four boxes, hidden entirely where the API is absent. **Do NOT wire `transcribeAudio()`
  (`clients/voice-notes.ts`, whisper-1) in here**: `review_tool_submissions` has deliberately no
  column for a name, email, phone, IP, user agent or session id, and *the absence of the column is
  the enforcement* — a voice is more identifying than any field it refuses. Nothing reaches our
  servers and there is nothing to delete. She edits the transcript before submitting.
  `language` is passed separately from `needsSpanish`, which is true for `"both"`: rendering a
  Spanish note and LISTENING in Spanish are different decisions, and `es-ES` recognition on a
  bilingual client garbles every English speaker who taps the button.
- **`src/lib/hub/readability.ts` imports nothing**, same discipline as `review-assemble.ts`. Pure
  Flesch-Kincaid: syllables, words, sentences. It returns offsets so the flagged sentences
  highlight in place under a mirrored div. **It may point at a sentence. It may not rewrite one,
  and there is no "fix it for me" button** — the moment software supplies the replacement words we
  are back over the line. The test asserts the module exports nothing named rewrite/simplify/
  suggest/improve/fix/shorten and that it imports nothing.
- `Copy my words` is now **Copy and go**, and its second half works for the first time once step
  29's panel has the URLs.

**The three review steps are different things and the cards now say so**, because Matthew
conflated 8 and 16. Step 8 is the competitor review-COUNT grid (internal, feeds findings §3), 16
owns whether the tool renders and is themed, 30 owns the handover. Step 16's card also says out
loud that **`reviewPreviewUrl()` cannot be handed to a client**: it is a `/dashboard/` path and the
page calls `notFound()` without a session, so a logged-out visitor gets a 404, not a login screen.
It belongs in that step's thread, which is internal. The client-facing surface is `reviews.{domain}`.

**Step 9 is NOT redundant with the audit and must not be merged into it.** It makes **zero model
calls** — `harvest.ts` imports `supabaseAdmin` and nothing else — and it CONSUMES the audit: it
reads `audit_runs.citations` and fetches up to 40 of the pages the engines cited. Three reasons it
cannot be replaced by `audit_reports.prompts`: that column is **regenerated by every audit run**
(`findings.ts` spells out the hazard), so quoting it would let a later scan rewrite the questions
in a report already sent — the Day-0 tracked set has to be frozen; the 20 prompts are model-invented
clean phrasing while `question_bank` is verbatim market wording with typos kept, carrying
`frequency_score`, `commercial_intent_score`, `objection_phrase` and a `source_url`; and deleting it
breaks step 12 outright (`custom-question-set.ts` hard-fails with "Run the avatar phrase harvest
(step 9) first") and starves `page-candidates.ts`. **The avatars are not in step 9 at all** — they
live in `niche_briefs.avatars`, per vertical, and `question_bank.avatar` stays NULL until step 11.
The LABEL is renamed to stop it reading as a duplicate; the KEY is not, because renaming a key
orphans every row carrying it.

`_probe-cascade.ts` is rewritten for the cursor. Its proposition is now **exactly one waiting step
at a time, and resolving it reveals exactly one more** — the old one asserted that confirming step
2 surfaced BOTH 7 and 9, which is the behaviour that was removed. Two fixture notes: the throwaway
client gets a canonical NAP (without it `nap_sweep` errors, `presence_sweep_manual` never unblocks
and the probe measures nothing), and it deliberately gets NO domain, so `site_dns_intel` fails and
is carved out by name — a domain would send `hub_preview`'s runner at the real Vercel API. It also
used to assert step 9 sat at `ready`, which is **the state of a failed card post**: `postStep`'s
last act is to park the row at `awaiting_me`, so `ready` only survives when the Slack post threw.

### Four lanes in one checkout, merged (2026-08-25)

Four sessions built four features side by side in this working tree under
`docs/lanes/CONTRACT.md`: file ownership instead of branches, because four sessions in one folder
would otherwise fight over `HEAD`. They composed on the first build. What follows is what each
one changed, and then the three places where two correct changes made a third thing wrong, which
is the part no lane could have found on its own.

**The screenshot already says which platform it is.** `resolvePlatformFromUrl` reads the address
bar off a sweep screenshot (`screenshot-read.ts`, Haiku, `temperature: 0`), so filing thirteen
pictures no longer means typing thirteen platform names. Text attribution still wins and the
write sits behind the same `.is("presence_platform", null)` predicate the text backfill uses, so
**a model can never relabel what a person named**. The gate moved from six named platforms to
`SWEEP_GATE_COUNT` = four DISTINCT platforms of any tier, counted over platforms and never over
files; Trustpilot joined `EXTENDED`, making `PLATFORM_COUNT` 19.

> ‼️ **A BRAND MARK IN A PAGE IS NOT AN ADDRESS BAR, AND THE LIVE CLIENT PROVES IT TWICE.** Only
> `domains` on the platform record resolves anything; `chamber` has no `domains` entry and must
> not get one, because its search surface is a Google results page. Of the five unattributed
> screenshots on SRT Agency LLC, one resolves and four are viewport captures cropped above the
> browser toolbar. Reading the logos would have made the table say 5 of 5 — and one of those four
> is a **Bing Maps** page that the reader's own evidence string called "appears to be Google
> Maps". A brand-mark reader would have filed it as Google Business Profile: a green tick on the
> wrong platform, which is worse than no tick. The honest fix is one sentence of copy in the
> thread note asking for the shot to include the browser bar.

**The avatar is decided first, and something can finally write it.** `clients.primary_avatar` had
a column, a CHECK constraint and a verifier and **no writer anywhere**, so on the first real
client that step came out `skipped` because no human being could tick it. `clients/avatars.ts` is
that writer. `avatar_confirmed` moved from position 11 to **8**, immediately after
`competitor_shortlist` and `blockedBy: ["baseline_scan"]`, and `avatar_harvest` gained it as a
blocker: researching a buyer before anybody has chosen one is the wrong order.

- **Keys are unchanged, only array position and labels.** Renaming a key orphans every
  `client_delivery_steps` row carrying it, including the `skipped` one this was built to rescue.
- **`niche_briefs` is keyed on `niche_key`, and nothing keys it on `vertical_slug`.** The obvious
  lookup returns **zero rows on the one client this had to work for**: its `vertical_slug` is
  `aeo-agency` and the matching brief is `aeo-marketing-agency`, identified only by its
  `business_type` matching character for character. `avatarCandidatesFor` walks vertical_slug,
  then business_type, then niche_key-as-business_type, and reports which one matched. A miss
  returns an empty list and invites a typed avatar; it never invents a candidate.
- **`question_bank.avatar` holds the SLUG, not the a1/a2/a3 slot**, and the CHECK widened to
  `^[a-z0-9][a-z0-9-]{0,59}$` for it. That table has **no `client_id`** and is shared across
  every client in a vertical forever, so "a1" would mean whatever that client's brief had in
  position one on the day they confirmed, and two clients would file two different buyers under
  one tag. The unique key is now `(vertical, avatar, normalized) NULLS NOT DISTINCT` — the third
  time this repo has had to write that down, and for the same reason each time: all 63 existing
  rows carry a NULL avatar, nulls compare distinct by default, so a plain index would constrain
  none of them and every re-run would insert 63 duplicates.
- **The 63 rows were deliberately NOT backfilled.** They were harvested before anybody had
  confirmed an avatar, and writing a slug onto them would be inventing which buyer they were
  collected for.
- `avatar_briefs (vertical, avatar_slug)` makes the deep research reusable: the second client
  aiming at the same buyer is offered what the first one produced. The brief itself is now the
  three-message framework, MENSAJE 1 / 2 / 3, each fenced so one can be copied without picking up
  the next, with the confirmed avatar filled into `[PRODUCTO]` and the selling slot. Deterministic
  byte for byte, and asserted as such.

**Stop asking a marketing agency about lip filler.** `universalSetFor` returns the shipped twenty
for `med_spa` and, for any other vertical, reads or derives-and-freezes `universal_v1@{vertical}`
from that client's own newest `audit_reports.prompts`. `composeTrackedSet` puts the client's OWN
two questions first, built from what they typed at intake and LABELLED `from intake` so they can
see which ones are theirs to correct, and DROPS any of the rest whose placeholders nothing on the
record fills rather than substituting melasma into a business that has never heard of the word.

> ‼️ **`services.primary_service` HAS NEVER EXISTED.** `substitutionsFor` read it as the fallback
> for `treatmentPrimary`; the intake key is `services_list`. So every client without
> `ideal_patient.highest_margin` resolved `[treatment]` to the empty string. Another reader with
> no writer, and the fourth this file records.

> ‼️ **THE VALUES CARRY THEIR PROVENANCE AND NOT ONLY THE QUESTIONS DO**, and the first merged
> call sheet is why. The twenty came out clean for the agency, and the substitutions table at the
> top of the same page still printed `concern: melasma` and `devicePrimary: Morpheus8`, bare,
> under a heading reading "with your values substituted in". They are neither the client's values
> nor used by anything — `composeTrackedSet` dropped every question that needed them, which is
> exactly why they are safe to keep in the object and exactly why they are not safe to print. A
> fallback that feeds nothing is now NAMED as one rather than removed, because hiding the row
> would leave a reader wondering why a placeholder they can see has no value.

**Step 21 refuses until a payment is RECORDED.** `clients.payment_recorded_at` and its three
companions, written by the panel at `id="payment"`.

> ‼️ **IT IS AN ASSERTION THE BOARD RECORDS, NEVER EVIDENCE OF A CHARGE.** Nothing in this
> application talks to a payment processor, so nothing here can observe money moving. Exactly the
> distinction `day_0_source` already draws between `photograph_2` and `manual_step`. Every surface
> reads "payment recorded by X on DATE"; the test suite greps all three payment files, comments
> stripped first, for `payment received` and for any processor reference.

> ‼️ **THE GATE LIVES IN THE VERIFIER, AND A GATE IN `stepPrecondition` ALONE IS BYPASSED.**
> `stepPrecondition` is called from `api/slack/actions/route.ts` and nowhere else; the client
> board's checkbox posts straight to `api/clients/[id]/delivery-step`, which calls
> `setDeliveryStep`, which runs `verifyStep` before the row write. Both carry the refusal now,
> reading one module so two copies cannot start disagreeing. The refusal states the REASON, not
> the rule: technical access is collected after the commitment, because a client who has not
> committed does not hand over their Google account, and asking early ends the call with neither.

**Step 20 hands over 33 closing questions** (`artifacts/call-questions.ts`), generated by the
existing `call_sheet` runner in CLOSER order, the same spine `call-coach/suggest` runs on, so the
document and the live coach cannot be at different stages of one call. The facts are built in
code and the questions are the model's; absent prompts come from `audit_runs.prompt`, never
`audit_reports.prompts`, the rule `findings.ts` states for the same reason. It does **not** call
`deliverArtifact`: that reaches `postStepAnchor` and would put step 20's top-level message in the
channel while step 18 is still the cursor. It stores the bytes and writes `call_held.output_ref`,
and step 20's card links it when that step legitimately appears.

**The page studio.** `page <client>` in `#aeo-seo-page-drafting`, a bare digit claims one of the
frozen candidates, and everything typed or dictated after that goes into `answer_md` **verbatim**.
`polish` posts a suggestion and never writes. The board finally has an **Edit** control on every
page row: `savePage` has always accepted an `id` and the route has always forwarded it, so until
now every saved page was write-once and unreachable.

- **The menu is FROZEN on the session row**, not re-derived at digit time, or a re-run of step 13
  would change what "2" means between the card and the number. Same hazard `client_pages.question`
  is stored verbatim to avoid.
- **A bare digit is a claim only while nothing is claimed.** Once a page is open, `3` is something
  he said about the page. Same doctrine as `thread-assistant.ts`.
- **Two client matches is the same answer as zero.** It lists them and refuses to guess, because
  guessing opens a draft against the wrong client's hub and the mistake only surfaces once a page
  is live on somebody's real domain.
- **Derived ideas can never out-rank a measured gap by being a guess.** `page_candidates.origin`
  separates a phrase a buyer typed from a page this system assembled out of a cluster of them,
  they get their own PDF section and their own heading on the menu, and `currentlyNamed` is
  **always null** on one, so the visibility-gap bonus (the largest term) is never collected.
- **`page_publish_request` does not publish and must not be changed to.** `setPublished` having
  exactly one caller is what makes `grep -rn "setPublished" src/` a real hole check on the Day 0
  wall. A Slack publisher would be a second place to get the before/after ordering wrong, on a
  surface with no session behind it.
- **Approve was dropped**, on Matthew's call: `client_pages.status` is draft/published/archived
  and adding an approved state would put a SECOND hard rail into a codebase whose stated doctrine
  is that Day 0 is the one place it blocks. **Half of that was reversed on 2026-08-26** (see
  "Evidence and the quality gate" below): there IS a second rail now, and it still has no fourth
  status value. `client_pages.status` is unchanged and nothing moves a page through an extra
  state; the gate is a recorded verdict in `page_gate_runs` that `page_publish` consults.

> ‼️ **STEPS 12 AND 13 POST NO CARD AT ALL, and their `instructionsFor` arms are dead on the
> normal path.** Both are `mode: "auto"`, so `postReadySteps` skips them and `instructionsFor` is
> never reached, the same dead-card class `first_page` was in one pass earlier. The only thing
> that reaches Slack for either is the runner's `note`, which is therefore where the one line
> that matters had to go. Both notes now carry the distinction, because it is a distinction about
> a PAIR and stating it on one of two steps that share a corpus is not stating it: **step 12 is
> the MEASUREMENT set, frozen at Day 0 and never published from; step 13 is the PUBLISHING
> backlog. Same corpus, opposite jobs.**

#### The three interactions no single lane could see

**1. A client-facing PDF explained an absence that had been filled that afternoon.**
`page-candidates.ts` printed *"Not grouped by avatar: nothing in the system records which avatar
was confirmed, so an a1/a2/a3 tag here would be invented rather than read"* — true when it was
written, false by the time it shipped, because the avatar lane built the writer in the next room.
The lane that owned the file was told to leave the comment and the lane that falsified it did not
own the file, which is exactly the gap a merge exists to close.

> The grouping stays on THEME, and for a better reason than the old one: a client has exactly ONE
> confirmed avatar, so grouping by it produces one group containing everything. It would replace
> an axis that separates rows with a constant. The paragraph now names the confirmed avatar, or
> says step 8 has not happened yet, and says the candidates were harvested against the vertical
> rather than tagged per avatar.
>
> **`page_candidates.avatar` still stays null**, and the reason moved from "the column does not
> exist" to a statement about the corpus: the honest per-row tag is `question_bank.avatar`, which
> records which buyer that phrase was harvested FOR and is null on every row written before an
> avatar could be confirmed. Stamping the client's current avatar onto rows harvested before
> anybody chose it is inventing the tag and then treating it as evidence.

**2. One waiting step at a time survived the reorder.** `reachableCursor` breaks the walk on the
first unresolved step whose `mode !== "auto"`, reachable or not, and `avatar_confirmed` is now a
manual step at position 8 with `custom_question_set` and `page_candidates` both blocked behind it.
Proved on a throwaway client rather than argued: the walk stops at 5, then 7, then 8, then 9
(`auto_then_manual` is also not `auto`), each one revealing exactly one more, anchors posted in
`DELIVERY_STEPS` order, and step 8's verdict coming back `system` tier off the column.

**3. `substitutionsFor`'s CODE path is byte-identical and its VALUES are not, deliberately.**
`UNIVERSAL_V1_MED_SPA`, `NEEDS_LOCATION_PREFIX`, `materialize`, `materializeAll` and
`freezeUniversalV1` are unchanged; `SUBSTITUTION_RULES` is the old replace chain lifted into a
table in the same order; `substitutionsFor` kept its signature and is a two-line delegate, so
`custom-question-set.ts` and `page-candidates.ts` needed no edit and got none. Verified by
rendering the twenty at HEAD and at the pre-lane commit with identical `Substitutions` and
diffing: same bytes, including a fixture where every placeholder is distinct so a rule that
stopped firing could not hide behind a blank.

> What DID change is what feeds it. `treatmentPrimary` now falls back through `services_list`
> (see `primary_service` above) and `competitorIntake1` prefers the confirmed step-7 competitor,
> both filtered through `usableCompetitorName`. Med spa clients inherit both. They are bug fixes,
> they are not no-ops, and calling the whole thing "unchanged" would be wrong in the one direction
> that matters.

#### One more, found while proving the page studio

> ‼️ **`revalidateTag` THROWS OUTSIDE A REQUEST CONTEXT, AND `hub/pages.ts` CALLED IT UNGUARDED
> AT FOUR SITES.** `hub/resolve.ts` and `hub/vercel-domains.ts` had already written this down and
> wrapped theirs. `startPageDraft` and `appendPageBody` are reached from `handlePageStudioEvent`,
> which `api/slack/events/route.ts` invokes inside `waitUntil`, and the throw lands AFTER the row
> is written, so the failure mode is the worst shape available: the draft exists, the thread never
> confirms it, and `page_studio_sessions.page_id` is never set, leaving a session nobody can claim
> and a person looking at nothing. All four now go through `bustPages()`. **Failing to bust a
> cache that expires on its own must never undo a write that already succeeded.**

#### Housekeeping the merge did, and what it left alone

Counts and step numbers that lane work had made false were corrected where they describe the
PRESENT and left where they describe the past: "eighteen platforms" became nineteen in the six
places asserting what the config holds today, and stayed in the eight places recounting a bug
("the gate used to be eighteen files in the thread"). The three refusals naming "the avatar phrase
harvest (step 9)" now say step 10. `test-onboarding-artifacts.ts`'s *EVERY LANE APPENDS ABOVE THIS
SUMMARY* marker had drifted 229 lines above the summary, with two lane blocks appended between the
warning and the thing it warns about, and now sits at the boundary it names.

Migrations, all four applied: `2026-08-25-lane-1-screenshots.sql`, `-lane-2-avatar.sql`,
`-lane-3-payment.sql`, `-lane-4-pages.sql`. Probes: `_probe-address-bar.ts` (read-only, it never
calls `attributeFromScreenshot`), `_probe-presence-url.ts`, `_probe-question-set.ts` (dry unless
`--freeze`), and `_probe-cascade.ts` rewritten for the cursor — its proposition is now exactly one
waiting step at a time, which INVERTS what it used to assert.

**Still owed, and none of it is code:** the bot is not a member of `#aeo-seo-page-drafting`
(`is_member: false`), so the page studio cannot receive a message until it is invited;
`OPENAI_API_KEY` gates the voice-note hop and `transcribeAudio` returns `{ok:false}` with the
thread saying so rather than failing silently; `CLIENT_LINK_SECRET` is unset, so `clientPreviewUrl`
returns null and the cards print "No shareable link could be minted" rather than a dead URL; and
`nap_sweep` reads "18 of 19 seeded" until the step is un-ticked to pick up the Trustpilot row,
which its own refusal already says.

### SLACK IS INTERNAL ONLY (2026-08-20)
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
(`clients.ops_thread_ts`, now the PINNED HEADER) and `#alerts-infra` all STAY. Those were always
internal and they are the point. `ops_checklist_ts` is kept but no longer written, see below.

### Client-facing messages are DRAFTS, and nothing can send them
`client-drafts.ts` posts a draft into the ops thread with a `wa.me` link on it; a human
taps it. **The free WhatsApp Business app has no API, so there is no send path and no code
that pretends otherwise.** Do not reach for the WhatsApp Business Platform API to get
around it: Meta begins billing service messages 2026-10-01 and the free app being
unaffected is the entire reason for this design. `sent_at` is stamped by the *Mark sent*
button, i.e. by a person reporting what they did.

- **Copy lives in `src/config/client-messages.ts` and nothing else does.** Six entries,
  `guard()`-wrapped, **all six written 2026-08-20**. `isUnwritten()` still makes a `TODO:`
  placeholder **refuse to post as a message** — it posts a note naming the key to write
  instead, so a seventh draft added later cannot go out unwritten. An unwritten draft must be
  impossible to send by accident and impossible to miss.
  Plain text, because WhatsApp renders `*` as bold and a leading hyphen as a literal one.
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

There is no separate WhatsApp number and there must not be one: one number, asked once.

**Closed across the inbound funnels 2026-08-20.** `normalizeLeadPhone()` in `src/lib/phone.ts`
is the one door: strict E.164 via `medspa/validate`, falling back to the digits as given so a
funnel can never DROP a number it captured. `leads/funnel`, `audit/public-intake`,
`leads/facebook`, `leads/capture`, `start-pilot` and `ingestLead` all go through it instead of
`.replace(/[^\d+]/g, "")`, which only ever stripped punctuation.

> ‼️ **Normalizing at the door was only half of it.** `findContact` matched `phone.eq` /
> `mobile_phone.eq` on the exact string, so it fixed nothing already stored in three shapes. It
> now matches the `phone_last10` / `mobile_last10` generated columns
> (`docs/2026-06-04-contacts-phone-last10.sql`), which five other lookups in this app were
> already using. That is the half that collapses the history.

> ‼️ `src/lib/phone.ts` exports **two** normalizers and the loose one stays. `normalizePhone`
> accepts any 11+ digits as `+<digits>` because iMessage hands it real international handles.
> `normalizeLeadPhone` is for anything a PERSON TYPED, where `+12345678901234` is a typo rather
> than a number. Do not consolidate them into one.

**The live-format half needs the other repo.** `/PDF`, `/aivisibility`, `/contact` and the quiz
funnels are front-ended by `srt-agwb`, so only their receiving routes could be fixed from here.
That is enough to protect storage and the CRM whatever the static site posts.
`webflow-aivisibility` was the one in-repo form still missing `formatPhoneUS`.

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

> ‼️ **`clients.subdomain` IS THE LABEL, and it was the full host until 2026-08-20.**
> `chooseSubdomain` wrote `learn.clinic.com` while `seedDnsRecords` and `baseVars` both read it
> as a label, so the panel's Host box said `learn.clinic.com` for the registrar to append the
> domain to, and the DNS ask read `learn.clinic.com.clinic.com` out to the client. The trap
> documented one line above, reproduced in the code that documents it.
>
> Read it through `subdomainLabel(subdomain, domain)` (`clients/normalize.ts`), never raw: it
> strips a trailing domain, so rows written before the fix need no migration. The client board
> is the one place that wants the full host and composes it. `seedDnsRecords` also repairs a
> host that no longer matches the convention, clearing `verified_at` with it, because
> `ignoreDuplicates` would otherwise preserve a wrong host forever and a verification is a
> statement about one specific name.
- TXT answers are joined before comparing: >255-char verification strings arrive chunked.

> ‼️ **THE TXT ROW USUALLY HAS NO EXPECTED VALUE, AND THAT IS NORMAL, NOT A GAP** (2026-08-22).
> When the registrar is a Google partner (GoDaddy is), Search Console verifies through "Domain
> name provider" and **writes the TXT record itself**. Nobody ever sees the string, so nobody
> pastes it into the panel, so `value` stays null — and `checkRecord` used to return `pending` at
> its first line without issuing a query at all. The row sat there forever while verification had
> succeeded weeks earlier, `allVerified()` could never be true, and the Hub strip never reached
> 3 of 3. Nothing looked broken, which is what made it expensive.
>
> With nothing to compare against, the SHAPE is the evidence: a live `google-site-verification=`
> answer means Google verified it. `checkExternalTxt` reports it `verified` and returns
> `learnedValue`, which `recheckDnsRecords` writes **only onto a row whose `value` is still null**,
> so a human-entered value stays authoritative. Once learned, the next pass takes the ordinary
> exact-compare branch and still verifies, because the stored string is the one the resolver
> returned — the two paths agree by construction.
>
> **An absent verification record is `pending`, never `mismatch`.** Nothing was ever claimed for
> that row, so there is nothing to disagree with. Same doctrine as the not_found rule.
>
> **NOT extended to CNAMEs, and that is the regression to guard.** There is no correct *shape* for
> a CNAME, only the specific per-domain target Vercel issued, so a "looks like a CNAME" check
> would tick green on a record pointing at somebody else's project. Case 5 of
> `scripts/_probe-dns-txt.ts` exists for exactly that and must not be deleted.
>
> The probe's live half falls back to 8.8.8.8: under a sandbox `dns.getServers()` reads
> `127.0.0.1` and every query is ECONNREFUSED, which is correctly reported as `not_found` and
> correctly not stored, and also proves nothing. Vercel's lambdas resolve normally.
- `resolveDnsProvider()` reads the nameservers to name the registrar, because "who is your
  domain with" is a question many owners genuinely cannot answer. Unknown NS returns
  `provider: null` with the nameservers still populated — a real answer, not a guess.
- A resolver that is DOWN reports `not_found` like an absent record, and `not_found` is never
  stored, so an outage quietly changes nothing rather than writing a wrong status. Verified
  against SRT's own domain: with no working resolver every record reads `not_found`; pointed at
  a real one, the live Search Console TXT reads `verified` and both CNAMEs read `not_found`.
- `HUB_CNAME_TARGET` is a **default, not a truth**: Vercel issues per-domain targets for
  newer projects, so correct it per record from the Vercel dashboard.

### The audit gates the call
`headerText` (step-board.ts) warns when `call_booked`/`call_held` is ticked while `baseline_scan`
or `findings_doc` is not. The call is where the screenshots and the avatar decision come from,
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

## The client hub (2026-08-18) — `learn.{clientdomain}` and `reviews.{clientdomain}`
`src/lib/hub/*`, `src/app/hub/[host]/*`, `src/middleware.ts`. Migration:
`docs/2026-08-18-client-hub.sql` (`client_hosts`, `client_pages`, `review_tool_submissions`).

This is what `subdomain_live` was waiting for. Before it, `chooseSubdomain` picked a label,
`seedDnsRecords` wrote a `cname_hub` row and the `ask_dns` draft read the hostname down the
phone — and then nothing served it, so the record could never resolve and delivery step 13
could not be completed for anybody. ONE multi-tenant surface inside Mission Control, not a
Vercel project per client.

### The security boundary is `src/middleware.ts` and it is the most dangerous file here
`learn.aclinic.com` is a hostname whose DNS **the client controls**, answering on the same
deployment as the internal CRM. Middleware decides **host, then path, then session** and never
the reverse.

- **DENY BY DEFAULT, as an allowlist of hub paths.** Not a denylist of internal ones. The real
  exposure was never `/dashboard`: `/api/scan/*`, `/api/leads/funnel`, `/api/onboarding/save`
  and `/api/clients/start` are **public by design and take no session**, so on a
  client-controlled hostname a denylist that missed one is a lead-injection endpoint and a
  40-model-call spend faucet. A new `/api` route added next month is refused without anyone
  remembering to think about it.
- **404, never 401/403 and never a redirect.** A 403 confirms the route exists; a redirect to
  `/login` from a host the client's DNS controls is both an open-redirect primitive and a
  genuine SRT login form on a domain their staff recognise.
- `classifyHost()` (`src/lib/hub/host-classify.ts`) is pure, edge-safe and imports nothing, so
  the one thing standing between a client's DNS zone and the CRM fits on a screen and is
  testable without a database. **No Host header fails closed to external.**
- `*.vercel.app` is classified INTERNAL deliberately. TLS there is on `*.vercel.app`, so the
  inner Host header is caller-controlled; making it internal means spoofing
  `Host: learn.x.com` at a deployment URL buys a 404 rather than a choice of branch. It does
  not make deployment URLs safe — they already serve the whole app to anyone holding one.
  **Turn on Vercel Deployment Protection.**
- **`x-hub-host` is stripped on internal hosts.** It is set by the external branch and is the
  review submit route's only statement of which client it is writing for, so a request
  hand-crafted against `mission.srtagency.com` must not be able to forge it.
- Middleware does **no database work**. Host CLASSIFICATION is string work; host RESOLUTION is
  `resolveHost()` on Node behind a cache.

> ‼️ **Middleware is a layer, never the only one.** Every `/api/clients/*` route still calls
> `auth()` itself. CVE-2025-29927 let a caller skip middleware entirely via
> `x-middleware-subrequest` (fixed in 14.2.25; this repo is on 14.2.28) and is the standing
> argument for why.

### ‼️ `public/robots.txt` is DELETED, and that is the whole product
It said `Disallow: /` to `User-agent: *` **and to GPTBot, OAI-SearchBot, PerplexityBot,
ClaudeBot, Claude-SearchBot, Google-Extended, CCBot, Bytespider and meta-externalagent by
name** — correct for an internal tool. A file in `public/` is served for **every hostname the
deployment answers for**, so the moment `learn.aclinic.com` resolved it would have handed that
file to exactly the crawlers the client is paying to be found by. The hub would have rendered
perfectly to a human and been worthless to a machine, which is the only failure mode that
matters here and the only one nobody would notice.

Its content moved verbatim to `src/app/robots.txt/route.ts` (internal host only). Hub hosts get
`src/app/hub/[host]/robots.txt/route.ts`. **Verify with a request, never by reading the code.**

Two smaller versions of the same trap: the root layout sets `robots: { index: false }` for the
whole app, so every hub page overrides it (the `src/app/scan/page.tsx` precedent, page metadata
beats layout metadata); and `src/components/providers.tsx` wraps everything in NextAuth's
`SessionProvider`. Two root layouts via top-level route groups is the clean fix and is deferred
— it means moving all eighteen route folders.

### The host is in the PATH, not a header
Middleware rewrites `learn.x.com/pricing` to `/hub/learn.x.com/pricing`. **Next's full-route
cache keys on the pathname**, so two clinics that both publish `/pricing` behind a header-based
lookup would share one cache entry and serve each other's page. The host segment is what keeps
them disjoint.

`client_hosts` rather than deriving from `domain` + `subdomain_convention`: derivation makes a
live, indexed client website depend on a string staying correct, and somebody fixing a typo on
the board would 404 a page Google has crawled. A row exists because
`POST /v10/projects/{id}/domains` returned 200 — what was ATTACHED, not what was intended, the
same split as `verified` versus `added` one layer down. It is also the Vercel ledger, so the
routing map and the attachment state cannot disagree.

> ‼️ **`resolveHost()` returns `unknown` on a MISS and THROWS on a FAILURE, and collapsing them
> is the expensive mistake.** A 404 served during a Supabase blip, on pages Google has already
> indexed, is how a client's hub gets quietly deindexed. A miss is 404; a throw reaches the
> error boundary and becomes a 5xx, which tells a crawler to come back.

No in-process Map in front of `unstable_cache`: a warm-lambda Map has no cross-instance
invalidation path, so a disabled host would keep serving from some regions for the life of the
container.

> ‼️ **Do not put `export const revalidate` on the robots / sitemap / llms route handlers.**
> That is a FULL-ROUTE cache and `revalidateTag()` does not reach it. Observed: publishing a
> page updated `llms.txt` and the hub index and left the sitemap serving a body generated
> before the page existed, from one shared query. The DB read inside `listPublished` is still
> cached and still tag-invalidated; `s-maxage` is what keeps load off the origin.

### `HUB_CNAME_TARGET` is a fallback, and now there is something that knows better
`src/lib/hub/vercel-domains.ts` — the first Vercel API call in this repo.
`GET /v9/projects/{id}/domains/{host}` first (idempotency: "already ours" and "somebody else's"
are different outcomes and a 409 does not separate them), then `POST /v10/...` to attach, then
`GET /v6/domains/{host}/config?projectIdOrName={id}` for `recommendedCNAME`, ranked, rank 1 wins.

Measured on this project: rank 1 is **`4fddd1b501fe6565.vercel-dns-017.com`**, not
`cname.vercel-dns.com`. The default would have been wrong for every client, and the DNS panel
would have sat at `added` forever with nothing visibly wrong.

- **Vercel returns a fully qualified name with the root dot.** Stripped once, on the way in.
  `checkRecord()` normalizes it away before comparing so a stored dot still verifies — the
  problem is the registrar's Value box and the person reading it back.
- **Env vars are `HUB_VERCEL_TOKEN` / `HUB_VERCEL_PROJECT_ID` / `HUB_VERCEL_TEAM_ID`.**
  Vercel RESERVES the `VERCEL_` prefix for its own system variables and refuses custom ones.
- **The status guard is the point.** The target is written only over `pending` / `ready`. Once
  a row is `added`, `verified` or `mismatch`, a human or the resolver has spoken and a refresh
  must not overwrite that; a changed recommendation goes in `note` and the green tick is left
  alone rather than silently becoming a lie.
- **No second status vocabulary.** Vercel's `misconfigured` before propagation is the same fact
  the panel already models between `added` and `verified`. It is stored on `client_hosts` as
  context and rendered as words, never as a sixth status. SSL issues itself once the CNAME
  resolves, so there is nothing to model for it.
- `seedDnsRecords`'s repair pass now clears `value` and `note` along with the host. Per-domain
  targets mean a `learn` to `guide` flip changes which target is correct, and the old one
  behind a freshly reset `ready` label is a value that resolves to nothing.

### Pages, and the bug this surfaced
`client_pages`, rendered on request with the DB read cached per client. `question` is stored
**verbatim** rather than referenced: `audit_reports.prompts` is regenerated by every run, so a
reference would let the next audit turn a published page into the answer to a question nobody
asked.

Indexability is v1, not polish: `index, follow`, a canonical on the client host, per-host
`sitemap.xml` and `llms.txt`, `LocalBusiness` on the index and `QAPage` per page. (QAPage, not
FAQPage — Google restricted FAQPage rich results in 2023 and a page answering one question is a
QAPage by definition.) `react-markdown` runs **without `rehype-raw`**, deliberately: a body is
typed into a form and served on the client's own domain under their name, so a paste carrying a
`<script>` would be an XSS on their site.

**Nothing generates page copy.** The board offers the twenty questions the audit actually ran
and a person writes the answer.

> ‼️ **`notify_first_page` was posting with no link in it.** `offerDraftsFor` called
> `postDraft(clientId, notify.key)` with no vars, and that draft's copy is "the first page is
> up:" followed by `{pageUrl}` on its own line, so `fill()` blanked the token and tidied the
> gap. The client was told a page was live and given nothing to click. `notifyVars()` derives
> it from the newest published page; it returns nothing rather than linking the hub index when
> the step was ticked before anything was published.

### `reviews.{domain}` — a mirror, not a ghostwriter
`docs/specs/SRT-Review-Tool-BUILD-SPEC-v2.md`. The host resolves through the same
`client_hosts` row with `kind = 'reviews'`, so the QR on the printed cards is live from the
moment the domain is attached.

- **No model in the path.** Not for drafting, not for cleanup, not for tone, not for spelling.
  `src/lib/hub/review-assemble.ts` imports nothing. FTC 16 CFR Part 465: a tool that GENERATES
  review content its user did not write is the regulated thing; one that REFORMATS what she
  typed is not. This repo has a Claude call in nearly every other feature and the reflex will
  be to add one here.
- **On screen labelled, in the copy buffer not.** `assembleLabelled` and `assemblePlain` are
  separate functions and not derived from each other, so a refactor cannot merge them. The
  labels are ours; the sentences are hers, and what reaches Google contains no SRT-authored
  text at all.
- **No staff field anywhere**, and no sentiment scale, no rating, no gating, no incentive.
- `review_tool_submissions` has **no column for a name, email, phone, IP, user agent or session
  id**, and the absence of the column is the enforcement: a route cannot store what there is
  nowhere to put. It also forecloses IP rate limiting, so the cap is a per-client daily count
  read back from the table. **The submit route must never read `x-forwarded-for`.**
- Spanish is NOT machine-translated here. The spec requires a native speaker precisely because
  a translated sentiment-neutral question can land as a leading one, so the tool says so in
  Spanish and renders English until reviewed copy exists.

### ‼️ The Day 0 wall — the one place this repo BLOCKS instead of flagging
`src/lib/clients/day-zero.ts`, migration `docs/2026-08-18-client-hub.sql`'s successor
`docs/2026-08-18-day-zero-wall.sql`. Canon: Runner v3's single hard rail, `docs/specs/`.

`page_publish` refuses while `clients.day_0_archived_at` is NULL. Everything else on the
delivery checklist warns and gets out of the way — `delivery-checklist.ts` says so twice, at the
Measure gate and at the market check: *"a checklist that refused would just get worked around."*
That reasoning is right for a call booked early, which costs the person who booked it. It is
wrong here, because what is protected is the **baseline the day 30/60/90 numbers are measured
against**, and once a page is live that baseline cannot be recovered by being careful afterwards.

- **The check goes BEFORE `setPublished`, and that ordering is the point.** Publishing is not one
  write: it flips `client_pages.status`, then `autoCompleteStep('first_page')` ticks a delivery
  step, refreshes the Slack checklist, posts a thread reply and **inserts a `client_messages` row
  telling the client their page is live**. A gate after any of that has already told the client
  something that should not have happened.
- **Unpublishing is never gated.** Taking a page down is the remedy, not the harm.
- **`day_0_source` is the honest column.** `photograph_2` means a real archived run wrote it and
  **nothing writes that today** — one engine is keyed and A2 `D-P16` says a one-engine run is
  never a photograph for a pilot client. `manual_step` means a human ticked the box, which is an
  *assertion* that the archive happened, not evidence of it. No artifact may call a `manual_step`
  stamp a photograph.
- **The waiver is a door, not a bypass.** `waiveDay0()` needs a reason of real length (a CHECK
  constraint enforces non-empty, the function enforces a sentence), records who, and posts to
  `#alerts-infra`. The board only offers it *after* a publish has been refused — offering it
  beside Publish would make it a second button, which is the same as having no wall.
- **Un-ticking clears only a `manual_step` stamp.** A mis-click must not erase a waiver somebody
  signed their name to, or deny a `photograph_2` a real run wrote.
- **`day-zero.ts` must never import `delivery-checklist.ts`.** The dependency runs one way:
  delivery-checklist calls `stampDay0()`, so `DAY_ZERO_STEP_KEY` lives in day-zero and is imported
  *from* there. Reversing it makes a cycle and one module sees the other half-initialised.
- **The hole check is a grep.** `GATED` and `NOT_GATED` in `day-zero.ts` list every write path and
  why. `setPublished` has exactly one caller and it is gated; verify with
  `grep -rn "setPublished" src/`.

### Evidence and the quality gate (2026-08-26) — the SECOND rail
`src/lib/clients/page-evidence.ts`, `src/lib/hub/page-gate.ts`. Migration:
`docs/2026-08-26-evidence-and-gate.sql` (`page_sources`, `page_gate_runs`,
`client_pages.evidence_map`, `page_studio_sessions.studio_mode` + `evidence_topic`).

`client_pages` held `answer_md` and nothing else, so the system could not say where any sentence
came from, and `draft-page.ts` fetched the client's website live and threw the crawl away. There
was no check between a draft and a live page on a domain the client controls beyond one person
reading it.

> ‼️ **THIS IS A SECOND HARD RAIL AND THE LINE ABOVE ABOUT "the one place it blocks" IS NOW
> HISTORY.** Matthew reversed it on 2026-08-26 and chose the shape: **block on evidence, warn on
> style**. What did NOT change is the half of the original objection that was really about
> workflow: **no fourth `client_pages.status` value exists.** Adding one is still refused.

- **The two tiers, and the line is not taste.** BLOCK covers what can be WRONG on somebody else's
  domain: `no_evidence`, `unbacked_claims`, `orphan_numbers`, `duplicate`, `answers_the_question`,
  `unsupported`. WARN covers what can be WEAK: `thin`, `generic`, `keyword_shaped`,
  `first_party_ratio`, `house_style`. **A gate that blocks on taste gets waived out of habit
  inside a fortnight**, and a rail everybody steps over is worse than none because it looks like
  one.
- **`body_hash` is the whole reliability of the gate.** A verdict describes the body it read.
  `assertGatePassed` re-hashes the CURRENT `answer_md` and refuses a mismatch with "the page
  changed", never honours it. Whitespace is normalised so re-wrapping keeps a verdict and changing
  a word does not. Three distinct refusals — `never_run`, `stale`, `blocked` — because they send
  a person to three different places, and **only `blocked` is waivable**: offering a waiver for
  "press Check" teaches people to skip a free fix.
- **A waiver is a verdict row, not a flag.** `waiveGate` inserts into `page_gate_runs` carrying
  the hash of the text it waived, so **it goes stale the moment the page is edited**, exactly as a
  pass does. A boolean on `client_pages` would survive a rewrite and license publishing something
  nobody looked at.
- **A null `evidence_map` is a SKIP, not a failure**, and this is the most important line in
  `page-gate.ts`. A page dictated straight into the body by the person who does the work has no
  map because no model wrote it. That is the BEST case this product has. Blocking it for missing
  a machine-generated field would punish exactly the behaviour the lane exists to encourage.
- **A changed body drops the map.** `savePage` and `appendPageBody` both null `evidence_map` when
  `answer_md` actually changes and the caller sent no new map, because a map that no longer
  matches would keep `unbacked_claims` passing on text it never described. `undefined` and `null`
  therefore mean different things in `SavePageInput`: undefined leaves the stored map alone (a
  title edit), null clears it.
- **Dictation into the body is ALSO filed as a source.** Without that row the gate reads a page
  dictated by the provider as a page with nothing behind it: `orphan_numbers` would refuse a price
  he said out loud. `answer_md` holds the words; `page_sources` holds where they came from.
- **`page_id IS NULL` is the client library, not an orphan row.** Pricing, policies,
  qualifications and their customers' own terminology are dictated once and ground every later
  page. Nothing may clean those up.
- **`AI_DERIVED` is not evidence.** It records the ABSENCE of backing so the gate can count it.
  `isFirstParty()` is the one definition and every consumer imports it.
- **`numberEvidence()` exists exactly once.** The drafter writes `sourceRef: "S3"` into
  `evidence_map` and the gate reads it back weeks later. Two numbering schemes would make every
  stored ref point at a different source than the one it was written against, and
  `first_party_ratio` would be measuring nothing.
- **A dangling ref fails validation.** An invented `S9` is worse than a null: null is a claim
  marked unsupported, a bad ref is an unsupported claim wearing a citation. It goes into
  `callClaudeJSON`'s correction retry, same as the em dash rule.
- **A failed model read-through is a SKIP.** Passing would let an API outage publish anything;
  blocking would make every page unpublishable on a check that never ran.
- **The column is `studio_mode`, never `mode`.** `mode` is a Postgres ordered-set aggregate, and a
  PostgREST select naming a bare `mode` resolves to the aggregate when the column is absent,
  failing with "WITHIN GROUP is required for ordered-set aggregate mode" — an error naming neither
  the table nor the column. Observed on this table before the column existed.
- **The hole check, same shape as the wall above:** `grep -rn "assertGatePassed" src/` must match
  `GATED` in `page-gate.ts`, and `grep -rn "setPublished" src/` must still return exactly one
  caller. If the second ever returns two, both rails have a hole at once.
- **The page studio gained `ask`, `next`/`skip`, `body`, `draft` and `check`.** `ask` walks
  `EVIDENCE_TOPICS`: page-scoped questions first while the claimed question is still what he is
  thinking about, client-scoped ones after and skippable. `draft` and `polish` stay separate on
  purpose — `polish` tidies HIS words and may add nothing, `draft` writes from the evidence and
  must say what each claim rests on. One command guessing which job it is on would sometimes
  rewrite a dictated page it was only meant to tidy.
- Probe: `bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts` (add `--model` for the
  read-through). It creates a throwaway page, asserts four verdicts, and deletes it in `finally`.

### Env
```
HUB_VERCEL_TOKEN=            # Vercel API token. NOT VERCEL_* — that prefix is reserved.
HUB_VERCEL_PROJECT_ID=       # prj_... from .vercel/project.json
HUB_VERCEL_TEAM_ID=          # team_... (stored as orgId in .vercel/project.json)
INTERNAL_HOSTS=              # Optional. Extra hostnames that serve Mission Control itself.
                             # NEXT_PUBLIC_APP_URL's host and *.vercel.app are already internal.
                             # EVERYTHING NOT LISTED IS TREATED AS A CLIENT HOST, so a missing
                             # entry breaks /dashboard loudly rather than exposing it quietly.
```

> ‼️ **ORDER OF OPERATIONS: do not add the client's CNAME before this branch is on `main`.**
> Attaching a domain points it at the PRODUCTION deployment. Until the hub code is in
> production, a resolving `learn.{clientdomain}` would serve Mission Control's own app on a
> hostname the client controls. Attaching alone is harmless — nothing resolves without the DNS
> record — so attach early, and add the record after the deploy.

## The scraper lane (2026-08-27) — `#srt-sub`, renaming to `#srt-scraper`
`src/lib/scraper/*`, `src/app/api/cron/scraper-tick`. Migration:
`docs/2026-08-27-scraper-lane.sql` (`scraper_batches`, `scraper_rows`).

Drop an Apollo export in the channel and it comes back filtered: `clean.csv`, `junk.csv` with a
`reason` column, the counts and the junk breakdown, and the survivors sent to MillionVerifier.
It replaces running `apollo_prefilter.py` by hand on the Desktop. Same six checks in the same
order, cheapest first, so the expensive DNS step only ever sees survivors:

| # | reason | |
|---|---|---|
| 1 | `no_email` | blank cell |
| 2 | `duplicate_in_file` | **new**, see below |
| 3 | `already_in_crm` | `outreach_prospects.email` |
| 4 | `bad_syntax` | |
| 5 | `role_account` | `ROLE_PATTERN`, ported verbatim |
| 6 | `disposable_domain` | `src/data/disposable-domains.ts` |
| 7 | `no_mx` | resolved in its own pass |

**`duplicate_in_file` is the one check the Python does not have.** Apollo repeats addresses across
pages of one export and MillionVerifier bills per row, so paying twice for one address is a live
cost rather than a tidiness point. The FIRST occurrence survives.

**Dedup is a live query, not `crm_hashes.txt`.** The script's dedup source was a text file that had
to be re-exported to stay honest and went stale the day it was written. `outreach_prospects` is the
follow-up operator's own table, so "already contacted" is read rather than remembered.

> ‼️ **THE STAGE MACHINE IS THE POINT, NOT DECORATION.** A batch walks
> `parsing -> mx -> filtered -> verifying -> done`, and every stage is re-enterable, because the
> two slow steps outlive a serverless invocation in opposite ways: the MX sweep is thousands of our
> own DNS lookups, and MillionVerifier runs on somebody else's queue for minutes to hours. A
> one-pass design fails by **silently truncating** — a smaller `clean.csv` and nothing saying which
> leads were never asked about. `advanceBatch` is called from the drop, so a small file finishes in
> one shot, and from the 5-minute cron, so a big one finishes at all.

> ‼️ **"COULD NOT LOOK" AND "NOTHING IS THERE" ARE DIFFERENT ANSWERS, and the MX step is the one
> place that can confuse them at scale.** The Python caught bare `Exception` and recorded every
> failure as `no_mx`, so a resolver hiccup on a cold start junks a batch of good leads with no
> trace. `MxVerdict` is tri-state: NXDOMAIN and NODATA are real noes; SERVFAIL, ETIMEOUT and
> friends are a failure to ASK and go to Cloudflare DoH before anyone may say no. A domain neither
> path could resolve stays `mx_ok = null` and the next tick asks again. Same doctrine as
> `dns-records.ts`: an absent answer from a broken resolver is never stored.

> ‼️ **COUNTING MX RECORDS IS NOT ENOUGH, AND `example.com` IS THE PROOF.** The Python asked
> `len(answers) > 0`, and an RFC 7505 null MX (a single record whose exchange is the root) is one
> answer — so the strongest "do not email us" signal on the internet read as "has a mail server".
> Parked domains and holding companies publish these, which is exactly what an Apollo pull is full
> of, and every one would have survived the filter and then been paid for. `isNullMx` in `mx.ts`,
> checked on both the resolver and the DoH path.

> ‼️ **MILLIONVERIFIER IS THE ONLY THING IN THIS LANE THAT SPENDS MONEY**, billed per address
> UPLOADED, not per address that comes back OK. So **THE UPLOAD IS NEVER AUTOMATIC, AT ANY SIZE.**
> Layer 1 finishes, `clean.csv` and `junk.csv` go up, and the batch parks in `filtered` behind a
> card carrying the count. Nothing is sent until a human reacts ✅ on that card.
>
> It was a size threshold for one day (`SCRAPER_MV_MAX_EMAILS`, default 25,000, gate above it and
> send below it) and Matthew reversed it on 2026-08-27. The reasoning is worth keeping: the whole
> point of layer 1 is a list somebody READS before layer 2 is paid for, and a threshold means the
> small runs, which is most of them, get spent before anyone has opened the file. **A gate that
> only fires on the unusual case is not a review step, it is a tripwire.** The env var is deleted
> rather than left inert, because a knob that no longer does anything is the same "reader with no
> writer" class of bug this file records five other instances of.
>
> Two guards sit underneath it: no key degrades to "here is clean.csv, upload it yourself" rather
> than throwing, and the upload is guarded by `mv_file_id` already being set, so a retried tick
> cannot buy the same list twice. `filter=all` is downloaded before `ok`, so an `invalid` verdict
> is recorded too, which is the most useful thing the lane learns.
>
> A batch nobody approves parks forever, and that is correct rather than a leak: approval can come
> days later, and the two guards in `publishResults` mean a cron re-entry every five minutes does
> nothing but re-read one row.

**Two Slack traps this lane sits on, both already documented elsewhere in this file and both live
here:** a CSV drop fires BOTH `file_shared` and a `message` with subtype `file_share`, so the
channel is in `handleFileShared`'s early-return list or one upload starts two batches and two
bills; and `slack.uploadFile` returns `{ok:false}` rather than throwing, and its share silently
no-ops when the bot is not a member, so `joinChannel` runs first and a failure is named in the
thread rather than leaving a confident summary with no file under it.

**The email column is resolved, not hardcoded.** The Python's constant was `"email"` and Apollo
exports `Email`, so the script's own default was wrong for its own stated input. A miss NAMES THE
HEADERS IT FOUND rather than throwing a message nobody can act on.

**No IDNA.** A non-ASCII domain is rejected as `bad_syntax` rather than punycoded. Right for a US
B2B pull, wrong for a list that is not, and stated in `rules.ts` rather than discovered. If that
day comes the fix is a punycode pass, NOT loosening the label check.

**The disposable list is CHECKED IN** (`src/data/disposable-domains.ts`, 8,368 domains), not
fetched at runtime: a runtime fetch makes the verdict depend on GitHub being reachable from a
lambda, and it fails SILENTLY, letting every disposable address through on the one step whose job
is to reject them. Checked in it can only go stale, which is visible. `bun run scraper:disposable`
refreshes it; monthly, same as the original note said.

**`tip_index` was considered and dropped** (Matthew's call, 2026-08-27). The idea was to hash the
company name to an integer in the pre-processing step so which email angle a company gets is
reproducible across runs and models rather than trusted to an LLM. The reasoning is sound and the
blocker is that no list of angles exists and nothing consumes the number. It is a pure function
over the company column when it is wanted, and needs no schema change.

Probe: `bunx tsx scripts/_probe-scraper.ts` (71 checks, no network, no DB, no Slack; `--mx` adds
three real lookups). It is the file that answers "is the port faithful to the Python", which is
why `filter.ts` and `rules.ts` are pure and stop before the resolver.

### Env
```
SLACK_SCRAPER_CHANNEL=       # C0AJXH7PTBM. The ID survives the rename to #srt-scraper.
MILLIONVERIFIER_API_KEY=     # Unset is HANDLED: it filters and posts clean.csv, it just does not verify.
# No size threshold exists. Every batch waits for a ✅ on its results card, at any size.
```

## Two workflows in the scraper lane, and a picker in front of both (2026-08-28)
`src/lib/scraper/{score,dataforseo}.ts`. Migration: `docs/2026-08-28-scraper-score-lane.sql`.

The lane assumed every file dropped in `#srt-scraper` was a contact list. A company list with no
contacts yet needs the opposite treatment first: score each business on how strong its presence
already is, throw away the ones already winning, and only pay Apollo to reveal contacts for the
invisible remainder. A CSV alone cannot tell you which of the two you have, so the drop stops
deciding and asks.

```
awaiting_workflow
  ├─1️⃣→ parsing → mx → filtered → [✅] → verifying → done
  └─2️⃣→ scoring → scored → [1️⃣2️⃣3️⃣ or free text] → [✅ confirm] → awaiting_apollo_export
            └─ Apollo export dropped in the thread → child batch → parsing → (rejoins above)
```

> ‼️ **THE PICKER IS UNCONDITIONAL AND IS NEVER AUTO-RESOLVED.** The card READS the headers and says
> what it sees ("no email column in this file, so 2️⃣ is probably it"). It does not act on that.
> Exactly the call Matthew made one day earlier when the MillionVerifier size threshold came out: a
> gate that only fires on the ambiguous case is a tripwire, not a review step.

**Column requirements are per workflow and are checked AFTER the pick.** Workflow A needs an email
column, B needs a company column, and `city` / `website` are optional in B. Checking at the drop is
what would kill a company list on "no email column" before anybody could choose 2️⃣.

**The drop stores headers and a file id and nothing else.** `startBatch` no longer resolves a column
or inserts a row; the pick re-reads the file through `slack.filesInfo`. One extra Slack download
buys two things: 50k rows are not inserted for a workflow that may never be chosen, and workflow A's
body is the old `startBatch` tail unchanged, so `_probe-scraper.ts`'s 71 checks still prove the port
is faithful to the Python.

> ‼️ **A TOP-LEVEL DROP IS NEW; A THREADED DROP BELONGS TO ITS BATCH.** A CSV replied into a thread
> whose batch is at `awaiting_apollo_export` IS that batch's Apollo export: it stamps
> `apollo_export_file_id`, and a **child batch** (`parent_batch_id`, same `slack_thread_ts`) goes
> straight into workflow A with no picker. A thread at any other status is told so and nothing
> happens. A child rather than a reuse because `scraper_rows` is keyed `(batch_id, row_index)` and
> the export's indices collide with the scored companies', so reuse would either overwrite the score
> audit trail or need an offset nobody could read later. Two rows in the table, one thread on screen.

### DataForSEO: the standard queue, polled by the cron that already exists
Verified against their docs on 2026-08-28 rather than assumed: **standard $0.0006/SERP, 100 tasks
per POST, ~5 min**; priority $0.0012; **Live Advanced $0.002 and one task per call**. Standard was
Matthew's call, and it fits: the lane already owns a resumable stage machine and a 5-minute cron.

> ‼️ **CHARGED AT `task_post`, NEVER AT `task_get`.** Results are free to collect for 30 days. Three
> guards follow and all three are load-bearing: `DATAFORSEO_MAX_QUERIES_PER_BATCH` (default 1000) is
> checked BEFORE the first POST and **refuses with the count** rather than scoring half a file, since
> a partially scored ranking is missing its bottom and the bottom is the pile that gets scraped; a
> task is posted only for a row whose `dataforseo_task_id` is still null, the same shape as
> `mv_file_id`, so a retried tick cannot buy the same list twice; and the per-task `cost` is summed
> onto `score_cost_usd`, so spend is RECORDED rather than estimated.

> ‼️ **`tasks_ready` IS DELIBERATELY NOT USED.** It is an account-wide collect-once queue, so a task
> collected by anything else is a company that silently never scores with the money already gone.
> `task_get` by the stored id is free, authoritative, and has no account-wide coupling. An unfinished
> task answers `40602 Task In Queue`, which is a clean "not ready" rather than an error — and
> "still queued" and "this task failed" must never collapse into one answer, or a pending SERP that
> was already paid for gets abandoned.

Every task carries `tag = scraper_rows.id` and DataForSEO echoes it, so `postTasks` matches results
**by tag and never by array position**: position is not contractual and a silent off-by-one files
every SERP against the wrong company. Retries are on **5xx and transport failures only** — a 4xx is
our request being wrong and repeating it just burns the rate limit.

### The score, and the denominator
`score.ts` is **pure and network-free**, the same split that lets `rules.ts` and `filter.ts` be
proved offline. It has to be: this number decides who gets deleted from a list.

| component | weight | attempted when |
|---|---|---|
| `knowledge_graph` present | 20 | any SERP came back |
| GBP review count, normalized to a 500 ceiling | 25 | a knowledge_graph or local_pack was found |
| rating ≥ 4.0 | 10 | a rating value was found |
| own domain is #1 organic for the brand name | 15 | `website` is on the row |
| directory citations in the top 10, 3 each, capped at 30 | 30 | organic results came back |
| Instagram in the top 5 with a parseable follower count | 15 | an instagram.com profile is in the top 5 |

> ‼️ **A COMPONENT THAT COULD NOT BE MEASURED LEAVES THE DENOMINATOR. IT DOES NOT SCORE ZERO.** The
> score is `earned / attempted` rescaled to 0-100, never `earned / 100`. If unmeasured weights simply
> vanished from a fixed total, a business nobody could measure would rank as *less dominant* than one
> that was, and the whole file is sorted by that number to decide who gets deleted. Same class as the
> `MxVerdict` tri-state in `mx.ts` and `site_signals` in the audit engine.

Three splits carry the rule and none may be collapsed:
- **No website makes `own_domain` UNMEASURED, not failed.** Nobody entered that contest.
- **No Instagram in the top 5 is a MEASURED absence** and earns zero, because that is a real finding
  about their presence. **A profile that IS there whose follower count will not parse is UNMEASURED**,
  because we know they have one and cannot say how big. The probe asserts the two produce different
  scores off the same organic block. `parseFollowerCount` returns null rather than guessing, and it
  is case-insensitive: Google writes "1,204 Followers" as often as "12.3K followers", and a capital
  F silently returning null marked a real profile as unmeasured until the probe caught it.
- **A profile block with no rating on it is a measured zero** (Google knows them and has nothing to
  show); **no profile block at all is unmeasured**.

`attempted === 0` leaves `dominance_score` NULL and the next tick asks again. A directory host seen
twice counts **once**, or a business with three Yelp pages looks three times as established.

> ‼️ **DO NOT HARDCODE A VERTICAL IN THE QUERY.** `"{company} med spa {city}"` bakes one vertical into
> a lane that is otherwise vertical-agnostic and the next vertical scores silently wrong instead of
> failing; the audit engine holds the same line. Resolution is the drop caption's `{company}`
> template, then `SCRAPER_DEFAULT_SCORE_QUERY`, then `"{company} {city}"`. The neutral fallback is
> not merely safe, it is **more correct**: four of the six components are brand-name signals, and a
> category term is exactly what makes "ranks #1 for its own name" stop meaning anything.

### One file, most popular first
`scored.csv` is sorted **descending**. Rank 1 is the biggest operator; the barely-visible ones are at
the bottom. Unmeasured rows sit last with a **blank rank**, never the next number.

> ‼️ **THE SORT DIRECTION IS WHAT MAKES THE CUTOFF UNAMBIGUOUS AND IT IS NOT A PRESENTATION CHOICE.**
> Ascending, "drop the first 10" and the file disagree about what "first" means, and getting that
> backwards deletes exactly the invisible businesses this lane exists to find. Descending, the
> instruction and the row order are the same thing. **Do not flip it for readability.**

The cutoff card takes 1️⃣ / 2️⃣ / 3️⃣ (keep the bottom 30 / 50 / 70 percent) **and** free text, parsed
by a pure grammar in `score.ts`: `drop the first 10`, `drop 10`, `top 20%`, `bottom 30%`,
`score > 60`, `score < 40`, `keep 120`. Anything else is refused and the grammar is printed —
mechanical for the same reason `looksLikeCallNotes` is, and no model decides which leads get deleted.
`CUTOFF_GRAMMAR` is one string used by both the parser's help text and the refusal, so they cannot
drift. `drop the top 20%` reads as a percentage and never as 20 rows.

Then an echo card and one more ✅: *"Dropping rows 1 to 10: the 10 most dominant, scores 94 down to
71. 240 remain, 6 of them not measured."* The descending sort already removed the ambiguity, so this
survives as a **review** step rather than a disambiguation one: the count is the one number nobody
can recover afterwards.

> ‼️ **A PERCENTAGE IS A PERCENTAGE OF THE MEASURED ROWS**, or the cut depends on how many lookups
> happened to fail, which is not a fact about any business on the list. **The unmeasured always land
> in the KEPT pile** and an over-large drop is clamped to the measured head: scraping a company
> unnecessarily costs one Apollo credit, discarding one loses a lead.

### Two piles, and they are different shapes on purpose
The confirm posts **both**, never just the survivors. The split is the product.

| file | columns | for |
|---|---|---|
| `dominant.csv` | **the original headers verbatim**, plus `rank`, `dominance_score`, `score_measured` | the cold-email drafting project |
| `apollo_targets.csv` | `company`, `website` | the Apollo contact reveal |

> ‼️ **`dominant.csv` MUST NOT BE NARROWED TO company + website.** It is the INPUT to a separate
> project whose own step 1 qualifies on first name, verified email, website, city and state, and
> which of those the dropped file happens to carry is unknowable from inside this lane. It hands back
> every column that came in and lets the downstream gate print its own `no_email` reasons. Narrowing
> here is the failure `buildCleanCsv`'s header rule already documents, and downstream it would look
> like a lead problem rather than the plumbing problem it is. `apollo_targets.csv` stays two columns
> because it is a SEARCH INPUT, not a lead list; the two must not converge on one shape.

### The gate router
`handleScraperReaction` resolved a batch from `mv_approval_ts` alone. There are now **four** gate
cards in one thread meaning four different things, one of which spends money, so each has its own
`*_ts` column and `batchByGateTs` returns **which gate** was reacted to rather than letting the
handler infer it. Reaction names are the repo's existing `one` / `two` / `three` and
`white_check_mark`. **No reaction is pre-seeded**, matching the MillionVerifier card, so none of
drop-studio's bot-reaction-count filtering is needed.

`activeBatches` gains `awaiting_workflow`, `scoring` and `scored`. **`awaiting_apollo_export` is
deliberately absent**: it waits on a human uploading a file, so there is nothing to poll and listing
it would make the cron's worklist dishonest. The two gate statuses that ARE listed have their cards
guarded by their own `*_ts`, so a re-entry re-reads one row — and a card whose Slack post failed at
drop time gets posted on the next tick instead of the batch sitting silent forever. **The cron may
poll external work. It may never advance past a gate.**

**Not built: ReachInbox.** The endpoint is `POST api.reachinbox.ai/api/v1/campaigns/add-email` with a
Bearer token and a 5/sec limit, but the request body is not publicly documented and Matthew's call
was to skip it. The `reachinbox_*` columns and the `handed_off` / `awaiting_reachinbox` statuses were
in the original spec and are **deliberately not created**: they would be three columns and two
statuses with a reader and no writer, the same class this file records five other instances of, and
the same reasoning that deleted `SCRAPER_MV_MAX_EMAILS` rather than leaving it inert. Adding them
later is one `alter table`.

Probe: `bunx tsx scripts/_probe-score.ts` (91 checks, no key, no network, no DB). It proves the
weights, both unmeasured splits, the descending sort, every grammar row, the refusal, and that
`dominant.csv` keeps every original column while `apollo_targets.csv` keeps exactly two.

### Env
```
DATAFORSEO_LOGIN=                     # Unset is HANDLED: it still posts scored.csv, all rows "not measured".
DATAFORSEO_PASSWORD=
DATAFORSEO_MAX_QUERIES_PER_BATCH=     # Optional, default 1000 (~$0.60). Over it the batch REFUSES with the count.
SCRAPER_DEFAULT_SCORE_QUERY=          # Optional. Falls back to "{company} {city}". Never put a vertical in the code default.
```
