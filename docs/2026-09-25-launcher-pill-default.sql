-- The launcher is a pill unless a tenant asked for a character.
--
-- ‼️ THE DEFAULT WAS SET IN TWO PLACES AND THIS IS ONLY ONE OF THEM. docs/2026-09-16-board-fixes.sql
-- gave concierge_configs.mascot a column default of 'wizard-cat', and src/lib/concierge/config.ts
-- separately coerced anything non-null to 'wizard-cat'. Either one alone would have put a cartoon on a
-- clinic's homepage, so the code change ships with this and neither works without the other.
--
-- ‼️ THE BACKFILL DOES NOT TOUCH A ROW WHERE ANYBODY RAN THE PICKER. There is no mascot_chosen_at
-- column, so a tenant who deliberately picked the wizard cat and a tenant who was never asked are the
-- same row. mascot_candidates is the only evidence that exists: it is written by `mascot pick a, b, c`
-- in step 18's thread, so a non-empty shortlist means a person was in there making a decision and the
-- row is left exactly as it is. An empty one means nobody ever chose and the cat was a default.
-- (The column is `not null default '[]'`, so the coalesce below is belt and braces, not a real branch.)
--
-- What this will and will not change, stated plainly: any tenant still carrying 'wizard-cat' with a
-- shortlist on file keeps the cat. To move one of those to the pill, type `mascot skip` in step 18's
-- thread, which now writes null rather than the built-in default.

alter table public.concierge_configs alter column mascot drop default;

comment on column public.concierge_configs.mascot is
  'The corner mascot key (src/lib/concierge/mascot). NULL is the default and shows the plain Help pill. '
  'Opt in with `mascot <key>` in step 18''s thread; `mascot skip` writes NULL.';

update public.concierge_configs
   set mascot = null
 where mascot = 'wizard-cat'
   and jsonb_array_length(coalesce(mascot_candidates, '[]'::jsonb)) = 0;

-- What moved, so the run can be checked against it.
select
  count(*) filter (where mascot is null)     as on_the_pill,
  count(*) filter (where mascot is not null) as with_a_character
from public.concierge_configs;
