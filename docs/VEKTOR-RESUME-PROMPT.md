# Continuation prompt — paste into a fresh Claude Code session

Copy everything between the `===START===` and `===END===` markers.

```text
===START===
I'm resuming a VeKtor launch. VeKtor is SRT Agency's AI Intelligence Layer built in Mission Control. The code is fully written and compiling. I need you to help me test it end-to-end and ship it live today.

## Where everything lives

Primary working dir: c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control
Sibling repo: c:\Users\matth\Desktop\Code\srt-portal

## State of the world (read these first)

1. Auto-memory index: C:\Users\matth\.claude\projects\c--Users-matth-Desktop-Code\memory\MEMORY.md — read this AND the files it points to, especially:
   - project_ai_intelligence_layer.md
   - project_meta_attribution_rule.md
   - project_portal_context.md
2. The build plan: C:\Users\matth\.claude\plans\srt-agency-gleaming-ullman.md
3. Setup guide for me (Matthew): docs/VEKTOR-SETUP.md
4. Slack-as-Claude-Code proposal (future work, not today): docs/VEKTOR-SLACK-CODING-PROPOSAL.md

## What's already built (all compiling, Next.js build passes)

- Supabase migration SQL at docs/2026-04-18-ai-intelligence-layer.sql (4 new tables: ai_decisions, fine_tune_examples, pending_slack_actions, deal_submissions)
- src/lib/ai-intel/* — guardian, zoho-guardian, inbound-classifier, deal-submission-builder, slack-approval, execute-action, meta-events, bank-statement-analyzer, deal-outcome-messaging, request-lender-routing, types
- src/lib/claude-calls.ts (Opus 4.7, Sonnet 4.6, Haiku 4.5 wrappers)
- src/config/vektor.ts (branding + channel router)
- src/config/rep-profile.ts (Benjamin/Matthew contact info)
- API routes:
  - /api/cron/ai-guardian — Supabase-based (legacy, parallel)
  - /api/cron/vektor-guardian — Zoho-based (new, preferred)
  - /api/cron/graph-subscription-renew
  - /api/cron/submission-followups
  - /api/cron/daily-digest
  - /api/agent/submissions — MS Graph inbound email webhook
  - /api/agent/bank-statements — bank statement analyzer POST
  - /api/slack/actions — button handler
  - /api/slack/commands — /srt slash command
  - /api/slack/events — events + reaction_added (modified)
  - /api/integrations/microsoft/subscribe
  - /api/deals/[id]/outcome-messaging — decline + approval generator
  - /api/deals/[id]/mca-offer — Zoho MCA field sync
  - /api/vektor/stats — atlas page stats
  - /api/ai-decisions, /api/deal-submissions, /api/email-queue
- Dashboard pages: /dashboard/vektor (architecture atlas), /dashboard/ai-decisions, /dashboard/deal-submissions, /dashboard/email-queue
- Modified src/app/api/deals/[id]/route.ts to fire Meta DealDeclined on stage='Deal Lost'
- Modified src/app/api/slack/events/route.ts to handle reaction_added emoji shortcuts

## What's NOT done (today's work)

### External config — I have to do these in external systems
1. Save pixel shark image to public/vektor.png (have the image locally)
2. Apply Supabase migration (paste docs/2026-04-18-ai-intelligence-layer.sql in Supabase SQL editor)
3. Create 5 Slack channels in SRT workspace: #Vektor, #Vektor-deals-Matt, #Vektor-WorkingLeads-Matt, #Vektor-renewals-Matt, #Vektor-Matt. Invite the VeKtor bot to each.
4. Slack app (api.slack.com) config:
   - OAuth scopes: chat:write, files:write, reactions:read, commands, im:write, users:read
   - Events URL: https://mission.srtagency.com/api/slack/events, subscribe to message.channels, app_mention, reaction_added
   - Interactivity URL: https://mission.srtagency.com/api/slack/actions
   - Slash command /srt → https://mission.srtagency.com/api/slack/commands
5. Zoho custom fields on Leads module:
   - MCA_Factor_Rate (Decimal 3), MCA_Total_Payback (Currency), MCA_Daily_Payment (Currency), MCA_Weekly_Payment (Currency), MCA_Term_Months (Integer), MCA_Net_Funded (Currency), MCA_Use_Of_Funds (Multiline text)
6. Env vars in Vercel AND .env.local for mission control:
   - SLACK_VEKTOR_CHANNEL, SLACK_VEKTOR_DEALS_CHANNEL, SLACK_VEKTOR_WORKING_LEADS_CHANNEL, SLACK_VEKTOR_RENEWALS_CHANNEL, SLACK_VEKTOR_MATTHEW_DM (all channel IDs)
   - MATTHEW_SLACK_USER_ID (user ID for $50k approval gate)
   - SLACK_SIGNING_SECRET (if not already set, for signature verification on /slack/actions + /slack/commands)
   - Optional: VEKTOR_DECLINE_IMAGE_URLS (comma-separated URLs of decline meme images)
7. POST to /api/integrations/microsoft/subscribe with { "mailbox": "submissions@srtagency.com" } to create the Graph change notification

### Tests I want to run

A. Local dev: bun run dev → visit /dashboard/vektor → confirm architecture atlas loads, click each tile, confirm the stats panel shows non-zero numbers once migration is applied and there's test data.
B. /dashboard/ai-decisions should show any ai_decisions rows
C. Zoho guardian dry-run smoke test:
   curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/vektor-guardian?dry_run=1&limit=5"
   Expect: ok=true, processed=N, no Slack messages sent
D. Zoho guardian live (after dry run looks good):
   curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/vektor-guardian?limit=5"
   Expect: Slack messages posted to #Vektor-WorkingLeads-Matt
E. Slack approval flow: click 👍 on a draft email Slack post, confirm email actually sends via MS Graph (check submissions@ sent folder), confirm ai_decisions.was_approved=true, fine_tune_examples row created
F. Bank statement analyzer: curl POST /api/agent/bank-statements with a test PDF URL, confirm Slack report posts to #Vektor-deals-Matt
G. /srt route [merchant] in Slack → confirm email arrives at submissions@ asking where to send; reply "Send to Legend" → confirm VeKtor builds submission draft and posts to #Vektor-deals-Matt
H. Decline flow: curl POST /api/deals/[id]/outcome-messaging with {"kind":"decline","reason":"stacked positions"} → confirm 2 SMS options posted to #Vektor-deals-Matt + decline image posted
I. Approval flow: curl POST with {"kind":"approval","offer":{"amount_approved":50000,...}} → confirm 3 presentations posted

## How you should work with me

- Walk me through ONE step at a time. Tell me exactly what to click, paste, or run.
- After each step tell me what I should see so I can confirm before moving on.
- When I hit a real blocker (auth, creds, env var I don't know), ask me for the value — don't guess.
- If a curl test fails, diagnose from the response body + server logs, don't just retry.
- I'm NOT a developer — I'm the CEO. Keep commands copy-pasteable. No "figure out" or "you'll need to" language.
- I'm on Windows / bash shell. Paths use c:\Users\matth\Desktop\Code\...
- Dev server command: cd "c:/Users/matth/Desktop/Code/Mission control 2.0/srt-mission-control" && bun run dev

## Priority order for today

1. Fix my localhost login so I can see /dashboard/vektor (check if auth is blocking me)
2. Save shark image + apply Supabase migration (no Slack/Zoho needed)
3. Create the 5 Slack channels + get their IDs + set env vars
4. Configure Slack app (scopes, events, interactivity, slash command)
5. Dry-run the Zoho guardian — does Claude return valid JSON for real Zoho leads?
6. Live-run the Zoho guardian — does the Slack message appear in #Vektor-WorkingLeads-Matt?
7. Test the approval flow end-to-end with ONE real lead
8. Create Zoho custom MCA fields
9. POST to create MS Graph subscription
10. Send a test email to submissions@ and confirm /api/agent/submissions fires

Start with step 1. Don't do anything destructive (no rm, no git push, no dropping tables) without asking.
===END===
```

