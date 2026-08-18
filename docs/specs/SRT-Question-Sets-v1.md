# SRT AEO — Question Sets v1

**Governs:** Photograph I, Photograph II, and every re-test at day 30 / 60 / 90.
**Hard rule:** a re-test runs the *identical* question text as the run it's measured against. Same wording, same variable substitution, same engines. A reworded question is a new question and starts its own baseline.

---

## Reconcile first

The pilot doc §7 says *"the universal 20 are the PDF set, versioned."* If the 20 Questions PDF lead magnet already exists, **its questions are the universal 20** and the list below is discarded.

The list below is a fallback: use it only if no PDF set exists, or as a diff against it. Either way, whatever is chosen gets frozen as `question_set_version = 'universal_v1'` and never edited in place — changes create `universal_v2` and a new baseline.

---

> ## ‼️ RESOLVED 2026-08-18. The reconciliation above is settled and the fallback below LOST.
>
> The PDF exists (`med-spa-aeo_lead-magnet_20-questions_v1.md`). **Amendment A2 `D-P15` makes its
> twenty the definition of `universal_v1@med_spa`, character for character, with a fixed
> substitution table `materialization_v1`.** Read
> `docs/specs/SRT-Pilot-Amendment-A2-Market-Audit-Bridge-Universal-Set.md` §4. That list is what
> seeds the tracked set. This one does not.
>
> **The fallback below is RETIRED and is kept only as the diff A2 §4 anticipates.** Nothing may
> seed `question_set_version = 'universal_v1'` from it. It is not a smaller version of the same
> list: it is keyword-shaped (`best med spa in {city}`) where the PDF's are full natural-language
> questions, and it uses variables (`{clinic}`, `{competitor}`, `{neighborhood}`,
> `{alternative treatment}`) that `materialization_v1` does not define.
>
> Runner v3 §4 says to say so out loud before retiring it. Said, in the Slack report of
> 2026-08-18 and here.
>
> **Still live in this document below the fallback:** the custom-set spec, the composition
> targets, the scope counts, and the versioning rules. A2 does not touch those. The **Engines**
> section is superseded by A2 `D-P16` on the fidelity footer and by the standing fact that one
> engine is keyed today — the four named there are the target, not the current state.

---

## The universal 20 (fallback draft — med spa vertical) — RETIRED, see the notice above

Variables: `{city}` · `{treatment}` · `{clinic}` · `{competitor}` · `{neighborhood}` · `{concern}`

Substituted per tenant from the intake record. The **question shapes** are universal; the substitutions are not.

**Discovery — where the clinic is either named or isn't**
1. best med spa in {city}
2. best {treatment} in {city}
3. top rated med spa near {neighborhood}
4. where can I get {treatment} in {city}
5. med spa near me in {city}

**Brand — what the engines already say about them**
6. is {clinic} any good
7. {clinic} vs {competitor}
8. {clinic} {city} reviews

**Problem-shaped — how patients actually ask**
9. who should I see for {concern} in {city}
10. what's the best treatment for {concern} and where in {city}
11. what's the difference between {treatment} and {alternative treatment}

**Objection-shaped — the highest-value set for AEO**
12. is {treatment} painful
13. is {treatment} safe
14. what should I ask before booking {treatment} in {city}
15. where should I go for {treatment} if I had a bad experience somewhere before
16. {treatment} in {city} for first timers

**Commercial**
17. how much does {treatment} cost in {city}
18. med spa in {city} with payment plans
19. med spa in {city} open evenings or weekends
20. med spa in {city} with a nurse practitioner or physician on site

> Questions 12–16 are the ones that matter most and the ones most agencies skip. They're phrased the way a nervous first-time patient types into a chat box — which is exactly the retrieval context you're trying to enter. They also map directly to the intake Step 3 objections and to the review tool's question 1.

---

## The custom set — approved once, on the call

Built between funnel completion and the call, from three inputs:

1. **Intake Step 3** — ideal patient, highest-margin treatment, the three objections they hear, what patients try first
2. **The weekly harvest** — `question_bank` entries for the med spa vertical, ranked by frequency × commercial intent
3. **Photograph I's cited sources** — what the pages that *are* being cited actually answer

| Scope | Universal | Custom | Total |
|---|---|---|---|
| Core | 20 | 20 | **40** |
| Complete | 20 | 60 | **80** |

Presented on the call as a list. The owner approves once and adds anything they think is missing — that addition is the point of the exercise, not a formality. Approved set is frozen as `custom_v1` for that tenant. Changes create `custom_v2` and a new baseline for the changed questions only.

**Composition target for the custom set** (guidance, not a quota):
- ~40% objection- and fear-shaped
- ~25% treatment-specific and procedure-comparison
- ~20% neighborhood, landmark, and adjacent-city variants
- ~15% commercial — price, financing, hours, credentials

---

## Engines

**On the scorecard — four, always the same four:**
ChatGPT · Perplexity · Gemini · Google AI Overviews

**Internal extras, never on the scorecard:** Claude, Bing Copilot. Run them if useful. They don't appear in a client artifact, because adding an engine mid-pilot breaks comparability and the case study's sample size.

Sample size, stated on every artifact:
- Photograph I: 20 × 4 = **80 observations**
- Photograph II / re-tests, Core: 40 × 4 = **160 observations**
- Photograph II / re-tests, Complete: 80 × 4 = **320 observations**

---

## Versioning rules

Every row in `ai_baseline` carries `question_set_version` and `question_text` **as run, fully substituted**. Not the template — the actual string sent to the engine.

This matters more than it looks. Two years from now, defending a case study means being able to show the exact string. Storing `best {treatment} in {city}` and reconstructing later is how numbers stop being defensible.

- `universal_v1` — the frozen 20
- `custom_v1` — per tenant, approved on the call
- Never edit in place. Increment.
- A version bump on the universal set means every tenant's next re-test runs both versions once, so there's an overlap point. Otherwise the trend line breaks.

---

## Named, never ranked

The scorecard vocabulary is fixed:

- **Named** / **not named** — did the engine mention them at all
- **Named alongside** — who else appeared in the same answer
- **Named instead** — who appeared when the client didn't

Never: "ranked #3," "position 2," "top result." Engines don't rank, they compose, and the composition varies run to run. Using ranking vocabulary makes a claim the data doesn't support and invites a client to check it in their own browser and get a different answer.

`ai_baseline.businesses_named` stores an **ordered** array because order is real data worth keeping. It is not shown to clients as a rank.
