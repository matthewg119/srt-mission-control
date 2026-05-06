-- Vektor submission system — Saturday 2026-04-25 ops.
--
-- Staged 2026-04-23 (Thursday) while waiting for Vercel deployment quota to reset.
-- Run in Supabase SQL editor AFTER the Saturday push completes.
--
-- See plan: C:\Users\matth\.claude\plans\i-need-to-finish-nested-aurora.md

-- Piece C: SRT test lender row.
-- Purpose: Matt can reply `send to SRT` in any deal thread and receive the
-- outgoing Vektor submission email at matthew@srtagency.com for QA.
INSERT INTO lenders (
  name, tier, submission_method, submission_email,
  is_active, notes, products
) VALUES (
  'SRT Agency (test)',
  1,
  'email',
  'matthew@srtagency.com',
  true,
  'Test lender — routes a copy of every submission to Matt for QA. Do not remove; the bank-stmt → reply-to-send flow depends on this for dry-runs.',
  ARRAY['MCA']
)
ON CONFLICT (name) DO UPDATE
  SET submission_email = EXCLUDED.submission_email,
      is_active = true,
      notes = EXCLUDED.notes;

-- Piece D: today's/yesterday's new lender rows.
-- Matt to paste rows here before Saturday or run a second INSERT batch manually.
-- Template:
-- INSERT INTO lenders (name, tier, submission_method, submission_email, is_active, notes, products)
-- VALUES
--   ('<Lender Name>', <1|2|3>, 'email', '<submissions@lender.com>', true, '<notes>', ARRAY['MCA']),
--   ...
-- ON CONFLICT (name) DO UPDATE
--   SET submission_email = EXCLUDED.submission_email, is_active = true;
