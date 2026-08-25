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

-- 3) The caption voice anchor. The old letters sold TRT clinics against $99/month telehealth.
--    Replaced with five GENERIC med spa letters written off the ChatGPT-Ads market research
--    (avatar sheet, the 6-belief ladder, the sourced Reddit/Trustpilot language). Generic on
--    purpose: this field steers caption VOICE, so the letters install beliefs and carry her
--    vocabulary without naming a mechanism or a price that would then leak into every caption.
--    NOTE: that research sells done-for-you PAID ChatGPT Ads, which is a different product from
--    what SRT sells. The avatar and the pain language transfer; the mechanism deliberately does
--    not. Integrity rules unchanged: cited numbers only, real market evidence never an SRT
--    client, no promise of patients or revenue, no em dashes.
update verticals set sales_letter_examples = $sl$
=== SRT AI Visibility - Belief-Installation Letters (med spa owner; caption voice anchor) ===
Five generic letters. GENERIC ON PURPOSE: they install beliefs and carry the avatar's voice, they
do not sell a named mechanism or a price. Captions borrow the cadence, the pain language and the
proof, never the offer.

Integrity rules baked in, do not violate: every statistic comes from the approved-numbers list on
the avatar or is cited inline below; every quoted person is real market evidence, never an SRT
client; never promise patients, appointments, bookings or revenue, the only promised outcome is
verified appearance in AI answers from neutral accounts; the word "AEO" appears only to attack it,
elsewhere the mechanism is "showing up in ChatGPT"; no em dashes. Placeholders [CITY] and
[FOUNDER NAME] are filled per send.

--- LETTER 1 . THE BLACK HOLE (it is broken, and it is not your fault . belief 1) ---
You Are Not Bad At Marketing. You Are Buying A Channel That Stopped Working.

Here is the sentence that shows up over and over in owner forums, in slightly different words every
time: "I feel like I'm throwing money into a black hole and hoping patients come out."

One owner put numbers on it. "honestly feeling a bit burnt out. spent $1500 last month on FB/IG ads
for my med spa. got leads, but half were ghosting and the other half were just looking for the
cheapest deal then never come back." (r/MedSpa) Another: "I invested a lot of time and money into
SEO, ads, multiple agencies, and was hoping to see enough improvement to justify renewing the
lease. But we haven't." (r/FacebookAds)

That second one is a person deciding whether to renew a lease.

The private version of this is worse than the public version, because privately it sounds like a
question about you. What am I doing wrong. Everyone else seems to be booked. It is not a question
about you. Average patient acquisition cost across med spas now runs about $285 (First Page Sage,
2026), the tracking that made paid social work was dismantled years ago, and the reports you get
back count impressions because impressions are what is left to count.

You cannot pay rent with impressions. You also cannot fix a channel by trying harder inside it.

What you can do is find out where the decision is actually being made now. Reply with your city and
I will show you what the AI answers today when someone in [CITY] asks where to go, from a neutral
account, with the exact prompts included so you can repeat it without me.
[FOUNDER NAME], SRT Agency LLC
P.S. If the answer already names you, I will tell you that and leave you alone. That is the only
version of this worth running.

--- LETTER 2 . SHE ASKED SOMETHING ELSE (the patient already moved . belief 2) ---
Your Next Patient Did Not Compare Ten Clinics. She Asked One Question And Got One Answer.

Picture the woman you want. Thirty eight, works, has been thinking about this for a year, has the
money, has never been to a med spa.

The old version of her opened Google, got ten blue links, read three, checked Instagram, and
eventually found you. Every step of that was a chance for you to be found.

The new version of her opens ChatGPT and types what she actually wants to know. She gets one
answer. Not a page. One. And whoever is named in it is the shortlist, because there is no page two
in a conversation.

That is not a forecast. ChatGPT has roughly 900 million weekly users (OpenAI, Feb 2026), around 20%
of conversations carry buying intent, and 53% of consumers now use AI to research before buying
(Pacvue, 2026). Meanwhile only 1.2% of local businesses appear in ChatGPT's answers at all, against
35.9% in Google's local pack (SOCi, 350,000 locations, 2026).

Read that last pair again. It is not that local clinics rank low in the new channel. It is that
almost none of them are in it.

Reply with your city. Neutral account, dated screenshots, the prompts included.
[FOUNDER NAME], SRT Agency LLC
P.S. Do not check on your own phone first. Your phone knows you. It is not the phone that matters.

