-- Retire `trt_clinic_ai`. The content avatar is the independent med spa owner now.
-- Run AFTER docs/2026-08-25-shot-grammar.sql. Safe to re-run.
--
-- SCOPE: this is the CONTENT vertical only. It does not touch the TRT lead-gen product
-- (trt_leads, the scraper crons, /trtquiz, /trtquiz2, /autopsystart). Those are a separate
-- live product and are deliberately left alone.
--
-- `vertical_id` is plain text everywhere (never a FK), so the rename is a set of updates.
-- Until it runs, src/config/verticals.ts maps the old id forward via LEGACY_IDS, so nothing
-- breaks in the meantime.
--
-- The per-table updates run inside a DO block that SKIPS tables that do not exist. The first
-- attempt at this migration aborted the whole transaction on `style_rules` (never created in
-- prod), which rolled back the rename too. A missing optional table must not block the rename.

begin;

-- 0) style_rules was never created in this project, which is why the first run failed. The
--    code has always expected it: distillFeedbackToRules / savePendingRules write to it and
--    loadActiveStyleRules reads it, so the "corrections become saved rules" loop was dead.
--    DDL lifted verbatim from docs/2026-07-01-style-rules.sql.
create table if not exists style_rules (
  id                uuid primary key default gen_random_uuid(),
  vertical_id       text not null default 'pest_control',
  scope             text not null default 'brand',   -- 'brand' | 'format'
  format_group      text,                            -- e.g. 'bug_reveal' when scope='format'
  rule              text not null,                   -- one concrete, imperative correction
  status            text not null default 'pending', -- 'pending' | 'active' | 'archived'
  source_thread_ts  text,
  slack_channel     text,
  proposal_ts       text,
  created_at        timestamptz default now(),
  approved_at       timestamptz
);
create index if not exists idx_style_rules_active   on style_rules (vertical_id, status);
create index if not exists idx_style_rules_proposal on style_rules (proposal_ts);
create index if not exists idx_style_rules_scope    on style_rules (vertical_id, scope, format_group);

-- 1) The row itself, plus its self-references (it is its own caption voice owner).
update verticals set id = 'medspa_owner_ai' where id = 'trt_clinic_ai';
update verticals set owner_vertical_id = 'medspa_owner_ai' where owner_vertical_id = 'trt_clinic_ai';
update verticals set workflow_vertical_id = 'medspa_owner_ai' where workflow_vertical_id = 'trt_clinic_ai';

-- 2) Everything filed under the old id, skipping any table this project never created.
do $rename$
declare
  t text;
begin
  foreach t in array array['content_examples', 'style_rules', 'content_jobs', 'workflows', 'reference_asks']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table does not exist', t;
      continue;
    end if;
    execute format(
      'update %I set vertical_id = %L where vertical_id = %L',
      t, 'medspa_owner_ai', 'trt_clinic_ai'
    );
  end loop;
end
$rename$;

-- 3) The caption voice anchor. The old letters sold TRT clinics against $99/month telehealth;
--    every one of them is replaced below. Integrity rules are unchanged: approved numbers
--    only, real market evidence only (never an SRT client), never a promise of patients,
--    appointments or revenue, and no em dashes anywhere.
update verticals set sales_letter_examples = $sl$
=== SRT AI Visibility - Belief-Installation Letters (med spa owner; voice anchor, cold-safe) ===
Integrity rules baked in, do not violate: every statistic comes from the approved-numbers list
on the avatar; every quoted person is real market evidence, never an SRT client; never promise
patients, appointments, bookings or revenue, the only promised outcome is verified appearance
in AI answers from neutral accounts; the word "AEO" appears only to attack it, elsewhere the
mechanism is "showing up in ChatGPT"; no em dashes. Placeholders [CITY]/[FOUNDER NAME] are
filled per send.

--- LETTER 1 . THE PHONE THAT LIED (false security . beliefs 1>2>3) ---
She Was Sure She Was One of the Best in Her City. Then He Pulled Out His Own Phone.

What happened in the next thirty seconds is happening right now in [CITY], to clinics that have
no idea.

