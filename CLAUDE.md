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
```

## Channels Connected
- **Web dashboard** — mission.srtagency.com/dashboard/chat
- **Telegram bot** — same AI, same tools, via /api/telegram/webhook
- **Website forms** — srtagency.com contact + apply forms → /api/leads/*
- **Slack** — #hot-leads for new lead + application complete notifications
