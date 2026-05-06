-- Add guideline PDF storage columns to lenders table.
-- Run in Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.lenders
  ADD COLUMN IF NOT EXISTS guideline_pdf_url   TEXT,
  ADD COLUMN IF NOT EXISTS guideline_pdf_name  TEXT;
