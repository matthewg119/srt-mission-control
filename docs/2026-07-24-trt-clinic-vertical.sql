-- TRT / hormone-clinic content vertical + its daily B-roll drop lane. ADD ONLY.
--
-- RUN ORDER: deploy the code first (the trt_clinic_ai SEED in src/config/verticals.ts must
-- be live), THEN run this. loadVertical() merges this DB row OVER that seed, so this row is
-- intentionally a WIRING STUB — the avatar_summary / beliefs / offer / style_token come from
-- the seed (a full kit hand-copied into SQL would only drift from it). offer/beliefs are set
-- NULL here on purpose so the column DEFAULTs ('{}' / '[]') don't override the seed via
-- mergeRowOverSeed's pick(); style_token is '' for the same reason.
--
-- CHANNEL: we REUSE the existing #ai-content-pest-control channel (id C0BFJMEDNFR, the value
-- of SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL) for the clinic drops — rename it in Slack whenever
-- you like, the id doesn't change. NO Vercel change is needed: the code now lets a verticals
-- row that claims a channel WIN over the env pest default, so this row takes the channel over
-- and the pest drop retires itself. (Deploy the code with that precedence flip first.)

-- 1. drop_mode column (mirrors src/config/verticals.ts). -----------------------------------
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS drop_mode text;  -- 'reel_prompts' | 'broll_suggestions'

-- 2. Rotation log for the B-roll suggestion drop (variety across the 3x/day drops). --------
CREATE TABLE IF NOT EXISTS broll_drops (
  id             uuid primary key default gen_random_uuid(),
  channel        text,
  slot           text,                         -- morning | midday | evening
  bucket         text,                         -- invisible | machine | patient | napkin
  belief_n       int,                          -- which belief (1-5,7) the hook opened
  format         text,                         -- cinematic | napkin
  on_screen_hook text,
  created_at     timestamptz default now()
);
CREATE INDEX IF NOT EXISTS broll_drops_channel_idx ON broll_drops (channel, created_at desc);

-- 3. The clinic vertical row — wiring + caption voice anchor only (kit lives in the seed). --
-- Release the channel from any other row first, so claiming it can't trip the unique index.
UPDATE verticals SET slack_drop_channel_id = NULL
  WHERE slack_drop_channel_id = 'C0BFJMEDNFR' AND id <> 'trt_clinic_ai';

