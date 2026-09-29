-- Which free-first variant a signing came from, and where in the upsell ladder it stopped.
--
-- ‼️ SAFE TO RUN BEFORE OR AFTER THE DEPLOY, AND THAT IS NOT TRUE OF EVERY MIGRATION IN THIS
-- FOLDER, SO IT IS WORTH SAYING WHICH KIND THIS ONE IS. The 2026-09-25 contacts.source_page
-- migration fails EVERY lead insert in the app if it is not run first, because lead-intake.ts
-- writes that column unconditionally. This one does not: /api/onboarding2/start sends
-- funnel_variant and upsell_outcome as null on every session from the two-card picker at
-- /onboarding2, and PostgREST drops a null for a column it does not know about rather than
-- erroring. The free-first route is the only caller that sends real values, and nothing links to
-- it until a winner is picked.
--
-- ‼️ BOTH NULLABLE, AND BOTH STAY NULLABLE. Every row written before today came through a screen
-- that has no variants and no ladder. Back-filling either would be inventing a fact about a
-- session somebody already completed: "variant 1" would claim they saw a presentation that did not
-- exist when they visited. NULL reads as "before the free-first test", which is true.

alter table public.onboarding2_signings add column if not exists funnel_variant text;
alter table public.onboarding2_signings add column if not exists upsell_outcome text;

comment on column public.onboarding2_signings.funnel_variant is
  'Which /onboarding2/free presentation this session saw: "1" through "6", matching the VARIANTS '
  'table in src/app/onboarding2/free/variants.ts. NULL for every session that came through the '
  'two-card picker at /onboarding2, which has no variants.';

comment on column public.onboarding2_signings.upsell_outcome is
  'Where the upsell ladder ended. accepted_year: took the guarantee, at step one or on the yearly '
  'side of the step two toggle. accepted_month: the monthly side of that toggle. declined: tapped '
  '"I do not want more appointments" and started on the free engine. free_direct: reserved for a '
  'session that reached free without the ladder running. NULL for sessions that never saw it.';

-- ‼️ NOT A CHECK CONSTRAINT, AND THE PRECEDENT FOR THAT CALL IS IN THIS DATABASE ALREADY.
-- The four values are a closed list in TypeScript and are validated at the route, which is where a
-- bad value can still be answered usefully. A CHECK here would turn the next outcome Matthew asks
-- for into a failed INSERT on a live funnel, at the exact moment somebody is trying to give us
-- money, rather than into a column with an unexpected string in it that a report can be taught to
-- read. time_log has a CHECK on its step key and that constraint is the thing that bites.

-- What has come through, so the first day of the test can be checked and so a variant with zero
-- rows is visibly zero rather than absent.
select
  funnel_variant,
  upsell_outcome,
  count(*)                                        as sessions,
  count(*) filter (where signed_at is not null)   as signed,
  count(*) filter (where is_demo)                 as demo_rows
from public.onboarding2_signings
where funnel_variant is not null
group by 1, 2
order by 1, 2;
