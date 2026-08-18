# SRT Agency — AEO Onboarding v2 · Pilot cohort
## The first clinics, delivered at no cost. No offers anywhere.

**What this is:** the onboarding flow for the first clinics, who receive the full service free for a fixed pilot period so that real results, real patient reviews, and real delivery hours exist before the webinar and ads go live.
**What this is not:** a sales document. There is no price, no tier pitch, no add-on, no "after the pilot you'll get…" anywhere in this flow — not in the invitation, the welcome email, the funnel, the call, the reports, or the close-out. Continuing after the pilot is a separate conversation with its own document.
**Relationship to other docs:** `SRT-AEO-Onboarding-v1.2.md` + `med-spa-aeo_OPS_onboarding-x-webinar_BRIDGE_v1.md` govern the paid flow. This doc reuses their machinery (same funnel, same scan, same booking, same hub, same review tool) and changes only what "free" and "first" require. Where v1.2 mentions payment, pricing, implementation as a paid service, or `/freeaudit`, this doc overrides for pilot tenants.
**Owner:** Matthew (delivery) · Lina (proof, scripts, canon)
**Status:** proposed locks, veto window open. Silence = ratified.

---

## 0 · Why pilots, and what they must produce

The webinar makes claims that only real delivery can back:

| On-camera claim | What the pilot has to produce |
|---|---|
| Day-0 photograph → day 30 / 60 / 90 re-tests (Q7, Beat 10, 14) | Dated baselines and re-tests per clinic, sample size built in |
| "The tool is a mirror, not a ghostwriter" (Beat 17–19) | Real bullet mirrors → real posted patient reviews, captured with permission |
| ~15 hours per Complete clinic; six at a time (Beat 36) | A timing log per clinic per task, so the number on camera is a measurement |
| "We pitch; they decide" with a log the client can see (Beat 22) | A real outreach log, including non-responses |
| One documented result (Beat 29) | A med spa case, one business, one city, N questions, confounds stated |
| Named, never ranked (everywhere) | Scorecards that use the vocabulary |

Everything above is a byproduct of doing the work exactly as it will be sold. That sentence is the whole design constraint: **pilots get the product, not a better version of it.** Extra care makes the proof unusable.

---

## 1 · "No offers" — the scrub list

Removed from every pilot touchpoint, no exceptions:

- prices, tiers as things to choose, "upgrade," "add-on," "implementation" as a purchasable service, the $ symbol
- countdowns, seat counts, "founding" anything, "special pilot pricing" (canon: there is no founding anything)
- `/freeaudit`, the OTO, the order page, Stripe — none of it touches a pilot
- "after the pilot" language of any kind before day 90

Still applies, because it's delivery truth, not selling:

- one clinic per market — a pilot holds its market for the pilot's duration
- six at a time — a pilot occupies a seat and is counted server-side like any client
- Keep Everything — when the pilot ends, they keep every asset, live
- every Integrity Law, every review-tool rule, "named" not "ranked," Reddit research-only, no posting as the client anywhere

Internal-only vocabulary: **Core scope / Complete scope** describe delivery volume so hours can be measured. Never used with a pilot clinic.

---

## 2 · Pilot design (proposed locks)

| Item | Lock |
|---|---|
| **Count** | 3 clinics. Leaves 3 seats open at webinar launch. |
| **Markets** | 3 different markets, defined radius each. One may be Spanish-language (Raúl) if he qualifies under §3. |
| **Scope** | 2 at Complete scope, 1 at Core scope — so both numbers on camera ("about fifteen hours," "call it half") get measured, and Beat 26's "some of you should buy Core" has a case. |
| **Duration** | 90 days from Day 0. Matches "day thirty, day sixty, and the one I actually believe at day ninety." |
| **Implementation track** | Citation cleanup, GBP buildout, orphaned-access recovery are done for pilots when the findings call for them — and **logged as a confound** in the case study ("with citation cleanup"). Hours logged separately from subscription hours. |
| **Cost to the clinic** | Nothing, ever, including third-party listing fees we choose to recommend — those are disclosed and paid by the clinic only if the clinic decides to; we never front them and never take a cut. |
| **What we ask** | The onboarding call, ~20 min/month after, approval of the custom question list once, access, a named person for the review tool, feedback at day 30/60/90, and permission (§2.1). |
| **Timing log** | Mandatory. Every task, every clinic, every minute (§12). No log, no pilot. |
| **Close-out** | Day 90: results package, timing report, permission confirmed, market decision. What comes next is not discussed before then. |

