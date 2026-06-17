# SRT Mission Control - Phase 0 Prompt (Scan -> Plan -> Wireframes)

> **Do NOT write or modify code in this session.** Output is limited to a scan report,
> a product plan, a migration map, 15 UI wireframes, and a build-order doc. Building
> happens in a later session.

## Who you are
You are the lead architect/designer for **SRT Mission Control** (`mission.srtagency.com`),
the internal operating system replacing Zoho CRM for SRT Agency LLC, an AI-first MCA
(Merchant Cash Advance) brokerage in North Carolina. Mission Control becomes the **single
source of truth** for CRM, dialing, pipeline, funder comms, and call intelligence.

## Where things live (scan these paths)
- **App (active repo):** this repo, `srt-mission-control` (Next.js App Router, Supabase,
  deployed on Vercel). Scan `src/`, `app/` or `src/app/`, `components/`, `lib/`, `utils/`,
  `api/` routes, `hooks/`, `scripts/`, `supabase/`, `docs/`, `CLAUDE.md`, `BACKLOG.md`.
- **Auto-Dialer Chrome Extension:** `../SRT-Auto-Dialer-v41` (latest; prior versions
  v16-v40 exist for reference). Currently DOM-integrated with **Zoho** via RingCentral
  PhoneBridge. This is what gets remasterized to target Mission Control.
- **Live Call Coach prototype:** `../live call coach srt` (Deepgram + Claude objection overlay).
- **Mac iMessage / device bridge:** `mac-bridge/`.
- **Env:** `.env.local`, `.env.example`, `vercel.json` for all connected services.

## Tech stack
Next.js (App Router) on Vercel | Supabase (DB + Auth + Storage, source of truth) |
**Zoho CRM (being fully replaced)** | RingCentral (PhoneBridge + RingOut) | Microsoft 365
(`submissions@`, `underwriting@`) | Claude API (Anthropic) | Deepgram (real-time
transcription) | Meta Ads + CAPI.

---

## PHASE 0 - SCAN (do this first, before any planning)

Produce a complete inventory. Read the code; do not assume from memory.

**0A. Scan**
- Supabase: every migration, `schema.*`, generated types, table/column/type, relationships, RLS policies.
- Zoho integration files: every module (Leads, Contacts, Deals, etc.), every custom field,
  every pipeline stage, every automation/sync currently in use. **Flag what Zoho has that
  Supabase does NOT yet mirror**; Matthew is unsure how complete the mirror is.
- RingCentral: every API call, webhook, PhoneBridge message type, RingOut flow.
- Chrome extension (`SRT-Auto-Dialer-v41`): every feature, DOM interaction, PhoneBridge
  event, call state machine, and Zoho DOM read/write.
- Meta CAPI: every event and field passed; how leads are attributed today.
- Deepgram / Live Call Coach: current state.

**0B. Inventory report**, for each of: Supabase tables & fields | Zoho objects/fields/stages/automations |
RingCentral integration | Chrome extension | Meta CAPI | **Gaps** (anything in Zoho not yet in Supabase).

**0C. Migration map**, a markdown table `Zoho Field/Object -> Supabase Table/Column` for every
field to carry over; flag fields that don't exist in Supabase yet.

---

## PHASE 1 - PRODUCT PLAN

Spec all modules below. Flag gaps against the scan. This is a purpose-built MCA OS, not a Zoho clone.

### Module 1 - Contacts & Pipeline
Contact fields: business name, owner name, phone(s), email, address, **time zone (auto from
state/zip)**, industry/vertical, lead source (Meta ad -> creative ID when available, cold call,
referral, etc.), stage, last-contacted, last-modified, append-only timestamped notes, attached call
recordings, assigned rep.

Pipeline stages:
`New Lead -> Intro Text Sent -> No Contact -> In Contact -> App Sent -> App Received -> Submitted ->
Approved -> Offer Presented -> Deal Closed -> Funded -> Active Deal -> Declined -> Not Interested ->
Take Off List -> DNQ`

**Auto-dialer daily pull (350 leads/day):**
- INCLUDE: no stage, New Lead, Intro Text Sent, No Contact, In Contact, and **all Meta/ads leads**.
- SORT: longest time since `last_modified` ASC (oldest-untouched first).
- IGNORE: Take Off List, Not Interested, Declined, DNQ.
- Respect time-zone calling windows; target 350 contacts/day.

