# VeKtor — manual setup to go live

This doc has the 4 things you (Matthew) have to do by hand before VeKtor can fully run. None of it is code — it's config in Slack, Zoho, Supabase, and env vars.

---

## 1. Save the shark image

Save the pixel shark to `public/vektor.png` in the srt-mission-control repo. The [dashboard/vektor](../src/app/dashboard/vektor/page.tsx) page + approval messages reference it. I couldn't save it directly from chat — that's on you.

---

## 2. Create 5 Slack channels + Slack app config

### Channels to create in your Slack workspace

| Channel | Purpose |
|---|---|
| `#Vektor` | Main firehose — everything flows here |
| `#Vektor-deals-Matt` | Submissions, bank statement reports, deal approvals/declines |
| `#Vektor-WorkingLeads-Matt` | Merchant state alerts, inbound email classifications |
| `#Vektor-renewals-Matt` | Funded deals due for renewal (future state) |
| `#Vektor-Matt` | DM-style channel for $50k+ approvals (you only) |

For each channel: `/invite @VeKtor` so the bot can post.

### Env vars to set (Vercel → Mission Control project)

```bash
SLACK_VEKTOR_CHANNEL=C0XXXXXXXX          # main #Vektor
SLACK_VEKTOR_DEALS_CHANNEL=C0XXXXXXXX    # #Vektor-deals-Matt
SLACK_VEKTOR_WORKING_LEADS_CHANNEL=C0XXXXXXXX
SLACK_VEKTOR_RENEWALS_CHANNEL=C0XXXXXXXX
SLACK_VEKTOR_MATTHEW_DM=C0XXXXXXXX
MATTHEW_SLACK_USER_ID=U0XXXXXXXX         # for $50k gate
```

Get channel IDs by right-clicking a channel → View details → copy ID.

### Slack app permissions + events

In api.slack.com → your VeKtor app:

**OAuth scopes** (Bot Token):
- `chat:write`
- `files:write`
- `reactions:read`
- `commands`
- `im:write`
- `users:read`

**Event Subscriptions** → Request URL: `https://mission.srtagency.com/api/slack/events`
Subscribe to:
- `message.channels`
- `app_mention`
- `reaction_added` ← **new, required for 👍 reactions to work**

**Interactivity & Shortcuts** → Request URL: `https://mission.srtagency.com/api/slack/actions`

**Slash Commands**:
- Command: `/srt`
- Request URL: `https://mission.srtagency.com/api/slack/commands`
- Description: "VeKtor commands"
- Usage hint: `route [merchant] | submit [merchant] | status [merchant] | followups | emails | activity`

### Optional — decline images

Drop a few decline meme / outcome images somewhere public (OneDrive shareable URL, public S3, etc.) and comma-separate them:

```bash
VEKTOR_DECLINE_IMAGE_URLS=https://1.png,https://2.png,/vektor/decline-default.png
```

VeKtor picks one at random when a deal is declined and posts it to `#Vektor-deals-Matt`.

---

## 3. Create Zoho custom fields

Log into Zoho CRM → Setup → Customization → Modules → Leads → Layout → add these custom fields to the default layout.

### MCA Offer Details (for closed/approved deals)

| Field Name | API Name | Type |
|---|---|---|
| MCA Factor Rate | `MCA_Factor_Rate` | Decimal (3 places) |
| MCA Total Payback | `MCA_Total_Payback` | Currency |
| MCA Daily Payment | `MCA_Daily_Payment` | Currency |
| MCA Weekly Payment | `MCA_Weekly_Payment` | Currency |
| MCA Term (Months) | `MCA_Term_Months` | Integer |
| MCA Net Funded | `MCA_Net_Funded` | Currency |
| MCA Use of Funds | `MCA_Use_Of_Funds` | Multiline text |

### Per-lender submission tracking

For tracking which lenders we've submitted to and their responses, the cleanest approach is to use Zoho **Related Lists** — create a custom module `MCA_Submissions` with a lookup to Leads. That lets Zoho show a list of submissions per lead automatically.

Alternative (simpler): add a multiline text field `Lender_Submissions_Log` that VeKtor appends to whenever a submission is sent/responded. Entries look like:

```
2026-04-18 11:32 — Legend (sent) — pending response
2026-04-18 14:08 — Yellowstone (sent) — pending response
2026-04-19 09:15 — Legend — approved $75k @ 1.36 factor, 6mo
2026-04-19 12:22 — Yellowstone — declined (stacked positions)
```

Tell me which you prefer and I'll wire the write path accordingly. For the short term, VeKtor writes to the Supabase `deal_submissions` table and surfaces it via `/dashboard/deal-submissions` — you already see everything there.

### Lead_Status values VeKtor treats as terminal

VeKtor skips merchants in these statuses (configured in [zoho-guardian.ts](../src/lib/ai-intel/zoho-guardian.ts)):

```
Closed - Not Converted, Closed - Converted, Junk Lead, Lost Lead,
Not Contacted, Dead Declined, Deal Lost, Closed, Funded, Declined
```

If your Zoho Lead_Status picklist values differ, edit `TERMINAL_ZOHO_STATUSES` in that file.

---

## 4. Apply the Supabase migration (if not done yet)

Open Supabase → SQL Editor → paste contents of [docs/2026-04-18-ai-intelligence-layer.sql](./2026-04-18-ai-intelligence-layer.sql) → Run. Creates 4 tables + `pg_trgm` extension + `lenders` column extensions.

---

## 5. Create the MS Graph subscription

Once env vars are set:

```bash
curl -X POST https://mission.srtagency.com/api/integrations/microsoft/subscribe \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mailbox": "submissions@srtagency.com"}'
```

This tells MS Graph to POST to `/api/agent/submissions` every time new mail arrives. Subscription auto-renews via the `graph-subscription-renew` cron.

---

## 6. First smoke test

Hit the Zoho guardian in dry-run mode on 5 leads:

```bash
curl "https://mission.srtagency.com/api/cron/vektor-guardian?dry_run=1&limit=5" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Then check [dashboard/ai-decisions](../src/app/dashboard/ai-decisions/page.tsx) to see what VeKtor would have done. No Slack messages sent on dry-run.

When you're ready for real: drop `&dry_run=1` and watch `#Vektor-WorkingLeads-Matt`.

---

## 7. Open localhost → see the system

```bash
bun run dev
```

Open:
- `http://localhost:3000/dashboard/vektor` — **The architecture atlas.** Click any node to see what it does, with clickable source-file paths.
- `http://localhost:3000/dashboard/ai-decisions` — audit log of every VeKtor decision
- `http://localhost:3000/dashboard/deal-submissions` — per-lender submission tracker
- `http://localhost:3000/dashboard/email-queue` — pending AI emails + sequence drips
- `http://localhost:3000/dashboard/lenders` — lender DB