---

## Realistic launch timing

Getting VeKtor fully live with every feature tested is probably a 2-3 day effort because:
- Slack workspace channel creation + app config + scope approval: ~30 min
- Zoho custom field creation: ~15 min
- Supabase migration + env vars: ~15 min
- MS Graph subscription + waiting for first inbound email to test: variable
- Testing the Zoho guardian against real leads (first run usually exposes schema mismatches): ~1-2h
- Testing each approval flow end-to-end: ~1h per flow

**Realistic by tomorrow:** Steps 1-7 from the priority order above. That gets you the Zoho guardian running + Slack approval flow working end-to-end. Bank statements + inbound email handler can come after tomorrow without blocking the core value.

## Priority checklist for today (while you're awake)

Keep this handy and check off as you go:

- [ ] 1. Get login working for localhost:3000 — confirm `/dashboard/vektor` loads
- [ ] 2. Save pixel shark image to `public/vektor.png`
- [ ] 3. Apply Supabase migration — open Supabase SQL editor, paste [docs/2026-04-18-ai-intelligence-layer.sql](Mission%20control%202.0/srt-mission-control/docs/2026-04-18-ai-intelligence-layer.sql), click Run
- [ ] 4. Create 5 Slack channels, invite VeKtor bot to each, copy each channel ID
- [ ] 5. Configure Slack app (scopes, events, interactivity URL, `/srt` slash)
- [ ] 6. Set env vars in Vercel + in `.env.local`
- [ ] 7. Dry-run Zoho guardian — confirm Claude returns valid JSON
- [ ] 8. Live-run Zoho guardian on 5 leads — confirm Slack message lands
- [ ] 9. Click 👍 on a draft Slack post → confirm email sends

Everything else can slip to day 2 without blocking you from demoing the core flow.
