-- Shot grammar + reference ask + B-roll voiceover (2026-08-25).
-- Safe to re-run. Everything is additive; nothing here drops or rewrites existing rows.
-- Until this runs, the app still works: the shot ledger falls back to "no history" (the
-- dealer just has nothing to avoid), the reference ask cannot track its threads, and `vo`
-- has nowhere to park its lines.

-- 1) Shot-grammar ledger: which combination each idea used, so the next deal can avoid it.
alter table broll_drops add column if not exists subject_key  text;
alter table broll_drops add column if not exists capture_key  text;
alter table broll_drops add column if not exists light_key    text;
alter table broll_drops add column if not exists grade_key    text;
alter table broll_drops add column if not exists framing_key  text;
alter table broll_drops add column if not exists presence_key text;
alter table broll_drops add column if not exists lane         text;

create index if not exists broll_drops_subject_idx
  on broll_drops (channel, subject_key, created_at desc);

-- 2) The daily "feed me examples" ask: one row per ask, so replies in that thread can be
--    claimed and filed into content_examples instead of starting a drop session.
create table if not exists reference_asks (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null,
  vertical_id  text not null,
  thread_ts    text not null unique,
  section      text not null,
  saved_count  int  not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists reference_asks_channel_idx
  on reference_asks (channel, created_at desc);

-- 3) Voiceover lines parked on a drop, so `vo` in that thread renders without regenerating.
--    asked_at is the confirmation gate: `yes` only renders after the lines were shown.
create table if not exists broll_voiceovers (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null,
  thread_ts   text not null unique,
  lines       jsonb not null default '[]'::jsonb,
  asked_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists broll_voiceovers_thread_idx
  on broll_voiceovers (thread_ts);

-- 4) The avatar is now the med spa owner, not the TRT clinic owner. The row's copy fields are
--    already NULL (the seed wins), but `name` was set in 2026-07-24-trt-clinic-vertical.sql and
--    still overrides it. The id stays as-is: it keys the drop channel and every filed reference.
update verticals
   set name = 'Med Spa Owner AI Visibility (B2B)'
 where id = 'trt_clinic_ai';

-- NOTE, not automated on purpose: this row's `sales_letter_examples` is still the TRT letter
-- set (it names "best TRT clinic near me" and $99/month telehealth). It is the caption voice
-- anchor, it is hand-written, and rewriting it is Matthew's call. Until it is replaced, drop
-- CAPTIONS will still speak TRT even though the B-roll prompts speak med spa.