### 2.1 · Permission, testimonials, and the word "review"

Two review streams. Different rules.

**Patients reviewing the clinic** (the review tool): canon spec, verbatim, §10.3. This is the product working; nothing about the pilot changes it.

**The clinic talking about us:**
- Permission to use results is asked once, at intake, as a checkbox with plain wording (§16.4). **Anonymized by default** — city-level, treatment-level, no clinic name. **Named use** needs a separate written yes. Revocable going forward; anything already recorded stays (the agreement says so).
- Testimonials are **voluntary, never a condition** of the pilot, never requested in exchange for anything, and asked for once at day 90 — not before, not repeatedly.
- Any testimonial used publicly carries a plain disclosure that the clinic took part in a no-cost pilot. That's the FTC endorsement posture and it's the same posture the product sells on camera; a hidden material connection would undercut Beat 19 in the mouth of the person saying it.
- **We do not ask pilots for a review of SRT / Get Named on Google or anywhere else.** A free service in exchange for a review is an incentivized review — the thing the review tool exists to not do. What pilots produce for the webinar is **evidence and testimonials**, not "reviews of us."
- Patient reviews are quoted only as already-public text, patient names removed, clinic named only with named-use permission.

---

## 3 · Who qualifies

A pilot is chosen, not sold. Criteria, in order of importance:

1. **A market we can win.** Not a consensus lock, no national chain sitting in training data. If the Photograph says the answers are already frozen, say so and don't start (Integrity Law 7 applies before day 0, not after).
2. **One clinic per market**, and a market we'd want at launch — the pilot's radius stays held while the pilot runs.
3. **The owner will do the work the product asks:** ~1 hour call, ~20 min/month, one question-list approval, and will answer "what do you actually do differently in a treatment" when asked.
4. **Reviews are asked for cleanly, or the owner is willing to stop what isn't.** No gating, no incentives, no lobby tablet, no staff-name prompts. Non-negotiable; it's on the intake form and it's confirmed on the call.
5. **A booking / patient-messaging system exists** so the automated request can live in it. If not, card-only mode — acceptable, but at least two of the three pilots should have a system.
6. **A named person for the review tool.** Not "the front desk." A name.
7. **A website we can point two CNAMEs at** and access that can be recovered (an ex-agency holding GBP is fine if the owner will start the recovery on the call).
8. **Willing to have results used** at least anonymized. Named use is a bonus, never a requirement.

Nice to have: thin or old reviews (Complete scope has more to show), a treatment specialty (procedure-specific answer pages move first), Spanish-speaking patient base for one pilot.

---

## 4 · The invitation

No script, no VSL, no scarcity theater. A conversation, from Matthew's outbound path or Lina's network, that says four things in plain language:

1. What we do, in one sentence: we get clinics **named** when a patient asks an AI in your city.
2. What the pilot is: 90 days, the full service, at no cost, in exchange for letting us measure it and — if you want to — talk about it afterward.
3. What we need from you (§2, "what we ask").
4. What you keep: everything, live, when the 90 days end.

Then the pilot agreement (§16.3), confirmed by email reply or e-signature. **No Stripe, no card on file, nothing that looks like a checkout.**

**The photograph as part of the invitation:** running the 20 universal questions for a candidate before they say yes is fine — it's their Day 0 anyway. It is not a public "free audit" and it is never a page anyone can request. Show three screenshots of a competitor being named instead of them; that is the entire pitch.

---

## 5 · Trigger and provisioning

There is no `checkout.session.completed`. The trigger is a human.

```
Mission Control → tenant → "Start pilot"
  → tenants row: billing_status = 'pilot', pilot_started_at, pilot_ends_at (+90 d),
    tier_scope ('core' | 'complete', internal), market_key + radius, market_locked_at,
    seat counted (six at a time — pilots count)
  → Slack client channel #srt-{slug} (Connect if they have Slack; single-channel guest
    in the Client Hub workspace if they don't — for med spa owners, expect the second)
  → onboarding token, 30-day expiry
  → welcome email (Resend) → srtagency.com/onboarding?t={token}   ← copy in §16.1
  → post to #onboarding-srt-aeo
```