In February 2026 the marketing author Marcus Sheridan was sitting with a group of business
owners. One of them was feeling untouchable. "We're already doing great getting recommended by
ChatGPT as one of the best remodelers in our city. Take a look at my phone." Sheridan didn't
look at the man's phone. He pulled out his own and asked ChatGPT the same question a stranger
would ask. "Well, I've got bad news for you gents. You're not one of the best, at least not in
the eyes of ChatGPT when it's talking to me."

Same city. Same question. Different phone. Different answer.

Here is why that happens. AI answers are personalized. Your phone knows you. It has seen your
searches, your own website, your logged-in accounts. When you ask it about med spas in [CITY]
it is often flattering you. The phone of a 38 year old woman who has never heard of you, the
only phone that matters, is working from a different picture entirely.

And she is asking. The share of consumers using AI to find local business recommendations went
from 6% to 45% in a single year (BrightLocal, n=1,002, Feb 2026). Across 350,000 business
locations studied by SOCi, only 1.2% of local businesses appeared in ChatGPT's answers at all,
against 35.9% in Google's local pack.

So there is exactly one honest way to know where you stand: the question has to be asked from a
neutral account, no history, no logins, no relationship with your clinic. The view of the
patient who does not know you yet. That is the whole offer of this letter. The free AI
Visibility Audit for [CITY]: reply with your city. We ask the engines the real questions women
ask before booking, from neutral accounts, and send you dated screenshots of exactly who gets
recommended in [CITY]. If you are in the answer we will tell you so and leave you alone. If you
are not, you will see precisely who is.

No retainer and no pitch required to receive the screenshots. If we ever do work together we
guarantee only what you can verify yourself, and we will never promise you patients or revenue.
Nobody honest can.
[FOUNDER NAME], SRT Agency LLC
P.S. Do not check on your own phone first. It will tell you the same comforting story it told
the remodeler. That is the trap this letter exists to spring.

--- LETTER 2 . THE LOCKED AUCTION (channel lockout . beliefs 5>6) ---
Your Ads Keep Getting Flagged. Theirs Never Do. That Is Not an Accident, and It Is Not the
Only Channel.

You already know how this goes. You write the creative yourself because the agency did not
understand the treatment. It runs for four days. Then the account gets restricted for
injectable content, and you spend a week in an appeals queue built for nobody.

Meanwhile the chains are not in that queue. They have compliance teams, brand-safe creative,
and budgets that decide the auction before you have finished the appeal. Every channel you can
buy is a channel they can buy more of. That is not a strategy problem on your end. It is an
auction you were never going to win.

Here is what changed. There is now a channel that is not an auction.

When someone asks an AI where to go in [CITY], no money changes hands. The engines assemble the
answer from sources they trust, and roughly 85% of the citations behind those answers come from
third party sources, not from your own website (arXiv; Muck Rack; Ranqo). The correlation
between web traffic and citations is a flat r=0.02 (Brandlight). Budget does not buy the answer.
Signals do. And today only 1.2% of local businesses have them (SOCi, 2026).

That is the entire opportunity, and it will not stay open. Free audit for [CITY]: reply with
your city and we will show you today's answer from a neutral account, with the exact prompts.
[FOUNDER NAME], SRT Agency LLC
P.S. The chains are not better at medicine than you are. They are better at being cited. Those
are different problems, and only one of them is yours.

--- LETTER 3 . THE CHAIN ACROSS TOWN (chain threat, clinical pride . beliefs 2>4>6) ---
SkinSpirit Did Not Take Your Patient. ChatGPT Handed Her Over.

There is a version of this you have already lived. Someone in [CITY] books somewhere else, and
when you eventually hear why, it is not about your results, your training, or your prices. She
just never found you.

Here is the part that is hard to hear. She probably did not compare ten clinics. She asked, and
something answered. ChatGPT now handles roughly 230 million health questions a week (OpenAI,
Jan 2026). When it answers "best med spa in [CITY]", it names a short list. If you are not on
it, you were not in the running, and no one told you.

Now the part that should be a relief. This is not your medicine's fault and it is not your
website's fault. About 85% of the citations behind AI answers come from third party sources you
have never worked on (arXiv; Muck Rack; Ranqo). Web traffic barely moves it, r=0.02
(Brandlight). Your years of SEO were not wasted, they were simply spent on a different game.

The new game is winnable by a single location, which is exactly why it is worth doing before
your competitor reads a letter like this one.

