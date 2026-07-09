# Daily Pest-Control Prospecting Pipeline

Unattended daily pipeline that harvests pest-control businesses across the entire
USA from Outscraper's Google Maps API, dedupes + stores them in Supabase, and posts
a morning progress report to the follow-up Slack channel. It works **ZIP code by ZIP
code, state by state** (Sun Belt first) until every US ZIP is covered — then it posts
a one-time **"no more records available in USA"** message and stops.

This is a **cold prospecting list** (businesses to sell funding to), separate from
Mission Control's inbound "leads" (Zoho funding applicants). Every table is
`prospect_`-prefixed.

## Pieces

| File | Role |
|------|------|
| `docs/2026-07-09-prospect-pipeline.sql` | Tables: `prospect_leads`, `prospect_rotation`, `prospect_runs` |
| `scripts/seed-prospect-rotation.ts` | One-time ZIP seed (`bun run seed:prospects`) |
| `src/lib/outscraper.ts` | Outscraper REST client + record mappers |
| `src/app/api/cron/pull-prospects/route.ts` | **Route A** — daily cron submit (12:00 UTC) |
| `src/app/api/webhooks/outscraper/route.ts` | **Route B** — results webhook + Slack report |
| `scripts/pull-prospects-now.ts` | Manual trigger (`bun run pull:now`) |
| `vercel.json` | Cron entry `/api/cron/pull-prospects @ 0 12 * * *` |

## How it flows

1. **12:00 UTC daily** Vercel Cron calls Route A.
2. Route A grabs the next `PROSPECT_ZIPS_PER_RUN` ZIPs where `active=true AND
   exhausted=false`, ordered by `state_priority, zip`. It submits ONE async
   Outscraper Google Maps job (one query per ZIP, e.g. `pest control 78701`),
   stores a `prospect_runs` row, and returns immediately (never blocks).
3. When Outscraper finishes, it POSTs results to Route B
   (`OUTSCRAPER_WEBHOOK_URL?run=<runId>`). Route B dedupes into `prospect_leads`
   (by `google_place_id` + `phone_normalized`), marks each ZIP `exhausted` when it
   returned fewer than the per-ZIP cap (= we got everything there), closes the run,
   and posts the morning report to `SLACK_FOLLOWUPS_CHANNEL`.
4. When Route A finds **no** active/uncovered ZIPs left, it posts
   **"✅ No more records available in USA"** once and stops. Start a new vertical or
   re-point the daily pull from there.

Email enrichment is **OFF** (base records only, ~$45/mo at 500/day). The `email`
column is reserved for a future free second-pass scrape. All data comes from the
Outscraper API — no raw HTML scraping.

## Setup

### 1. Create the tables
Paste `docs/2026-07-09-prospect-pipeline.sql` into the Supabase SQL editor and run it.

### 2. Seed the ZIP rotation (~33k ZIPs)
```
bun run seed:prospects
```
Fetches a public US ZIP dataset and upserts `prospect_rotation` (Sun Belt first).
Safe to re-run. Override the source with `ZIP_DATASET_URL` if the default is down.

### 3. Env vars
Add to `.env.local` and to Vercel (Project → Settings → Environment Variables):
```
OUTSCRAPER_API_KEY=                 # from app.outscraper.com
OUTSCRAPER_WEBHOOK_URL=https://mission.srtagency.com/api/webhooks/outscraper
OUTSCRAPER_WEBHOOK_SECRET=          # optional; if set, Route B requires ?token=<this>
PROSPECT_ZIPS_PER_RUN=25            # ZIPs pulled per daily run
PROSPECT_LIMIT_PER_ZIP=20          # Google Maps cap per ZIP query
PROSPECT_QUERY=pest control        # swap to start a new vertical later
```
Already present, reused as-is: `CRON_SECRET`, `SLACK_FOLLOWUPS_CHANNEL`,
`SLACK_BOT_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

> Cost tuning: daily record volume ≈ `PROSPECT_ZIPS_PER_RUN × (avg businesses/ZIP)`.
> Most ZIPs are sparse, so raise `PROSPECT_ZIPS_PER_RUN` to cover the USA faster;
> lower it to spend less per day. Outscraper bills per returned record (~$0.003 base).

## Test end-to-end

```
bun run dev
bun run pull:now          # POSTs Route A locally with CRON_SECRET
```
Then check:
- A `prospect_runs` row appears (`status = submitted`, has `outscraper_request_id`).
- The picked ZIP rows show a fresh `last_pulled_at`.
- When Outscraper calls the webhook (or you POST a sample payload to Route B with
  `?run=<runId>`): rows land in `prospect_leads` (deduped), the run flips to
  `completed` with correct counts, the covered ZIPs flip `exhausted`, and the 🐛
  report posts to the follow-up Slack channel.

Force the USA-complete path: temporarily `update prospect_rotation set exhausted=true;`
then `bun run pull:now` → Route A posts the one-time "no more records available in USA"
message and returns `{ done: true }`.

## Deploy
`bun run build` clean → push → Vercel auto-deploys. Confirm the new cron shows under
Vercel → Project → Cron Jobs.

## ⚠️ Compliance before you dial/email
These rows are raw prospecting data. Before any become a **call or email list**:
- Scrub against the national + state DNC registries (Florida especially). The
  `dnc_checked` boolean on `prospect_leads` is reserved for that second job.
- Follow CAN-SPAM for any cold email.
