# SRT — Pilot Amendment A1
## Page volume, the avatar harvest, and tracked-set discipline

**Amends:** `SRT-AEO-Onboarding-v2-PILOT.md` — `D-P5`, §10.2, §12, §14. Compliance canon otherwise unchanged.
**Also touches:** `SRT-AEO-Delivery-Offer-v2.md` §4 (counts), `SRT-Question-Sets-v1.md` (custom set timing), `SRT-Artifact-Templates-v1.md` §3 (confounds line).
**Does not touch:** §10.3, §16, the review tool spec, or any Integrity Law. None of this changes what the review tool does.
**Status:** RATIFIED. A2 §1 records it: the veto window closed with no veto raised.

---

## 0 · What changed, and what didn't

Matthew is over-delivering to the pilot cohort on purpose — more pages than the paid product sells, because these clinics are getting the service free and the point is to actually help them.

Note first, so nobody re-litigates it: **the pilot doc already assumes the clients are free.** That was never the constraint. The constraint being amended is `D-P5`, which said delivery volume equals exactly what will be sold, *so that the case study measures the product*.

That reasoning is still right. The amendment keeps it intact by separating the two things `D-P5` was bundling together: how much work gets done, and which work the numbers are attributed to.

---

## 1 · The problem `D-P5` was solving

Three on-camera claims rest on volume being what it says:

| Claim | What breaks if pilots get 20 pages/month |
|---|---|
| 4 new + 4 refreshed / 8 + 8 per month (Beat 12–13) | The day-90 result was produced by roughly triple that. A buyer at 8+8 will not reproduce it. |
| ~15 hours per Complete clinic; six at a time (Beat 36) | 20 pages/month is well past 15 hours. The six-client cap is arithmetic on that number, and month two is the number that goes on camera. |
| One documented result, confounds stated (Beat 29) | Undisclosed volume is an undisclosed confound. That is the one thing Integrity Laws 3 and 6 exist to stop. |

None of these is an argument against doing more work for a free client. They are arguments against the extra work being **invisible in the record**.

---

## 2 · The lock — the `D-P4` pattern, applied to pages

This is the mechanism the pilot doc already uses for the implementation track: do the work, log it as a confound, log the hours separately. Extend it.

**`D-P5a` — Two publishing tracks.**

`hub_pages` gains `scope ('measured' | 'over_delivery')`.

- **Measured** — 4 new + 4 refreshed (Core scope) or 8 + 8 (Complete scope) per month. Selected first, published first, and preferentially covering questions in the tracked set. This is the product as sold.
- **Over-delivery** — everything above that count. Publishes normally. Tagged. Never counted toward the sold volume in any artifact.

**`D-P5b` — Hours stay honest.**

`time_log` gains `pages_over_delivery` to its fixed category list. Like `implementation`, it is **excluded from the subscription total** in every rollup. Month two's subscription figure is what goes on camera, and it stays the figure for a clinic receiving 4+4 or 8+8.

**`D-P5c` — Stated as a confound, every month.**

The scorecard's confounds line (Artifact Templates §3) already prints implementation-track yes/no and ads yes/no. It gains one more:

> Over-delivery: {n} pages published above the standard monthly count this month, {N} to date.

Same for the day-90 results package and any case study built from it. A pilot that received 60 pages is described as having received 60 pages.

**`D-P5d` — What stays cut.**

Volume is amended. Nothing else is. Still cut: extra engines on the scorecard, extra outreach beyond 25 pitches/month at Complete, `llms.txt`, schema past the basic block, directories past the core six as *remediation*, Reddit or forum posting of any kind. Over-delivery means more of a deliverable that already exists, never a new one.

---

## 3 · Why this is worth the two extra fields

Because the alternative is a case study that cannot be defended, and the pilot exists for the case study.

If day 90 shows a clinic went from named in 3 of 40 to named in 22 of 40, the first question any competent buyer asks is *what did you actually do*. "Eight pages a month" has to be true or the answer is worthless. With the two tracks, the honest answer exists and is stronger: *here is what the standard package produced, here is what additional volume added on top.* That second sentence is a data point nobody else in this market has.

It also means the day-90 timing report — the thing the pilot clinics are the first people to see — still says something meaningful about what the paid service costs to run.

---

## 4 · The avatar harvest

**`D-P11` — Reddit and forum harvest, research only, pre-call and weekly.**

Sources: Reddit via the official API with SRT credentials, RealSelf Q&A, and forum pages already surfaced in `citation_sources`. Seeded from intake Step 3 objections verbatim, the services taxonomy, `{city}`, and `{treatment}`.

