-- /onboarding2, pass two: identity on screen one, one initial per PAGE, and a call day agreed in
-- the chat instead of a calendar embed.
--
-- ADDITIVE ONLY. The four onboarding2 tables already exist in production
-- (docs/2026-09-01-onboarding2.sql, docs/2026-09-02-onboarding2-name.sql), so nothing here may be
-- folded back into those files. Every statement is add-column-if-not-exists and is safe to run
-- more than once.
--
-- THE RULE BEHIND ALL OF IT: if we have already collected a piece of data, nothing later in the
-- funnel may ask for it again. The signature screen used to re-ask print name, business legal
-- name, title, email and phone, all of which the signer either had already typed or should have.
-- Screen one now collects the whole identity and the signature screen collects a signature, a
-- date and a business address.


-- ---------------------------------------------------------------------
-- 1. onboarding2_signings: the identity, captured on screen one.
--
-- ONLY ONE OF THESE FOUR IS ACTUALLY NEW, AND SAYING SO IS THE POINT OF THIS BLOCK.
-- business_legal_name, signer_title, contact_phone and contact_phone_typed have existed since the
-- first migration. What changed is WHEN they are written: screen one now sets them on the still
-- open row through patchOpenSigning(), which keeps its .is("signed_at", null) lock, and POST
-- /sign no longer accepts any of them from the request body. The three add-column lines below are
-- deliberate no-ops, kept so this file records the whole set the funnel now writes here rather
-- than leaving a reader to diff two migrations to work out which three already existed.
--
-- `website` is the genuinely new one. It used to be qualifying question 1, asked by the chatbot
-- after signature. It is now a required field on screen one, and intakePatchFrom() reads it off
-- THIS COLUMN to derive clients.domain. Without a domain, hostsFor() and seedDnsRecords() have
-- nothing to build from and the whole hub lane refuses, so this column is load-bearing for eight
-- delivery steps.
-- ---------------------------------------------------------------------

alter table public.onboarding2_signings
  add column if not exists website text;

-- Already present. Listed so the screen-one write set is legible in one place.
alter table public.onboarding2_signings
  add column if not exists business_legal_name text;
alter table public.onboarding2_signings
  add column if not exists signer_title text;
alter table public.onboarding2_signings
  add column if not exists contact_phone text;
alter table public.onboarding2_signings
  add column if not exists contact_phone_typed text;

comment on column public.onboarding2_signings.website is
  'The clinic website, captured on screen 1 with the rest of the identity. Was qualifying question 1 until 2026-09-03. intakePatchFrom() normalises it into clients.website and clients.domain, and the hub lane cannot run without the domain.';


-- ---------------------------------------------------------------------
-- 2. onboarding2_initials: an initial now covers a PAGE, which is a RANGE of sections.
--
-- THIS IS THE ONE CHANGE IN THIS FILE THAT TOUCHES A SECURITY PROPERTY, SO READ THE WHOLE
-- COMMENT. POST /sign refuses to record a signature unless every section in the snapshot has been
-- initialled (missingSections() in src/lib/onboarding2/initials.ts). That check is the only thing
-- that makes an initial mean somebody paged through the document; without it a hand-crafted POST
-- straight to /sign produces a signed agreement nobody read and every initial in the PDF is
-- decoration.
--
-- Nine clauses now lay out as four pages: 1 | 2,3 | 4,5,6 | 7,8,9. One initial per page, so four
-- rows rather than nine. THE CHECK IS NOT WEAKENED BY THIS, and here is exactly why:
--
--   - The page grouping is DECLARED in src/config/onboarding2-agreement.ts and frozen into
--     agreement_snapshot.pages at POST /start. It is never measured in the browser, so a narrow
--     phone and a wide laptop initial the same four things.
--   - Each page carries its own sha256, computed over EVERY section on that page joined on the
--     same RECORD separator canonicalDocument() already uses. The browser recomputes it over the
--     text it painted and echoes it. A mismatch is a 409, exactly as before.
--   - So the attested text is byte-identical: four page hashes over {1} {2,3} {4,5,6} {7,8,9}
--     cover the same characters, in the same order, with the same separators, as nine section
--     hashes did. What fell is how many times a person types two letters, not how much text they
--     attested to. A page hash is also strictly harder to forge selectively, because it cannot be
--     matched while altering any single clause on the page.
--   - coverageOf() expands page_sections into the covered set. missingSections() and its call
--     site in sign/route.ts are unchanged, so /sign still 409s with a list of SECTION numbers.
--
-- section_no, section_key and section_sha256 stay populated, with the page's FIRST section, so
-- the existing (signing_id, section_no, created_at desc) index and every current reader keep
-- working. A row written before this migration has page_sections null and coverageOf falls back
-- to [section_no], which is correct for it: back then a page was a section.
--
-- The unique (signing_id, client_nonce) idempotency key is untouched. A retry from a flaky phone
-- still collides instead of writing a second initial; going back to re-initial a page still mints
-- a new nonce and legitimately writes another row.
-- ---------------------------------------------------------------------