### Module 2 - Deals & Funders (commissions + payoff)
Deal fields: linked contact | funder (from Funders table) | funded amount | term (months) |
payment frequency (daily/weekly/monthly) | payment amount (auto-calc) | buy rate | sell rate |
factor rate | commission % and commission total (auto from buy/sell spread) | funded date |
estimated payoff date | **% paid off** (payments made / total) | balance remaining | status
(Active / Paid Off / Default / Renewal Eligible). **Notify rep at 50% paid off, suggest renewal.**

Funders table: name, contact info, ISO agreement on file (Y/N), approval-criteria notes, avg
turnaround, preferred verticals, current deal count. (Funder communication tracked here.)

### Module 3 - Call Scheduling (time-zone intelligence)
Call follow-ups at **9 AM in the merchant's local time**. System must: detect TZ from state/zip;
convert merchant-9-AM to Matthew's ET; group contacts by ET call-time; produce a **Daily Agenda**
in 5-10 min blocks (e.g. "9 AM ET: these 10 ET merchants; 11 AM ET: CT merchants; 12 PM ET: PT
merchants for their 9 AM"). Blocks expand to the queue. Sync to **Google Calendar + Outlook**
simultaneously. Each event carries merchant name, phone, stage, last notes, and today's opener
suggestions **in the description**, so follow-ups work from a phone even if a call runs long.

### Module 4 - Call Interface (full-screen dialer cockpit, split-screen)
Main working screen. Full screen, dark (navy `#0A1F44`, teal `#00B4B4` accents). **Two-pane,
resizable split layout** so Matthew can run the whole call from one screen in the browser:

- **Left pane, live artifact (default = contact card):** business | owner | stage badge |
  city/state | their local time | phone. **Previous conversations** (bullets from notes),
  **Follow-up focus** (bullets, what to say today), **3 openers**, **3 jokes** ("vibe boosters").
  This pane is a swappable "artifact" slot; during a live call it can flip between the contact
  card, the live transcript, or a deal/payment view.
- **Right pane, phone + live coach (see Module 6/8):** an embedded **RC web-phone UI** with full
  dial pad / mute / hold / hangup, **connected to the RingCentral extension/PhoneBridge from the
  browser**, stacked above a **live chat** where Matthew can type mid-call ("what do I say to the
  price objection?") and get streamed Claude suggestions in real time.
- Actions: Call now (RingCentral) | Skip | Remove | Log outcome | Add note | Schedule follow-up.

All openers/follow-up bullets/jokes are **AI-generated per contact at render time** (Claude API,
streaming) from: stage, prior notes, time since last contact, vertical.

**Scan question to answer in Phase 0:** confirm whether the RingCentral integration supports a
**browser-embedded web phone** (RingCentral Embeddable / Web Phone SDK) vs. relying solely on the
Chrome extension's PhoneBridge, and recommend which powers the in-app phone UI.

### Module 5 - Auto-Dialer remasterization (Chrome extension)
Keep the existing extension architecture and the working RingCentral PhoneBridge integration.
Repoint it from Zoho to Mission Control: remove Zoho DOM dependencies; replace Zoho record writes
with Supabase API calls; detect answered-call state via PhoneBridge `postMessage`; auto-advance
on hangup; record duration/outcome/timestamp; manual pause/skip/stop; momentum states (Hot =
3+ answered in a row, Cooling = 2 missed, Cold = 5+ missed). Port the call state machine to the
Mission Control contact schema.

### Module 6 - Live Call Coach (Deepgram), live during the call
Real-time transcription feeding the **right-pane live chat** of the Call Interface (Module 4):
Claude reads a sliding transcript window and **proactively suggests rebuttals**, AND Matthew can
**type a question mid-call** ("how do I handle 'I need to think about it'?") and get a streamed
answer without leaving the call. Recording saved to Supabase Storage + linked to contact; post-call
auto-summary appended to notes. Confirm current prototype state from `live call coach srt`.

### Module 7 - Sales Twin data pipeline (collection only, Phase 1)
Every call = training data (the long-term moat). Consent ack at login. Store audio (Supabase
Storage / S3-compatible) + transcript (linked, timestamped). Tag by outcome / stage / vertical /
rep. Schema `call_recordings`: id, contact_id, rep_id, recording_url, transcript, duration,
outcome, call_date, stage_at_call, vertical. (Phase 2: train custom voice + objection model.)

### Module 8 - Chat Interface (the primary UI / "the brain")
A Claude-powered chat is the **main way Matthew operates the CRM**; let the model do scheduling
and orchestration; the Zoho-style data views are secondary.
- **Operator mode (default):** natural-language access to all Supabase data + calendar + schedule.
  "Who do I call today?" -> agenda. "What happened with Maria from Texas?" -> history. "How many
  deals closed this month?" -> query. "Add a note to ABC Plumbing, call back Friday" -> write.
- **Developer mode:** same chat with system-prompt access; can suggest/apply code changes to the
  repo and shows raw tool calls / Supabase queries. Toggle `[Operator] <-> [Developer]` top-right.

### Module 9 - Meta Ads integration (Phase 1 = data import)
Connect Meta creative -> lead -> deal as one attribution chain. Phase 1: pull active campaigns/ad
sets/ads via Meta Graph API into `meta_ads` (creative id, ad name, campaign, spend, leads). On new
Meta lead (webhook/CAPI) auto-tag `meta_ad_id`. Pipeline shows source ad; dashboard shows cost per
lead and cost per funded deal by ad. **Phase 2 (flagged, future): autonomous creative testing**,
new ad uploads auto-mapped, fully autonomous.

### Module 10 - Notifications & Calendar
Notifications (in-app + email + SMS): deal hits 50% paid off (renewal) | follow-up due today
(7 AM ET digest) | new Meta lead (immediate) | app received (submission reminder). Calendar: dual
sync Google + M365; every call block = an event with the full contact brief in the description;
add/remove/reschedule from Mission Control syncs both ways.

---

## PHASE 2 - 15 UI WIREFRAMES

Produce **15 wireframes**, one at a time with a clear label, so we can pick a direction screen by
screen. For each: 1-2 sentence layout description | clean ASCII wireframe (use plain ASCII only,
`+ - |`, no Unicode box characters) | key interactions | which design tokens apply.

Screens: 1) Dashboard / Command Center | 2) Call Interface, **live split-screen cockpit**
(left = contact-card artifact, right = embedded RC web phone + live coach chat) | 3) Pre-Call Brief
card | 4) Call Queue / time-blocked agenda | 5) Contact detail | 6) Pipeline Kanban | 7) Deal
detail (commissions, funder, payment schedule) | 8) Funders directory | 9) Approvals tracker |
10) Chat, Operator mode | 11) Chat, Developer toggle | 12) Calendar day view with call blocks |
13) Meta Ads attribution dashboard | 14) Notifications center | 15) Settings / Users / Reps.
For screen 2, show at least one ASCII variant of the left/right split with the phone UI + live
chat docked on the right.

