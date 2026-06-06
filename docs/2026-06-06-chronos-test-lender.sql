-- Chronos (TEST) funder — a sandbox lender for dry-running the verbatim-forward flow.
--
-- Reply `chronos` in a "New Deal" #srt-sub thread and forwardDealToFunders() will send the
-- exact package + attachments to matthewmzts@gmail.com, so you can see precisely what a real
-- funder receives without emailing anyone real. tier=9 keeps it out of `tier 1/2/3 only` routing.
--
-- Run in Supabase prod (SQL editor). Guarded so re-running is a no-op (lenders.name is not unique).

insert into public.lenders (name, tier, is_active, submission_method, submission_email, to_emails, cc_emails, recipient_source)
select 'Chronos (TEST)', 9, true, 'email', 'matthewmzts@gmail.com', '{matthewmzts@gmail.com}', '{}', 'manual'
where not exists (select 1 from public.lenders where name = 'Chronos (TEST)');

-- If it already exists, make sure it points at the test inbox and is active.
update public.lenders
set is_active = true,
    submission_method = 'email',
    submission_email = 'matthewmzts@gmail.com',
    to_emails = '{matthewmzts@gmail.com}'
where name = 'Chronos (TEST)';
