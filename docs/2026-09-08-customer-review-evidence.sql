-- A customer's own published review, quoted verbatim, as evidence a page can rest on.
--
-- Matthew: "an option within the drafter to create a new post or create from a review where we
-- can send a screenshot of the review and highlight it in a post", and then: point it at the
-- offer we are promoting and at the keyword strategy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ‼️ THIS IS NOT THE REGULATED THING, AND draft-page.ts:3-8 IS ALREADY THE ARGUMENT.
--
-- FTC 16 CFR Part 465 regulates a tool that GENERATES review content its user did not write.
-- That is the Rytr fact pattern and it is why src/lib/hub/review-assemble.ts imports nothing.
--
-- This is the other side of the same line, and draft-page.ts states it: "A hub page is the
-- CLIENT's own marketing copy on the client's own domain, published under their name after a
-- person read it, the same thing an agency has always written for a client. Different artifact,
-- different rule." Quoting a review a customer ALREADY PUBLISHED, character for character, in
-- that marketing, is ordinary. Nothing here goes near review-assemble.ts and nothing here
-- writes a word a customer did not.
--
-- The enforcement is that the quote is TRANSCRIBED and never edited: review-quote-read.ts
-- returns what is printed, the drafter is told to quote it or drop it, and a claim citing a
-- CUSTOMER_REVIEW source is rejected unless it appears verbatim in that source.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ FIRST-PARTY, AND isFirstParty() IS WHERE THAT IS DECIDED, NOT HERE.
-- A customer's own words about this business are the business's own knowledge in the sense the
-- gate cares about: a real person said it about this client, and it is checkable against the
-- screenshot it was read off. This constraint only says the value is legal. Every consumer
-- imports isFirstParty() rather than writing the list again, which is what stops "the client
-- said this" and "a model wrote this" quietly becoming the same thing.
alter table public.page_sources drop constraint if exists page_sources_type_check;
alter table public.page_sources add constraint page_sources_type_check
  check (source_type in (
    'CLIENT_VOICE',
    'CLIENT_DOCUMENT',
    'CLIENT_WEBSITE',
    'FIRST_PARTY_DATA',
    'CUSTOMER_REVIEW',
    'EXTERNAL_RESEARCH',
    'AI_DERIVED'
  ));

-- Two new ways a source arrives, both named so a quote can be traced back to how it was got:
-- read off a screenshot of a public listing, or read out of the client's own review tool.
alter table public.page_sources drop constraint if exists page_sources_via_check;
alter table public.page_sources add constraint page_sources_via_check
  check (collected_via is null or collected_via in (
    'slack_voice',
    'slack_typed',
    'board',
    'crawl',
    'audit',
    'review_screenshot',
    'review_tool'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- The transient slot a screenshot read lands in, before anybody has confirmed it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ‼️ ONE JSONB ON THE SESSION, NOT A TABLE, the same call docs/2026-09-08-skin-candidates.sql
-- made and for the same reason. A proposed quote exists only between a screenshot and a
-- confirmation, which is seconds. A table would outlive the decision it exists for and would
-- invite somebody to query "what did we consider" as though a discarded read were evidence.
--
-- It is REPLACED on every screenshot and CLEARED on confirm. Two proposals at once is two
-- conversations about one quote.
--
-- ‼️ AND IT IS THE proposed_* SLOT THE DOCTRINE REQUIRES. review_audit_rows.proposed is the
-- precedent: a model reading a picture proposes, and a person confirms. The durable row is the
-- page_sources row, and nothing writes one except somebody pressing the button.
alter table public.page_studio_sessions
  add column if not exists proposed_review jsonb;

comment on column public.page_studio_sessions.proposed_review is
  'Transient. One review read off a screenshot, verbatim, awaiting [Use this quote]. Replaced '
  'on the next screenshot and cleared on confirm. A proposal is not a record: the durable row '
  'is in page_sources and only a person creates one.';
