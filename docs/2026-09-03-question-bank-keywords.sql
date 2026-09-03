-- question_bank learns a fourth source: the ranked keyword list from research section 9.
--
-- ‼️ THIS IS A BUG FIX, NOT A FEATURE. Section 9, extractKeywords() and the second upsert in
-- research-intake.ts all shipped in a9dc805 against a table that refuses the rows. The upsert is
-- ONE statement, so a single keyword killed the whole batch, keywordsStored stayed 0, and the
-- Slack reply printed "No KEYWORDS block found" to an operator who had just pasted a hundred of
-- them. Until this runs, section 9 is a prompt that asks for keywords, a parser that reads them
-- correctly, and a database that throws every one away while blaming the paste.
--
-- ‼️ ONLY THE SOURCE CONSTRAINT IS WIDENED. The intent one is NOT, and that is deliberate.
-- commercial_intent_score is SHARED with every phrase commercialIntent() scores on a 0-to-3
-- ladder, and the keyword parser was emitting 4 and 5. Widening the check to 0-to-5 would have
-- silenced the error while leaving the real fault in place: a keyword scoring 5 where the best
-- harvested phrase scores 3 does not rank higher because it is more commercial, it ranks higher
-- because it was measured with a different ruler, and page_candidates would have sorted every
-- keyword above every real buyer question forever. The parser was corrected to the existing
-- ladder instead (ready and price -> 3, comparing -> 2, researching -> 1).
--
-- A separate source is the whole point of the keyword lane: anything reading buyer phrases keeps
-- filtering on 'harvest' and 'deep_research' and carries on seeing exactly what it saw before
-- section 9 existed. Collapsing keywords into one of those would defeat that and pollute the
-- corpus a second time.
--
-- Safe to run more than once. Nothing is written or deleted; a constraint is replaced by a
-- strictly wider one, so no existing row can be invalidated by it.

begin;

alter table public.question_bank
  drop constraint if exists question_bank_source_check;

alter table public.question_bank
  add constraint question_bank_source_check
  check (source in ('harvest', 'deep_research', 'intake', 'keywords'));

commit;


-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect ONE row, and its definition must contain 'keywords'.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.question_bank'::regclass
  and conname = 'question_bank_source_check';

-- Expect the intent ceiling to still be 3. If this says 5, somebody widened the wrong
-- constraint and the keyword rows are now outranking every harvested phrase.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.question_bank'::regclass
  and conname = 'question_bank_intent_check';
