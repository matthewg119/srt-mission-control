-- The client's visual theme for the hub and the review tool.
--
-- Safe to run more than once.
--
-- WHY THIS EXISTS. Runner v3 5f and 5g: the hub and the review tool have to read as the
-- clinic's own pages, not as an agency's. A customer who scans a card in a waiting room and
-- lands on something that looks like a SaaS product does not leave a review.
--
-- ‼️ VISUAL ONLY, AND THE SHAPE ENFORCES IT.
-- 5g is explicit: "The COPY, the four questions, the flow, the bullet labels, the
-- destination links and every rule in the build spec are IDENTICAL for every clinic and are
-- not themable. Visual theme per client; wording and structure never."
--
-- So this is ONE jsonb column holding four visual keys and nothing else:
--   logoUrl, accent, accentSoft, fontFamily
-- plus provenance: extractedFrom, extractedAt, confirmedAt, confirmedBy.
--
-- It is deliberately NOT a set of typed columns, and equally deliberately NOT a free-form
-- settings bag. src/lib/hub/theme.ts reads it through readTheme(), which returns exactly
-- those keys and drops everything else — so a stray "headline" written into this column by
-- some future hand never reaches a page. The validation lives in code because the values
-- are scraped from a third party's homepage and are injected into a style attribute: hex
-- colours only, a tight character class for font stacks, http(s) URLs only.
--
-- WHY THE THEME IS NOT LIVE UNTIL A HUMAN SAYS SO. 5f: "Theme confirmed by me in the
-- dashboard before the preview is shown." activeTheme() returns null while confirmed_at is
-- absent, so an extracted-but-unconfirmed theme renders as the default. An accent scraped
-- from a cookie banner is a thing to look at on the board, never a thing a client discovers
-- on a call.
--
-- WHY BACKGROUND AND FOREGROUND ARE NOT THEMABLE. The hub is a light document whose entire
-- purpose is being read and quoted, by people and by crawlers. A client-chosen background
-- is how it becomes unreadable on somebody's phone, and there is no version of that trade
-- that is worth it. Two variables move: --hub-accent and --hub-accent-soft.

alter table public.clients
  add column if not exists theme jsonb;

comment on column public.clients.theme is
  'Visual theme for the hub and review tool: logoUrl, accent, accentSoft, fontFamily, plus '
  'extractedFrom/extractedAt/confirmedAt/confirmedBy. VISUAL ONLY — no copy, no labels, no '
  'destinations (Runner v3 5g). Read it through readTheme() in src/lib/hub/theme.ts, which '
  'validates every value before it reaches a style attribute. Not applied to any page until '
  'confirmedAt is set.';

-- No backfill and no default. A NULL theme is the correct starting state and renders the
-- built-in palette, which is what every client has today.
--
-- select legal_name, theme->>'accent' as accent, theme->>'confirmedAt' as confirmed
--   from public.clients order by created_at;
