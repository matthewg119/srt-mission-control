-- 2026-08-26 — verticals.voc_quotes: the raw voice-of-customer bank
--
-- The drop channel's `go` now writes 20 LONG-FORM direct-response headlines instead of 30
-- eight-word on-screen titles, and it builds them off the customer's own words. Those words
-- existed in exactly one place in this database, inside verticals.sales_letter_examples,
-- which only ever reaches generateSalesLetterCaption. The headline lane never saw them.
--
-- ROW-ONLY, no seed fallback, the same treatment sales_letter_examples gets in
-- mergeRowOverSeed. An avatar with an empty bank generates without quotes and the Slack post
-- says so; it never inherits another avatar's customers. Pest control owners and med spa
-- owners are not interchangeable sources of pain.
--
-- Add-only. Safe to re-run.

alter table public.verticals
  add column if not exists voc_quotes jsonb;

comment on column public.verticals.voc_quotes is
  'Raw voice-of-customer quotes for this avatar, as [{text, source}]. Reddit confessions, '
  'reviews, DMs: whatever the buyer wrote themselves. Stored UNEDITED on purpose, typos and '
  'swearing included, because that is the heat the headlines are rebuilt from. Appended to by '
  'the `quotes` command in the avatar''s drop channel; never replaced from Slack.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: the 20 med spa owner quotes, ordered by emotional intensity.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Written with coalesce so a re-run cannot wipe quotes added through Slack since. It seeds
-- ONLY when the column is still null.

update public.verticals
set voc_quotes = coalesce(voc_quotes, $vq$[
  {"text": "Girl right?! and honestly my anxiety has skyrocketed since being in this industry. The constant hussle, trying to make a paycheck, selling whack ass services. It's all just too much. I wanted to treat skin and make people happy, not sell my soul.", "source": "r/Esthetics"},
  {"text": "I am exhausted, embarrassed, and poor, (working two 1099 contractor type side jobs to try to pay the rent and not die) but i am not a quitter.", "source": "r/MedSpa"},
  {"text": "I had a dream about being an esthetician and I've been in a med spa for about 3 years and it's literally killed any passion I had for this.", "source": "r/Esthetics"},
  {"text": "I built out a lovely modern place in a strip mall, put in a lot of sweat, tears, and sweaty tears, and moreso money.", "source": "r/MedSpa"},
  {"text": "This industry has changed so much and honestly I would go back to school for something else.", "source": "r/Esthetics"},
  {"text": "I would never have done this field if I knew it was 100% sales I just would have stayed in massage. This field is so toxic.", "source": "r/Esthetics"},
  {"text": "honestly feeling a bit burnt out. spent $1500 last month on FB/IG ads for my med spa. got leads, but half were ghosting and the other half were just looking for the cheapest deal then never come back.", "source": "r/MedSpa"},
  {"text": "I invested a lot of time and money into SEO, ads, multiple agencies, and was hoping to see enough improvement to justify renewing the lease. But we haven't.", "source": "r/FacebookAds"},
  {"text": "One reason my passion died is because I'm doing services I don't even love because they pay more.", "source": "r/Esthetics"},
  {"text": "med spa pay is laughable. I only make good money if I do a super high ticket service which are slim because people don't want to pays thousands of dollars.", "source": "r/Esthetics"},
  {"text": "I know its BS but I also need direction. Halp.", "source": "r/MedSpa"},
  {"text": "I need help but not sure whom to ask or hire..", "source": "r/MedSpa"},
  {"text": "If I wasn't self employed I couldn't deal, I've worked for so many horrible bosses and spas.", "source": "r/Esthetics"},
  {"text": "I'm at a loss and don't understand what I'm doing wrong.", "source": "r/MedSpa"},
  {"text": "I own two med spas. I have spent countless dollars on ineffective marketing.", "source": "r/MedSpa"},
  {"text": "I'm so embarrassed about my situation that I've created a throwaway account to post this.", "source": "r/MedSpa"},
  {"text": "In mid-2023, I took a significant step and opened a medspa, investing over $150,000 through loans.", "source": "r/MedSpa"},
  {"text": "I started a medspa about a year ago, solo.", "source": "r/MedSpa"},
  {"text": "I did everything and managed everything myself.", "source": "r/MedSpa"},
  {"text": "I love my boss but she's chaotic, constantly changing things, constantly trying to 'revamp' and it's just like when is enough, enough. It never is.", "source": "r/Esthetics"}
]$vq$::jsonb)
where id = 'medspa_owner_ai';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify (expect one row: medspa_owner_ai | 20)
-- ─────────────────────────────────────────────────────────────────────────────

select id, jsonb_array_length(voc_quotes) as quotes
from public.verticals
where voc_quotes is not null
order by id;
