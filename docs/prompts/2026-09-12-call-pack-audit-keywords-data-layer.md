# Call pack, keywords measured by the audit, the per-client data layer, then reset SRT

A build prompt for a fresh session, written 2026-09-11 from a planning session with three read-only
research passes. Everything below was checked against the repo and prod that day. Line numbers
drift; symbol names do not.

## Goal, in Matthew's words

"I intend to build a full AI database where we can create workflows internally. My whole point is
that SRT agency at some point is just a chatbot UI with workflows, so all of the data of each
customer (inside Slack or Mission Control) needs to be saved with its specific dataset so we can
create workflows around each client and have productized systems throughout the company, so if we
build one workflow for 1 client it can be functional for each one. Make sure all data we collect is
saved correctly ... and to be able to pull any info I need from our current chatbot in Mission
Control."

And on the keyword check: "this should be done after we do the visibility audit or simply use the
results we got from the visibility audit from that profile specifically."

And on the board: "we can merge everything that goes in the call pack and keep the rest."

## Repo and where to work

`Mission control 2.0/srt-mission-control`. Worktree `C:/Users/matth/Desktop/Code/_wt-page-plan`,
branch `feat/page-plan`, which equals `main` at df4a8cf plus this prompt. Other sessions share the
main checkout: never `git add -A`, run `git branch --show-current` before every commit, stage by
explicit `:(literal)` paths (bracketed route folders are globs otherwise). Deploys go by
fast-forward push `git push origin feat/page-plan:main` after `git fetch` confirms main has not
moved; Vercel builds main. Read `CLAUDE.md` (grep it, it is huge) and the two 09-11 prompts in
`docs/prompts/` first.

## What exists (do not rebuild)

- The one-strategy chain is deployed: prep call `offer_locked` (#11, `offer:` + `terms:`, Call now
  RingOut), `keyword_set` (#14, client-keywords.ts + keyword-expansion.ts, 200+ phrases, approve in
  thread, bulk `keywords add:`), `pre_call_pages` (#23, pre-call-pages.ts, 1 pillar + 8 supports on
  the four buying questions, leased drafting waves via /api/internal/pre-call-pages), the plan map
  (`/dashboard/clients/[id]/plan`), plan links in the hub template and the dashboard preview.
- `/api/internal/board-kick` (CRON_SECRET): re-renders every card with its current number and walks
  a board. CRON_SECRET is readable with `vercel env pull <scratch file> --environment=production`
  run from the MAIN checkout (it has `.vercel/`); never print it.
- Wrong-thread guard (step-commands.ts): a step command in another step's thread gets "Nothing was
  saved" and a link.
- `scripts/_reset-client-board.ts <slug>`: deletes a board and the bot's cards, keeps intake and
  the audit, re-seeds. Used on SRT 2026-09-07.
- Cascade probe scratch channel: `#srt-probe-scratch` = `C0C1A0DDF8S` (private, bot only). Run
  `PROBE_SCRATCH_CHANNEL=C0C1A0DDF8S bunx tsx --env-file=.env.local scripts/_probe-cascade.ts`.

## What the research found (2026-09-11)

- Only SRT (`srt-agency-llc`, id 871f51be-26a1-4a85-a18a-6df0ce82395f, our own test client) has
  ever used the board. 15 of 43 steps ever completed; nothing after #20 has run.
- The Mission Control chatbot (`runConversationWithTools`, src/lib/ai.ts; tools in ai-tools.ts and
  crm-tools.ts; web /api/chat, Slack `askAssistant` in the events route, Telegram) reads ONLY the CRM
  (contacts, lead_activities, lead_tasks, deals). No tool reads `clients` or any client table, and
  the read-only role behind `query_database` (docs/2026-08-18-crm-readonly-role.sql) has no grant on
  them.
- Chat memory: `chat_conversations`/`chat_messages` use uuid ids; Slack and Telegram pass
  `slack-C…-ts` style ids, so history reads return nothing and inserts fail silently (plus a
  non-existent `agent_id` upsert). Nothing is keyed per client.
- Free text in a step thread that is not a command goes to the assistant and neither side is saved.
- **Live bug:** `audit_reports.call_notes` does not exist (`docs/2026-08-16-audit-call-notes.sql`
  was never applied), so the call-notes writer fails AND `loadNumberedEvidence` errors and silently
  drops intake answers and call notes from every page draft's evidence.