**Design tokens:** BG `#0A1F44` | accent `#00B4B4` | surface `#0F2A5C` | text `#FFFFFF` /
secondary `#94A3B8` | success `#10B981` | warning `#F59E0B` | error `#EF4444` | Inter (UI) /
JetBrains Mono (data) | radius 8px cards / 4px inputs.

---

## DELIVERABLES (write these docs only)
1. `docs/SCAN_REPORT.md`, full current-state inventory.
2. `docs/MIGRATION_MAP.md`, Zoho -> Supabase field mapping.
3. `docs/CRM_PRODUCT_PLAN.md`, full spec of all 10 modules, gaps flagged.
4. `docs/UI_SKETCHES.md`, 15 wireframes.
5. `docs/BUILD_ORDER.md`, prioritized sequence (below).

**Build priority (Matthew):**
- **P0:** contact schema + pipeline stages in Supabase | Call Interface (full-screen dialer) |
  auto-dialer remasterization (extension Zoho -> Mission Control) | time-zone scheduling + Daily Agenda.
- **P1:** deal object + commission calculator | funder directory | 50% payoff notification |
  Chat (Operator mode) | calendar sync (Google + Outlook) | Live Call Coach overlay.
- **P2:** Sales Twin recording pipeline | Meta Ads attribution | Developer-mode chat | multi-user / reps.
- **Phase 2 SaaS (month 6+):** Sales Twin voice model | Meta autonomous creative testing | white-label.

## Constraints
- Preserve working integrations (RingCentral PhoneBridge, Deepgram, Meta CAPI).
- Supabase is source of truth; never write to Zoho again.
- Maintain RLS; reps see only their assigned contacts by default.
- Multi-user from day one (Benjamin, sales rep, uses it too).
- Mobile-responsive call interface; dialing must work from any screen.
- Store every recording for future Sales Twin training; architect storage for scale.
- The Chrome extension is a separate artifact; plan its remasterization separately from the Next.js app.
- No em dashes in any generated copy/email output.
