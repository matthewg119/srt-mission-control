# SRT AEO — Artifact Templates v1

Every client-facing artifact, in one place, so wording doesn't drift between clinics or between months. Drift is what makes a case study indefensible.

---

## 1 · The fidelity footer

**Goes on every rendered artifact that contains engine results.** Findings doc, every scorecard, the day-90 package, any screenshot deck. No exceptions.

> **How this was measured.** These questions were run through each engine's API with search enabled on {date}, from {location}, using question set {version}. API retrieval is not identical to typing the same question into the app — there's no personalization and no session history, so your own results may differ. What this measures is a consistent, repeatable signal of whether you're in the set of businesses an engine can retrieve for these questions. Because the method doesn't change between runs, the difference from one month to the next is meaningful.
>
> **Sample size:** {N} questions × {M} engines = {K} observations.

Non-negotiable, and it is not a disclaimer — it's the thing that makes the numbers trustworthy. A client who finds the gap themselves churns. A client who was told about it in month one believes the rest.

---

## 2 · Findings doc — Photograph I

Six sections, v1.0 §3.1 order, every time. Assembled automatically, reviewed before the call.

**1 — Where AI names other clinics in {city} instead of you**
Lead with 3–5 real UI screenshots. Name the competitors that appeared. State: named in X of 20, {top competitor} named in Y of 20.

**2 — Why**
The discrepancy log. Plain language: *"Your address appears three different ways across seven platforms. The engines can't confirm who you are."*

**3 — The review gap**
Client vs. the three named competitors, side by side. Count, average, recency, owner response rate, themes in negatives.

**4 — The technical gap**
No schema, no answer-shaped pages, crawlers blocked, no `llms.txt`. One line each, no jargon.

**5 — The plan for the next 21 days**
A plan. **Not a fix list with a price on it.** For pilots there is nothing purchasable anywhere in this section.

**6 — What we need from you**
The access list. Only the access list.

Fidelity footer.

---

## 3 · Scorecard — day 30 / 60 / 90

Same shape every time, so months stack.

**Header:** {Clinic} · Day {N} · Question set {version} · {N} questions × 4 engines = {K} observations

**The line that matters**
> On day 0 you were named in **{X} of {N}**. Today you are named in **{Y} of {N}**.

**By engine** — named / not named, Day 0 vs today, across ChatGPT · Perplexity · Gemini · Google AI Overviews.

**Named instead of you** — who appeared when you didn't, with change since Day 0. This is the displacement view.

**Questions that changed** — moved to named, and moved to not-named. **Show both.** A month where something slipped and you showed it is worth more than three months of only-good news.

**Review tool** — cards handed, scans, completions, posted, % containing an objection phrase.

**Hub** — traffic, top pages, AI referral sessions broken out by engine, crawler activity labeled *leading indicator*.

**Outreach** (Complete scope) — pitched, replied, declined, no response, landed. Non-responses shown.

**Confounds** — implementation track yes/no, ads running yes/no, anything the clinic changed. Stated plainly, every month.

Fidelity footer.

**Plus a short video** walking through what moved and what didn't. Flat months get a video too, and the video says the month was flat.

### Vocabulary

Named · not named · named alongside · named instead.
Never ranked, position, top result, or #N.

---

## 4 · Weekly Slack report

To the tenant's `slack_channel_id`. Never hardcode a channel.

> **{Clinic} · week of {date}**
> **AI crawler activity** — {n} visits from {bots}. *Leading indicator: it means the engines are reading your pages, not that answers have changed.*
> **Hub** — {n} visits · top pages: {…}
> **From AI assistants** — ChatGPT {n} · Perplexity {n} · Gemini {n} · Copilot {n}
> **Leads** — {n}, of which {n} said they heard about you from an AI assistant
> **Published** — {titles with links}
> **New reviews** — {n}, average {x}
> **This week:** {one plain-English line}

**Never implies movement in AI answers that a re-test hasn't shown.** Crawler activity is not a result and the report says so in the same sentence it reports it. That discipline is what makes the day-30 number land.

---

## 5 · Day-90 close-out

Six things, this order, one email plus an optional short call.

1. **Results package** — Day 0 vs 30 / 60 / 90, named / not named, who was named instead, review tool numbers, hub traffic and attribution, outreach log. Fidelity footer. Sample size on every number.
2. **Timing report** — hours their pilot took, by category, in plain language. Subscription hours and implementation hours separately. Month one and month two separately (month one carries the learning curve; say so).
3. **Permission confirmed** — anonymized use stands unless revoked; named use asked plainly, once, with what named would mean.
4. **Testimonial** — asked once, optional, their words, told upfront it carries the no-cost-pilot disclosure wherever used.
5. **Keep Everything, executed** — hub serving unchanged, listings corrected, review system connected, every scorecard and video and the question set delivered as files. Nothing switched off.
6. **Market decision** — seat released, market opens, unless a separate conversation says otherwise. That conversation has its own document.

**Nothing about what comes next appears before item 6**, and item 6 doesn't propose anything.

---

## 6 · Directory & list outreach — Complete scope

25 pitches/month budget. One follow-up at 7 days, then stop. Every send, reply, decline, and **non-response** logged and shown to the clinic.

Targets come from `citation_sources` — pages that were actually cited in that clinic's own Photograph runs. They're provably in the retrieval set for the clinic's questions, which is what makes this different from generic link building.

> **Subject:** {specific to their post, under 8 words}
>
> {One true, specific observation about the actual post — an outdated entry, a closed business, a genuine gap. Proves a human read it.}
>
> {One sentence on the clinic and one concrete credential.}
>
> Would you consider including them when you next update it? I can send photos, verified hours, or a short written blurb — whatever's least work for you.
>
> {Name}, {title}, SRT Agency — I work with {clinic}.

Rules: under 120 words. Affiliation stated plainly, every time. Paid listings disclosed in the same breath; we never front them and never take a cut. **We pitch, they decide** — a decline is logged and shown, not retried.

When a placement lands, set `placement_confirmed_at` and flag the source query for the next re-test. Before/after on a question tied to a placement you earned is the strongest thing in any monthly report.

---

## 7 · Language

Every client-facing artifact renders in the tenant's `language` (`en` / `es` / both). Spanish reviewed by a native speaker before first send — machine-translated scorecard language drifts toward overclaiming, and the fidelity footer is exactly the paragraph you can't afford to have drift.
