-- The lead magnet becomes a per-page decision, made before the page is drafted.
--
-- Matthew, 2026-09-03: the magnet is chosen in the AEO drafting workflow, for SRT and for every
-- future client, and the page is written toward it. Until now it was ranked out of lead_magnets by
-- rungOf() AFTER the page existed, over placement columns that are null on every live page, so
-- every page on every hub resolved the same wildcard row and the launcher pill read the same
-- hardcoded per-audience string no matter what the widget was about to hand over.
--
-- Three columns. Nothing is dropped, nothing is renamed, and every existing page keeps working:
-- a null lead_magnet_key means "let the ladder decide", which is exactly today's behaviour.

-- ── 1. The pill label ────────────────────────────────────────────────────────
--
-- ‼️ A SEPARATE COLUMN RATHER THAN A TRUNCATED title, because the two are read by different people
-- in different places. `title` is the offer spelled out inside the conversation; this is what a
-- stranger reads on a pill in the corner of a page before agreeing to anything. Truncating the
-- title gives "The 20 Questions Your Patients..." which promises nothing.
--
-- Null is legal and falls back to the title (pillLabel() in lib/concierge/magnets.ts). The probe
-- warns at 28 characters, which is where a corner button starts wrapping into a paragraph.
alter table public.lead_magnets add column if not exists cta_label text;

comment on column public.lead_magnets.cta_label is
  'Short launcher-pill label, under about 28 characters. Null falls back to title.';

-- ── 2. What a page is written toward ─────────────────────────────────────────
--
-- ‼️ A KEY, NOT A FOREIGN KEY, AND THAT IS DELIBERATE. `city_rivals` is seeded twice, once for
-- Comparison and once for Neighbourhood, so a page pointing at one row would be pointing at half
-- an offer. magnetByKey() resolves the key audience-scoped, which is the same firewall chains use.
--
-- Null means the ladder decides. Every page written before today is null and behaves as it did.
alter table public.client_pages add column if not exists lead_magnet_key text;

comment on column public.client_pages.lead_magnet_key is
  'lead_magnets.magnet_key this page was drafted toward. Null hands the choice back to the ladder.';

-- ── 3. Carried for the life of a conversation ────────────────────────────────
--
-- ‼️ ON THE SESSION BECAUSE THE PAGE IS ONLY IN FRONT OF US ONCE. The frame document holds the key
-- from the loader and /start writes it here; every later turn arrives with nothing but a token.
-- Re-deriving it from entry_path would mean parsing a URL back into a page row on every turn, and
-- would silently change the offer mid-conversation if somebody re-pointed the page while a visitor
-- was still reading it.
alter table public.concierge_sessions add column if not exists page_magnet_key text;

comment on column public.concierge_sessions.page_magnet_key is
  'The magnet the entry page named, frozen at session start.';

-- ── 4. Labels for the seven seeded rows ──────────────────────────────────────
--
-- NO EM DASHES. copy-guard.ts checks every other copy surface in this repo and the probe checks
-- this one. Keyed by magnet_key + audience, so the two city_rivals rows and the two question_20
-- rows both get the same label, which is what rows sharing a key are already required to do.
update public.lead_magnets set cta_label = 'Free AI visibility scan', updated_at = now()
 where magnet_key = 'visibility_scan' and audience = 'owner';

update public.lead_magnets set cta_label = 'Who AI names in your city', updated_at = now()
 where magnet_key = 'city_rivals' and audience = 'owner';

update public.lead_magnets set cta_label = 'The 20 questions PDF', updated_at = now()
 where magnet_key = 'question_20' and audience = 'owner';

update public.lead_magnets set cta_label = 'Free 3 minute skin scan', updated_at = now()
 where magnet_key = 'skin_scan' and audience = 'patient';

update public.lead_magnets set cta_label = 'Send me my skin report', updated_at = now()
 where magnet_key = 'skin_report' and audience = 'patient';

-- ── 5. What this should look like afterwards ─────────────────────────────────
select magnet_key, audience, cta_label, length(cta_label) as len, vertical, category
  from public.lead_magnets
 where active
 order by audience, sort_order, magnet_key;
