# SRT — Pilot Amendment A2
## Market definition, the audit to tenant bridge, `universal_v1`, and the engines

**Amends:** `SRT-AEO-Onboarding-v2-PILOT.md` — closes the standing "how is a market defined" open item and adds the tenant-record fields in §6 below. `SRT-Question-Sets-v1.md` — the universal set is no longer a fallback. `SRT-Artifact-Templates-v1.md` §3 — fidelity footer form. Build Prompt v4 §5 (avatar), §6 (engines) as build consequences.
**Also records:** Amendment A1 ratified.
**Does not touch:** the review tool spec, any Integrity Law, page volume (A1 stands), the Reddit posting ban.
**Status:** `D-P13` and `D-P14` were confirmed in writing on 18 Aug 2026 ("10 miles is fine"; the avatar is the subject's, per audit). `D-P15` and `D-P16` are proposed locks, veto window open. Silence = ratified.

---

## 0 · What changed, and what didn't

Three of the four things below were already true in spirit and undecided in number or mechanism. This writes the number and the mechanism down so Claude Code builds one thing.

The fourth — the audit to tenant bridge — is new. The audit bot in `#ai-visibility-audits` and the onboarding runner in `#onboarding-*` describe the same business at two different moments, with different questions and a different engine count. Left unjoined they duplicate work; joined carelessly they contaminate the case study. This is the careful join.

---

## 1 · A1 — ratified

`SRT-Pilot-Amendment-A1-Volume-and-Harvest.md` proposed `D-P5a–d`, `D-P11`, `D-P12` with an open veto window. No veto was raised; the follow-up direction on 18 Aug 2026 built on top of it. **A1 is ratified as written.** Its registry actions stand, with one edit below (Runner v2 becomes v3).

---

## 2 · `D-P13` — A market is a 10-mile radius

**Lock.** A market is the circle of radius **10 miles** around the tenant's canonical address. One clinic per market. Pilots hold a market exactly as paying clients do.

**Mechanism.**
- Centre = the canonical address geocoded once at intake, into `tenants.market_center`. Geocode with the US Census geocoder or a static ZIP-centroid dataset, not Places — `market_center` lives for the life of the tenant and Places coordinates are (as I understand the terms) cacheable for about 30 days. Keep the `place_id` too; that may be stored. Radius = `tenants.market_radius_mi`, `NOT NULL DEFAULT 10`.
- A market is **held** by any tenant whose billing status holds a seat (`'active'`, `'pilot'`; if the repo already defines the seat-holding list, that list wins).
- The checkout ZIP check geocodes the entered ZIP to its centroid and blocks when that point lies inside any held market. Same check at pilot intake. The check reads **distance from centre**, never ZIP equality: two ZIPs a mile apart are one market; one large ZIP with two clinics nine miles apart is also one market.
- No counter, no "how many seats," waitlist when held — unchanged from canon.
- Changing a radius is an admin action, logged, and only ever follows the agreement. The number is not a dial and it is not a negotiating chip.

**Still open, deliberately:** the contract wording that carries the 10 miles into the signable pilot agreement and the paid agreement (canon v4 blocker 8). The number is locked; the sentence is not written.

---

## 3 · `D-P14` — Audit to tenant: joined on the business, separated in the numbers

**What an audit is.** One engine (ChatGPT with web search), 20 prompts generated for the *subject's* niche, a 0–100 score, named-in-N-of-20, who was named instead, cited sources, a PDF, a report URL. A prospecting asset. **Not Photograph I** — wrong engine count, and its questions are the niche generator's, not `universal_v1`.

**Lock — what carries across** when a lead becomes a tenant (matched on `place_id`, else domain, else normalized NAP):

| Carries | As | Used for |
|---|---|---|
| The run: prompts as run, per-question named/not named, businesses named instead, cited sources, score, PDF, report URL | `ai_baseline` row, `run_label = 'prospect_audit'`, `engines = ['chatgpt_web']`, `excluded_from_scorecard = true` | Context only. Findings §1 may say "the audit you already saw." Never a baseline, never on a scorecard, never in a re-test, never in a case study, never combined with a photograph. |
| Its cited sources | `citation_sources` with `run_id` | Harvest input only (A1 `D-P11`). |
| Its avatars | `lead_avatars` (30-day cache, as the bot already caches) | **Candidates** for step 5b, under the subject rule below. |

Nothing else carries. The audit's score never seeds a trend line.

**Lock — the avatar rule is subject-keyed, not taxonomy-keyed.** The audit's avatar generator is niche-keyed: run on a dentist it produces the dentist's ideal patients; run on a roofer, the roofer's; run on SRT itself (`niche_cache_key = 'aeo-marketing-agency'`) it produces SRT's buyers with retainer ranges. So:

- `lead_avatars` is read for a tenant **only where `niche_cache_key = tenants.vertical`**. Any other cached row is invisible to that tenant. Not "SRT's own rows" specifically — any mismatch.
- **One vocabulary.** `tenants.vertical` takes its values from the bot's `niche_cache_key`, verbatim — no mapping table. `med_spa` in these documents stands for whatever string the bot uses for med spas. The SRT test tenant's vertical is `aeo-marketing-agency`.
- **The cache is per niche, not per business** — every med spa audited in a 30-day window gets the same three avatars. That is why audit avatars are candidates and never the answer; the clinic-specific avatar still comes from intake and the clinic's own reviews (v4 §5).
- The audit emits free-form labels; the tenant needs the fixed enum `a1` nervous first-timer / `a2` fixer-switcher / `a3` maintenance buyer. The mapping is a human click in step 5b. **Never automatic.**
- `retainer_range` is meaningless for a patient and never carries.
- `lead_avatars` never writes `tenants.primary_avatar`. Only 5b does.

**Why the separation is load-bearing.** Integrity Laws 3 and 6: sample sizes stated, confounds disclosed. A single-engine run on a different question set sitting next to a four-engine photograph is an undisclosed confound in the one place the case study cannot afford one.

---

## 4 · `D-P15` — `universal_v1` is the 20 Questions PDF, verbatim

**The PDF exists.** Source file: `med-spa-aeo_lead-magnet_20-questions_v1.md` (webinar project). The funnel's PDF renders from it. If the shipped PDF's wording ever diverges from the source, the **shipped** wording wins for `universal_v1` and this amendment gets a v2 — the tracked set must be the questions the public actually received, because Beat 11 says so on camera ("the twenty in the PDF are the ones everybody's patients ask").

**Lock — `universal_v1@med_spa`, the 20, character for character:**

1. What's the best med spa near me for [Botox / filler / laser]?
2. Who does the best lip filler in [city]?
3. Where should I go for laser hair removal in [city] if I have sensitive skin?
4. What's a reputable med spa in [city] for a first-timer?
5. Which med spas in [city] have the best reviews for [treatment]?
6. Is [treatment] safe, and how do I find a qualified provider near me?
7. How do I know if a med spa is legit / has licensed injectors?
8. What should I look for in a med spa before booking?
9. Has anyone had a bad experience with [treatment], and how do I avoid it?
10. Which med spas in [city] are run by nurses or doctors?
11. How much does [Botox / filler / etc.] cost in [city]?
12. What's the average price for [treatment] near me?
13. Which med spa in [city] has the best value for [treatment]?
14. Are there any deals or membership plans for [treatment] in [city]?
15. Compare [Clinic A] vs [Clinic B] in [city].
16. Book me a consultation for [treatment] near me.
17. What med spa in [city] specializes in [specific concern — e.g., melasma, acne scars]?
18. Who's the best injector for natural-looking results in [city]?
19. Which med spa near me offers [specific device / brand — e.g., Morpheus8, CoolSculpting]?
20. I had a bad experience with laser before — who in [city] is gentle and experienced with nervous patients?

**Lock — `materialization_v1`, the substitution table.** The bracketed placeholders are the only things that change per tenant. Everything else runs verbatim, including "med spa," "injector," and "laser."

| Placeholder as printed | Becomes | Value comes from |
|---|---|---|
| `[city]` | `{city}, {state}` | canonical NAP |
| `near me` | `near {city}, {state}` | canonical NAP |
| `[Botox / filler / laser]` · `[Botox / filler / etc.]` · `[treatment]` | `{treatment_primary}` | intake Step 3, highest-margin treatment |
| `[Clinic A]` | `{client_name}` | canonical DBA |
| `[Clinic B]` | `{competitor_intake_1}` | first competitor named at intake Step 2 |
| `[specific concern — e.g., melasma, acne scars]` | `{concern}` | the primary concern mapped to `{treatment_primary}` in the services taxonomy; if unmapped, the PDF's example "melasma," and the fidelity footer says so |
| `[specific device / brand — e.g., Morpheus8, CoolSculpting]` | `{device_primary}` | first device/brand-named service on the intake services list; if none, the PDF's example "Morpheus8," and the fidelity footer says so |
| Questions 7, 8, 9 (no location in the text) | prefixed with `I'm in {city}, {state}. ` — the question after the prefix stays verbatim | canonical NAP |

**Rules.**
- Values are proposed from intake and frozen in `tenants.question_substitutions` at Photograph I. They are printed on the call sheet with a correction box beside each. A correction is logged; Photograph II runs the corrected text; that question's I-to-II delta is marked not-like-for-like. After Photograph II nothing changes.
- `question_text` is stored **as run** on every `ai_baseline` row. The scorecard compares text to text, never template to template.
- `materialization_v1` is itself versioned. Changing a substitution rule is `materialization_v2` and starts a new baseline for every question it touches. It is not a tidy-up.
- If `SRT-Question-Sets-v1.md` carries a fallback universal set that differs from the 20 above, the 20 above win and the fallback is retired — before client one's Photograph I, never after.
- **Universal sets are keyed by vertical.** `universal_v1@med_spa` is this list. A tenant of another vertical uses `universal_v1@{vertical}`, frozen from the audit generator's 20 for that niche at that vertical's first Photograph I. The SRT test tenant (`aeo-marketing-agency`) is such a tenant; nothing from it enters a med spa case study.

---

## 5 · `D-P16` — The photographs run the four engines the offer names

Restated for the build, because the running test tenant shows a one-engine baseline.

- The four are the ones canon v4 §3 and the PDF name: **ChatGPT, Gemini, Perplexity, Google AI Overviews.** No fifth (A1 `D-P5d` stands).
- Photograph I, Photograph II and every re-test run every keyed engine of the four, identical engines and identical `question_text` from run to run.
- The fidelity footer on every artifact reads **`N questions × M engines · {date} · {question set versions}`**, and M is what actually ran.
- Fewer than four may be accepted as a client baseline **only by written decision before client one's Photograph I** (Runner v3, HOW TO WORK item 3). A one-engine run is never labelled a photograph for a paying or pilot client.

**Flag, not a lock — the four collide with "official APIs only."** ChatGPT, Gemini and Perplexity have official APIs; as of my knowledge Google AI Overviews does not, and scraping Google is off the table by canon. If Claude Code confirms that, the honest shapes are: (a) three engines automated + AI Overviews **sampled manually** on the findings doc and the scorecard, footer stated as such; (b) three engines, and the on-camera "across four engines" line (canon v4 §3, close Beat 11) is amended before recording; (c) an official AI Overviews API exists in 2026 and none of this applies. Gemini is not AI Overviews and is not presented as it. This is a Lina decision because it touches a recorded line; the runner routes it to her in writing.

**Same check for the $39 audit.** Canon v4 §3 says the $39 audit is "those 20, run for you across four engines." The SRT audit bot in the screenshots runs *generated* prompts on *one* engine. If that bot is what fulfils the $39 OTO, the ladder is false at rung two. Whatever runs the $39 audit must run `universal_v1` + `materialization_v1` on the same engines as the photographs, or the on-camera ladder is amended. Confirm which engine fulfils the OTO.

---

## 6 · Schema deltas

- `tenants`: `market_center` (lat/lng), `market_radius_mi integer NOT NULL DEFAULT 10`, `question_substitutions jsonb`, `vertical` (if absent; values = the audit bot's `niche_cache_key` vocabulary; default = the bot's med spa key, written `med_spa` here), `lead_id` nullable
- New `lead_avatars`: `id`, `audit_run_id`, `niche_cache_key`, `subject` (place_id / domain / normalized NAP), `avatars jsonb`, `pick`, `generated_at`, `expires_at`
- `ai_baseline`: `excluded_from_scorecard bool default false`; `run_label` gains `'prospect_audit'` and `'test_run'`
- `citation_sources`: `run_id` if absent
- Question-set versions: `universal_v1@med_spa` (the 20 above) and `materialization_v1` recorded as frozen entries in whatever table v4 already uses for `question_set_version`; if none exists, add one — do not store them as a code constant only

---

## 7 · Decision locks

| Lock | Decision | Status |
|---|---|---|
| **A1** | Ratified as written. | ratified |
| **D-P13** | Market = 10-mile radius on the canonical address, distance-checked, one clinic per market, pilots hold markets. Contract sentence still to be written. | confirmed 18 Aug |
| **D-P14** | Audit joins the tenant on the business; its run is `prospect_audit`, excluded from every scorecard/re-test/case study; avatars are subject-keyed candidates mapped to a1/a2/a3 by a human; nothing else carries. | confirmed 18 Aug |
| **D-P15** | `universal_v1@med_spa` = the 20 Questions PDF verbatim, with `materialization_v1`; frozen at Photograph I, corrected once on the call, immutable after Photograph II; keyed by vertical. | veto window open |
| **D-P16** | Photographs and re-tests run all keyed engines of the four; footer N × M; fewer than four only by written decision before client one. | veto window open |

---

## 8 · Registry actions

Add to `SRT-Doc-Registry-v2.md` CANON, at position 3 (below A1, since it amends canon):

| Document | Governs |
|---|---|
| `SRT-Pilot-Amendment-A2-Market-Audit-Bridge-Universal-Set.md` | Market radius, audit to tenant separation, `universal_v1` + `materialization_v1`, the four engines. Records A1 ratified. |
| `SRT-ClaudeCode-Prompt-ONBOARDING-RUNNER-v3.md` | The step engine, Slack gates, presence sweep, findings doc, call sheet, audit bridge, market check, rhythm loop, in-flight migration. |

Delete: `SRT-ClaudeCode-Prompt-ONBOARDING-RUNNER-v2.md` (and v1 if it survived A1's delete).

Build Prompt v4's authoritative docs list becomes:

```
1. SRT-AEO-Onboarding-v2-PILOT.md
2. SRT-Pilot-Amendment-A1-Volume-and-Harvest.md      — amends D-P5
3. SRT-Pilot-Amendment-A2-Market-Audit-Bridge-Universal-Set.md
                                                     — market, audit bridge, universal_v1, engines
4. SRT-AEO-Delivery-Offer-v2.md
...
```

Cross-reference for the SRT docs: the Integrity Laws are numbered **1–12 in `med-spa-aeo_PROJECT-CANON_v4.md` §5**, and that numbering is the one every SRT doc cites (Law 7 = refuse markets you can't win; Law 3 = sample sizes aloud; Law 6 = disclose confounds; Law 10 = never claim placement; Law 11 = staff names never a promise).

---

## 9 · Open after A2

| Item | Owner | Blocks |
|---|---|---|
| Contract wording for the 10-mile market, pilot and paid agreements | Lina | signing, not building |
| Signable pilot agreement | Lina | pilot start |
| Reddit API terms verified for read-only harvest — as of my knowledge commercial use of the Data API needs Reddit's approval; build 4c to run on RealSelf + `citation_sources` alone if Reddit says no | Matthew / Claude Code | step 4c |
| Which engine fulfils the $39 OTO audit, and whether it runs `universal_v1` on the four | Lina + Matthew | canon §3 ladder |
| Google AI Overviews: official API or manual sample — decides the "four engines" line | Lina | Beat 11 wording, Photograph I grid |
| Yelp Fusion keyed and terms verified | Matthew / Claude Code | automated tier only |
| Engine count accepted as baseline, in writing | Lina + Matthew | client one's Photograph I |
| Google 2026 review policy primary-source read | Lina | webinar Beat 19, not the build |

---

## Repo note, added when this file was placed in `docs/specs/` on 2026-08-18

This is the **revised** A2. It supersedes an earlier copy that geocoded via Places and wrote the
SRT test tenant's vertical as `aeo_agency`. If you are holding a copy that says either of those,
it is the old one.

Names here are Runner-v3 names, not this repo's. Translation table:
`docs/SRT-ClaudeCode-CONTINUATION-hub-to-onboarding.md`. What §6's schema deltas map to:

| A2 §6 | This repo |
|---|---|
| `tenants` | `clients` |
| `tenants.market_center` | `clients.market_center_lat` / `market_center_lng` (already exist) |
| `tenants.market_radius_mi` | `clients.market_radius_mi` (exists, nullable — A2 wants `NOT NULL DEFAULT 10`) |
| `tenants.vertical` | `clients.vertical_slug` (exists). `nicheKeyFor()` is already `vertical_slug \|\| business_type`, so the ONE VOCABULARY rule holds by construction |
| `ai_baseline` | `audit_runs` + `audit_reports`. `audit_runs.prompt` is already question-text-as-run; `citations` is cited sources; `recommended` is businesses-named. Needs `run_label` and `excluded_from_scorecard` |
| `lead_avatars` | `niche_briefs` (`niche_key`, `avatars jsonb`, 30-day TTL). Needs `subject` and `audit_run_id` |
| `citation_sources` | `audit_runs.citations jsonb`, denormalized. Normalize only when the harvest queries it |
| the seat-holding list | `billing_status in ('pilot','active')`, already used in `provision.ts` and `report-reminders.ts`. Note `src/lib/medspa/stripe.ts` defines a **different** list for the paid funnel |
