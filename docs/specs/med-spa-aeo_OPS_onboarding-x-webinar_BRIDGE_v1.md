# MED SPA AEO — ONBOARDING BUILD × WEBINAR
## Bridge v1 — what the webinar promises, what the SRT build must do, and where they currently disagree

**Governs:** the seam between `med-spa-aeo_PROJECT-CANON_v4.md` / `med-spa-aeo_06-CLOSE_FINAL_v7.md` (the promises) and `SRT-AEO-Onboarding-v1.2.md` + `SRT-ClaudeCode-Build-Prompt-v2.md` + `SRT-Review-Funnel-Spec.md` + `SRT-Prompt-Library.md` (the delivery machine).
**Rule of precedence:** canon wins on anything said on camera or in the offer. SRT v1.2 wins on infrastructure choices canon never made. Where both are silent, this file decides and canon v5 inherits it.
**Status:** proposed locks, veto window open. Silence = ratified. Feeds canon v5 (§9 patch list at the bottom).
**Sequencing context:** first clients arrive through Matthew's outbound path (free audit → conversation → Stripe) *before* the webinar launches. Ads come after. §7 covers what that does to the webinar.

---

## 0 · Verdict

**v1.2 + build prompt v2: approved as the infrastructure spine, with amendments.** The four decisions (`learn.` subdomain, custom booking at 4-hour notice, `#srt-{slug}` per client with Connect-first, global `citation_sources`) are adopted into canon. Same-day is approved. "Store structured, render visual" is approved. The fidelity disclosure is approved and gets extended to the $39 audit report.

**`SRT-Review-Funnel-Spec.md`: not approved as written.** It's a good agency review funnel and it is not the tool the close describes on camera. Beat 17's "it does not write the review" and Beat 19 are on the never-cut list, and the spec contradicts three of the things they say out loud (see §3 · B1). It gets replaced by the canon spec in close v7 Part V. Everything else in this file is amendments to a build that's fundamentally right.

**Nothing here slows the paste.** The blockers are spec changes to sections 5, 7 and 1 of the v2 prompt, plus a handful of columns. Fix the prompt, then paste.

---

## 1 · Adopted from the SRT docs into canon (no argument)

| Decision | Adopted as | Note |
|---|---|---|
| Subdomain | **`learn.` — fallback `guide.` only if `learn.` already resolves; two options, never a third; exception logged on tenant** | The content-engine ops manual said `resources.` — that manual gets a one-line patch. `learn.` wins because it appears in every citation URL and reads like the business made it. |
| Booking | Custom, in Mission Control. **Minimum notice 4 h**, max 21 days, 60 min, token-gated, `.ics`, MS365 via Graph. | Same-day approved: Beat 39 says "on that call we go through your baseline together before I build a single thing" — still true. |
| Slack | One channel per client, `#srt-{slug}`, provisioned by the webhook, `slack_channel_id` on tenant. Connect preferred. | On camera: "All of it in Slack" (Beat 27). Resolves canon §12 blocker 10. See A2 for the guest path. |
| Citation sources | **Global** table, `citation_observations` carries `tenant_id`, `outreach` links to it. Fills itself from every baseline. | Also the data structure for **competitor displacement tracking** (Complete) — same table, rendered by competitor over time. |
| Same-day scan | Fires on funnel completion, < 20 min, APIs where they exist. | With the canon grid change in B6. |
| Store structured, render visual | `ai_baseline` rows are the artifact; cards rendered from data; 3–5 real UI screenshots per client for the deck. | Requires the Beat 10 wording check in B6. |
| Fidelity disclosure | Report footer: API retrieval ≠ consumer chat UI; measured as a consistent, repeatable signal. | **Extend to the $39 audit report and the monthly scorecard.** Same sentence, every time. |
| Spam protection | Honeypot + Turnstile + IP limit + timing flag, on every public form incl. the review tool. | — |
| Non-clinical forms | Name, email, phone, service interest. Nothing describing a person's health. | Also decides B2. |
| Corpus, not training | `client_corpus` + `question_bank`, retrieval only. | **Vocabulary law:** never say "we train an AI on your business" in any script, SOP or sales line. There is no training. There is a corpus. |
| Free audit vs paid audit | Free = 2–3 queries, one engine, teaser. Post-payment = full. | Keeps Q1 literally true. Locked harder in B8. |
| Citation outreach | Cold email to the publishers who already own cited pages; one follow-up, then stop; never posting as the client anywhere. | Same thing canon calls **directory outreach — we pitch; they decide** (Law 10). Reddit stays research-only. Volume and tier gate in B3. |