INSERT INTO verticals (
  id, name, status, style_token,
  audience, language, business_descriptor, wearer_role,
  avatar_summary, beliefs, offer,
  slack_drop_channel_id, owner_vertical_id, workflow_vertical_id, drop_mode,
  sales_letter_examples
) VALUES (
  'trt_clinic_ai',
  'TRT Clinic AI Visibility (B2B)',
  'active',
  '',                       -- seed's style_token wins (pick() treats '' as "use seed")
  NULL, NULL, NULL, NULL,   -- audience/language/descriptor/role -> seed
  NULL, NULL, NULL,         -- avatar_summary/beliefs/offer -> seed (NULL dodges '{}'/'[]' default)
  'C0BFJMEDNFR',            -- #ai-content-pest-control, reused for clinic (rename in Slack anytime)
  'trt_clinic_ai',          -- speaks for itself (post-render caption voice)
  'pest_control',           -- reuse the shared workflow/render library
  'broll_suggestions',      -- the daily lane posts 3 cinematic B-roll prompts, not reels
  $sl$
=== SRT AI Visibility — Belief-Installation Letters (voice anchor; cold-safe set) ===
Integrity rules baked in, do not violate: every statistic is from the approved-numbers table;
every quoted person is real market evidence, never an SRT client; never promise patients,
appointments, or revenue — the only promised outcome is verified appearance from neutral
accounts (60-90 days, or work continues free); the word "AEO" appears only to attack it;
elsewhere the mechanism is "showing up in ChatGPT". Placeholders [CITY]/[FOUNDER NAME]/etc.
are filled per send.

--- LETTER 1 · THE PHONE THAT LIED (false security · beliefs 1>2>3) ---
The Business Owner Was Sure He Was One of the Best in His City. Then the Consultant Pulled Out His Own Phone.

What happened in the next thirty seconds is happening right now in [CITY] — to clinics that have no idea.

In February 2026, the marketing author Marcus Sheridan was sitting with a group of business owners. One of them — a remodeler — was feeling untouchable. "We're already doing great getting recommended by ChatGPT as one of the best remodelers in our city. Take a look at my phone." Sheridan didn't look at the man's phone. He pulled out his own, and asked ChatGPT the same question a stranger would ask. "Well, I've got bad news for you gents. You're not one of the best — at least not in the eyes of ChatGPT when it's talking to me."

Same city. Same question. Different phone. Different answer.

Here's why that happens, and why it matters more to you than to a remodeler: AI answers are personalized. Your phone knows you. It has seen your searches, your own website, your logged-in accounts. When you ask it about clinics in [CITY], it is often flattering you. The phone of a 44-year-old man who has never heard of you — the only phone that matters — is working from a different picture entirely.

And that man is asking. The share of consumers using AI to find local business recommendations went from 6% to 45% in a single year (BrightLocal, Feb 2026). ChatGPT alone now handles roughly 230 million health questions a week (OpenAI, Jan 2026). When he asks "best TRT clinic near me," the answer in most American cities is a short list of national telehealth platforms — the $99-a-month kind. Across 350,000 business locations studied by SOCi, only 1.2% of local businesses appeared in ChatGPT's answers at all.

So there is exactly one honest way to know where you stand: the question has to be asked from a neutral account — no history, no logins, no relationship with your clinic. The view of the patient who doesn't know you yet. That's the whole offer of this letter. The free AI Visibility Audit for [CITY]: reply with your city, or take 15 minutes at [BOOKING LINK]. We ask ChatGPT, Perplexity, and Gemini the real questions men ask before choosing a clinic — from neutral accounts — and send you dated screenshots of exactly who gets recommended in [CITY]. If you're in the answer, we'll tell you so and leave you alone. If you're not, you'll see precisely who is.

No retainer, no pitch required to receive the screenshots. If we ever do work together, we guarantee only what you can verify yourself: appearance in at least one major engine for your target question within 60-90 days, or we keep working at no cost. We will never promise you patients or revenue — nobody honest can.
— [FOUNDER NAME], SRT Agency LLC
P.S. — Don't check on your own phone first. It will tell you the same comforting story it told the remodeler. That's the trap this letter exists to spring.

--- LETTER 3 · THE LOCKED CASINO (channel lockout · beliefs 5>6) ---
Meta Took Down Your Ads. Google Filed Testosterone Under "Regulated Medical Treatment." And the Companies Outspending You Raised $876 Million.

You're not losing the paid-traffic game. You were never allowed to play it.

There's a story so common in this niche that a marketing vendor uses it to describe their typical client: "Most HRT and TRT clinic owners have a story. They hired someone to run Facebook ads, the campaigns ran for a few weeks, then everything got flagged and the account went down." If that's your story too, you already know the rest. Paid ads for testosterone and hormones are heavily restricted and routinely rejected by Meta and Google. One physician-owner put it in six words on a practice forum: "I attempted facebook ads and it basically got me nowhere."

Meanwhile, the companies taking your local patients don't have that problem, because they don't need the auction to be fair — they need it to be expensive. Ro raised $876 million. Hone raised $39 million. They can outbid, outlast, and out-lawyer any local clinic in any channel where money decides the winner. Even the good news in paid is fragile: that same physician documented $6.50 back for every $1 he spent on Google Ads — genuinely excellent — right up until a category policy or an account reviewer decides otherwise. A channel that can be switched off by someone else's compliance team was never yours.

Now the part almost nobody in this niche has noticed. There is one channel where the decision isn't made by an auction at all: the AI answer. When a man in [CITY] asks ChatGPT where to get treated, no bid is placed and no ad budget is consulted. The engines assemble their recommendation from signals: consistent directory data, a review floor around 4.3 stars, presence in the third-party sources and forum conversations they actually read — ChatGPT cites Reddit roughly ten times more than any other network. Signals are not bought. They are built. And right now, across 350,000 locations measured, only 1.2% of local businesses are emitting them. The venture money bought the casino. It cannot buy the answer — today. (If the engines ever introduce paid placement, that sentence changes, and we'll be the first to tell you.)

See your city's answer first. The free AI Visibility Audit: we ask the engines the real questions patients ask about TRT in [CITY], from neutral accounts, and send you the dated screenshots — whoever they show. Reply, or book 15 minutes at [BOOKING LINK].
— [FOUNDER NAME], SRT Agency LLC
P.S. — If we do work together: verified appearance in a major engine in 60-90 days or we work free until it happens, and never a promised patient. One clinic per market, because nobody can honestly position two competitors for the same answer.

--- LETTER 6 · THE $99 WEBSITE (telehealth threat, clinical pride · beliefs 2>4>6) ---
You Draw Labs In Person. You Titrate. You Answer the Message at 9 P.M. So Why Is a $99-a-Month Website Winning Your Patients?

It isn't better medicine. It's presence in a room you don't know exists.

