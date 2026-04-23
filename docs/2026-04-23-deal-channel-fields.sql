-- Per-deal Slack channel.
-- Once Vektor sends a deal to its first lender, a dedicated public channel
-- `#deal-<slug>-<id>` is opened for ongoing lender communication. All future
-- submission_sent / funder_reply / approved / declined posts go there
-- instead of the #pipeline-new parent thread.
--
-- Run in: Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS slack_deal_channel_id   TEXT,
  ADD COLUMN IF NOT EXISTS slack_deal_channel_name TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_slack_deal_channel
  ON public.deals(slack_deal_channel_id)
  WHERE slack_deal_channel_id IS NOT NULL;
