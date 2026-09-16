-- The call pack: delete the two merged-away delivery steps' orphaned rows.
--
-- ‼️ RUN THIS AFTER THE DEPLOY, NOT BEFORE IT. This is the opposite of every other migration in
-- this folder and the reason is mechanical: loadRows (delivery-checklist.ts) and reachableCursor
-- (step-engine.ts) both RE-SEED a client whose row count is lower than DELIVERY_STEPS.length. Run
-- against the old code, which still holds 43 steps, this delete removes two rows and the next
-- board read puts them straight back, `pending`, where runReadyAutoSteps will happily claim them
-- and run generators that no longer belong to a step.
--
-- What changed: `presence_pdf` and `findings_doc` are no longer delivery steps. Both documents are
-- still generated, by the `call_sheet` runner, and both are filed against `call_sheet` with the
-- call sheet and the closing questions. Matthew, 2026-09-12: "we can merge everything that goes in
-- the call pack and keep the rest." The board went from 43 steps to 41.
--
-- ‼️ client_docs IS NOT TOUCHED. Documents already filed under the old step keys stay exactly
-- where they are: they are a record of work that really happened, and findings.ts still resolves a
-- presence PDF filed under the legacy key. Only the BOARD rows go, because a row whose step_key is
-- not in DELIVERY_STEPS has no card, no verifier and no way to be worked.
--
-- Idempotent, and safe to run more than once.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-12-call-pack-orphans.sql

delete from public.client_delivery_steps
 where step_key in ('presence_pdf', 'findings_doc');

-- What to expect:
--
--   -- Zero rows, on every client:
--   select step_key, count(*) from public.client_delivery_steps
--    where step_key in ('presence_pdf', 'findings_doc') group by step_key;
--
--   -- 41 rows for a client whose board has been read since the deploy:
--   select count(*) from public.client_delivery_steps
--    where client_id = (select id from public.clients where slug = 'srt-agency-llc');
--
--   -- The four call pack documents, once the pack has run:
--   select filename, source, uploaded_at from public.client_docs
--    where delivery_step_key = 'call_sheet' and source = 'generated'
--    order by uploaded_at desc;