Here is how the national telehealth platforms talk about you — real copy, aimed at your patients: "Unlike local brick-and-mortar clinics, which often charge $169 or more per month… [we include] provider access and medication for under $99/month." Ten-ish national brands, venture-funded, prescribing in minutes, framing your in-person labs and actual supervision as an overpriced inconvenience. Your clinical instinct says the comparison is absurd — and clinically, you're right. A ten-minute intake with mailed vials is not the same medicine as a supervised protocol with a physician who knows the patient's history.

But you're wrong about where the contest happens. It doesn't happen in the exam room, where you'd win. It happens the moment a man in [CITY] asks a question — and increasingly, he asks an AI. Forty-five percent of consumers now use AI for local recommendations, up from 6% a year ago. ChatGPT handles some 230 million health questions weekly. And the engines don't judge medicine. They synthesize sources: the "best TRT" listicles, the directories, the forum threads. That corpus has a structural bias you couldn't have known about — the listicles are largely an affiliate ecosystem, built around the national brands that pay commissions. Local clinics aren't losing in those sources. They're absent from them. Roughly 85% of what AI cites lives off your website entirely, in places your years of SEO never touched.

So hear the absolution clearly: it is not your medicine, and it is not your website. Only 1.2% of local businesses appear in ChatGPT's answers at all. Nine out of ten practices that rank well on Google are never mentioned by AI. You are not behind. Almost everyone is absent. Here's what changes the fight: unlike the ad auctions Meta and Google closed to you, the source layer doesn't take bids. It reads signals — directory consistency, a 4.3-star review floor, presence in the third-party pages and conversations the engines cite. Signals a local clinic can build without a dollar of venture capital.

First step costs nothing: see the room. The free AI Visibility Audit sends you dated, neutral-account screenshots of exactly who ChatGPT, Perplexity, and Gemini recommend for TRT in [CITY]. Reply, or book 15 minutes at [BOOKING LINK].
— [FOUNDER NAME], SRT Agency LLC
P.S. — Your price isn't the problem either. A patient who never sees your name never reaches the conversation where your value case wins. Invisibility is upstream of everything you're proud of.

--- LETTER 9 · TO THE DOCTOR WHO LEFT (identity · beliefs 2>5>6) ---
To the Physician Who Left the System So No One Could Decide Who His Patients Are: There's a New Committee Deciding. You're Not in the Room.

You escaped the 80-hour weeks and the private-equity contract. One gatekeeper remains — and it's the first one you can actually beat.

You remember why you left. One physician put his version on a practice-owners' forum: tired of "working 80-90 hour weeks," unwilling to sign when a private-equity group took over the contract for "more work and less pay." So he opened his own practice. Another owner, two months into the same leap: "Its been pretty slow patient wise but rewarding." Slow but rewarding. That was the trade: security for control. Control of your protocols, your panel, your hours, your standards. It's the whole point of the cash-pay model — no panel committee, no administrator, no algorithm deciding which patients reach you. Except one still does.

When a man in [CITY] asks ChatGPT where to treat low energy and low drive — and 45% of consumers now ask AI for local recommendations, against 6% a year ago — a system you've never met decides whether your clinic exists. In most cities, its answer is a rotation of roughly ten national telehealth brands. Across 350,000 measured locations, 1.2% of local businesses appear at all. You've met gatekeepers before. But notice what this one isn't. The hospital wanted your employment. The insurance panels wanted your NPI and your discount. The ad platforms wanted your budget — then banned your category anyway, while companies holding $876 million in venture money bought what was left of paid attention. The AI answer wants none of those things. It takes no bids and signs no contracts. It reads signals: consistent directory data, a review base above roughly 4.3 stars, presence in the third-party sources and forum threads the engines cite. Every one of them buildable by a single independent clinic — no headcount, no capital raise, no permission.

For the first time since you left, the gatekeeper can be satisfied on merit signals rather than leverage. And the results are checkable by you, from any neutral account, without trusting us or anyone — the only kind of marketing consistent with why you walked out in the first place. Start with the truth about your city. Free AI Visibility Audit: dated, neutral-account screenshots of who the engines recommend for TRT in [CITY] today. Reply, or book 15 minutes at [BOOKING LINK].
— [FOUNDER NAME], SRT Agency LLC
P.S. — You didn't leave employed medicine to depend on an algorithm's opinion. But the men of [CITY] already do. The audit simply shows you what it's currently saying while you're not in the room.

--- LETTER 11 · THE OPERATOR'S LETTER (MSO owner · asset & exit value · beliefs 1>2>6>9) ---
You Hired the Medical Director. You Cover the NP's Hours. You've Watched $20,000 a Month Go to Meta and an SEO Firm. Point to the Asset.

A letter for the owner who built the business — not the one who prescribes in it.

