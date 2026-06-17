# Claude Code prompt — finish wiring SalesTwin to "fully functional"

Paste the block below into Claude Code (in the `srt-mission-control` repo) to build
the remaining SalesTwin integrations. The core engine already exists
(`src/lib/sms-ai-engine.ts` drafts replies from `bot_persona` + `voice_examples`;
`src/lib/sms-channel.ts` + `src/lib/imessage-suggestion.ts` post per-lead Slack
draft cards with Send/Regenerate/Remix/Hold; `src/lib/imessage-followups.ts` +
`/api/cron/sms-followups` schedule follow-ups; `src/lib/speed-to-lead.ts` places
RingCentral RingOut; `src/lib/sales-twin/zoho-bridge.ts` writes Zoho notes). Already
built this round: **post-conversation notes** (`src/lib/sms-conversation-notes.ts`
+ `/api/cron/sms-conversation-notes`).

## Prerequisites (do first, not code)
1. Run `~/Desktop/SRT-Activate-Migrations.sql` in the Supabase SQL editor (project
   `gvsborqpkyvhcfrpgagp`). It creates `tenants`, `voice_examples`, `bot_persona`,
   `sim_*`, `sms_outbox`, `sms_followups`, the `match_voice_examples` RPC, and the
   `sms_conversations.notes_posted_at` column the notes job needs.
2. Seed `bot_persona` (base/adaptive row, `stage = null`) from
   `docs/salestwin-persona.md`, and seed `voice_examples` from the example pairs
   (mark the strongest as `is_golden = true`). A loader script may already exist —
   check `scripts/load-voice-examples.ts`.
3. Set envs (per memory): `LOOPMESSAGE_*` (sender must be 336-833-2303),
   RingCentral / `RC_WEBPHONE_*`, and add the cron line below to `vercel.json`.

## Build prompt

> Build these on top of the existing SalesTwin engine. Keep each change isolated
> and typecheck with `bun run build`.
>
> 1. **Add the post-conversation-notes cron to `vercel.json`**: `{ "path":
>    "/api/cron/sms-conversation-notes", "schedule": "*/5 * * * *" }`. (Route +
>    lib already exist.) Also confirm `/api/cron/sms-autosend` is scheduled.
>
> 2. **Call-from-SMS Slack button**: add a button to the per-lead SMS draft card
>    (`src/lib/imessage-suggestion.ts`) labeled "📞 Call now". Handle it in
>    `src/app/api/slack/actions/route.ts` by reusing `triggerSpeedToLead` /
>    `initiateRingOut` from `src/lib/speed-to-lead.ts` to RingOut the lead, and
>    post the dial status back to the thread. Add a "📅 Schedule call" companion
>    that calls `scheduleFollowup(contactId, "call", dueDate)`.
>
> 3. **`sms_outbox` delivery tracking**: route outbound sends (LoopMessage) through
>    the `sms_outbox` table (insert → send → update status sent/delivered/failed),
>    and add `/api/cron/sms-outbox-retry` to retry failed sends 3× with backoff.
>    Wire LoopMessage delivery webhooks to update the row.
>
> 4. **True post-call summaries**: add a RingCentral telephony/call-ended webhook
>    (or poll call_log) so when a call ends, the post-conversation-notes summarizer
>    runs immediately for that contact (don't wait for the 10-min idle sweep).
>
> 5. **Draft-queue page** `/dashboard/sms-drafts`: list all pending
>    `sms_pending_drafts` across leads with "waiting Nm" badges and Send/Hold
>    actions, so drafts aren't only visible in per-lead channels.
>
> Reuse existing helpers: `callClaudeText` (`src/lib/claude-calls.ts`),
> `slack` (`src/lib/slack-bot.ts`), `addNoteResilient` (`src/lib/zoho.ts`),
> `supabaseAdmin` (`src/lib/db`). No em dashes in any generated copy.
