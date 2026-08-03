-- Pitch pipeline v2: belief seeding, the draft linter, and the AI-crawler check.
-- ADD ONLY, safe to re-run.
--
-- Context (SRT_Belief_Seeding_Module.md + SRT_Loom_AI_Access_Check.md):
-- every prospect-facing draft installs exactly ONE belief, and a belief already installed is
-- never installed again. That needs a per-report ledger. Separately, the "there's something on
-- your own site working against you" tease is only honest when a SEARCH crawler is blocked, so
-- the robots result has to be stored with enough fidelity to tell that apart from a training
-- opt-out.

-- Which AI crawlers robots.txt blocks:
--   [{ "bot": "OAI-SearchBot", "role": "search"|"training", "engine": "ChatGPT",
--      "viaWildcard": bool, "detail": text }]
--
-- TRI-STATE, and the three must never be collapsed (same contract as site_signals):
--   null  the check never ran        -> no claim about their crawler access is permitted
--   []    ran, nothing blocked       -> a real answer; the second-gap beat is CUT, not skipped
--   [...] findings                   -> only a "search" role earns the devastating beat. A
--                                       blocked GPTBot is a TRAINING opt-out and does NOT keep
--                                       them out of today's answers; saying otherwise is caught
--                                       by anyone technical in five seconds.
alter table audit_reports add column if not exists robots_check  jsonb;

-- The belief ledger for this thread:
--   { "installed": [{ "belief": "B1", "stage": "draft 1", "line": text, "at": timestamptz }],
--     "offered":   [{ "belief": "B1", "label": text, "line": text }] }
--
-- `installed` is what stops a seed being repeated (linter rule 7). `offered` is the three
-- pre-sell lines the last draft was posted with, so a "seed 2" reply knows what 2 refers to.
alter table audit_reports add column if not exists seed_ledger   jsonb;

-- Language of the CALL, which is the language the drafts get written in: 'en' | 'es'.
-- Nothing in the pipeline can infer this (no lead table has ever carried a language column), so
-- null means nobody has said and the agent ASKS in-thread rather than guessing.
alter table audit_reports add column if not exists call_language text;

-- Google Business Profile stats. Used for exactly one decision: a strong profile
-- (>= 4.7 stars AND >= 100 reviews, see src/config/pitch.ts) opens on belief B4
-- "different game, different winners" instead of the default B1, because leading with absence
-- to someone proud of their reviews reads as an insult they can immediately disprove.
alter table audit_reports add column if not exists gbp_rating    numeric;
alter table audit_reports add column if not exists gbp_reviews   integer;