You're not the provider. You're the one who signs for everything: the medical director's monthly, the part-time NP budgeted into expenses, the front desk, the lease — and the marketing line that never stops. The market's own for-sale listings show what that line looks like: one medspa, "Marketing Spend: ~$20,000/month on Meta ads and SEO"; another owner, "$23,000 on website, marketing and training"; another carrying a $16,648 annual advertising line. And at the end of the road, listings that read like a men's health clinic whose owner is "selling and exiting men's health and wellness space entirely."

Here's the operator's problem with all of it: rented acquisition never compounds. Every patient is bought at retail, again, forever. The ad account that produces this month can be flagged next month — in this category, practically a rite of passage. And when you sell, the buyer prices that fragility straight into your multiple: revenue that depends on a media buyer's luck and a platform's mercy is worth less per dollar of EBITDA. You know it because you'd discount it too.

Now look at the one channel that behaves like a balance-sheet item instead of an expense. When a man in your market asks ChatGPT where to get treated — as 45% of consumers now do for local recommendations, versus 6% a year ago — the answer is assembled from durable, third-party signals: review floors, directory consistency, presence in the sources and forums the engines cite (~85% of citations are off-site). Signals accumulate. They don't reset when a campaign ends. Across 350,000 measured locations, only 1.2% of local businesses have them — which means, in most markets, uncontested inventory. Two structural details your operator brain will appreciate. Exclusivity is real, not manufactured: one clinic per market, because nobody can honestly build two competitors toward the same answer. Measurement is CFO-grade: documented baseline before month two is billed, monthly share-of-citations reporting from neutral accounts with replicable prompts, and a guarantee tied to verified appearance in 60-90 days — never to patients or revenue.

The free audit doubles as market intel. We'll send you dated screenshots of exactly who holds your market's AI answer today — national brands, or a local competitor you didn't know had moved. Reply with your city, or book at [BOOKING LINK].
— [FOUNDER NAME], SRT Agency LLC
P.S. — If you ever sell, imagine this line in the deal book: "Clinic appears in AI recommendations for [CITY]; measurement method and reports transfer with the business." That line is available to exactly one business per market.

--- LETTER 12 · THE WORD-OF-MOUTH CEILING (referral ceiling · beliefs 1>2>6) ---
Word of Mouth Built Your Practice. It Will Also Cap It — at Exactly the Size of Your Patients' Contact Lists.

The most trusted channel in medicine has one flaw: there's no dial on it.

There's a sentence that appears in almost every practice-for-sale listing in this niche. A real one: "The 35-year reputation of this practice keeps a steady flow of new patients streaming in from word of mouth." It's meant as a selling point, and it is one. It's also a confession: the flow is steady because it's fixed. Referrals arrive at the speed of other people's conversations. You can't schedule them, budget them, aim them at the slow season, point them at a second location, or turn them up when a competitor gets loud.

Here's the reframe: word of mouth didn't die. It moved. When 45% of consumers ask AI for a local recommendation — up from 6% in a single year, with 230 million health questions a week hitting ChatGPT — they are doing exactly what a referral seeker has always done: asking a trusted third party, "who should I go to?" Same psychology. New mouth. The difference is physics. The old mouth was unreachable — you couldn't market to your patients' dinner tables. The new mouth is influenceable and measurable: it recommends from signals (review floors around 4.3 stars, directory consistency, presence in the third-party sources and forums it reads), and you can audit what it says any month, from any neutral account. Today it barely mentions local clinics at all — 1.2% across 350,000 measured locations. In most cities, it has simply never been given a reason to say your name. Your 35 years still count: a deep review base and a real reputation are among the strongest signals the engines read. The tragedy would be owning the reputation and lacking the citations.

Hear what the new mouth currently says about [CITY] — free, in writing: dated screenshots from neutral accounts of who ChatGPT, Perplexity, and Gemini recommend. Reply, or book at [BOOKING LINK].
— [FOUNDER NAME], SRT Agency LLC
P.S. — Usual terms if we ever work together: appearance you can verify in 60-90 days or we work free, one clinic per market, and never a promised patient. The new mouth doesn't take bribes; neither do we.
$sl$
)
ON CONFLICT (id) DO UPDATE SET
  name                  = EXCLUDED.name,
  status                = 'active',
  slack_drop_channel_id = EXCLUDED.slack_drop_channel_id,
  owner_vertical_id     = EXCLUDED.owner_vertical_id,
  workflow_vertical_id  = EXCLUDED.workflow_vertical_id,
  drop_mode             = EXCLUDED.drop_mode,
  sales_letter_examples = EXCLUDED.sales_letter_examples,
  updated_at            = now();

-- 4. (Optional) make the historical pest wiring explicit; harmless if already set.
UPDATE verticals SET owner_vertical_id = 'pest_owner_ai'
  WHERE id = 'pest_control' AND owner_vertical_id IS NULL;
