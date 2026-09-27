-- Which page a lead came from, on the card rather than in a reply nobody opens.
--
-- ‼️ RUN THIS BEFORE THE DEPLOY, AND THIS ONE IS NOT THE USUAL WARNING. Most of these migrations are
-- "run it first or the feature is inert". This one is different: lead-intake.ts writes source_page in
-- the contacts INSERT unconditionally, so on a database without the column EVERY new lead in the app
-- fails to be created. Not the concierge, not one funnel: all eleven ingestLead callers, plus Speed to
-- Lead and the Slack thread that hang off the contact id it returns.
--
-- It was left unconditional on purpose. A conditional write would not have saved anything (the moment a
-- lead actually HAS a page the insert fails either way) and would have hidden the dependency instead of
-- declaring it. The card read is safe either way: lead-thread.ts selects * and filters empty fields, so
-- a missing column renders as a card without a Page line.
--
-- ‼️ IT IS NOT contacts.source. That column is an origin TAG ("concierge", "pdf", "facebook_lead") and
-- is what every query and the #hot-leads filter group by. This is the URL a human recognises. A lane
-- that put a path into source would break all of them, which is why they are two columns.
--
-- Null where there genuinely is no page: a Meta lead ad is filled in inside Facebook and never touches
-- the site, a ReachInbox reply arrives as mail, and a pilot start happens after the page that earned the
-- lead already recorded itself. Each of those is a comment at its call site, not a gap.

alter table public.contacts add column if not exists source_page text;

comment on column public.contacts.source_page is
  'Host and path the lead came from, no scheme, e.g. "srtagency.com/scan". Rendered on the #hot-leads '
  'card next to Source. Preferred from the Referer on the capturing request, falling back to the funnel '
  'the route knows it is. NULL where there is no page: lead ads, email replies, post-payment provisioning.';

-- ‼️ NOT BACKFILLED, AND THAT IS DELIBERATE. Every lead before today has its page in a Slack thread
-- reply as prose, if it has one at all, and those strings were built by six different callers in five
-- different shapes ("Funnel: /scan", "Page: clinic.com/pricing", nothing). Parsing them into a column
-- would be inventing attribution for leads nobody can check any more. An empty column reads as "before
-- we recorded this", which is true. A wrongly parsed one reads as a fact.

-- How many leads from here on carry one, so the first day can be checked.
select
  count(*)                                       as contacts,
  count(*) filter (where source_page is not null) as with_a_page,
  count(*) filter (where created_at > now() - interval '1 day') as created_today
from public.contacts;