- **We never post to Reddit or any forum, and never as the client.** Already canon. Reading is research; posting is not on the table and no posting path gets built.
- Verify the Reddit API's current terms permit this use before it ships.
- Output goes to `question_bank` (global) with `source = 'harvest'`, scored on frequency, commercial intent, avatar tag, and whether the phrase names an objection.

**Two runs, two purposes:**

1. **Pre-call**, as step 4c of the onboarding runner. Feeds the custom question set so the client's actual avatar phrases are in the tracked set *before* Day 0.
2. **Weekly**, during rhythm. Surfaces 50 ranked page ideas per tenant to the client's Slack channel as a multi-select. Matthew picks the week's set.

---

## 5 · Tracked-set discipline — unchanged, and now load-bearing

The harvest feeds two places through two different tables. This separation is what the case study rests on and it must not blur.

| Path | Table | Frozen? |
|---|---|---|
| Harvest to custom question set to approved on the call to Day 0 | `ai_baseline.question_set_version` | **Yes.** `custom_v1`, never edited in place |
| Harvest to page candidates to weekly selection to pages | `page_candidates` | No. Regenerated freely |

**`D-P12` — Avatar phrases are tracked from Day 0, or they start their own baseline.**

The custom set (20 at Core, 60 at Complete) is built from intake Step 3 + the harvest + Photograph I's cited sources, approved once on the call, frozen as `custom_v1`. Photograph II runs `universal_v1 + custom_v1`. That is Day 0 and it is where avatar-specific phrases get measured from.

Phrases discovered later create `custom_v2`. They do not edit `custom_v1`. At the next re-test both versions run once so there is an overlap point — otherwise the trend line breaks. `custom_v2` questions carry their own baseline date, stated on the scorecard.

Selection and page generation **never** write to the tracked set. If a code path exists where they could, it is a build stop.

---

## 6 · Schema deltas

- `hub_pages`: `scope ('measured' | 'over_delivery')`, default `'measured'`
- `time_log` categories: add `pages_over_delivery`, excluded from subscription totals alongside `implementation`
- `question_bank`: `avatar`, `objection_phrase bool`, `harvest_run_id`
- New `harvest_runs`: `id`, `tenant_id` nullable, `vertical`, `sources jsonb`, `seed_terms text[]`, `run_at`, `results_count`
- `nap_discrepancies`: `tier ('core_six' | 'extended')`

---

## 7 · Decision locks — ratified

| Lock | Decision |
|---|---|
| **D-P5a** | Two publishing tracks. `measured` = the sold count. `over_delivery` = everything above it, published and tagged. |
| **D-P5b** | `pages_over_delivery` hours excluded from the subscription total, same as `implementation`. Month two's subscription figure is the on-camera number. |
| **D-P5c** | Over-delivery stated in the confounds line of every scorecard, the day-90 package, and any case study. |
| **D-P5d** | Volume is the only thing amended. Engines, outreach budget, `llms.txt`, schema, directory remediation scope and the Reddit posting ban all stay cut. |
| **D-P11** | Harvest is research-only, official APIs, pre-call once and weekly thereafter. No posting path is built. |
| **D-P12** | Custom set frozen as `custom_v1` at Photograph II. Later phrases become `custom_v2`, run alongside once for overlap, with their own baseline date. Selection never writes to the tracked set. |

---

## 8 · Registry actions

Add to `SRT-Doc-Registry-v2.md` CANON:

| Document | Governs |
|---|---|
| `SRT-Pilot-Amendment-A1-Volume-and-Harvest.md` | Page volume tracks, the harvest, tracked-set discipline. Amends pilot doc `D-P5`. |

Delete: `SRT-ClaudeCode-Prompt-ONBOARDING-RUNNER-v1.md`. A1's Runner v2 registry row is superseded by A2 §8, which registers Runner v3 and deletes v2.

Add to Build Prompt v4's authoritative docs list, at position 2 (immediately below the pilot doc, since it amends canon):

```
1. SRT-AEO-Onboarding-v2-PILOT.md
2. SRT-Pilot-Amendment-A1-Volume-and-Harvest.md   — amends D-P5
3. SRT-AEO-Delivery-Offer-v2.md
...
```

Still open at the time A1 was written: the Integrity Laws numbered, the webinar beats, the 20 Questions PDF, the signable pilot agreement, and how a market is defined. A2 closes the last three.

---

## Repo note, added when this file was placed in `docs/specs/` on 2026-08-18

Names in this document are Runner-v3 names, not this repo's. See the translation table in
`docs/SRT-ClaudeCode-CONTINUATION-hub-to-onboarding.md`. The two that matter here:
`hub_pages` is **`client_pages`**, and `tenants` is **`clients`**. `time_log` is `time_log`.