`billing_status` drives every downstream branch: no invoices, no credit logic, no "$ unused" email, no implementation checkout, no renewal email at day 30. Anything that reads a price reads nothing.

---

## 6 · Intake — the same six steps, three additions

The v1.1 question set stands. Additions for every tenant, pilot or not:

| Step | Addition |
|---|---|
| 4 · Current review workflow | **"What booking / patient-messaging software do you use?"** (separate from "what tool do you use to ask for reviews") · add **RealSelf** to destinations |
| 4 | "Do you currently offer anything in exchange for a review?" · "Is there a tablet or QR in the lobby for reviews?" — either yes = a conversation on the call, and it stops |
| 6 · Booking | **Consent block** (§16.4) before the booking embed: results-use permission (anonymized default / named opt-in), language preference (`en` / `es`) |

Booking: minimum notice 4 hours, 60 minutes, token-gated, `.ics`, MS365 calendar. Same as v1.2.

---

## 7 · Photograph I — fires on funnel completion

Under 20 minutes, automated:

- **20 universal questions × 4 engines** — ChatGPT, Perplexity, Gemini, Google AI Overviews. The universal 20 are the PDF set, versioned. Claude and Copilot may run as internal extras; they are not on the scorecard.
- 3–5 real UI screenshots of the queries where a competitor is named instead of them.
- NAP sweep queue, review audit (client + 3 competitors), WHOIS, Lighthouse, schema, robots.txt / llms.txt.
- Cited sources → `citation_sources` / `citation_observations` (global asset fills from client one).
- Findings doc assembled in v1.0 §3.1 order. **Section 5 is "the plan for the next 21 days" — a plan, not a fix list priced at anything.** Section 6 is the access list, only the access list.
- Fidelity footer on every rendered artifact: API retrieval isn't the consumer chat UI; what's measured is a consistent, repeatable signal, which is what makes a month-over-month delta meaningful.

---

## 8 · The call — about an hour, one session

| Minutes | What | Pilot note |
|---|---|---|
| 0–15 | Findings. Lead with the screenshots. Name the competitors. | Same as paid. |
| 15–20 | Canonical NAP confirmed aloud, field by field. | Same. |
| 20–28 | **Custom question list** — the 20 (Core scope) or 60 (Complete scope) built from Step 3, the harvest, and the baseline's cited sources. They approve once. Add anything they think is missing. | This is Q8's promise; it lives here. |
| 28–43 | Access grants, live, client driving. Registrar: **three records, two CNAMEs and one TXT** (hub, `reviews.`, domain-level Search Console). Never ask for credentials. | Same. |
| 43–50 | **Review mechanism + destination:** where the automated request will live (their booking system → we configure it, or card-only), Google primary / RealSelf for procedure visits, the named person, and the rules restated once: every patient, own phone at home, nothing offered, nobody prompted for a name. | Same. |
| 50–55 | **Implementation track:** what the findings say needs cleaning (citations, GBP, orphaned access) and what access that needs. Stated as work we're doing, full stop. | **No offer.** In the paid flow this is where implementation is offered; for pilots it's part of the plan and it's logged as a confound. |
| 55–60 | What happens over the next 21 days. Consent confirmed aloud. Day-30 report date set. | Same, minus anything about what happens after day 90. |

Record the call with consent — for the timing log and for the "what do you actually do differently" quotes that end up in answer pages.

---

## 9 · Photograph II — within 72 hours of the call

The full set — **40 (Core scope) or 80 (Complete scope) × the four engines** — run and archived as Day 0 **before any change lands** on the hub, GBP, or a directory. Same fidelity footer. This is what the day-30/60/90 re-tests are measured against, and the number the case study is built on.

---

## 10 · Build — days 1 to 14

### 10.1 · Hub
`learn.{clientdomain}` (fallback `guide.`, logged) live **≤ day 7**: tenant record, corrected-NAP schema, provider bio pages with credential schema, sitemap, `llms.txt`, robots allowing AI crawlers, Search Console submitted, cross-links both ways. **First answer pages live ≤ day 14** — Q7 says "first pages live in week two," so week two it is.

### 10.2 · Content
Generated per scope, at exactly the counts that will be sold: **4 new + 4 refreshed (Core scope) or 8 + 8 (Complete scope) per month.** Answer-shaped: direct answer in the first 100 words, built from the questions the clinic is currently not named for, objections first. No GBP post calendar as a standing deliverable — GBP Q&A seeding and the first posts belong to the implementation track and are logged there. Nothing above the counts; extra pages would confound the case.

