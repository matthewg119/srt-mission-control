-- The review tool's star rating, the attestation, and the private note.
--
-- Run against prod Supabase. Safe to run twice; every statement is idempotent.
--
-- ‼️ THIS DOES NOT BREAK review_tool_submissions' NO-PII RULE, AND THAT RULE IS WHY THE COLUMNS
-- LOOK LIKE THIS. The table was built with deliberately no column for a name, an email, a phone,
-- an IP, a user agent, a session id or a device fingerprint, and its original migration says the
-- ABSENCE OF THE COLUMN IS THE ENFORCEMENT. None of the three below can identify anybody: a
-- number from 1 to 5, free text somebody chose to write, and a timestamp.
--
-- ‼️ NOTHING IN THE CODE READS `rating` TO MAKE A DECISION, AND THAT IS THE WHOLE POINT OF IT
-- EXISTING. Routing a customer to a public review link on a high rating and a private form on a
-- low one is review gating: prohibited outright by Google's Business Profile policy and reachable
-- by the FTC as suppression under 16 CFR Part 465. Every rating reaches the same four questions,
-- the same editable box and the same destination links.
-- scripts/_probe-review-gating.ts asserts that against the source and fails the build if a branch
-- reading this column ever appears.

alter table public.review_tool_submissions
  add column if not exists rating smallint,
  add column if not exists attested_at timestamptz,
  add column if not exists private_note text;

-- Separate from the add, so re-running this file does not error on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'review_tool_submissions_rating_check'
  ) then
    alter table public.review_tool_submissions
      add constraint review_tool_submissions_rating_check
      check (rating is null or rating between 1 and 5);
  end if;
end $$;

comment on column public.review_tool_submissions.rating is
  'How she rated the visit, 1 to 5. CAPTURED, NEVER ROUTED: no code path branches on this
   value, and scripts/_probe-review-gating.ts fails the build if one appears. Nullable because
   the stars are optional, like all four questions.';

comment on column public.review_tool_submissions.attested_at is
  'When she confirmed "I am a real customer of this business and these are my own words".
   The TIMESTAMP rather than a boolean: "she ticked it" and "she ticked it at 14:02 on the 4th"
   are different evidence and the column costs the same. Gates the Copy button and nothing else.';

comment on column public.review_tool_submissions.private_note is
  'Optional note for the business, offered to EVERY rating and never posted anywhere. It sits
   below the destination links in the DOM, on purpose: a private box that appears only under a
   low rating, in place of the public link, is the gating funnel this tool refuses to be.';
