-- The hub SKIN: which template a client's pages are built on, and the ground colours it
-- stands on. Add-only. Run it BEFORE deploying (see the note at the bottom).
--
-- Why a SECOND column rather than more keys inside clients.theme:
--   theme     is the CLIENT's brand. Logo, accent, font, extracted from their own homepage,
--             and its whole value is that provenance.
--   hub_skin  is OUR format. Which of four layouts, how wide the measure, how round the
--             corners, what the page sits on. Nobody's brand, and nothing read off their site.
-- Keeping them disjoint is what stops the two writers from having a precedence puzzle to
-- resolve, and readTheme() strips keys it does not know, so a skin stored inside theme would
-- have been silently dropped on the first read anyway.
--
-- The confirmation stays on theme.confirmedAt, deliberately, and is NOT duplicated here.
-- "The look is signed off" is one decision. Two independent gates would let a hub go live
-- half-confirmed with no honest way to say which half.

alter table clients
  add column if not exists hub_skin jsonb;

comment on column clients.hub_skin is
  'Hub/review-tool SKIN: {template, ground colours, headingFamily, radius, measure, baseSize, '
  'source, sourceNote, updatedAt, updatedBy}. Validated by src/lib/hub/skin.ts readSkin() on '
  'every read, so a bad value is dropped rather than rendered. NULL = the Document template '
  'with no overrides, which is what every hub built before 2026-09-02 renders. Confirmation '
  'lives on clients.theme.confirmedAt and covers both objects.';

-- No backfill and no default, on purpose.
--
-- NULL and "somebody chose Document" are different facts: readSkin(null) reports source
-- 'default', so the board and the step card can say "nobody has picked a template" rather
-- than claiming a decision nobody made. Writing '{"template":"document"}' across every
-- existing row would erase that distinction permanently, and it buys nothing — the renderers
-- already treat NULL as Document.

-- ‼️ ORDER OF OPERATIONS: RUN THIS BEFORE THE DEPLOY, NOT AFTER.
--
-- src/lib/hub/resolve.ts names hub_skin in the SELECT that every hub page request goes
-- through, and PostgREST fails the WHOLE select on one unknown column. So a deploy that lands
-- ahead of this migration does not degrade to an unskinned hub: it throws in resolveHost(),
-- which is deliberately not caught, which becomes a 5xx on every client's live hub and on
-- both previews. Minutes, on pages Google has already crawled.