### 10.3 · The patient review tool — the framework, as built

Standalone mobile page at `reviews.{clientdomain}`, reached by QR code on a physical card handed to the patient at the end of her visit. That evening, on her own phone, at home, she scans it and gets four open, sentiment-neutral questions:

1. What were you worried about before you came in?
2. What were you hoping would happen?
3. Had you had a bad experience somewhere before this one?
4. What actually happened at your appointment?

She answers in her own words — typed or voice-to-text, about ninety seconds. The tool then does exactly one thing: it lays what she said back out as bullet points — her worry, her expectation, what happened instead. Her language, not ours. She edits whatever she wants, copies it, and posts it herself to Google (primary) or RealSelf (procedure-specific visits). A mirror, not a ghostwriter.

| Rule | Why |
|---|---|
| Output contains only what she supplied. No invented details, no added adjectives, no treatments she didn't name, no clinic marketing language. **String assembly, no generation model in the path.** | FTC 16 CFR Part 465 — the Rytr fact pattern. |
| Never ask who treated her; never suggest naming anyone. If she volunteers a name, leave it. **No staff field anywhere in this route.** | Google 2026 — merchants may not request specific content, including staff names. Integrity Law 11. |
| Fully editable. Nothing locked. | Her authorship in fact, not just framing. |
| Never submits on her behalf. Copy, then a link. She posts in her own account. | Reviewer identity must be genuine. |
| Own device only. No clinic tablet, no clinic wifi, no lobby completion. Card goes home with her; optional follow-up text a few hours later. | Google 2026 kiosk ban + single-IP spam filtering. |
| Every patient gets the card. No sentiment pre-screen, no "how was it?" filter, no separate private path for unhappy patients. The optional "want the owner to reach out?" line — if used — shows to **everyone**. | Review gating — banned and enforced. |
| No incentive of any kind. Not a discount, gift, entry, or points. | Banned regardless of the review's sentiment. |
| Question set versioned and logged with every submission. Answers stored to `client_corpus` (`review_funnel_answer`) with no identifiers, no IP. | A challenged review can be defended: here's what was asked, nothing was steered. |

Metrics: card handed vs scans vs completions vs posted; **% of posted reviews containing an objection phrase** (the AEO metric); average word count. Nothing about staff names.

