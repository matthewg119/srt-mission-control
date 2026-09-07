-- ReachInbox event capture, so a campaign rate has a denominator.
--
-- WHY THIS TABLE EXISTS
-- The whole ReachInbox lane (2026-08-28) was built around one constraint: ReachInbox gated
-- webhooks AND the REST API behind Tier 4, so the number of emails that went out was genuinely
-- unobservable and campaign-digest.ts refuses to print a rate without it. On 2026-09-07 the Slack
-- webhook integration turned out to be open on the PRO free trial, with an `Email Sent` event and
-- a per-campaign selector. That is the missing denominator.
--
-- !! THE TRIAL ENDS 2026-09-15. Everything reading this table must degrade to counts when the
-- events stop arriving, never divide by a partial send number. See campaign-digest.ts.

create table if not exists public.reachinbox_events (
  id uuid primary key default gen_random_uuid(),

  -- !! DEDUPE KEY, AND IT IS NOT NULLABLE ON PURPOSE. A webhook provider retries, and a retried
  -- `sent` event double-counts the denominator, which is the one number a spend decision is made
  -- on. When ReachInbox sends no id of its own the receiver hashes the payload into one, so this
  -- column is always populated and the unique index always bites. Postgres allows unlimited NULLs
  -- in a unique index, so a nullable column here would silently not dedupe at all.
  provider_event_id text not null unique,

  -- sent | opened | clicked | replied | bounced | completed | unknown
  -- Free text, not a CHECK: we have seen exactly one payload shape and a CHECK written against a
  -- guess would reject real events at the door and lose them. 'unknown' is a real, kept value.
  event_type text not null,

  campaign_name text,
  campaign_id   text,

  -- Lowercased. The join key to outreach_prospects.email and onboarding2_leads.email.
  lead_email text,

  occurred_at timestamptz not null default now(),

  -- !! ALWAYS THE RAW BODY, KEPT FOREVER. The parser above it was written against a single
  -- observed payload. Keeping the original means a wrong field mapping is a re-read rather than
  -- data that was never captured, and the trial window is too short to lose a week to a mis-parse.
  payload jsonb not null,

  received_at timestamptz not null default now()
);

create index if not exists reachinbox_events_campaign_idx
  on public.reachinbox_events (campaign_name, event_type, occurred_at desc);
create index if not exists reachinbox_events_email_idx
  on public.reachinbox_events (lead_email);
create index if not exists reachinbox_events_occurred_idx
  on public.reachinbox_events (occurred_at desc);

alter table public.reachinbox_events enable row level security;
drop policy if exists "Service role full access" on public.reachinbox_events;
create policy "Service role full access" on public.reachinbox_events
  for all to service_role using (true) with check (true);

-- Which campaign put this prospect on the board.
-- Until now every ReachInbox prospect carried source='reachinbox' and nothing else, so every
-- campaign ever run produced byte-identical attribution and no per-campaign number was possible.
alter table public.outreach_prospects
  add column if not exists campaign text;

create index if not exists outreach_prospects_campaign_idx
  on public.outreach_prospects (campaign)
  where campaign is not null;


