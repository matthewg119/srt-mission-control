-- Audit outreach: pre-pitch intake, then one finished draft. ADD ONLY, safe to re-run.
--
-- Doctrine change (see src/lib/audit-engine/email-assistant.ts + outreach-intake.ts):
-- cold email 1's only job is to earn a "yes, send it". One finding, plain text, no links,
-- no price, no meeting ask. Everything of value (report link, scorecard, the free redesign
-- concept, the Loom, the price) lands in ONE reveal message AFTER they say yes. The free
-- redesign is the reward, not the hook.
--
-- So a finished cold audit no longer dumps 3 drafts into the thread. It posts an intake
-- card, Matthew answers it in-thread in free text, and that produces one draft. These
-- columns hold that per-report conversation state.

-- awaiting_intake | drafted | revealed. NULL = pre-intake or a public form-fill lead
-- (those keep the old fulfillment path in finish-report.ts and never get an intake card).
alter table audit_reports add column if not exists outreach_stage    text;

-- The questions actually asked: [{ "n": int, "ask": text, "source": "fixed"|"audit" }].
-- Stored so the drafter can see what Matthew's free-text reply was answering.
alter table audit_reports add column if not exists intake_questions  jsonb;

-- Matthew's reply, VERBATIM. Never normalized: the drafter reads it as prose, so a
-- parser that guessed wrong would silently lose an instruction.
alter table audit_reports add column if not exists intake_answers    text;

-- The human being written to. A cold /audit run has no contact row, so before this
-- there was nowhere to keep the recipient and the Outlook draft went out with no To.
alter table audit_reports add column if not exists prospect_name     text;
alter table audit_reports add column if not exists prospect_email    text;

-- Free homepage redesign concept + Loom walkthrough. Referenced ONLY by the reveal
-- message, never by a permission-stage email.
alter table audit_reports add column if not exists redesign_url      text;
alter table audit_reports add column if not exists loom_url          text;

-- [{ "kind": text, "detail": text }] — the "one thing on your site working against you"
-- hook, computed from the homepage HTML already fetched during classification
-- (src/lib/audit-engine/site-signals.ts). Ordered most damning first. Empty array is a
-- real answer (nothing found); null means the scan never ran.
alter table audit_reports add column if not exists site_signals      jsonb;