--- LETTER 3 . THE ONE THAT IS NOT YOU (the personal wound . belief 3) ---
I Asked The AI Where To Go In [CITY]. It Named Three Clinics. None Of Them Were Yours.

Audits across more than fifty U.S. markets found that roughly 82% of med spas do not appear in AI
recommendations at all.

Most owners find this out the wrong way. They check on their own phone, see themselves, and file it
away as handled. That is exactly what happened to a business owner sitting with the marketing
author Marcus Sheridan in February 2026. "We're already doing great getting recommended by ChatGPT
as one of the best remodelers in our city. Take a look at my phone." Sheridan did not look at his
phone. He pulled out his own and asked the same question a stranger would ask. "Well, I've got bad
news for you gents. You're not one of the best, at least not in the eyes of ChatGPT when it's
talking to me."

Same city. Same question. Different phone. Different answer.

Here is the part that should take some weight off. This is not about your medicine and it is not
about your website. Roughly 85% of the citations behind AI answers come from third party sources
you have never worked on (arXiv; Muck Rack; Ranqo), and the correlation between web traffic and
citations is a flat r=0.02 (Brandlight). Your years of SEO were not wasted. They were spent on a
different game.

Reply with your city and I will send you what [CITY] gets told today.
[FOUNDER NAME], SRT Agency LLC
P.S. Free, no call required, and I will include the prompts so you can run it yourself next month
without me.

--- LETTER 4 . THE SEAT IS STILL EMPTY (the window . belief 4) ---
In 2005 Claiming Your Pin On Google Maps Also Felt Optional.

The businesses that claimed theirs early spent the next fifteen years being the default answer in
their city. The ones that waited spent those fifteen years buying their way back in.

Nobody framed it as a decision at the time. It looked like admin.

Right now 42% of searchers click the local pack, and the businesses sitting in it did nothing more
clever than get there first. The equivalent seat in AI answers is open, and it is mostly empty:
1.2% of local businesses appear at all (SOCi, 2026).

There are two reasons that seat closes. The first is that position compounds, because the sources
these systems cite consolidate over time and the clinic already being cited keeps getting cited.
The second is arithmetic. There is room for a short list per city, and your city has other clinics
in it, some of them reading something like this.

Waiting is not neutral here. It is asymmetric. Conquering an empty seat is cheap. Displacing
somebody who already has it is not.

Reply with your city and find out which of the two you are looking at.
[FOUNDER NAME], SRT Agency LLC
P.S. If it turns out a chain already owns your city's answer, you should know that this month
rather than next year.

--- LETTER 5 . DO NOT TAKE MY WORD FOR IT (why trust anyone again . belief 6) ---
You Have Been Burned By People Who Sound Like Me. So Do Not Believe Me. Verify It.

The complaints in this industry are specific and they are documented. "they made themselves the
sole Owner of our Google ads account and removed us. We literally lost our google ads account of 10
years and cannot control it or reclaim it." (Trustpilot) "I was told the agreement was month to
month, only to be told later that I was locked into something different." (Trustpilot) "Total
waste: 9000$ on 3 month subscription with no value." (Shopify App Store) "They advertise an ROI
guarantee that states, 'Get your ROI or you don't pay.' During the call, I learned that's not what
the guarantee means at all." (Trustpilot)

So here is my position, and it is a limitation, not a pitch.

I will never promise you patients. I will never promise you revenue. Nobody honest can, and anyone
who does is telling you what a scammer would tell you. What is measurable is whether your clinic
appears when the question gets asked from a neutral account, how often, and against whom. That is
it. That is the whole claim.

Which is why everything I send you comes with the prompts. Not a dashboard. The actual questions,
so you can open a private window, ask them yourself, and check my work without me in the room. If
you can verify it alone, you never have to trust me, and I never have to be trusted.

Reply with your city.
[FOUNDER NAME], SRT Agency LLC
P.S. Most of what is sold under the "AEO" label is smoke. I would rather agree with you about that
first than pretend the category is clean.
$sl$
where id = 'medspa_owner_ai';

commit;

-- Verify (expect one medspa_owner_ai row, no trt_clinic_ai row, and 0 leftovers):
--   select id, name, owner_vertical_id, workflow_vertical_id, drop_mode, slack_drop_channel_id
--     from verticals where id in ('medspa_owner_ai','trt_clinic_ai');
--   select count(*) from content_examples where vertical_id = 'trt_clinic_ai';
--   select left(sales_letter_examples, 90) from verticals where id = 'medspa_owner_ai';
