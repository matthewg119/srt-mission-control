-- Funder underwriting boxes — extracted from real guideline PDFs in
-- ~/Desktop/Funder Guidelines/ on 2026-06-05. Format per docs/funder-uw-box-prompt.md.
--
-- These populate lenders.underwriting_box, the free-text "what this funder wants"
-- field read by the AI matcher (suggest-funders.ts) and surfaced to Vektor by the
-- get_lenders tool so it can answer UW questions in #srt-sub.
--
-- Matched by EMAIL DOMAIN (robust to name drift in the lenders table). Each UPDATE
-- targets the lender whose submission_email or to_emails carries the funder's domain.
-- Safe to re-run (an UPDATE just overwrites the box).
--
-- SKIPPED (PDF present but NOT real UW criteria — do not box):
--   • Everest / New Partners (everestbusinessfunding.com) — PDFs are a fee schedule + syndication flyer only.
--   • Rapid / Brian Poppleton (rapidfinance.com) — PDF is a partner questionnaire (a form WE fill out).
-- SKIPPED (merchant docs, not funder guidelines):
--   • Casa Capital (casacapital.org) + NewCo (newcocapitalgroup.com) — "PLANET JANE" agreements.
--   • Greenvalueprop (greenvalueprop.com) — a Commercial Invoice.
--   • Snvtraining (snvtraining.org) — bank statements / credential.
--
-- VERIFY FIRST (confirm the domain match hits exactly one intended funder per row):
--   SELECT name, submission_email, to_emails, underwriting_box
--   FROM public.lenders
--   WHERE submission_email ILIKE '%@cfgms.com'
--      OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@cfgms.com%'
--   ORDER BY name;

-- 0. Add the columns the lenders table is missing (none of these existed as of 2026-06-05).
--    underwriting_box  → the UW box Vektor recites.
--    guideline_pdf_url/_name → set later by scripts/upload-funder-guidelines.ts.
ALTER TABLE public.lenders ADD COLUMN IF NOT EXISTS underwriting_box   TEXT;
ALTER TABLE public.lenders ADD COLUMN IF NOT EXISTS guideline_pdf_url  TEXT;
ALTER TABLE public.lenders ADD COLUMN IF NOT EXISTS guideline_pdf_name TEXT;

-- Arsenal Funding / Immediate Advances
UPDATE public.lenders SET underwriting_box =
  'Min $50k/mo rev ($75k trucking) · TIB 6mo+ (prefers 1yr+) · max $250k (more via side-by-side) · FICO 500+ · positions any, will not fund behind balances <$30k · 1st position must be >$30k · blocks solar/lending-financial/law(PI-law-OK)/auto-dealers · NSF+neg days <25% of mo · no CA deals · no 1st-position nonprofits · no active reverse, open defaults, or payment plans · construction needs TR/AR for 1st'
WHERE submission_email ILIKE '%@immediateadvances.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@immediateadvances.com%';

-- CFG Merchant Solutions
UPDATE public.lenders SET underwriting_box =
  'TIB 3mo+ · positions 2nd/3rd+ OK (only if merchant can afford it) · no min FICO · no min revenue/deposits · NSF/neg days <=6/mo · terms 3-9mo · funds ~24h after approval · B/C/D paper, almost no industry restrictions · must fund a business bank acct with online access · also offers TRUE invoice factoring'
WHERE submission_email ILIKE '%@cfgms.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@cfgms.com%';

-- Funderial
UPDATE public.lenders SET underwriting_box =
  'Min $10k/mo volume · TIB 1-3mo+ (industry dependent) · FICO 500+ · min 5 descriptive deposits/mo · NSF <=5/mo · neg days <=4/mo (no hard limit on CC-split/lockbox) · blocks auto-dealers/brokers/RE-developers/financial-services/credit-repair · trucking only if subcontracting (FedEx/UPS/USPS/Amazon) · ACH + CC-split/lockbox · CA/VA/UT/TX/PR are CC-split/lockbox only (no ACH) · defaults satisfied, BK discharged <24mo, no open liens/judgments <24mo'
WHERE submission_email ILIKE '%@funderial.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@funderial.com%';

-- ONTAP Capital (Canadian funder)
UPDATE public.lenders SET underwriting_box =
  'Min $25k/mo rev ($100k construction/trucking) · TIB 1yr+ · max $1M · 3+ deposits/mo · factor 1.15-1.35 (buy) · terms 3-18mo · blocks auto-sales/solar/law/non-profits/adult/bail-bonds/consulting/financial-services · Canadian funder (Quebec: $50k/mo, TIB 2yr+, max $350k, 5+ deposits)'
WHERE submission_email ILIKE '%@ontapcap.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@ontapcap.com%';

