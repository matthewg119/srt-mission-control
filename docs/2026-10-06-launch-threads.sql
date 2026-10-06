-- Many threads on one client, instead of one thread per client forever.
--
-- Matthew, 2026-10-06, looking at Vektor's history rail: "ideally we can only interact with the
-- chat and save the conversations". The launch chat had one row per client, enforced by a unique
-- index, so every onboarding was a single thread that grew without end and nothing could be
-- named, found or reopened.
--
-- ‼️ IT RELAXES "ONE THREAD PER CLIENT" AND NOT "ONE CLIENT PER THREAD", AND THAT DISTINCTION IS
-- THE WHOLE REASON THIS IS SAFE. docs/2026-09-30-launch-conversation.sql states the rule it was
-- protecting: "never two clients in one thread", because a conversation holding two clients is one
-- where an action executes against whichever the model last mentioned. That property is untouched.
-- Every row here still carries exactly one client_id, the client an action runs against still comes
-- from the route (/dashboard/launch/[id]/chat), and ensureConversation checks a requested thread id
-- against that client's own threads before opening it. What changes is only that a client may have
-- more than one of them.
--
-- Safe to run twice. Nothing is deleted and no row is rewritten.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The unique index becomes an ordinary one
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The replacement is not a plain (client_id): the rail reads this client's threads newest first on
-- every page load, so the sort is in the index. `nulls last` because last_turn_at is null until the
-- first turn, and a thread opened and never used belongs at the bottom rather than the top.
drop index if exists public.launch_conversations_client_uidx;

create index if not exists launch_conversations_client_idx
  on public.launch_conversations (client_id, last_turn_at desc nulls last);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A name, so a thread can be recognised weeks later
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ WRITTEN ONCE, FROM THE FIRST MESSAGE, AND NEVER REWRITTEN. titleConversation() updates only
-- `where title is null`, so a thread keeps the name it was given and renaming one later is a
-- deliberate edit rather than something that drifts as the conversation changes subject. Null is a
-- legitimate value: every thread that existed before this migration has one, and the rail renders
-- those as "Untitled thread" rather than inventing a name for a conversation it has not read.
alter table public.launch_conversations
  add column if not exists title text;

comment on column public.launch_conversations.title is
  'What this thread is called in the history rail. Taken from its first user message, trimmed to 80 characters, and written once. Null on every thread opened before 2026-10-06.';