- `client_avatar_runs` has 0 rows though SRT's avatar was confirmed. `client_docs` files each PDF
  twice. SRT's only `page_sources` row is the junk "1" (page dfdd10c5).
- SRT's one client-linked audit (2181d405, 2026-08-27) asked 20 classifier-invented questions, 4
  mentioned; 0 of 20 match any keyword or page candidate. `namedByPrompt` picks the report by
  contact_id, not client_id. There is no entry point that runs supplied prompts, and no Day 0
  "Photograph II" runner (`photograph_2` has no writer; custom_v1 is never frozen).

## Decisions already made by Matthew (do not re-ask)

| # | Decision |
|---|---|
| D1 | Board: merge the call pack, keep everything else. 43 steps become 41. |
| D2 | The keyword check comes from the visibility audit: approved keywords join the tracked question set and the audit measures them. `keywords check` is removed. |
| D3 | Data layer: all of it. Fix what is broken, log everything per client, chatbot client tools, reusable per-client workflows. |
| D4 | Settle the board first, then reset SRT onto it in a fresh channel with the offer lock cleared, keeping intake and audit 2181d405. onboarding2 is never involved (SRT's intake came from the v1 form). |
| D5 | Supporting pages and posts focus on the four buying questions: price, fears, comparisons, how it works. |

## Workstreams, in this order

### W1. The call pack (board 43 to 41)
- One step, key `call_sheet` kept (keys are never renamed), label "Call pack: call sheet, findings,
  presence PDF, closing questions". Its runner generates all four, reusing `generatePresencePdf`,
  `generateFindings`, `generateCallSheet`, `generateCallQuestions` (src/lib/clients/artifacts/). Its
  verifier (system tier) checks every document is filed against the step.
- Remove `presence_pdf` and `findings_doc` from DELIVERY_STEPS, STEP_VERIFIERS and AUTO_RUNNERS.
  Re-point blockers: `citation_cleanup_list` becomes blocked by `presence_sweep_manual`; nothing else
  named them except `call_sheet`. `stage-rollup.ts` STAGE_REQUIRES does not name them (check).
- Migration deletes their orphaned `client_delivery_steps` rows. Card copy that names them by
  number goes through `stepNumber()`.
- Probe and test counts 43 to 41 with the acknowledgement comment; `_probe-cascade` green.
- Nothing else on the board moves.

### W2. Keywords measured by the audit
- (a) custom_v1 (`generateCustomQuestionSet`, artifacts/custom-question-set.ts) includes the
  approved, relevant keyword queries (`planKeywords` / `isRelevantKeyword` in client-keywords.ts)
  alongside its existing sources. `custom_question_set` becomes blocked by `keyword_set` and must
  move after it in the array; the stale-blocker re-aim then re-runs it after approval.
- (b) A supplied-prompt audit entry: insert `audit_reports` with given prompts, a `run_label` and
  `excluded_from_scorecard`, no Slack scorecard and no lead writeback, then the existing process
  route and `runBatch` (they do not care what the prompts are). EVERY reader of "the client's newest
  report" (baseline verifier, `universalSetFor`, `adoptAuditClassification`, presence-pdf,
  `namedByPrompt`) ignores labelled runs.
- (c) A Day 0 "Photograph II" runner: universal_v1 plus custom_v1, frozen at that moment, through
  (b); writes `day_0_source = 'photograph_2'` (the value exists and has no writer today). The same
  entry serves the day 30/60/90 re-tests.
- (d) Results write back to `client_keywords.currently_named` by normalized prompt, with the +15 gap
  term for "not named". A no_data answer records nothing.
- (e) Remove `keywords check` (grammar, command, card line, probe cases). `namedByPrompt` resolves the
  report by client_id. State the cost per run (about $0.03 a question) on the card.

### W3. Fix what is broken now
- Apply `docs/2026-08-16-audit-call-notes.sql` (paste it in chat as a full sql block for Matthew to
  run). Then prove `loadNumberedEvidence` returns intake answers and call notes for SRT.
- Chat memory: Slack and Telegram conversation ids must fit storage (a mapping table from the
  external key to a uuid, or a text key column), drop the `agent_id` upsert, and key a conversation to
  a client when it happens in that client's thread.
