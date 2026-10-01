-- Can the AI crawlers read this client's site? One reading per check.
-- Safe to run more than once.
--
-- ‼️ A LOG, NOT A STATE COLUMN, AND THAT IS THE WHOLE POINT. The valuable fact is not "the door
-- is shut", it is "the door WAS open and is now shut", which is a comparison between two
-- readings. A boolean on clients would answer the first question and make the second one
-- unanswerable, and the second is the one that produces a message worth sending.
create table if not exists public.client_crawler_probes (
  id          uuid        primary key default gen_random_uuid(),
  client_id   uuid        not null references public.clients(id) on delete cascade,

  checked_at  timestamptz not null default now(),

  -- ‼️ robots_ok IS ABOUT SEARCH BOTS ONLY. A site disallowing GPTBot and Google-Extended has
  -- opted out of TRAINING and is still perfectly readable by the crawlers that fetch a page to
  -- answer a question. Recording a training opt-out as a closed door would put a false finding
  -- in front of an owner, on the one technical claim in the pitch.
  robots_ok   boolean,
  -- What the server did when asked as a crawler, which is a different fact from what the file
  -- says. null means the request did not come back cleanly: never measured, never a finding.
  waf_ok      boolean,

  -- The search-bot tokens actually disallowed, as written in their file, so a card can quote them.
  agents_blocked jsonb not null default '[]'::jsonb,

  -- The full reading, training blocks included. Those are not a claim and are worth keeping: a
  -- training opt-out today is often a search block next month, by the same hand.
  observed    jsonb       not null default '{}'::jsonb,

  created_at  timestamptz not null default now()
);

create index if not exists client_crawler_probes_client_idx
  on public.client_crawler_probes (client_id, checked_at desc);

alter table public.client_crawler_probes enable row level security;

comment on table public.client_crawler_probes is
  'One crawler-door reading per check. robots_ok is about SEARCH bots only; a training opt-out is not a closed door.';