---

## 2 · Promise → build map

Every row is something said on camera or written into the offer. Third column is where it lives in the SRT build today.

| # | Promise (where) | The build must… | v1.2 / v2 status |
|---|---|---|---|
| 1 | 40 / 80 tracked questions, four engines: **ChatGPT, Perplexity, Gemini, Google AI** (Beat 7, Q1) | Run the tier's question set across exactly those four; anything else is internal | ⚠️ v2 §5 uses "v1.0 templates 1–8 + 3 long-tail" and six engines → **B6** |
| 2 | "Week one, we take the photograph… dated, screenshotted" (Beat 10) | Day-0 baseline complete inside week one, before any Phase 5 change | ✅ same-day covers it · ⚠️ "screenshotted" wording → **B6** |
| 3 | 20 universal + 20 yours; "you'll see the whole list before we run it… you approve the question list once" (Beat 11, Q8) | Custom questions built from Step 3 + harvest + baseline sources; **client approval step on the call**; question set versioned | ❌ no approval step in the call agenda → **B6, B9** |
| 4 | 4 new + 4 refreshed / 8 + 8 answer pages per month (Beat 12–13) | Content calendar generated per tier at exactly those counts | ⚠️ 30-day calendar = ~20 GBP posts + 10 hub pages → **B3** |
| 5 | Same questions re-run monthly; scorecard + video (Beat 14) | Monthly re-run diffed against Day 0; video is the product | ✅ v1.0 §6 · weekly Slack report is extra, never promised |
| 6 | Automated review requests, "the review system stays connected to your booking software" (Beat 16, 27, 32) | Trigger lives in the client's booking/text system; SRT never holds the patient list | ⚠️ v1.0 §5.4 has SRT sending SMS/email → **B2** |
| 7 | The review tool: four open questions → bullet points → she edits → she posts. "It does not write the review." "We do not generate reviews with AI." No staff-name prompt. No tablet. Every patient. (Beat 17–19; Integrity Law 11) | Build the canon spec, exactly | ❌ SRT spec generates prose, asks for staff name, uses chips → **B1** |
| 8 | Written review responses "built on purpose, not 'thank you for your kind words'"; negative-review workflow — **Complete only** (Beat 20) | Per-review written responses, tier-gated | ⚠️ v1.0 §5.4 "response templates 5/3/1-star" for everyone → **B3, A6** |
| 9 | Monthly directory & list outreach — **Complete only**; "we pitch, they decide"; **client sees the full log incl. non-responses**; paid listings disclosed; "that money goes to them, not to me" (Beat 22; Law 10; Part V #7) | Tier-gate; client-visible outreach log; paid-listing fields; no commissions | ⚠️ outreach untiered, 3–5/day, log internal-only → **B3, A4** |
| 10 | Competitor displacement tracking — Complete (Beat 28) | Render `businesses_named` over time by competitor + `citation_observations` | ✅ data exists · ⚠️ needs a rendering + tier gate |
| 11 | "All of it in Slack" (Beat 27) | Channel per client, provisioned automatically | ✅ · **A2** for clients with no Slack |
| 12 | Keep Everything: pages stay on your site, listings stay corrected, review system stays connected, "nothing gets switched off… no version where your site goes dark" (Beat 32) | Hub keeps serving after cancellation; export anytime | ❌ v1.0 contract "releases the subdomain within 14 days" → **B7** |
| 13 | One clinic per market, radius in the agreement, **enforced at checkout by ZIP**, held from first payment (Beat 35, 39, Q6) | `market_key`, `zip`, `radius_mi`, `market_locked_at` set on `checkout.session.completed`; ZIP check gates checkout | ❌ absent → **B5** |
| 14 | Six at a time, waitlist when full, **no counter displayed anywhere** (Beat 36–37) | Server-side count of active tenants; waitlist state; nothing rendered | ❌ absent → **B5** |
| 15 | "$39 comes off your first month automatically" (Beat 39; Part V #3–4) | Webhook handles the audit purchase and the subscription; credit applied without a human; "$39 unused" email day 18–21, once | ❌ webhook assumes one product → **B5** |
| 16 | Onboarding call ~45 min; ~20 min/month after (Q8) | Call length and client-time budget honored | ⚠️ v1.2 call = 60 min → **B9** |
| 17 | Baseline week one, first pages live **week two**, re-tests day 30/60/90 (Q7) | Hub live ≤ day 7; first answer pages published ≤ day 14 | ⚠️ v1.0 §5.3 says weeks 1–3 → tighten to ≤ day 14 |
| 18 | Implementation $1,499: optional, **offered at onboarding only**, never a prerequisite; if declined, subscription delivered as sold, **no scope reduction**; charged only after verbal yes on a recorded call **and** emailed confirmation (canon §3, contract law, SOP line #9) | Phases tagged as included vs implementation; call is where it's offered; separate checkout, never the saved card | ❌ absent → **B4** |
| 19 | The report stands alone; nothing auto-sends; second close is evidence, not a pitch (Part III) | Review-first rule; report delivery = Loom + email sequence | ✅ v1.2 "review-first rule holds" |
| 20 | Free audits are "a screenshot and a phone call"; the $39 is a product — four engines, twenty questions, prompt map, 90-day plan (Q1) | `/freeaudit` stays shallow, outbound-only, unindexed; $39 stays deep | ⚠️ → **B8** |
| 21 | Refund before month two if the market can't be won (Story 3; canon §12 #7) | Refund-trigger language in the agreement; a stage-8 check | ⚠️ not in the SOP → §5 stage 8 |

---

## 3 · Blockers — proposed resolutions

### B1 · The review tool. The SRT spec is a different product than the one on camera.

| SRT-Review-Funnel-Spec.md | Canon (close v7 Part V + Beats 17–19) | Why it can't ship as written |
|---|---|---|
| **Step 3: "Who looked after you?"** — dropdown from the tenant's staff list; "% containing a named staff member" is a tracked metric | **Never ask who treated her, never suggest naming anyone.** If she volunteers a name, leave it. | Beat 19 says on camera: "we don't put anybody's name in her mouth — Google changed its rules on that this year." Integrity Law 11. This is the single most exposed line in the spec. |
| **Step 6: generate a 30–40 word prose review** with Claude Sonnet, temp 0.7, "sounds like a real person typed it on their phone" | **Her answers reorganized into bullet points.** Reorganize and format; never author. **"It does not write the review."** | Beat 17 and Beat 19 ("We do not generate reviews with AI") are DO-NOT-CUT. Canon's own read of FTC Part 465 / the Rytr fact pattern is that a tool producing review text is the thing being enforced against. Assembly-into-prose is still authorship. |
| **Step 1 multi-select objection chips** (from Step 3 objections) + **Step 5 service chips** (from taxonomy) | **Four open questions, sentiment-neutral, no content steering:** worried about · hoping would happen · bad experience before · what actually happened | Google 2026 (as canon reads it): merchants may not request that specific content be included. Pre-loaded phrases and treatment names that flow into the review are exactly that. Open questions only. |
| Sentiment detection → negative path shows review link **and** owner-contact offer | **No separate path for unhappy patients.** Every patient sees the identical screen. | Fix is one line: show "want the owner to reach out?" to **everyone**, or to no one. Sentiment-blind. Then no classifier, no branch, no argument later. |
| Timing: "same day, within 2 hours" · QR at checkout | **Own device only.** No clinic tablet, no clinic wifi, no lobby completion. Card goes home; optional follow-up text hours later. | Same intent; the spec must state the device rule explicitly because the install table puts the QR at checkout. |
| Destination: Google default; Trustpilot / Yelp / Healthgrades per tenant | **Google primary, RealSelf second, rotate later.** Yelp only after reading Yelp's solicitation rules. Trustpilot never leads. | Add RealSelf to Step 4 of the onboarding funnel and to `review_destination_url` options. |
| Question set implicit | **Question set versioned and logged** | If a client's reviews are ever challenged you show what was asked. |

**Keeps from the SRT spec:** no gating · fully editable · no incentives · copy-then-link, she posts herself · mobile-first · store answers to `client_corpus` (`source_type = 'review_funnel_answer'`, no identifiers, no IP) · funnel-completion metrics. **The AEO quality metric stays "% of posted reviews containing an objection phrase."** The staff-name metric goes.

**Build instruction for v2 §7:** *"Route `learn.{domain}/review`. Build the spec in `med-spa-aeo_06-CLOSE_FINAL_v7.md` Part V. Four open questions verbatim. Output = her answers as bullet points, editable, copy button, then the destination link. No generation model in the path — string assembly only. No staff field anywhere in this route. Question set stored with a version id on every submission."*

**Renaming:** the file is `SRT-Review-Funnel-Spec.md`; the deliverable on camera is "the patient review tool." Rename the file to match, so nobody builds from the wrong noun.

### B2 · "Automated review requests" — decide the mechanism so Beat 32 and the PHI line both stay true

Beat 32 says on camera: *"the review system stays connected to your booking software."* v1.0 §5.4 has SRT sending SMS/email itself (A2P status, short links). Those are different systems, and the second one requires SRT to hold a list of a med spa's patients — the exact thing the non-clinical rule exists to avoid.

**Lock:** the request is sent from the client's own booking / patient-messaging system (Boulevard, Vagaro, Zenoti, Aesthetic Record, Mindbody, GHL, whatever they run), configured by us during onboarding: trigger = visit complete, delay = a few hours, message = the card link. We never import, store or send to patient contacts. Where no system exists → the card is the mechanism and the client's own texting tool is the follow-up; say so on the call, and the tenant record notes `review_request_mode = 'card_only'`. This is what "connected to your booking software" means, and it's what makes it survive cancellation.

**Funnel change:** Step 4 gets one explicit question — *"What booking / patient-messaging software do you use?"* — separate from "what tool do you use to ask for reviews."

### B3 · Tier gating and deliverable inflation

There is no `tier` in the build. Everything is delivered to everyone, and two deliverables exceed what the offer sells.

- **Add `tenants.tier` ('core' | 'complete')** and gate: outreach (Complete), written review responses + negative-review workflow (Complete), competitor displacement rendering (Complete), question count 40 vs 80.
- **The 30-day calendar** (~20 GBP posts + 10 hub pages) is not the offer. Generate per tier: 4 or 8 new answer pages + 4 or 8 refreshes per month. **GBP posts are not a subscription deliverable.** They belong to the $1,499 GBP buildout ("first GBP post published; cadence scheduled" — the cadence is theirs to keep, ours only if the timed month says there's room). Reason: canon removed "post counts above 8 new/mo," and the six-client cap is arithmetic on ~15 hrs per Complete client — every unsold deliverable is hours nobody priced.
- **Outreach volume:** v1.2 says 3–5 personalized emails/day/client — that's 65–110 a month, and "the outreach" is one line item inside the 15 hours. **Lock a monthly budget instead: 25 pitches/month per Complete client, one follow-up each, until the first Complete client's month is timed.** If the timing says the cap is four, the number on camera moves (Beat 36) — canon already says so.
- **Written responses:** per-review, in language, restating what happened. Not templates. Templates are the thing Beat 20 mocks.

### B4 · The $1,499 boundary, in the schema and on the call

- **Tag phases.** v1.0 §5.1 citation cleanup, §5.2 GBP buildout, and orphaned-access recovery (the §3.3 blockers) are **implementation scope.** Everything else in Phase 4–5 is subscription scope. `onboarding_steps` rows carry `scope ('subscription' | 'implementation')`.
- **Two definitions of done.** Appendix C currently requires "NAP matched everywhere" and "GBP fully built." For a client who declined implementation, done = hub live, baseline archived, review tool handed off, first pages live, weekly report firing. **"We deliver the subscription as sold. We do not reduce scope."** — that sentence goes into the SOP verbatim (canon §12 blocker 9).
- **Where it's offered:** the onboarding call, and only there. The findings doc's "fix list ranked by impact" *is* the pitch — the NAP evidence sells it. Nothing about implementation in the welcome email, the funnel, or the report.
- **How it's charged:** never the saved card. Verbal yes on the recorded call **and** an emailed confirmation stating the amount → then a separate Stripe checkout link. Store `implementation_status`, `implementation_confirmed_at`, `implementation_email_ref` on the tenant. Build prompt v2 §2 must say this out loud so Claude Code doesn't helpfully reuse the payment method.

### B5 · Market lock, capacity, the $39 — the webhook is carrying more than one product

Nothing in v2 knows about ZIP, radius, six seats, or the $39. Some of it belongs to the funnel/order-page build (the still-missing `claude-code-prompt_v4-funnel-update`), but the *tenant* side lives here.

- `tenants` gains: `zip`, `market_key`, `radius_mi`, `market_locked_at`, `tier`, `vertical`, `language`, `price_override` (see A8), `review_request_mode`, `implementation_*` (B4).
- **`checkout.session.completed` handles two products:** the $39 audit (→ prospect/audit record, saved payment method — canon §13: `setup_future_usage: 'off_session'`, never remove) and the subscription (→ tenant, market lock, credit applied). Idempotent on event id in both cases.
- **Market lock at payment, not at the call** (Q6). Soft-hold the market for the life of a checkout session so two clinics in one radius can't both pay; if the race is lost, the second payment is refunded automatically with a plain email.
- **Capacity:** count active tenants server-side; at six, the order page shows the waitlist, not a number. **No counter, anywhere, ever.**
- **The credit:** subscription checkout for a customer with a paid audit on file applies $39 automatically (Stripe coupon/balance). "You have $39 unused in your cart" fires once, day 18–21, suppressed on subscribe or market held.

### B6 · The baseline is the tier's question set, on the four engines named on camera

- **Grid:** Core = 40 questions, Complete = 80, across **ChatGPT, Perplexity, Gemini, Google AI Overviews.** Claude and Copilot may run as internal extras; they are not on the scorecard and not in the count. Beat 7 and Q1 name the four.
- **The 20 universal** are the PDF questions, as a fixed, versioned set. **The 20 (or 60) custom** are built from Step 3 + the weekly harvest + the baseline's cited sources, and **the client approves them once, on the call** (Q8, Beat 11).
- **Sequencing that satisfies both same-day and canon:**
  1. Funnel complete → run the 20 universal × 4 engines immediately (this is exactly the $39 audit; if a paid audit ≤ 14 days old exists, reuse it as the call artifact — otherwise re-run, AI answers drift). This is what's on the screen at the call. Three real UI screenshots of a competitor being named instead of them is enough.
  2. On the call → approve the custom set.
  3. Within 72 h of the call → the full 40/80 × 4 = **the Day-0 photograph**, archived **before the first Phase 5 change lands.** Still inside "week one." Still true.
- **Beat 10 says "Dated. Screenshotted."** If the artifact is API rows rendered as cards, that word stops being literally true. Two honest options for the read-aloud: keep 3–5 real UI screenshots per client (already in v1.2) and leave the line; or change to *"Dated. Logged word for word."* **Recommendation: change the line.** Law 12 — nothing stays on camera after it stops being true.
- **Vocabulary:** the scorecard says **named / not named** and **order named**. The prompt-library table column "Position" is renamed. Never "rank," never "position #."

### B7 · Keep Everything vs "release the subdomain within 14 days"

Beat 32 on camera: pages stay, listings stay corrected, review system stays connected, *"there's no version of this where you cancel and your site goes dark."* v1.0 Phase 0 contract: on cancellation, full export and subdomain released within 14 days. Those can't both be true.

**Lock:** on cancellation the hub keeps serving, unchanged, at no cost, until the client moves or deletes it; full export available anytime; DNS stays theirs (it always was). Serving static pages costs approximately nothing and makes Beat 32 literal. **Appendix A (migrate their whole site onto our infrastructure)** is deferred out of canon scope — if it's ever offered, the same rule applies or Beat 32 has to change first.

### B8 · The free audit and the $39 audit must stay different products

Q1 on camera: free audits are "a screenshot and a phone call"; the $39 is four engines, twenty questions, a prompt map and a 90-day plan. v1.2 already defines `/freeaudit` as 2–3 queries on one engine.

**Lock:** `/freeaudit` = ≤ 3 queries, one engine, no plan, no prompt map, `noindex`, never linked from anything a med-spa registrant can reach; outbound only. The $39 = 20 × 4 + prompt map + 90-day plan + Loom, delivered as canon Part III specifies. **Never let the free one grow.** If it ever does, Q1 comes off the script the same day.

### B9 · Q8 says forty-five minutes; v1.2 says sixty

Change Q8 to *"about an hour"* — it's the first Q&A item cut if the runtime is long anyway. And add three lines to the call agenda: (a) approve the custom question list, (b) offer implementation (verbal yes → emailed confirmation), (c) confirm the review-request mechanism and the review destination. Client time budget after the call stays ~20 min/month.

---

## 4 · Amendments (not blockers)

- **A1 · `learn.` adoption.** Patch the content-engine ops manual and canon §3 from `resources.` to `learn.` (fallback `guide.`). Any content-lane SOP that builds hub URLs uses the constant, not a per-client field.
- **A2 · Slack, for owners who don't have Slack.** Most med spa owners don't. The guest path (single/multi-channel guest in a dedicated Client Hub workspace) is a first-class path, not a fallback — decide at onboarding from one question. On camera it's "in Slack," not "in your Slack." Verify Connect availability on the current plan before promising Connect to anyone.
- **A3 · Email.** Canon §13: Resend for the funnel and client transactional. Graph/MS365 for Matthew's one-to-one email. Don't wire client transactional through Graph.
- **A4 · Outreach log visible to the client** (Part V #7). Complete tenants get, in the weekly Slack report and the monthly scorecard: sent / replied / added / no response, by name. Add `citation_sources.is_paid_listing` + `listing_fee_note` so paid options are disclosed in the same breath, systematically. `outreach.outcome` gets a `paid_option_disclosed` state. No commissions, rebates or markups — the schema shouldn't even have a field for one.
- **A5 · Weekly report language.** Crawler hits are a leading indicator, never a result. The plain-English line may not imply movement in AI answers the monthly re-run hasn't shown. Weekly reporting is never mentioned on camera; monthly re-test + scorecard + video is the promise.
- **A6 · Review responses** — per review, written, restating what happened. Templates deleted from §5.4.
- **A7 · Onboarding funnel deltas.** Step 4: add booking-software question (B2) and RealSelf to destinations. Step 6 (or the agreement at checkout): case-study permission checkbox — opt-in, revocable, anonymized by default (the content-engine anonymization/permission law, §C2 — promote to canon).
- **A8 · Raúl and legacy pricing.** If he's onboarded before the webinar, `price_override` + `terms_note` on the tenant hold his original numbers; every automated email must read price from the tenant, never a constant. Spanish: the review tool and the funnel need `language = 'es'` from day one — Spanish reviews are what serve Spanish queries.
- **A9 · Vertical scope.** SRT infra is vertical-agnostic; the webinar offer is med spa. `tenants.vertical` drives the universal question set (the med spa 20 come from the PDF; other verticals need their own set) and the platform list for the NAP sweep.
- **A10 · Contract text at checkout.** Month-to-month, first month only (v1.0 "down payment" wording goes) · market radius clause (canon §12 #8) · refund-trigger language: trigger, window, decision-maker (canon §12 #7 — blocks recording Story 3) · Keep Everything terms as in B7 · no minimum term · paid-listing no-commission clause.
- **A11 · "Named," never "ranked"** in every client-facing string the build renders: scorecards, Slack posts, report footers, findings doc headings.
- **A12 · The 20-question PDF set is versioned** like the review-tool questions: the re-test promise (Beat 14, "the same ones") depends on the set not drifting.

---

## 5 · The eight stages — proposed names (v2 open item)

`onboarding_steps.stage`, in order. Each maps to a promise so the board is also the compliance record.

| # | Stage | Enters when | Done when |
|---|---|---|---|
| 1 | **Payment** | `checkout.session.completed` | Tenant created · market locked · $39 credit applied if due · Slack channel provisioned · welcome email sent |
| 2 | **Intake** | Welcome email opened | Funnel complete · canonical NAP locked · booking made (≥ 4 h notice) |
| 3 | **Photograph I** | Funnel complete | 20 universal × 4 engines run · findings doc assembled · 3–5 real screenshots captured · citation sources upserted |
| 4 | **Call** | Booking time | Findings walked · NAP confirmed aloud · **custom questions approved** · access granted · CNAME + TXT live · review mechanism + destination decided · implementation offered (yes → recorded + emailed) |
| 5 | **Photograph II** | Call complete | Full 40/80 × 4 archived as Day 0 — **before any change lands** |
| 6 | **Build** | Day 0 archived | Hub live ≤ day 7 · first answer pages ≤ day 14 · review tool handed to a named person · implementation track running if bought · weekly report firing |
| 7 | **Report** | Day 30 | Re-run · scorecard · video · outreach log (Complete) · displacement view (Complete) |
| 8 | **Renew** | Day 30 report delivered | Month-two decision · **refund-trigger check** (Story 3: if the market can't be won, say so and refund before they pay a second month) · timing log for the 15-hour claim |

---

## 6 · What the SRT build gives the webinar (use it)

- **Proof, dated.** Every client is a Day-0 → day-30 → day-60 record on the four engines, with sample size built in. Beat 29 currently has one flooring case; the first med spa client turns it into a med spa case — one business, one city, N questions, confounds stated (were they running ads? what else changed?). Integrity Laws 3 and 6 apply the moment a number leaves the database.
- **The review tool, demonstrated.** Real bullet mirrors → real posted reviews (with the patient's and the clinic's permission) is the strongest possible support for Beats 17–19. Capture the first ten as they happen.
- **The outreach log** — including non-responses — is the on-camera proof of "we pitch; they decide." Show a real one in Beat 22.
- **The 15-hour figure and the six-cap** get validated by the first Complete client's timed month **before** they're recorded (Beat 36, canon §3). If it's twenty hours, it's four clinics, and the script says four. This is the strongest argument for the sequencing you've chosen.
- **The citation database** grows with every free audit Matthew runs, whether or not anyone buys. By launch you may already hold a contact-verified map of what feeds AI answers in your first markets — that's Beat 21 with receipts.
- **Attribution data** ("ChatGPT or another AI assistant" as a lead source) becomes a stat you own with a sample size you can state.

---

## 7 · Clients first, then ads — what it does to the webinar

1. **The outbound offer must equal the webinar offer.** Same prices, no minimum term, one clinic per market, six at a time, Keep Everything, implementation optional and offered at onboarding only. Otherwise the case studies you record carry a different deal than the one on the screen. `closing-brain.md` CONFIG still has placeholders ("$X setup + $Y/mo, 3-month minimum") — fill it from canon §3 before Matthew's next call. Guarantee-based closes are allowed *only* as Keep Everything (not a refund).
2. **Testimonials fall under the same FTC posture as the review tool.** No incentives, no editing beyond what they said, permission on file, typical or disclosed. The Pool Party Test permission law applies to any client story that goes on camera.
3. **If seats fill before launch, launch with the waitlist live.** Beat 37 already says what that looks like. Nothing about the script changes; the order page just tells the truth.
4. **Traffic.** Canon §2 is organic Instagram; v3's cold-ad flow (ads → landing page + VSL-A → opt-in) is what comes back when ads return. VSL-A (v0 drafted, ~80 s) was written for exactly that role. Canon §2 gets a v5 note: "ads reintroduced after first client cohort; six-at-a-time is a standing constraint under either traffic source." No countdown, either way.
5. **Recording order.** Beat 29 (proof), Beat 36 (the arithmetic), Beat 10 (screenshotted / logged), Q8 (call length), and any client story wait for real numbers. Everything else records now.

---

## 8 · Amend the v2 build prompt before pasting

Minimal edits, in order of the prompt's own sections:

- **§1 schema:** add `tier`, `vertical`, `language`, `zip`, `market_key`, `radius_mi`, `market_locked_at`, `price_override`, `review_request_mode`, `implementation_status / _confirmed_at / _email_ref`, `case_study_consent`, `booking_software` to `tenants`; `scope` to `onboarding_steps`; `is_paid_listing` to `citation_sources`; `question_set_version` to `ai_baseline` and to the review-tool submissions table; a `market_holds` table (session id, market_key, expires_at); a `waitlist` table.
- **§2 provisioning:** two products on the same event; market lock + soft-hold + race handling; $39 credit; **the saved payment method is never charged for anything but the one-click subscription upgrade** — the $1,499 is a separate checkout after recorded yes + emailed confirmation.
- **§3 funnel:** Step 4 additions (B2, RealSelf); Step 6 or checkout: consent + agreement clauses (A10).
- **§5 baseline:** replace the query spec with B6 (20 universal versioned × 4 engines now; 40/80 × 4 within 72 h of the call; Claude/Copilot internal only). Add the fidelity footer to every rendered artifact.
- **§7 review tool:** replace with the B1 build instruction. Delete the generation prompt from the path.
- **§9 weekly report:** tier-gate the outreach and displacement blocks; A5 language rule.
- **New §10:** monthly re-run + scorecard render + outreach log render (Complete) + displacement render (Complete), Day 0 diff.

---

## 9 · Canon v5 patch list (delta only)

- §1 Naming: add **"the patient review tool"** (not "review funnel"); add "citation outreach" as an internal synonym of directory outreach.
- §2 Funnel: note the outbound path (free audit → conversation → Stripe) as the first-cohort channel; ads-after note (§7.4 above).
- §3 Offer: subdomain `learn.` (fallback `guide.`) · automated review requests = configured in the client's booking software · GBP posts = implementation scope, not subscription · outreach budget 25/month/Complete until timed · engines named: ChatGPT, Perplexity, Gemini, Google AI · call ~1 h.
- §5 Integrity Laws: add **13 — "There is no training. Never say we train an AI on a client's business."** Promote the anonymization/permission law (§C2) from the ops manual.
- §12 Blockers: 9 → B4 (drop the sentence into the SOP verbatim) · 10 ✅ (Slack structure) · 14 → in build (prompt runner = Audit Engine v2, four engines) · 15 → in build with the B1 spec · 16 → A4 · 17 → B5.
- §13 Tech stack: add Zoho v5 (Matthew's outbound CRM) with Supabase `tenants` as the system of record; MS365 Graph for calendar and one-to-one email; Resend for everything client-facing.
- Close v7: Q8 → "about an hour" · Beat 10 → "Dated. Logged word for word." (read-aloud decision) · Beat 32 unchanged, contract changed to match.

---

## 10 · File hygiene (standing risk)

- `SRT-AEO-Onboarding-v1.2.md` and `SRT-ClaudeCode-Build-Prompt-v2.md` exist as uploads only. **Add both to the project.** v1.0, v1.1, the prompt library and the review spec too, marked superseded where they are.
- `med-spa-aeo_OPS_content-engine_v1.md` is **not in the project files** right now. Re-upload it, then patch `resources.` → `learn.`.
- `claude-code-prompt_v4-funnel-update` is still missing. Build prompt v2 covers post-payment onboarding only — the VSL landing page, opt-in, $39 OTO with off-session setup, order page with ZIP check, capacity/waitlist, and credit are still unwritten as a prompt.
- Story 2 file: still missing. Phase 08 continuation prompt: confirm saved.

---

## 11 · Decision locks — veto window open, silence = ratified

| Lock | Decision |
|---|---|
| **D-OB1** | Subdomain `learn.`, fallback `guide.`; canon and ops manual patched. |
| **D-OB2** | Review tool = canon Part V spec. Four open questions, bullet mirror, no model in the path, no staff field, sentiment-blind owner-contact option, Google → RealSelf. SRT spec retired. |
| **D-OB3** | Automated review requests are configured inside the client's booking/messaging system; SRT never holds patient contacts. `card_only` mode when no system exists. |
| **D-OB4** | Baseline = tier question set × ChatGPT / Perplexity / Gemini / Google AI. 20 universal now → approve custom on the call → full 40/80 within 72 h, before any change. Claude/Copilot internal only. |
| **D-OB5** | Beat 10 → "Dated. Logged word for word." Fidelity footer on the $39 report, the findings doc, and every scorecard. |
| **D-OB6** | `tenants.tier` gates outreach, written responses, negative workflow, displacement, question count. Calendar generates 4/4 or 8/8. GBP posts = implementation scope. Outreach budget 25/month/Complete until timed. |
| **D-OB7** | Implementation: phases tagged; two definitions of done; offered on the call only; recorded yes + emailed confirmation + separate checkout; "we deliver the subscription as sold." |
| **D-OB8** | Market lock at payment with soft-hold; capacity six with waitlist, no counter; webhook handles audit + subscription; $39 auto-credit. |
| **D-OB9** | Cancellation: hub keeps serving unchanged at no cost; export anytime; contract rewritten to match Beat 32; migration upsell deferred. |
| **D-OB10** | `/freeaudit` ≤ 3 queries × 1 engine, noindex, outbound only; the $39 is the product Q1 describes. |
| **D-OB11** | Q8 → "about an hour"; call agenda gains question approval, implementation offer, review mechanism + destination. |
| **D-OB12** | Eight stages as in §5. |
| **D-OB13** | Weekly report never on camera; crawler activity labeled a leading indicator; "named," never "ranked," in every rendered string. |
| **D-OB14** | Outbound offer = webinar offer; `closing-brain.md` CONFIG filled from canon §3 before the next call. |
