-- 2026-04-21: per-lender offer tracking — minimal 4 columns
-- Mirrors the Zoho "Lender Submissions" subform on each Lead record.
-- Each row in deal_submissions = one lender the deal was sent to.
-- The existing `notes` column carries the Notes text (approved / declined reason / stips).

ALTER TABLE deal_submissions ADD COLUMN IF NOT EXISTS approved_amount numeric;
ALTER TABLE deal_submissions ADD COLUMN IF NOT EXISTS buy_rate numeric;
ALTER TABLE deal_submissions ADD COLUMN IF NOT EXISTS sell_rate numeric;
ALTER TABLE deal_submissions ADD COLUMN IF NOT EXISTS term text;

COMMENT ON COLUMN deal_submissions.approved_amount IS 'Amount the lender approved';
COMMENT ON COLUMN deal_submissions.buy_rate IS 'Lender buy rate / factor we pay (e.g. 1.25)';
COMMENT ON COLUMN deal_submissions.sell_rate IS 'Sell rate presented to merchant (e.g. 1.35)';
COMMENT ON COLUMN deal_submissions.term IS 'Free-text term, e.g. "40 weeks", "12 months", "90 days"';
