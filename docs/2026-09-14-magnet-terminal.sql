-- 2026-09-14 — the terminal offer stops being a skin report for everybody
--
-- ‼️ THE SINGLE WORST ROW IN THE DATABASE, AND IT IS LOAD-BEARING, WHICH IS WHY IT SURVIVED.
-- `skin_report` is a library row with client_id, vertical, treatment and category ALL NULL and
-- audience 'patient'. In rankMagnets that is rung 0, the universal fallback, so it is the LAST
-- offer every end-customer client in every vertical will ever make. docs/2026-09-01-concierge.sql
-- says DO NOT DELETE in capitals, and it is right: it is the only reason resolveMagnet() cannot
-- return null, and a null there means the launcher still renders and still says something while
-- handing the visitor nothing.
--
-- So a diner who declines to book on la-casita's site is offered a skin report, in the taco shop's
-- own voice, on the taco shop's own domain. Nobody wrote that. It falls out of one null vertical.
--
-- The fix honours the do-not-delete rule rather than arguing with it: scope the row to the vertical
-- it was always about, and give the ladder a genuinely universal terminal to land on instead.
--
-- Additive, idempotent, safe to run more than once.
-- Runner: bun run scripts/db.ts --file=docs/2026-09-14-magnet-terminal.sql [--dry]
--
-- ‼️ ORDER MATTERS INSIDE THIS FILE. The new terminal rows are inserted BEFORE skin_report is
-- scoped. Doing it the other way round leaves a window, however short, in which a patient-stance
-- client in a non-medspa vertical has no rung 0 at all and resolveMagnet() returns null.


-- =====================================================================
-- 1. A TERMINAL THAT SAYS NOTHING ABOUT ANY PARTICULAR TRADE
-- =====================================================================
--
-- One per stance, because the stance firewall in rungOf() is what stops a chain hopping between
-- the two catalogues and it is staying exactly as it is.
--
-- ‼️ WRITTEN WITHOUT A SINGLE TRADE NOUN. No skin, no clinic, no treatment, no dish. This row is
-- the one offer that has to be true on a med spa, an agency, a taco shop and whatever onboards
-- next, so it promises the only thing all four can actually deliver: a person, and an answer in
-- writing. sort_order 9999 puts it behind everything a real vertical offers.
--
-- asset_url is null and that is fine: isDeliverable() only refuses a magnet whose key is in
-- ENV_ASSET and whose env var is unset. This key is not, so it is always deliverable, which is
-- exactly what a terminal has to be.
-- ‼️ `where not exists`, NEVER `on conflict`. lead_magnets_placement_key is a unique INDEX over
-- coalesce() EXPRESSIONS, not a plain constraint, so `on conflict on constraint` does not apply to
-- it and a bare column list fails to infer it with 42P10. An explicit existence check is
-- unconditionally safe and says what it means.
insert into public.lead_magnets
  (client_id, vertical, treatment, category, audience, magnet_key, title, promise,
   concierge_entry, cta_label, asset_url, chains_to_key, active, sort_order)
select null, null, null, null, stance, 'talk_to_us',
       'Have someone get back to you',
       'Someone from the team, with the answer written down so you can keep it.',
       'I can have someone get back to you on this, written out so you have it. Where should it go?',
       'Have someone get back to me',
       null, null, true, 9999
from (values ('patient'), ('owner')) as s(stance)
where not exists (
  select 1 from public.lead_magnets m
  where m.magnet_key = 'talk_to_us'
    and m.audience = s.stance
    and m.client_id is null
    and m.vertical is null
    and m.treatment is null
    and m.category is null
);


-- =====================================================================
-- 2. skin_report BECOMES WHAT IT ALWAYS WAS
-- =====================================================================
--
-- Not deleted, not deactivated. Given the vertical it describes, so it stops being the answer for
-- businesses it was never written for.
--
-- ‼️ 'medspa' IS THE SPELLING ALREADY IN THE TABLE, and skin_scan uses it too. It is NOT the
-- spelling classify.ts emits, which is why section 3 adds the alias rather than renaming this one:
-- renaming would break the chain skin_scan -> skin_report for the row that exists today.
update public.lead_magnets
set vertical = 'medspa', updated_at = now()
where magnet_key = 'skin_report'
  and audience = 'patient'
  and client_id is null
  and vertical is null;


-- =====================================================================
-- 3. BOTH SPELLINGS OF THE MED SPA VERTICAL RESOLVE
-- =====================================================================
--
-- ‼️ TWO PLACEMENTS OF ONE MAGNET, NOT A RENAME. lead_magnets_placement_key is unique on
-- (magnet_key, audience, client_id, vertical, treatment, category), so 'medspa' and 'med-spa' are
-- two legitimate rows for the same offer. classify.ts writes kebab-case free text and the seed rows
-- were written snake-ish, so a real med spa classified 'med-spa' matched NEITHER of these before.
--
-- This is the cheap half of the spelling problem. The real fix is normalising at
-- adoptAuditClassification, which is the single writer of clients.vertical_slug, and it is owed
-- separately: PRESET_BY_VERTICAL in src/config/audience-presets.ts lists the spellings for the same
-- reason and carries the same note.
insert into public.lead_magnets
  (client_id, vertical, treatment, category, audience, magnet_key, title, promise,
   concierge_entry, cta_label, asset_url, chains_to_key, active, sort_order)
select src.client_id, 'med-spa', src.treatment, src.category, src.audience, src.magnet_key,
       src.title, src.promise, src.concierge_entry, src.cta_label, src.asset_url,
       src.chains_to_key, src.active, src.sort_order
from public.lead_magnets src
where src.magnet_key in ('skin_scan', 'skin_report')
  and src.vertical = 'medspa'
  and src.client_id is null
  and not exists (
    select 1 from public.lead_magnets dup
    where dup.magnet_key = src.magnet_key
      and dup.audience = src.audience
      and dup.client_id is null
      and dup.vertical = 'med-spa'
      and dup.treatment is not distinct from src.treatment
      and dup.category is not distinct from src.category
  );


-- =====================================================================
-- VERIFICATION
-- =====================================================================

-- ‼️ THE CHECK THAT MATTERS. Expect exactly TWO universal rows, both talk_to_us, one per stance.
-- If skin_report still appears here, section 2 did not match and a diner is still being offered a
-- skin report.
select audience, magnet_key, title, sort_order
from public.lead_magnets
where client_id is null and vertical is null and treatment is null and category is null
  and active
order by audience, sort_order;

-- Every patient-stance placement, so the med spa ladder is visibly intact.
select coalesce(vertical, '(universal)') as vertical, magnet_key, sort_order, chains_to_key
from public.lead_magnets
where audience = 'patient' and active
order by vertical nulls first, sort_order;

-- Same for owner. visibility_scan stays universal on purpose: it is the one offer SRT can make to
-- any owner in any trade.
select coalesce(vertical, '(universal)') as vertical, magnet_key, sort_order, chains_to_key
from public.lead_magnets
where audience = 'owner' and active
order by vertical nulls first, sort_order;
