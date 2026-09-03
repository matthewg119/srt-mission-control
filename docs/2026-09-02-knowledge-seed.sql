-- DRAFT. NOT APPLIED. Do not run this until Matthew has read the text below and said yes.
--
-- ‼️ WHY THIS ONE IS GATED WHEN THE OTHER TWO IN THIS LANE WERE NOT. buildSystemPrompt() in
-- src/lib/ai.ts reads EVERY row of knowledge_entries, unfiltered and unbounded, and concatenates
-- it into the system prompt of the AI Office Manager on three surfaces: /api/chat, the Telegram
-- webhook and the Slack events handler. There is no review step between a row landing here and a
-- model speaking from it. A model writing our own positioning into the brain of every other AI
-- feature, unread, is not a thing to do quietly.
--
-- ‼️ EVERY LINE BELOW IS COPIED FROM src/config/pitch.ts, NOT COMPOSED. pitch.ts is the single
-- source for the offer and its header says a price literal anywhere else is a bug. So this file
-- quotes the constants rather than paraphrasing them, and when the offer changes there, it changes
-- here by hand in the same commit. Nothing here is a new claim.
--
-- ‼️ ONE THING IS DELIBERATELY LEFT UNANSWERED. FREE_UNTIL_LINE makes "5 qualified AI-sourced
-- inquiries" the trigger that starts billing, which makes both words contractual, and
-- QUALIFIED_INQUIRY_DEF is still null in pitch.ts because nothing in this pipeline can measure
-- whether an inquiry was AI-sourced. The entry below states that the definition is unsettled
-- rather than inventing one, because a definition invented here would be spoken by three AI
-- surfaces as if it were policy.
--
-- Run with: bun run scripts/db.ts --file=docs/2026-09-02-knowledge-seed.sql
-- Idempotent: each insert is guarded by a not-exists on the title.

