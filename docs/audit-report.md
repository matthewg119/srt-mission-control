# SRT Mission Control — Codebase Audit

Date: 2026-04-18
Scope: [Mission control 2.0/srt-mission-control/](../) and [srt-portal/](../../../srt-portal/).
Purpose: Phase 0 of the AI Intelligence Layer build. Identify dead code, duplicate logic, drift, and conflicts before shipping the new cron/webhook/slash-command surface.

## Files to Delete

Orphaned components in Mission Control (`src/components/*`) — no imports found via static grep. Before deleting each: run `grep -r "<ComponentName>" src/` to catch dynamic imports; if zero hits, delete. Ambiguous cases go to `src/_archived/`.

| File | Reason |
|------|--------|
| [src/components/brain-trust/agent-list.tsx](../src/components/brain-trust/agent-list.tsx) | No imports found |
| [src/components/brainheart-command-center.tsx](../src/components/brainheart-command-center.tsx) | Needs verification — brainheart cron still runs, component may be referenced dynamically |
| [src/components/chat-interface.tsx](../src/components/chat-interface.tsx) | No imports — `/dashboard/chat` uses a different client component |
| [src/components/chat-popup.tsx](../src/components/chat-popup.tsx) | No imports |
| [src/components/coaching-studio/*](../src/components/coaching-studio/) (3 files) | No imports — coaching routes use server components inline |
| [src/components/dashboard-client.tsx](../src/components/dashboard-client.tsx) | No imports |
| [src/components/dashboard-shell.tsx](../src/components/dashboard-shell.tsx) | No imports |
| [src/components/sidebar.tsx](../src/components/sidebar.tsx) | No imports — `app/dashboard/layout.tsx` uses its own nav |
| [src/components/pipeline-board.tsx](../src/components/pipeline-board.tsx) | No imports — pipeline page uses a newer kanban component |
| [src/components/template-editor.tsx](../src/components/template-editor.tsx) | No imports |
| [src/components/tool-cards/*](../src/components/tool-cards/) (5+ files) | No imports |

Also: dead env vars (see GHL Remnants below).

## Files to Consolidate

| Files | Into | Reason |
|-------|------|--------|
| [src/lib/zoho.ts](../src/lib/zoho.ts) + [srt-portal/src/lib/zoho.ts](../../../srt-portal/src/lib/zoho.ts) | No immediate action — keep duplicated | Separate Vercel deployments. Shared-package migration is out of scope for this build. Add a header comment "Intentional duplicate — sibling in other repo" to both. |
| [src/lib/pdf-generator.ts](../src/lib/pdf-generator.ts) + portal sibling | Document-only — update both when touching | Same reason. Memory rule already enforces this. |
| Agent name/phone/email hardcoded in [src/lib/sequence-engine.ts:246-248](../src/lib/sequence-engine.ts#L246-L248), [src/app/api/sequences/seed/route.ts:98](../src/app/api/sequences/seed/route.ts#L98), [src/config/email-signature.ts](../src/config/email-signature.ts) | New: [src/config/agent-profile.ts](../src/config/agent-profile.ts) | Four places each have to be touched when Benjamin changes. Single source of truth needed before the AI layer quotes these in drafts. |
| Zoho default `Lead_Source="Meta Ads"` + `Lead_Status="New"` in [src/lib/zoho.ts:204-205](../src/lib/zoho.ts#L204-L205) | New: [src/config/defaults.ts](../src/config/defaults.ts) | Hardcoded defaults that the AI layer will override per attribution source. |

## Dead Environment Variables

| Variable | Status | Action |
|----------|--------|--------|
| `GHL_API_KEY` | Declared in both `.env.local` files; zero code references in either repo | Delete from both `.env.local` and any `.env.local.example` |
| `GHL_LOCATION_ID` | Same as above | Delete |
| `ELEVENLABS_API_KEY` | Referenced in code (call coach) but missing from `.env.local.example` | Verify present in prod Vercel env; add to example |
| `PLAYBOOK_UPDATE_SECRET` | Referenced in code; verify Vercel env | Verify; add to example |
| `SLACK_UW_CHANNEL`, `SLACK_SUB_CHANNEL` | Declared in [src/lib/slack-bot.ts](../src/lib/slack-bot.ts) channels object; no route invokes these channels | Candidate removal — confirm with Benjamin they aren't reserved for upcoming workflows |
| `LEAD_THREAD_API_KEY` | In both `.env.local` files; usage unverified | Grep on execution; delete if truly unused |

GHL removal confirmed zero code hits for `GHL_`, `GoHighLevel`, `gohighlevel`.

## Orphaned Supabase Tables/Columns

Verified via code grep (`from("table_name")`). None confidently orphaned from static analysis. Candidates needing query-log confirmation over 30 days:

| Table/Column | Status |
|--------------|--------|
| `update_tasks`, `updates` | Referenced in some automation code; low observed traffic |
| `call_coach_sessions`, `call_coach_transcripts`, `call_coach_users` | Only queried by `/api/call-coach/*` routes; confirm if call coach feature is still active |

Do not delete on this PR — file a follow-up with 30-day query-log export.

## GHL Remnants Found

Only environment variables (above). Zero code references, zero API calls, zero imports. Dittofeed has fully replaced GHL.

## Hardcoded Values to Move to Config

| Location | Value | Move To |
|----------|-------|---------|
| [src/lib/sequence-engine.ts:246](../src/lib/sequence-engine.ts#L246) | `"Benjamin"` | `AGENT_PROFILE.name` in [src/config/agent-profile.ts](../src/config/agent-profile.ts) |
| [src/lib/sequence-engine.ts:247](../src/lib/sequence-engine.ts#L247) | `"(786) 282-2937"` | `AGENT_PROFILE.phone` |
| [src/lib/sequence-engine.ts:248](../src/lib/sequence-engine.ts#L248) | `"benjamin@srtagency.com"` | `AGENT_PROFILE.email` |
| [src/app/api/sequences/seed/route.ts:98](../src/app/api/sequences/seed/route.ts#L98) | `"786-282-2937"` | `AGENT_PROFILE.phone` |
| [src/config/email-signature.ts](../src/config/email-signature.ts) (lines 9, 33, 34, 84, 95) | Matthew Gabriel + phone + fax + company | Parameterize via `AGENT_PROFILE` + a `REP_PROFILE` lookup |
| [src/lib/zoho.ts:204-205](../src/lib/zoho.ts#L204-L205) | `"Meta Ads"` / `"New"` defaults | `DEFAULTS.zohoLeadSource` / `DEFAULTS.zohoLeadStatus` in [src/config/defaults.ts](../src/config/defaults.ts) |

## Conflicts with Intelligence Layer

| File | Conflict | Resolution |
|------|----------|------------|
| [src/lib/ai-tools.ts](../src/lib/ai-tools.ts) `submit_to_lender` | Already drafts lender submissions into `email_drafts` (URL-approval pattern) | Keep for chat-UI flow. New Slack-approval path is additive; both write to `email_drafts`, new path also creates `pending_slack_actions`. |
| [src/app/api/cron/ad-intelligence](../src/app/api/cron/ad-intelligence/) | Route exists but missing from [vercel.json](../vercel.json) cron schedule | Add `0 23 * * *` in vercel.json update step. |
| [src/app/api/slack/events/route.ts](../src/app/api/slack/events/route.ts) | Handles Events API (messages, app_mention) | New `/api/slack/actions` is for Interactive Components + reactions — separate webhook URL in Slack app config. No conflict. Add `reaction_added` subscription to `/slack/events` for the approval shortcut. |
| `sequence_enrollments` table | Original AI-layer spec said write `cancel_tag`; actual schema uses `status='cancelled'` + `cancelled_at` | Plan uses existing columns. No migration needed for this. |
| `lenders` vs "funders" | Original spec used "funders" terminology; DB has `lenders` table | Keep `lenders`. New `deal_submissions.lender_id` FKs to it. |

## Summary

Codebase is in good shape. The integration surface (Zoho, Slack, Microsoft Graph, RingCentral, Anthropic SDK, Meta CAPI, sequence engine, PDF generator) is already built and wired — the AI Intelligence Layer will **compose** existing primitives rather than reinvent them.

**Estimated cleanup effort:** ~1 day
- Component deletes (pre-verified with grep): 1-2h
- GHL env var removal: 10 min
- Agent-profile + defaults config extraction: 2h
- vercel.json cron additions: 5 min
- Header-comment duplicate markers on Zoho / PDF libs: 10 min
- Follow-up ticket filed for 30-day table query-log audit: documentation only

**Ready to build** the AI Intelligence Layer on top.