- Write `client_avatar_runs` on every avatar confirmation.
- Stop `client_docs` double filing (unique on client_id + slack_file_id, or a content hash).

### W4. One log of everything said and done per client
- New table `client_events` (client_id, step_key, source slack|dashboard|system,
  kind message|command|button|file|bot_post|assistant_reply, author, text, slack_channel,
  slack_ts, slack_thread_ts, payload jsonb, created_at), unique on (slack_channel, slack_ts) where
  present. Header explains why it is a table and why nothing is deleted.
- Written from the Slack events route (every message in a client's threads, commands included), the
  actions route (every button), notifyStep/postStep (bot posts) and the assistant (its replies).
- Backfill SRT from Slack (conversations.replies of every anchor; join the channel first).

### W5. The chatbot can see every client
- New tools in the shared loop: `find_client` (by name, slug or domain), `get_client_profile`
  (clients row and bags, offer, avatar, tier, step states), `get_client_keywords`, `get_client_plan`
  (plan, page statuses, plan map link), `get_client_pages`, `get_client_audits`, `get_client_docs`,
  `search_client_events`. Start from the reads the dashboard board page already does
  (`/dashboard/clients/[id]/page.tsx`), `ops-index.ts facts()` and `loadNumberedEvidence`.
- Read-only views over client tables added to the role behind `query_database`.
- The system prompt (`buildSystemPrompt`) names the client tools. Works from web, Slack and Telegram.

### W6. Reusable per-client workflows
- A workflow is defined once and runs against any client, using the W5 reads as its inputs. First
  explore and reuse what exists (the content workflow builder and its tables; see memory notes
  project_workflow_builder_v2 and project_content_engine_v3_workflows) before designing anything new.
- First two workflows: (1) Google Business and social posts built on the four buying questions
  (price, fears, comparisons, how it works) from the client's approved plan and keywords; (2) the
  post-call email from call notes. Every run is stored per client (`client_events` or a
  `workflow_runs` table).

### W7. Reset SRT onto the settled board, last
- Extend `_reset-client-board.ts`: add `client_keywords` and `page_plan` to WIPE; clear the offer
  LOCK (keep the proposal) so the prep call is walked for real; create a fresh private channel and set
  `ops_channel_id` before seeding (it is write-once and null for SRT today); keep intake and audit
  2181d405. Archive junk page dfdd10c5.
- Run it (dry first), then verify from the DB and Slack: step 11's card posts with the phone and Call
  now, and the walk proceeds as Matthew works it.
- Finish the proofs still owed: the concierge demo link opens (#20, now its verifier fetches it), the
  review tool check fetches for real, the drafting waves hand off to the next batch (#23), the plan map
  fills in.

## Invariants. Do not loosen any of these.
- Step keys are never renamed; a step appears after everything in its blockedBy; phases stay
  contiguous; STEP_VERIFIERS stays exhaustive.
- A green tick is evidence: `verified_source` is system or thread only.
- The Day 0 wall and the evidence gate stay; `setPublished` has one caller;
  `approveMagnetCandidate` is the only insert into `lead_magnets`.
- No em dashes, en dashes or double hyphens in any copy or model output.
- Reads of new columns stay tolerant, or the migration runs before the deploy.
- Paste every migration as a full fenced sql block in chat, never a file path.
- SRT is resolved by slug, never by a pinned id.

## Verification
```
bun run build
./node_modules/.bin/tsc --noEmit
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts                      # 41 steps
bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
bunx tsx --env-file=.env.local scripts/_probe-keywords.ts
bunx tsx --env-file=.env.local scripts/_probe-hub-links.ts
PROBE_SCRATCH_CHANNEL=C0C1A0DDF8S bunx tsx --env-file=.env.local scripts/_probe-cascade.ts
```
Plus, live: the chatbot answers "what are SRT's approved keywords and its page plan" from the web
assistant and from Slack; SRT's `client_events` holds the backfilled threads; a Photograph II run for
SRT writes a labelled report and updates `currently_named`; after the reset, step 11 is the first card
waiting.

## What to ask Matthew, only if the code forces it
- The fresh channel's name.
- Whether W6 ships in this session or its own.

End with: what shipped, the SQL to paste, what was verified live and what was not, and what Matthew
does next in Slack, in that order.
