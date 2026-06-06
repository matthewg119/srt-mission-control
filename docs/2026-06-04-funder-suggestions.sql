-- Email-driven "ready to shop" funder suggestions.
--
-- 1. lenders.underwriting_box — free-text "what this funder wants" box used by the AI
--    matcher (suggest-funders.ts) to decide which funders fit a deal. Populate per
--    funder via docs/funder-uw-box-prompt.md. Funders without a box can still be named
--    manually; they just won't be auto-suggested with a fit reason.
-- 2. email_submissions.suggested_lender_ids — the funder set the bot suggested for a
--    New-Deal email, so a later in-thread `go`/`all` reply knows who to forward to.
--
-- Run in Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.lenders
  ADD COLUMN IF NOT EXISTS underwriting_box TEXT;

ALTER TABLE public.email_submissions
  ADD COLUMN IF NOT EXISTS suggested_lender_ids UUID[] DEFAULT '{}';