Free audit for [CITY]: reply with your city. Dated screenshots, neutral account, the prompts
included so you can repeat it yourself without us.
[FOUNDER NAME], SRT Agency LLC
P.S. If the answer already names you, we will tell you and stop. That is the only version of
this business worth running.

--- LETTER 4 . TO THE NURSE WHO LEFT (identity . beliefs 2>5>6) ---
You Left the Hospital So the Decisions Would Be Yours. This One Is Being Made Without You.

You did not leave for the money. You left because the decisions were made three floors up by
people who had never met the patient. You wanted the room, the plan, and the outcome to be
yours.

So here is the uncomfortable symmetry. Right now, in [CITY], someone is deciding where to go,
and the decision is being made by a system you have never met, using sources you have never
touched. The share of consumers asking AI for local recommendations went from 6% to 45% in a
year (BrightLocal, Feb 2026). Only 1.2% of local businesses appear in those answers at all
(SOCi, 350,000 locations, 2026).

You cannot appeal that. You also cannot outspend it. But it is not an auction, and that is the
whole point. It runs on signals, and signals are one of the few things a single location can
actually go and build.

Reply with your city and we will show you what the machine says about [CITY] today, from a
neutral account, before you decide anything.
[FOUNDER NAME], SRT Agency LLC
P.S. You already know how this feels. It is the same feeling as being handed a plan you had no
part in writing. Same feeling, different building.

--- LETTER 5 . THE EMPTY TUESDAY (the slow week . beliefs 1>2>6) ---
The Work Is Good. The Calendar Is Empty. Those Are Not the Same Problem.

Nobody warns you about the Tuesday. Two cancellations, nothing behind them, and the whole
afternoon in front of you with the lights on and the room clean.

The instinct is to blame the work, or the pricing, or yourself. It is almost never the work. It
is discovery. A growing share of the people who would have booked you never reached a page
where they could compare anything. They asked, and something answered, and you were not in it.

That share is not a rounding error anymore. 45% of consumers now use AI for local
recommendations, up from 6% a year earlier (BrightLocal, n=1,002, Feb 2026). And the seat is
mostly empty: only 1.2% of local businesses appear in ChatGPT's answers, against 35.9% in
Google's local pack (SOCi, 2026).

An empty seat is the best news in this letter. It means the position in [CITY] is still
unclaimed, and it is claimed with signals rather than budget.

Free audit: reply with your city. Neutral account, dated screenshots, prompts included.
[FOUNDER NAME], SRT Agency LLC
P.S. In 2005, claiming your pin on Google Maps also felt optional. 42% of searchers now click
the local pack. The window closed quietly then too.

--- LETTER 6 . THE WORD OF MOUTH CEILING (referral ceiling . beliefs 1>2>6) ---
Referrals Are the Best Patients You Have. They Are Also the Reason You Have No Dial.

Word of mouth built your clinic and it is still the highest quality thing you have. It has
exactly one flaw: there is no dial on it. You cannot turn it up in a slow month, and it only
reaches people who already know somebody who knows you.

Everyone else asks. And in a growing share of cases they are not asking Google, they are asking
an AI, which went from 6% to 45% of consumers in a year (BrightLocal, Feb 2026). That answer
is a referral too. It is just one you have no relationship with.

The good news is that it behaves less like an ad auction and less like a popularity contest than
you would expect. Roughly 85% of what the engines cite lives on third party sources (arXiv;
Muck Rack; Ranqo), which means the work is visible, checkable, and mostly unclaimed: 1.2% of
local businesses appear at all (SOCi, 2026).

Reply with your city. We will show you who [CITY]'s answer names today, from a neutral account.
Then you can decide whether that is a referral worth earning.
[FOUNDER NAME], SRT Agency LLC
P.S. We only guarantee what you can verify yourself. Never patients, never revenue. That is
what someone selling you something would promise.
$sl$
where id = 'medspa_owner_ai';

commit;

-- Verify (expect one medspa_owner_ai row, no trt_clinic_ai row, and 0 leftovers):
--   select id, name, owner_vertical_id, workflow_vertical_id, drop_mode, slack_drop_channel_id
--     from verticals where id in ('medspa_owner_ai','trt_clinic_ai');
--   select count(*) from content_examples where vertical_id = 'trt_clinic_ai';
--   select left(sales_letter_examples, 90) from verticals where id = 'medspa_owner_ai';