-- ── the funnel, aggregated in the database ──────────────────────────────────────────────────────
--
-- A function rather than a view so the window is a parameter: the card asks for 30 days, and the
-- same question can be asked over a year by hand without a second object to keep in sync.
--
-- ‼️ IT AGGREGATES HERE RATHER THAN IN THE DIGEST BECAUSE `sent` IS THE BIG NUMBER. A month of
-- sends is tens of thousands of rows; PostgREST pages at 1000, so building this in TypeScript
-- would mean paging the whole send log into a serverless function every morning to produce eight
-- integers.
--
-- ‼️ EVERY COUNT IS `count(distinct email)`, NOT `count(*)`. A campaign emails the same person
-- several times across its steps, so counting events would make a reply rate of "replies per
-- email sent" that silently answers a different question from "people who answered us".
create or replace function public.reachinbox_campaign_funnel(days integer default 30)
returns table (
  campaign text,
  sent     bigint,
  replied  bigint,
  bounced  bigint,
  opened   bigint,
  clicked  bigint,
  booked   bigint,
  closed   bigint
)
language sql
stable
as $$
with
  cutoff as (select now() - make_interval(days => greatest(days, 1)) as since),

  -- Webhook events. The only source of `sent`, and it exists only while the ReachInbox plan
  -- carries webhooks.
  ev as (
    select
      coalesce(nullif(trim(e.campaign_name), ''), '(no campaign on the event)') as campaign,
      e.event_type,
      lower(e.lead_email) as email
    from public.reachinbox_events e, cutoff
    where e.occurred_at >= cutoff.since
      and e.lead_email is not null
      and trim(e.lead_email) <> ''
  ),

  -- Replies seen by the forwarding mailbox instead. This is the half that keeps working if the
  -- webhook goes away, so replies are the UNION of the two and never the webhook alone.
  reply_mail as (
    select
      coalesce(nullif(trim(op.campaign), ''), '(no campaign on the event)') as campaign,
      lower(op.email) as email
    from public.outreach_touches t
    join public.outreach_prospects op
      on op.id = t.prospect_id and op.source = 'reachinbox',
    cutoff
    where t.direction = 'inbound'
      and t.channel = 'email'
      and t.outcome = 'replied'
      and t.occurred_at >= cutoff.since
  ),

  replied_all as (
    select campaign, email from ev where event_type = 'replied'
    union
    select campaign, email from reply_mail
  ),

  -- Campaign names this lane actually knows about, so a booking carrying somebody else's
  -- utm_campaign (a Meta ad, say) cannot invent a ReachInbox campaign row.
  known as (
    select distinct campaign from ev
    union
    select distinct campaign from reply_mail
  ),

  -- ‼️ TWO PATHS, AND THE SECOND ONE IS NOT REDUNDANT. A prospect row is minted only when somebody
  -- REPLIES, so anyone who clicked the link in the cold email and booked without ever writing back
  -- would be invisible on the prospect path alone -- and that person is the best outcome the
  -- campaign has. The utm_campaign path catches them, which is why the booking links in the
  -- ReachInbox templates have to carry ?utm_campaign=<name>.
  booked_src as (
    select coalesce(nullif(trim(op.campaign), ''), '(no campaign on the event)') as campaign,
           lower(l.email) as email,
           l.client_id
    from public.onboarding2_leads l
    join public.outreach_prospects op
      on lower(op.email) = lower(l.email) and op.source = 'reachinbox',
    cutoff
    where l.booked_slot_at is not null and l.booked_slot_at >= cutoff.since

    union

    select nullif(trim(l.utm_campaign), '') as campaign,
           lower(l.email) as email,
           l.client_id
    from public.onboarding2_leads l, cutoff
    where l.booked_slot_at is not null
      and l.booked_slot_at >= cutoff.since
      and nullif(trim(l.utm_campaign), '') in (select campaign from known)
  ),

  counts as (
    select
      k.campaign,
      (select count(distinct e.email) from ev e where e.campaign = k.campaign and e.event_type = 'sent')    as sent,
      (select count(distinct r.email) from replied_all r where r.campaign = k.campaign)                     as replied,
      (select count(distinct e.email) from ev e where e.campaign = k.campaign and e.event_type = 'bounced') as bounced,
      (select count(distinct e.email) from ev e where e.campaign = k.campaign and e.event_type = 'opened')  as opened,
      (select count(distinct e.email) from ev e where e.campaign = k.campaign and e.event_type = 'clicked') as clicked,
      (select count(distinct b.email) from booked_src b where b.campaign = k.campaign)                      as booked,
      -- A `clients` row is the only unambiguous won-signal in this database. The CRM's `Closed`
      -- stage covers won AND lost, so it cannot be used here.
      (select count(distinct b.email) from booked_src b
         where b.campaign = k.campaign and b.client_id is not null)                                         as closed
    from known k
  )
select campaign, sent, replied, bounced, opened, clicked, booked, closed
from counts
order by replied desc, sent desc, campaign;
$$;

revoke all on function public.reachinbox_campaign_funnel(integer) from public, anon, authenticated;
grant execute on function public.reachinbox_campaign_funnel(integer) to service_role;
