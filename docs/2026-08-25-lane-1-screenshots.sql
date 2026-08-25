-- LANE 1 — screenshots become evidence (2026-08-25)
--
-- ONE TABLE, TWO COLUMNS. Everything else this lane needed already exists in production and was
-- verified there before a line was written:
--
--   client_docs.presence_source_url      exists, null on all 35 rows
--   client_docs.presence_attributed_by   exists, null on all 35 rows
--   nap_discrepancies.proposed_status    exists, along with raw_name / raw_address / raw_phone,
--                                        listing_url, screenshot_ref and claimed
--
-- So the vision attribution path and the step 14 listing pass need no migration at all. What was
-- missing is the review grid's proposal slot.
--
-- Add-only. Nothing is dropped and nothing is backfilled.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- review_audit_rows: a place for a reading that is NOT an answer
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The tool proposes, a person confirms. A count read off a screenshot lands in `proposed` and
-- nothing downstream reads it: findings section 3, the call sheet and isRecorded() all read
-- review_count, which is written only by applyProposedReadings, which runs only from a button
-- press. A row carrying a proposal and no confirmation reads as "not recorded" everywhere.
--
-- jsonb rather than a column per field, deliberately. These are five values that only mean
-- anything together, they are never queried individually, and giving each one a real column
-- would put a nullable near-duplicate of every recorded column on the table, which is how
-- somebody eventually reads the wrong one.

alter table public.review_audit_rows
  add column if not exists proposed        jsonb,
  add column if not exists proposed_source text;

comment on column public.review_audit_rows.proposed is
  'What a screenshot was READ as, waiting for a person to confirm it. Never an answer: '
  'review_count is the answer and only applyProposedReadings writes it, from a button press. '
  'Shape: { reviewCount, averageRating, mostRecentReviewAt, ownerRepliesInLastTen, listingUrl, '
  'screenshotRef, evidence, readAt }. ownerRepliesInLastTen is the COUNT that was read (0 to 10); '
  'the conversion to owner_response_rate happens once, on confirm, so the proposal stays '
  'checkable against the picture it came from.';

comment on column public.review_audit_rows.proposed_source is
  'Where the proposal came from. Today always ''screenshot''. It exists so a future second '
  'source cannot be mistaken for this one after the fact.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT IN THIS MIGRATION, and each absence is deliberate
-- ─────────────────────────────────────────────────────────────────────────────
--
-- No CHECK on proposed_source. It is a provenance note, not a state machine, and a constraint
-- on it would have to be migrated every time a source is added.
--
-- No index. These rows are only ever read a whole client at a time (16 rows for a client with
-- three competitors), and the existing review_audit_rows_client_idx already covers that.
--
-- No backfill of client_docs.presence_attributed_by on the thirteen rows already attributed on
-- the live client. They are all message_text attributions by construction, because until this
-- lane shipped the text path was the ONLY writer of presence_platform, and presenceCoverageFor
-- reads a null as message_text for exactly that reason. Writing a value we inferred would make
-- an inference look like a record.
--
-- PLATFORM_COUNT moved 18 to 19 with Trustpilot. That needs no migration either: nap_sweep's
-- verifier will read "18 of 19 seeded" for any client seeded before this, and its own refusal
-- already says to un-tick the step to re-seed. seedPresenceSweep upserts with ignoreDuplicates
-- against the (client_id, platform, listing_url) NULLS NOT DISTINCT index, so a re-seed adds the
-- nineteenth row and touches nothing already filled in.