**Two standing items:** the tool is a separate build from the funnel app (add to the Claude Code prompt as its own section — the bridge doc's B1 instruction); and Google's own published 2026 review policy gets a primary-source read before Beat 19 is recorded.

### 10.4 · The automated request
Configured inside the clinic's booking / messaging system: trigger = visit completed, delay = ~3 hours, message = §16.6, identical for every patient. We never import, store, or message patient contacts. No system → `review_request_mode = 'card_only'`, and the card is the mechanism.

### 10.5 · Off-site (Complete scope only)
Directory & list outreach from `citation_sources`: we pitch, they decide; one follow-up, then stop; **25 pitches/month budget** until timing says otherwise; every send, reply, and non-response logged and shown to the clinic. Paid listings disclosed in the same breath; we never front them and never take a cut. Written per-review responses and the negative-review workflow, in language, no templates.

---

## 11 · Rhythm

- **Weekly, Slack:** crawler activity (labeled a leading indicator), hub traffic, leads with the "ChatGPT or another AI assistant" attribution option, content published, new reviews. One plain-English line. Never implies movement in AI answers the re-test hasn't shown.
- **Monthly work:** the page counts above; re-run; outreach and responses at Complete scope; the video.
- **Day 30 / 60 / 90:** the same questions re-run on the same four engines; scorecard against Day 0; a short video walking through what moved and what didn't, including flat months; outreach log and displacement view for Complete scope. Client time after the call: ~20 minutes a month.

---

## 12 · The timing log — the point of the pilot for Beat 36

`time_log` — `tenant_id`, `task_category`, `minutes`, `logged_by`, `logged_at`, `note`.

Categories (fixed list): `baseline_retest` · `pages_new` · `pages_refresh` · `review_tool_setup` · `review_responses` · `outreach` · `reporting_video` · `client_comms` · **`implementation`** (kept out of the subscription total).

At day 30, 60, 90: hours per clinic per category, subscription total vs implementation total. The on-camera arithmetic is "Complete runs about fifteen hours a month per clinic… Core's lighter, call it half." If the Complete-scope pilots run twenty, the cap is four and Beat 36 says four. The math works because it's real, so the log has to be honest — including the hours that were learning curve (mark them; month two is the number that counts).

---

## 13 · Day 90 — close-out

Six things, in this order, in one email and a short call if they want one:

1. **Results package:** Day 0 vs day 30 / 60 / 90 on their questions, named/not-named, who is named instead, the review-tool numbers, hub traffic and attribution, the outreach log. Fidelity footer. Sample size on every number.
2. **Timing report** — how many hours their pilot took, in plain language. They're the first people who get to see the arithmetic.
3. **Permission confirmed** — anonymized use stands unless revoked; named use asked plainly, once, with what "named" would mean (their clinic name, city, screenshots).
4. **Testimonial** — asked once, optional, their words, and told upfront it will carry the no-cost-pilot disclosure if used.
5. **Keep Everything, executed:** the hub keeps serving unchanged, listings stay corrected, the review system stays connected, every scorecard and video and the question set delivered as files. Nothing switched off.
6. **Market decision:** the seat is released and the market opens unless a separate conversation says otherwise. That conversation has its own document. Nothing in the pilot creates a special price, a waiver, or a term.

---

## 14 · Proof artifacts checklist (what the webinar gets)

- [ ] Per clinic: Day 0, day 30, day 60, day 90 records on four engines — sample size stated, confounds listed (implementation track yes/no, ads running yes/no, anything else the clinic changed)
- [ ] The first ten bullet mirrors → posted reviews, with permission, patient names removed
- [ ] A real outreach log with non-responses (Complete scope)
- [ ] Timing totals per scope, month one and month two separately
- [ ] Attribution counts: leads self-reporting "ChatGPT or another AI assistant"
- [ ] Testimonials with disclosure language attached to each
- [ ] Which markets are held at launch and which are open

---

## 15 · Definition of done — pilot onboarding

- Pilot agreement confirmed in writing; consent recorded on the tenant
- Tenant provisioned as `pilot`; market held; seat counted; Slack channel live
- Funnel complete; canonical NAP locked; booking made at ≥ 4 h notice
- Photograph I run; findings doc; screenshots; sources upserted
- Call done: NAP confirmed, custom questions approved, access granted, all three DNS records live (two CNAMEs and one TXT), review mechanism + destination decided, named person recorded
- Photograph II archived as Day 0 before any change
- Hub live ≤ day 7; first answer pages ≤ day 14
- Review tool live; cards printed and handed; automated request configured or `card_only` recorded
- Timing log has entries from day 0
- Weekly Slack report firing; day-30 report date set

---

## 16 · Client-facing copy blocks (offer-free)

### 16.1 · Welcome email (Resend, within 60 seconds of "Start pilot")

> **Subject:** Next step — ten minutes, then pick your call time
>
> [Name] — you're in. Here's the only link you need for now:
> [srtagency.com/onboarding?t=…]
>
> It's about ten minutes: your business details exactly as they should appear everywhere, your treatments, who you most want walking in, and how you currently ask for reviews. The last screen books our call.
>
> On the call I'll show you exactly where the AI is naming other clinics in your city instead of you, then we get set up — about an hour, you drive your own accounts, I never touch a password.
>
> — [Matthew / Lina]

### 16.2 · "What happens next" (funnel completion screen)

> Thanks — that's everything we need to run your first photograph.
> Before we talk, we run the twenty questions patients in your city ask an AI, across four engines, and write down who gets named. On the call you'll see it. Then we build. First pages are live within two weeks, and every month you get the same questions re-run and a short video of what moved.

### 16.3 · Pilot terms — one page, plain language

> **What this is.** For 90 days we run our full service for [Clinic] at no cost. That includes: measuring where AI names clinics in [City] for the questions your patients ask; building and refreshing answer pages on `learn.[domain]`; the patient review tool and its cards; [Complete scope: written review responses and monthly outreach to the directories and lists AI reads]; and a monthly scorecard with a short video.
> **What we ask.** About an hour for the onboarding call, roughly twenty minutes a month after that, approval of your question list once, access to your business profiles as a manager (never passwords), and one named person on your team for the review tool.
> **Reviews.** Every patient gets the card. No incentives, no lobby tablets, no picking who gets asked, no asking anyone to name staff. If any of that happens today, it stops.
> **Your results.** We may use anonymized results (city and treatment level, no clinic name). Using your name needs a separate yes from you. You can withdraw future use at any time; anything already recorded stays.
> **What you keep.** Everything, live, when the 90 days end — the pages, the corrected listings, the review tool connection, every scorecard and video, the question list.
> **What we don't do.** Guarantee a result. Nobody can promise what an AI says. What we put a date on is the work.
> **What this isn't.** A trial of anything for sale. There's nothing to buy during the pilot and we won't bring it up. After day 90 you'll have your results and we'll ask what you'd like to do.
> **Costs.** None to you. If we ever recommend a listing that charges a fee, we'll say so and it's your call; we don't take anything from it.
> **Market.** While the pilot runs, we don't work with another clinic within [radius] of you.

### 16.4 · Consent block (funnel step 6, before booking)

> **Using what we measure.** We'd like to use your results to show other clinic owners what this looks like.
> ☑ Anonymized — city and treatment, no clinic name, no screenshots that identify you *(default)*
> ☐ Named — clinic name, city, screenshots. *(Optional. You can change this later for anything not yet recorded.)*
> **Language for your patients' review tool:** ○ English ○ Spanish ○ Both

### 16.5 · The card

> **Front:** [Clinic name] · **Four questions. Ninety seconds. Your words.** · [QR] · *Scan when you're home.*
> **Back:** What were you worried about before you came in? · What were you hoping would happen? · Had you had a bad experience somewhere before this one? · What actually happened? — *Answer in your own words. Nothing is posted unless you post it.*

Same card for every patient. No "if you loved your visit." No stars. No staff names. No thank-you gift. Printed, not on a tablet.

### 16.6 · The automated text (from their booking system, ~3 hours after the visit)

> Thanks for coming in today. If you have ninety seconds tonight — four questions about your visit, in your own words: [link]. Nothing is posted unless you post it.

### 16.7 · Review tool screen copy

> **Intro:** Four questions about your visit. Your answers, in your words. You'll see them laid out as notes you can change, copy, and post — only if you want to.
> **After the four:** Here's what you said, laid out as notes. Change anything. Copy it. Then post it wherever you like — [Google] · [RealSelf].
> **Optional, shown to everyone:** Want [owner first name] to reach out about anything? Leave a number. *(Never worded by sentiment.)*

---

## 17 · Schema deltas vs v1.2 (pilot)

- `tenants`: `billing_status ('pilot' | 'active' | 'churned' | 'waitlist')`, `pilot_started_at`, `pilot_ends_at`, `tier_scope`, `language`, `consent_results ('anonymized' | 'named' | 'none')`, `consent_recorded_at`, `testimonial_disclosure_required bool (default true for pilots)`, `review_request_mode`, `booking_software`
- `time_log` (§12)
- `review_tool_submissions`: `tenant_id`, `question_set_version`, `answers jsonb`, `posted_destination nullable`, `created_at` — no identifiers, no IP
- Every price-reading path branches on `billing_status` first

---

## 18 · Decision locks — veto window open, silence = ratified

| Lock | Decision |
|---|---|
| **D-P1** | 3 pilots, 3 markets, 90 days, 2 Complete scope + 1 Core scope, one Spanish-language if qualified. |
| **D-P2** | Pilots occupy seats and hold markets exactly like paying clients. |
| **D-P3** | Zero offer language before day 90, in any channel. Continuing is a separate conversation with a separate document; the pilot creates no special price, waiver, or term. |
| **D-P4** | Implementation track done for pilots when findings call for it; logged as a confound; hours logged separately. |
| **D-P5** | Delivery volume = exactly what will be sold. No extra pages, no extra outreach, no extra engines on the scorecard. |
| **D-P6** | Permission: anonymized by default, named by separate yes, revocable forward only. Testimonials voluntary, asked once at day 90, disclosed as no-cost pilot wherever used. No reviews of us solicited, ever. |
| **D-P7** | Review tool = the framework in §10.3, no model in the path, no staff field, sentiment-blind owner-contact line, Google → RealSelf. |
| **D-P8** | Automated request lives in the clinic's booking software; we never hold patient contacts; `card_only` otherwise. |
| **D-P9** | Timing log mandatory from day 0; month two is the number that goes on camera. |
| **D-P10** | Close-out order as §13; seat released and market opened at day 90 unless a separate conversation says otherwise. |
