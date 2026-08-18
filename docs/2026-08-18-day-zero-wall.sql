-- The Day 0 wall, enforced in code instead of only warned about.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Runner v3's one hard rail: Photograph II archives BEFORE any change
-- lands on a CLIENT-CONTROLLED property, and "if you find a path where a page could
-- publish with day_0_archived_at NULL, STOP AND TELL ME." That path existed:
-- POST /api/clients/[id]/hub action=page_publish put a page live and indexable at
-- learn.{clientdomain} with nothing checking anything.
--
-- ‼️ THIS BREAKS THIS REPO'S OWN DOCTRINE ON PURPOSE, AND ONLY HERE.
-- delivery-checklist.ts says it twice, about the Measure gate and about the market
-- overlap check: "Flags, never blocks... a checklist that refused would just get worked
-- around." That reasoning is right for a call booked early, which is a judgement someone
-- made about their own week. It is wrong for this one, because the thing being protected
-- is not the workflow, it is the baseline the day 30/60/90 numbers are measured against,
-- and once a page is published that baseline cannot be recovered by being more careful
-- later. A flag you can ignore is exactly as good as no flag on the one step where the
-- damage is unrecoverable.
--
-- So: blocks, with an override that is explicit, attributed, reasoned and Slacked. The
-- override exists because a wall with no door gets removed by whoever hits it at 9pm.
--
-- WHAT THE WALL BLOCKS: publishing a page at the live hub host. Later, when they exist:
-- submitting a directory correction, editing a GBP field.
-- WHAT IT DOES NOT BLOCK, and never did: attaching Vercel domains, seeding or checking
-- DNS, saving a draft, the preview, the review tool. Preview and staging are ours. The
-- wall is about their properties.

-- ─────────────────────────────────────────────────────────────────────────────
-- The stamp
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Four columns rather than one boolean, because "is the wall open" and "why is the wall
-- open" are different questions and the second one is the one that gets asked in six
-- months when a scorecard looks wrong.

alter table public.clients
  add column if not exists day_0_archived_at timestamptz;

alter table public.clients
  add column if not exists day_0_archived_by text;

-- HOW the wall came to be open. This is the honest bit and it is why the column is not
-- just a timestamp:
--   photograph_2 — a real archived run wrote it. The only value that means what Runner
--                  v3 means. Nothing writes this yet: there is no photograph_2 run in
--                  this repo, because one engine is keyed and A2 D-P16 says a one-engine
--                  run is never a photograph for a pilot client.
--   manual_step  — a human ticked 'day_zero_archive' on the delivery checklist. This is
--                  an ASSERTION that the archive happened, not evidence of it. It is what
--                  every client will carry until the measurement layer lands, and the
--                  artifacts must never describe it as a photograph.
--   waived       — somebody published anyway, on purpose, with a reason.
alter table public.clients
  add column if not exists day_0_source text;

alter table public.clients
  drop constraint if exists clients_day_0_source_check;
alter table public.clients
  add constraint clients_day_0_source_check
  check (day_0_source is null or day_0_source in ('photograph_2', 'manual_step', 'waived'));

-- Required when day_0_source = 'waived'. Free text, written by the person waiving, shown
-- on the board and posted to #alerts-infra. Never defaulted, never auto-filled.
alter table public.clients
  add column if not exists day_0_waived_reason text;

-- The two are one fact, so they cannot disagree: a waive with no reason is not a waive.
alter table public.clients
  drop constraint if exists clients_day_0_waiver_has_reason;
alter table public.clients
  add constraint clients_day_0_waiver_has_reason
  check (
    day_0_source is distinct from 'waived'
    or (day_0_waived_reason is not null and length(btrim(day_0_waived_reason)) > 0)
  );

-- And the stamp itself cannot be half-written.
alter table public.clients
  drop constraint if exists clients_day_0_stamp_complete;
alter table public.clients
  add constraint clients_day_0_stamp_complete
  check ((day_0_archived_at is null) = (day_0_source is null));

comment on column public.clients.day_0_archived_at is
  'NULL until Day 0 is archived. While NULL, page_publish refuses. Set by setDeliveryStep '
  'when day_zero_archive completes, or by an explicit waive. See src/lib/clients/day-zero.ts.';

comment on column public.clients.day_0_source is
  'How the wall came to be open: photograph_2 (a real run, nothing writes this yet), '
  'manual_step (a human tick, an assertion not evidence), or waived (published anyway, '
  'with a reason). Artifacts must never call a manual_step stamp a photograph.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: nobody is grandfathered in
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Any client whose day_zero_archive step is ALREADY ticked gets the stamp, so turning the
-- wall on does not retroactively block a client who did the work before the column
-- existed. Source is manual_step, because that is exactly what a tick is.
--
-- Everyone else stays NULL and will hit the wall on their next publish, which is the
-- point. There is no "published before, so presumed fine" clause: a page already live is
-- evidence the wall was needed, not evidence it can be skipped.

update public.clients c
   set day_0_archived_at = s.completed_at,
       day_0_archived_by = coalesce(s.completed_by, 'backfill 2026-08-18'),
       day_0_source      = 'manual_step'
  from public.client_delivery_steps s
 where s.client_id = c.id
   and s.step_key  = 'day_zero_archive'
   and s.status    = 'complete'
   and c.day_0_archived_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- What to expect after running this
-- ─────────────────────────────────────────────────────────────────────────────
--
-- select legal_name, day_0_archived_at, day_0_source, day_0_waived_reason
--   from public.clients order by created_at;
--
-- Every row NULL/NULL/NULL is a client who cannot publish a page until somebody ticks
-- 'Day-0 scan archived, before any change lands' on the delivery checklist, or waives it
-- in writing. That is the intended state.
