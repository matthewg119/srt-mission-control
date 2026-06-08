-- statement_drops.email_note — the merchant note typed alongside a #srt-sub
-- bank-statement drop (e.g. "Looking for 5-10k working capital").
--
-- It renders verbatim under the deposit table in the generated Submissions email
-- draft (replacing the blank "Merchant is looking for $___ for ___" placeholder),
-- and is stored here so thread rebuilds ("3 months", "override", "rebuild") keep it.
--
-- Run in Supabase prod (SQL editor) before deploying the feature.

alter table public.statement_drops
  add column if not exists email_note text;