alter table public.onboarding2_initials
  add column if not exists page_no integer;

-- integer[], not a from/to pair. A page is defined by the sections it CONTAINS, and storing the
-- literal list means a later reader never has to re-derive a range against a snapshot that may
-- have been renumbered since.
alter table public.onboarding2_initials
  add column if not exists page_sections integer[];

alter table public.onboarding2_initials
  add column if not exists page_sha256 text;

comment on column public.onboarding2_initials.page_sections is
  'Every section number this one initial covers, verbatim from the snapshot page it was typed against. coverageOf() unions these to answer "which sections have been initialled". Null on rows written before 2026-09-03, when one initial covered exactly one section.';

comment on column public.onboarding2_initials.page_sha256 is
  'The hash of the WHOLE page as it was on screen, computed by the browser over the text it rendered and checked against the snapshot before this row was written. section_sha256 still carries the first section hash so older readers keep working.';


-- ---------------------------------------------------------------------
-- 3. onboarding2_leads: the onboarding call, agreed in conversation.
--
-- NO CALENDAR LINK ANYWHERE IN THIS FLOW (Matthew, 2026-09-03). The Calendly embed, the
-- postMessage listener and the booking screen are all deleted. The assistant congratulates them,
-- asks mornings or afternoons, then offers today, tomorrow and the day after within that daypart,
-- with the three days computed SERVER-SIDE from the current time so the model cannot invent one.
--
-- booked_slot_at and calendly_event_uri are left in place and simply stop being written. They
-- describe a confirmed calendar event, which is a different fact from "they said Thursday
-- afternoon", and overloading one to mean the other is how a column ends up lying. The partial
-- index onboarding2_leads_unbooked_idx keys on booked_slot_at and therefore now lists every
-- completed lead, which is honest: none of them has a calendar event yet.
--
-- A DATE, NOT A TIMESTAMPTZ. We agree a DAY and a HALF of it. Storing "Thursday afternoon" as a
-- timestamptz would mean inventing a clock time and a timezone for a clinic whose timezone we do
-- not know, and a fabricated 13:00 would be indistinguishable from a real one to every later
-- reader. The day options are generated in America/New_York, which is ours, and that is stated in
-- src/lib/onboarding2/scheduling.ts rather than implied by a column type.
-- ---------------------------------------------------------------------

alter table public.onboarding2_leads
  add column if not exists call_daypart text;
alter table public.onboarding2_leads
  add column if not exists call_day date;
alter table public.onboarding2_leads
  add column if not exists call_choice_label text;
alter table public.onboarding2_leads
  add column if not exists call_chosen_at timestamptz;

-- Text plus a named check, never a Postgres enum. Nothing in this database uses one, because
-- widening a check is one statement and widening an enum inside a transaction with a running app
-- is not. Guarded so re-running this file does not fail on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onboarding2_leads_call_daypart_check'
  ) then
    alter table public.onboarding2_leads
      add constraint onboarding2_leads_call_daypart_check
      check (call_daypart is null or call_daypart in ('morning', 'afternoon'));
  end if;
end
$$;

-- The queue that replaces "signed, answered everything, has not booked". Partial, because a lead
-- who has picked a day is dead weight in this index forever.
create index if not exists onboarding2_leads_no_call_idx
  on public.onboarding2_leads (qualifying_completed_at desc)
  where qualifying_completed_at is not null and call_day is null and not is_demo;

comment on column public.onboarding2_leads.call_day is
  'The day they picked for the onboarding call, agreed in the chat with no calendar involved. Paired with call_daypart. A confirmed calendar event, if one is ever created, still belongs in booked_slot_at.';


-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'onboarding2_signings' and column_name = 'website';
--     -> 1 row. Without it screen one cannot store the website and clients.domain is never set.
--   select column_name from information_schema.columns
--    where table_name = 'onboarding2_initials'
--      and column_name in ('page_no','page_sections','page_sha256');
--     -> 3 rows. Without page_sections, coverageOf falls back to one section per initial and
--        POST /sign 409s "initials_incomplete" on every four-page signature.
--   select conname from pg_constraint where conname = 'onboarding2_leads_call_daypart_check';
--     -> 1 row.