-- VOX Funding
UPDATE public.lenders SET underwriting_box =
  'Min $10k/mo rev (higher for some industries) · TIB 1yr+ · max $1.5M · FICO 600+ · positions 1st-3rd (2nd/3rd need 30-day gap) · neg days <=5/mo · A-C risk class, soft credit pull · terms to 24mo(1st)/18mo(2nd)/15mo(3rd) · blocks adult/cannabis/check-cashers/used-car-dealers/money-transfer/funeral-homes/pawn-shops/gas-stations/govt'
WHERE submission_email ILIKE '%@voxfunding.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@voxfunding.com%';

-- Legend Funding
UPDATE public.lenders SET underwriting_box =
  'Min $20k/mo rev · TIB 1yr+ (3-5yr for high-risk) · max $350k (min $20k) · positions 1st-3rd · neg days <=4/mo · terms 4-12mo · no stacking within 30 days of last funding · CA/NY need 4mo statements upfront · high-risk: trucking (5yr,600 FICO,$50k,max $75k/6mo) / construction (3yr,600 FICO,max $250k/10mo) / real-estate / cannabis / consulting / non-profits · stips <$350k: bank verification + POO'
WHERE submission_email ILIKE '%@legendfunding.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@legendfunding.com%';

-- Hunter Caroline
UPDATE public.lenders SET underwriting_box =
  'Min $15k/mo (Micro program) · max $1MM · positions 1st-7th (program-tiered) · FICO 500+ (sub-500 case-by-case; Micro 680 1st/630 2nd) · factor (sell, incl points) 1.36-1.55 · terms 2-12mo · recent funding OK, reverse/partial-reverse consolidations OK · buyouts (net >=50%, must lower payment) · deals <$100k need no TR · blocks law/financial/bail-bonds/check-cashing/pawn/credit-repair/collections/adult/gambling/travel/auto-truck-boat-sales/nail-salons/gas-stations/publicly-traded · construction needs $100k+ & 8 deposits · trucking $100k+ no factoring'
WHERE submission_email ILIKE '%@huntercaroline.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@huntercaroline.com%';

-- Lexio Capital
UPDATE public.lenders SET underwriting_box =
  'Min $12.5k/mo rev · TIB 6mo+ · max $100k (min $7.5k) · FICO 550+ · positions 1st-3rd (challenged credit 1st-2nd only) · NSF/neg days <=5 · no defaults · ITIN OK ($15k no docs / $25k with EAD card) · blocks auto-sales/solar/law(financial-bankruptcy)/bail-bonds/credit-repair/debt-collectors/MLM/travel/churches/RE-flipping/brokers · will not accept Cash App/Chime/Mercury/PayPal/SoFi/Relay/Novo & similar fintech bank accounts · construction 600+ FICO & 9mo · trucking 620+ FICO & 1yr'
WHERE submission_email ILIKE '%@lexiocapital.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@lexiocapital.com%';

-- Amsterdam Capital Group (ACG / M Hench)
UPDATE public.lenders SET underwriting_box =
  'Min $30k/mo true rev and/or $1.5k avg daily balance · TIB 1yr+ (6mo case-by-case) · positions any (prefers 2nd-3rd) · FICO 500+ · neg days >5 considered excessive · deposits <5/mo considered low · terms to 10mo (high-risk to 7mo, holdback to 50%) · blocks non-profit/real-estate/auto-boat-RV-sales/investment-firms/religious/general-contractors/solar/cannabis(CBD-OK)/vape-smoke-in-IL · no wholesale in NY · not licensed in CA/UT, avoiding TX · trucking $100k/5yr/no-factoring · every deal needs recourse/collectibility'
WHERE submission_email ILIKE '%@acgroupinc.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@acgroupinc.com%';

-- Elevate Funding
UPDATE public.lenders SET underwriting_box =
  'Min $12k/mo gross rev · TIB 3mo+ · max $60k · 1st POSITION ONLY · 6+ deposits/mo (or 12 processing batches) · neg days <=6 ACH (<=14 split) · factor (buy) 1.31-1.42 · terms to 10mo · no COJ/UCC/PG · payoff of existing advance must net 40% · blocks adult/agriculture/auto/car-sales/check-cashing/churches/coaching-influencers/collections/crypto/MLM/drop-shipping/legal/moving/nail-salons/non-profits/real-estate/security/trucking/travel · ITIN OK (1yr + prior tax return)'
WHERE submission_email ILIKE '%@elevatefunding.com'
   OR coalesce(array_to_string(to_emails, ','), '') ILIKE '%@elevatefunding.com%';

-- Confirm what landed:
-- SELECT name, underwriting_box FROM public.lenders WHERE underwriting_box IS NOT NULL ORDER BY name;