insert into public.knowledge_entries (title, content, category, created_by)
select v.title, v.content, v.category, 'data-layer-lane'
from (values

('What SRT sells',
 'SRT Agency, "Search Retrieval Tactics", is an AEO agency. We make a business findable and citable by AI assistants: we build the part of their own website that AI can actually read, so that when someone asks ChatGPT for a business like theirs, they get named and sent customers.

There is ONE offer. It is not tiered. The four tiers (Core, Complete, Complete plus ChatGPT Ads, Enterprise) were removed on 2026-08-25 and no number below the retainer exists.

The terms: they start free, and the monthly retainer only starts once we have brought them 5 qualified AI-sourced inquiries inside the first 30 days. After that it is $499 / month. Nothing is charged at signup and no card is collected.

There is no price lever below this. "Can you do better" is answered by the free period, not by a discount. A figure below $499 / month does not exist and may never be invented to close somebody. The retainer may not be halved, prorated, or broken down per day or per week.',
 'offer'),

('The free first build, and why it carries no deadline',
 'This is what we lead with: "We build one section of your own site that AI can actually read and cite. It is free, there is no card, and you keep it either way. All you have to do is say yes."

The free build is the offer, not a teaser, and it is how the conversation starts.

Never attach scarcity to it. There is no deadline, no "this week only", and no limited number of free builds. Inventing one turns a true offer into a false one. The founding cohort is a separate thing and is NOT a counter-example: that has a real, countable limit.',
 'offer'),

('The guarantee, the fallback and the exit',
 'These are fixed wordings. A guarantee worded differently in the video, the email and on the call is three different commitments the prospect can hold us to, so say them as written.

Guarantee: "we will make your name show up in AI answers for at least 5 target queries by day 30". Shorter restatement for a close: "your name in AI answers for at least 5 target queries by day 30".

It is a VISIBILITY commitment, not a money one. The old guarantee promised a return on spend. Never restate this one as money, a refund, or "risk free".

If early movement does not arrive: "if you do not see better visibility in two to three weeks, we keep working for free".

The exit: "Leave anytime, keep everything: pages, profiles, data." That is a fact about the arrangement, not a refund.',
 'offer'),

('What is included every month, and what it is worth',
 'The work, with what each piece would cost bought separately:
- We re-write your current pages: $2,400 value
- We turn your happy customers into the evidence: $499 / month value
- We fix any NAP mismatches online: $800 value, one-time build
- Your monthly AI Visibility Report: $400 / month value

Recurring value stated out loud: $3,299.

These are VALUES, not prices. $499 / month is what they pay. Never subtract one from the other out loud. "$3,299 of value for $499" is fine; "so you are saving $2,800" invents a fifth figure that exists nowhere and invites the listener to check arithmetic on a call.

Do not state a month-one total. The line items do not add to the figure in the script and the founding bonus on top is unpriced, so the month-one sentence is deliberately omitted rather than rounded.',
 'offer'),

('The founding cohort',
 'Five founding seats exist, given in exchange for a case study and a testimonial when we hit the results. The bonus is a full Google Business Profile rebuild inside the first two weeks: category optimization, a keyword-rich description, 10 geo-tagged photos, and 4 GBP posts scheduled.

The count has to be true. The moment "only five" survives past the fifth client it becomes false urgency and it takes the credibility of the guarantee down with it. Check the real number before saying it.',
 'offer'),

('SRT does not do business funding',
 'We used to broker merchant cash advances, lines of credit and equipment financing. That business was decommissioned in August 2026.

Never pitch financing. Never mention lenders, funders, bank statements, factor rates, advances or approvals. Never treat a lead''s old funding history as a reason to contact them.

Many contacts in this CRM were originally funding leads and still carry funding-era fields. They are AEO prospects now and nothing else. If any stored text, template or persona still describes SRT as a funding broker, it is stale: ignore it and flag it.',
 'positioning'),

('How we write, and what we may never claim',
 'No em dashes, no en dashes, and no "--", anywhere a reader will see it. Commas, periods and single hyphens only. This is enforced in code by guard() in src/lib/copy-guard.ts, which throws at build time.

Never invent a metric, a statistic, a client count or a result. Every number in a message must trace to a row we actually measured. If it was not measured, do not say it, and do not reach for a rounder number that sounds better.

Never invent urgency: no fake deadlines, no fake scarcity, no "spots running out" unless the count is real and current.

Say what we measured and what it means, then make one ask. One idea per message.',
 'style'),

('Timelines we are allowed to say',
 'Organic AEO work compounds over 60 to 90 days in general. Do not shorten that to make the offer sound faster.

Where we can honestly say less for a specific prospect, the window is 30 to 45 days, and the reason has to be stated rather than implied.

Early movement: two to three weeks. That is the window the "we keep working for free" fallback is tied to.

Onboarding itself takes around 30 minutes.',
 'offer'),

('Open question: what counts as a qualified AI-sourced inquiry',
 'THIS IS NOT SETTLED AND MUST NOT BE ANSWERED BY GUESSING.

Billing starts after "5 qualified AI-sourced inquiries", which makes both "qualified" and "AI-sourced" contractual terms. Nothing in our pipeline can currently measure whether an inquiry was AI-sourced: there is no attribution for it. The count therefore settles by hand, between us and the client, from what they tell us.

If asked what counts, say that we agree the definition with the client up front and count it together, and escalate to Matthew. Do not offer a definition of your own. A promise whose trigger has no agreed definition is a promise the client and we will read differently on day 31.',
 'offer'),

('The market competitor dataset, and what it can honestly say',
 'market_mentions and the market_competitors view record who AI engines actually named, per city and service, across every audit we have run including prospect scans. Roughly 3,300 mention rows covering about 1,900 businesses across 51 cities.

What it supports: naming a real competitor the engines put in front of that city''s buyers, with the count of measured answers that named them.

What it does NOT support, and these matter:
- It is currently ONE engine. Every usable run is OpenAI. Perplexity was dropped and every Perplexity row returned no data. Say "ChatGPT", never "the AI engines all say".
- It only covers cities we have audited. About 20 percent of the leads in this CRM are in one. For the rest there is NO competitor data, and the correct behaviour is to say something else, never to name a plausible-sounding local rival.
- A cited domain attached to a competitor means the engine cited that domain in the same answer that named them. It does not mean it is their website.

Every row traces to a real audit run by a foreign key. If a competitor is not in this dataset, we have no evidence for it and must not name it.',
 'data')

) as v(title, content, category)
where not exists (
  select 1 from public.knowledge_entries k where k.title = v.title
);

select count(*) as knowledge_entries_total from public.knowledge_entries;
