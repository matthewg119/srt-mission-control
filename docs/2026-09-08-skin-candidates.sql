-- Three page designs to choose between, and the choice that ends the conversation.
--
-- Matthew: upload an image of the ideal page, an automation returns three variations, pick one,
-- and that pick becomes the default design for every page drafted for that client after.
--
-- ‼️ ONE JSONB COLUMN AND NOT A TABLE, AND THE REASON IS THAT CANDIDATES ARE NOT AN ARTIFACT.
--
-- The durable thing is the CHOSEN skin, and clients.hub_skin already holds it, already carries
-- `source` and `sourceNote` recording where it came from, and is already the one thing
-- resolve.ts and page-preview.ts read at render. Candidates exist only between a screenshot and
-- a pick, which is usually minutes. A table would outlive the decision it exists for, would need
-- its own cleanup, and would invite somebody to query "what did we consider" as though a
-- discarded option were evidence of anything.
--
-- The set is REPLACED on every screenshot and CLEARED on a pick. There is no history here on
-- purpose: two candidate sets at once is two conversations about one design.
--
-- ‼️ NO DEFAULT AND NO BACKFILL, THE SAME CALL docs/2026-09-02-hub-skin.sql MADE FOR hub_skin.
-- NULL means "nobody has dropped a reference", which is different from "three were offered and
-- none was picked", and only one of those is a state anybody has to act on.

alter table public.clients
  add column if not exists hub_skin_candidates jsonb;

comment on column public.clients.hub_skin_candidates is
  'Transient. Three token sets derived from one screenshot read, written by handleSkinScreenshot '
  'and cleared by the pick. The chosen one lands on hub_skin. Never a layout: SkinRead has no '
  'field for markup, copy or section order, so a candidate cannot carry one. See '
  'src/lib/hub/skin-variants.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ AND A NOTE ABOUT WHAT THE PICK DOES TO theme.confirmedAt, BECAUSE IT REVERSES A RULE.
--
-- writeSkin() clears theme.confirmedAt on every skin write, deliberately: changing the look
-- un-confirms it, so an unconfirmed design can never reach a client's own domain. That rule is
-- unchanged for `template <name>`, for `skin reset` and for a screenshot read.
--
-- The PICK is different, and this is the one place it is written down. Step 15's verifier refuses
-- until themeConfirmed(clientId) is true, and its refusal says "open the client board, Theme
-- panel, then press Confirm". Choosing one of three rendered previews IS a person looking at it
-- and saying yes, which is exactly what hub-setup.ts:62 defines confirmed to mean. Making
-- somebody pick a design and then go and confirm the same design on a different screen is a
-- second signature on one decision, and a second signature people click through.
--
-- So confirmSkinPick() writes hub_skin and theme.confirmedAt in ONE update. The board's Confirm
-- button still exists and still works for everyone who never dropped a screenshot. Nothing about
-- the two evidence tiers changes: this is still a human action, recorded with who and when.
-- ─────────────────────────────────────────────────────────────────────────────
