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
- GoHighLevel (GHL) API v2 for CRM
- Vercel deployment

## Architecture

### AI Office Manager (the core)
- `src/lib/ai.ts` — `runConversationWithTools()` handles Claude tool loop (up to 5 iterations)
- `src/lib/ai-tools.ts` — 9 tools: pipeline queries, deal management, SMS/email, templates, activity
- `src/app/api/chat/route.ts` — Web chat endpoint (used by dashboard)
- `src/app/api/telegram/webhook/route.ts` — Telegram endpoint (same AI, same tools)
- `src/lib/telegram.ts` — Telegram Bot API client

### CRM Integration
- `src/lib/ghl.ts` — GHL API client (contacts, opportunities, pipelines, custom fields)
- `src/config/pipeline.ts` — Two pipelines: New Deals + Active Deals (with GHL IDs)

### Lead Capture (from srtagency.com)
- `src/app/api/leads/capture/route.ts` — Contact form → GHL contact + opportunity
- `src/app/api/leads/application/route.ts` — Apply form → progressive capture (25% create, 100% enrich)

### Dashboard Pages
- `/dashboard` — Overview with pipeline stats
- `/dashboard/pipeline` — Kanban board
- `/dashboard/chat` — AI Office Manager chat interface
- `/dashboard/templates` — SMS/Email templates
- `/dashboard/automations` — Stage-based automation rules
- `/dashboard/settings` — API keys, AI config, knowledge base

## Database Tables (Supabase)
| Table | Purpose |
|-------|---------|
| pipeline_cache | Cached GHL opportunities for fast dashboard queries |
| message_templates | SMS/Email templates per pipeline stage |
| automation_logs | Log of automated actions (SMS, email, stage moves) |
| system_logs | General event log (lead captures, errors, actions) |
| chat_conversations | Chat session metadata |
| chat_messages | Individual chat messages (web + Telegram) |
| integrations | API configs (AI priorities, GHL settings) |
| knowledge_entries | AI knowledge base (custom context for the Office Manager) |

## GHL Pipeline IDs
- **New Deals:** `eNMzDiNKRgmvkZUc8Nid`
- **Active Deals:** `Jhkxtrseqgm1qwMJGe7A`

## Environment Variables
```
ANTHROPIC_API_KEY=         # Claude API
GHL_API_KEY=               # GHL Private Integration Token
GHL_LOCATION_ID=           # GHL Location
NEXT_PUBLIC_SUPABASE_URL=  # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY= # Supabase service role key
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Supabase anon key
TELEGRAM_BOT_TOKEN=        # Telegram bot (from @BotFather)
TELEGRAM_USER_ID=          # Allowed Telegram user ID
NEXT_PUBLIC_APP_URL=       # https://mission.srtagency.com
```

## Channels Connected
- **Web dashboard** — mission.srtagency.com/dashboard/chat
- **Telegram bot** — same AI, same tools, via /api/telegram/webhook
- **Website forms** — srtagency.com contact + apply forms → /api/leads/*
