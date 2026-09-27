-- The v4 question set, and the rule that keeps a "Yes" out of a public review.
--
-- Run against prod Supabase. Safe to run twice: every statement below is a comment.
--
-- ‼️ THERE IS NO SCHEMA CHANGE HERE, AND THAT IS THE POINT.
--
-- review_tool_submissions.question_set_version is plain `text not null` with no CHECK
-- (docs/2026-08-18-client-hub.sql), so "v4" needs no migration to be storable. `answers` is jsonb,
-- so six keys fit where four did. concierge_configs.quick_actions already exists and its reader
-- already accepts the "booking" kind. A column added here would be a column to maintain for a
-- change that did not need one.
--
-- What DOES need writing down is the invariant, because it lives in TypeScript and the damage it
-- prevents lands in this table. A future reader with psql open and no editor should be able to
-- find out why there are no gate answers in `answers`.

comment on column public.review_tool_submissions.answers is
  'What she typed, assembled, one entry per question she answered.

   KEYS ARE QUESTIONS, NEVER CHIPS. v4 (2026-09-24) asks three yes/no questions before three of
   the free-text ones: did you have expectations, were you concerned, were you afraid. A Yes is a
   BRANCH. It decides which question is asked next and it is NOT STORED HERE, because a gate has
   no key in ReviewQuestion and therefore nowhere in this bag to land.

   That is load bearing rather than tidy. page-review.ts reads Object.values() off this column to
   pull quotable lines for a client page, so a stored "Yes" would be quotable as though she had
   written it, on a page published under the clinic name. FTC 16 CFR Part 465 is about review
   content the customer did not write.

   scripts/_probe-review-gating.ts asserts assemblePlain() of a gates-only bag is the empty
   string, and that no gate id is also a question key.';

comment on column public.review_tool_submissions.question_set_version is
  'Which set of questions she walked.

   "v3" is the four-question chat: worried, hoping, surprised, happened.
   "v4" is the Virtual Agent walk: service, liked, improve, expectations, concerns, fears.

   Both are live while the two are compared, chosen by an ?engine= parameter that only the two
   internal previews pass. A client host always renders the default, so a real customer cannot
   reach an unfinished flow.

   NOTHING MIGRATES AND NOTHING IS REWRITTEN. assembleLabelled() and assemblePlain() iterate the
   question list, so a row contributes no bullet for a key its set no longer asks. A v3 row read
   today produces exactly what it produced before v4 existed.';

comment on column public.review_tool_submissions.rating is
  'One to five, and it routes NOTHING. Captured for the client''s own reporting.

   Every value reaches the same questions, the same editable box, the same copy button and the
   same destination links. Routing by rating is review gating, prohibited outright by Google''s
   Business Profile policy and reachable by the FTC as suppression under 16 CFR Part 465.

   This is asserted in the build, not promised in a comment: scripts/_probe-review-gating.ts
   subtracts the five permitted expressions from BOTH review client components and fails if the
   word survives anywhere else. It runs in .github/workflows/checks.yml.';
