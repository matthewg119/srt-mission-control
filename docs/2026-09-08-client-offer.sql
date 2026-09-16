-- The one thing this client sells, proposed automatically and locked by a person on the call.
--
-- ‼️ THERE WAS NO OFFER ANYWHERE, AND THE FIELD THAT WAS SUPPOSED TO BE ONE HAD ALMOST NO READER.
--
-- `clients` has no offer, no primary_offer, no target_keywords. The nearest thing is
-- services.primary_treatment, whose own config comment (src/config/client-intake.ts:124-131) says
-- in capitals that it is "THE ONE FIELD THE WHOLE BUILD IS AIMED AT ... what we aim the pages, the
-- posts and the free offer at". It is REQUIRED at intake.
--
-- And the substitution chain never read it. treatmentPrimary in question-sets.ts resolved
-- ideal_patient.highest_margin, then the first line of services_list, then services.primary_service
-- (a key that has never existed). primary_treatment appeared at no position. Only
-- deep-research-run.ts read it. So the field the whole build is aimed at reached the research
-- prompt and nothing else: not the tracked question set, not the page candidates, not the
-- [treatment] substitution, not the magnet ladder.
--
-- Nothing was null and nothing errored. The work was simply aimed at the wrong thing, which is why
-- the step 13 PDF reads as padding: a whole-vertical phrase corpus with nothing tying it to what
-- this client actually sells, then sixty slots filled out of it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ ONE JSONB COLUMN AND NOT A client_offers TABLE, AND THE SINGULAR IS THE ARGUMENT.
--
-- docs/prompts/offers-pipeline.md asks for this decision to be justified here rather than in a
-- commit message. Three reasons, and the first is the real one:
--
-- 1. MATTHEW WANTS ONE. "find the exact offer / offers they want to promote, ideally just one."
--    A table models many and would immediately raise "which is primary", which is the question
--    this column answers by existing.
--
-- 2. EVERYTHING DOWNSTREAM INTERPOLATES ONE STRING. client-intake.ts:130-131 records why
--    primary_treatment is single-line and short: "a paragraph there would come back as a menu
--    again, and a menu cannot be interpolated into a sentence." [treatment] takes one value.
--    Introducing offers means confronting that singular, not routing around it.
--
-- 3. THE MAGNET SIDE ALREADY HAS A TABLE. lead_magnets holds the free thing given away, with a
--    client rung above every library rung, and approveMagnetCandidate is its only insert. The
--    offer names WHAT THEY SELL; the magnet is what we give away for it. A second table would
--    duplicate half of one that works.
--
-- It sits beside services and ideal_patient, which are the same shape and the same kind of thing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ TWO HALVES IN ONE BAG, AND THEY MEAN DIFFERENT THINGS.
--
--   proposedTreatment / proposedSource / proposedAt
--       Written by the offer_proposed runner. A READING of the intake form, no model call, always
--       carrying which field it came from. Overwritten freely. Never treated as decided.
--
--   treatment / magnetKey / positioning / lockedAt / lockedBy
--       Written by a person at offer_locked, live on the call. The only half anything downstream
--       reads as a decision. lockedAt and lockedBy are what separate "the form said this" from
--       "we agreed this".
--
-- Same split as every proposed_* slot in this repo. proposeOffer() never overwrites the locked
-- half, because re-running a reading of a form over a decision made on a call is exactly the
-- failure that split exists to prevent.
--
-- ‼️ NO CHECK CONSTRAINT ON THE TREATMENT TEXT, DELIBERATELY. It is the client's own words for
-- what they sell. A vocabulary would mean refusing a real business's real service because it was
-- not on a list somebody wrote in advance.
--
-- ‼️ NO DEFAULT AND NO BACKFILL. NULL means nobody has proposed anything, which is a state the
-- board can act on. An empty bag would look like a proposal that came back with nothing.
--
-- ORDER OF OPERATIONS: RUN THIS BEFORE THE DEPLOY. step-verify.ts names `offer` in CLIENT_COLUMNS
-- and question-sets.ts names it in its own select, and PostgREST fails the WHOLE select on one
-- unknown column. Until this has run, every verifier on the board refuses at once and every
-- substitution comes back null. Same trap docs/2026-09-02-hub-skin.sql documented for hub_skin.

alter table public.clients
  add column if not exists offer jsonb;

comment on column public.clients.offer is
  'The one offer everything is aimed at. Two halves: proposedTreatment/proposedSource/proposedAt '
  'written automatically by the offer_proposed runner from services.primary_treatment (a reading, '
  'never a decision), and treatment/magnetKey/positioning/lockedAt/lockedBy written by a person '
  'at offer_locked on the call. Only the locked half is read as decided. See '
  'src/lib/clients/offers.ts.';
