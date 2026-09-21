# The send boundary, the dataset, the reviews, and the signing gate

The fourth of four prompts. Read the other three first; nothing here replaces any of them.

| Prompt | Covers |
|---|---|
| `2026-09-21-maps-source-spend-and-lead-coverage.md` | the Maps source, the spend ledger, national coverage, and the four defences against a 3️⃣ silently running workflow 2 |
| `2026-09-22-compliance-gate-context-database-and-learning.md` | the compliance gate and the context database. Shipped: policy checks, `policy_documents` + weekly scan, the Approve button, `meta_hash`, the `page_dataset` reader, `dataset_suggestions`, the guarantee field |
| `2026-09-23-twenty-pages-previews-and-offer-context.md` | **W0 to W4. All specified, none built.** W0 is the one this prompt's §3 depends on |
| **this one** | the send boundary, the magnet audience axis, the widened dataset, the review door, the signing gate |

This adds five things Matthew asked for on 2026-09-21 after the first of those was written.

## Where the work is

Two branches, both pushed, both on top of `origin/main` as of 2026-09-21:

| Branch | Holds |
|---|---|
| `feat/workflow-c` | the scraper lane, the third arm, both 2026-09-2x prompts. **8 ahead / 8 behind main.** Rebase before building. |
| `feat/dentist-pack` | the dentist preset, `normalizeVerticalSlug`, `owner_pitch`. **2 ahead, rebased, clean.** |

‼️ All eight migrations from 2026-09-18 and 2026-09-19 are **applied and verified in production**
on 2026-09-21. `workflow_check_listprep`, `raw_leads.enriched_at`, `raw_leads.enrich_attempts`,
`list_pipeline_runs.vertical_slug`, `sendable_leads.sent_at`, `outreach_prospects_website_trgm_idx`,
`client_audiences.owner_pitch`, and `owner_rows_without_pitch = 0`. The three probes that were red
against production are green. **The 10-row live drop is still the first real proof and still comes
before any building.**

## Measured in production this session, not read off the code

Every number below was read from the database on 2026-09-21. They are the reason for the sections
that follow, and each one is the same shape of bug: a schema that anticipates a thing, and no
writer.

| Thing | Measured | Consequence |
|---|---|---|
| `outreach_prospects` | 0 rows before the handoff fix | `already_contacted` had never fired once |
| `page_sources` | **7 rows, all `CLIENT_WEBSITE` / `crawl`** | zero `CUSTOMER_REVIEW`, so every voice-of-customer read returns empty |
| `lead_magnets.audience_id` | exists, **null on all 12 rows**, **zero readers in `magnets.ts`** | two avatars under one client share one magnet pool |
| `lead_magnets.vertical` | carries **both** `medspa` and `med-spa` as duplicate rows | somebody papered over the spelling split by inserting twice |
| `lead_magnets.treatment` | null on all 12 rows | the offer axis of the ladder is live but unused |
| `clients` | 5 rows, 4 with a null vertical | the client machine has never run a second vertical |
| `collected_via = 'review_screenshot'` | in the CHECK constraint, **no writer in `src/`** | see §4, and the door is already built |
| `present()` for a research field | `sectionAnswered()` = **150 characters**, after stripping "could not verify" | a field reports filled while no value of it exists anywhere. See §3 |

---

## 1. MillionVerifier is the send boundary, and a checkbox confirms it

Matthew, 2026-09-21: *"when we run an email through our million verifier workflow it usually means
that we will email it next so everything that goes by them can be assumed as sent email (just give
me a checkbox so we can confirm we emailed them after we complete the workflow, this way we can
track how many emails we are sending as well)."*

**What exists.** `recordHandoff()` (`src/lib/scraper/listprep.ts`) writes an `outreach_prospects`
row per address and stamps `sendable_leads.sent_at` at `publishSendable`. It runs for **workflow 3
only**.

**The gap, and it is the bigger half.** Workflow 1 (filter and verify) terminates at
`verified-ok.csv` (`lane.ts:2262`) and records **nothing**. Workflow 1 is what produced the 136
address campaign on 2026-09-16 that left no trace. Both arms pass through MillionVerifier; only one
writes the board.

**Build:**

1. **Lift the handoff to the MV boundary, for both arms.** Anything MillionVerifier returned
   `ok` or `catch_all` for is assumed it will be mailed. Workflow 1 reads its addresses from
   `scraper_rows` (`mv_result`), workflow 3 from `sendable_leads`. One function, two readers.
2. **A confirm gate after the terminal card.** A new `scraper_batches.send_confirmed_ts` plus
   `send_confirmed_count`, reached by a ✅ on the final card, wired the same way the three existing
   gates are: an entry in `GATE_COLUMNS` (`store.ts:186`), so `batchByGateTs` resolves it and the
   router cannot drift. ‼️ `GATE_COLUMNS` rows carry a `table` field because `drop_review_ts` lives
   on the run; this one is on the batch.
3. **The count is the point.** The card reports this batch's count and the running total. Put the
   total behind one query over `outreach_prospects` (`source in ('listprep','filter')`), not a
   counter column: a counter drifts and a query cannot.

‼️ **THE ASSUMPTION AND THE CONFIRMATION ARE DIFFERENT FACTS AND MUST NOT COLLAPSE INTO ONE
COLUMN.** `sent_at` means "we handed this off and suppression must now treat it as mailed".
`send_confirmed_ts` means "a person says it actually went out". Suppression reads the first,
because the asymmetry has not changed: a row wrongly suppressed costs one lead, a row wrongly left
mailable costs a second cold sequence from a second domain. Reporting reads the second, because a
number that counts intentions is not a number of emails sent. If these ever become one column,
either suppression goes blind until somebody clicks, or the send count becomes a lie.

‼️ **`confirmed` ON `outreach_prospects` STAYS FALSE EITHER WAY.** `outreach_prospects_due_idx` is
`where state <> 'CLOSED' and paused = false and confirmed = true`, and it is the worklist the
Microsoft Graph nudge sender drains. A ✅ here means "ReachInbox sent it", not "enrol this address
in a second sequence out of matthew@srtagency.com". Wiring the checkbox to `confirmed` would do
exactly that, from the tenant that carries client mail.

---

## 2. The magnet ladder ignores the audience it was built for

Matthew asked whether `owner_pitch` fixed which lead magnet each concierge offers. **It did not,
and it was not meant to.** `owner_pitch` is the one sentence describing the SELLER on an
owner-stance lane. The magnet is a different system, and it has a real defect.

`rungOf()` (`src/lib/concierge/magnets.ts:121`) scores on `audience` (the patient/owner stance),
`clientId`, `vertical` (weight 4), `treatment` (2) and `category` (1). **It never reads
`audience_id`**, which exists on the table and is null on every row. So a client with two audiences
aimed at two different avatars draws from one undifferentiated pool, and the offer axis
(`treatment`) is null everywhere, so it never discriminates either.

**Build:**

1. Add `audience_id` to `MagnetQuery` and to `rungOf` as the **highest-weight axis below
   `clientId`**, above `vertical`. An audience-scoped magnet is more specific than a vertical one.
2. Keep the wildcard rule exactly as it is: `null` on the row means "any", `null` on the query
   never matches a named row. That asymmetry is what makes the library rows reachable and it is
   already proven by the probe.
3. Backfill `audience_id` on the client-owned rows only. Library rows stay null on purpose.
4. **Collapse the duplicate `medspa` / `med-spa` rows.** They are the spelling split showing up as
   data. Decide the one spelling (`normalizeVerticalSlug` says kebab-case, `serviceKey` says
   squashed) and record which, then delete the other. ‼️ Do this as a migration with the losing
   spelling named, not by editing rows by hand: `rankMagnets` ties break on `sort_order` then
   `magnet_key`, and two rows sharing both is a CTA that changes between renders.

---

## 3. The dataset. ‼️ W0 FIRST, AND WIDENING BEFORE IT IS ACTIVELY HARMFUL

Matthew, 2026-09-21, on the `PATIENT` keyword table being "ten categories of lip filler": *"needs
to be broken down in all of the different fields across our whole onboarding to make sure the data
we pull is legit... avatar, product, offer, fear, dreams, desires, budget, age, zip code, as much
info as we can / need."*

‼️ **THIS IS §3 OF THE 2026-09-21 PROMPT AND W0 OF THE 2026-09-23 PROMPT, NOT A THIRD SYSTEM.**
Do not build a parallel registry. What follows is what the field list should grow to, and the
reason it cannot grow yet.

### The measurement that reorders this whole section

`present()` for a research-filled field resolves to `sectionAnswered()`
(`src/lib/clients/avatar-profile.ts:169`), which is, in full:

```ts
const body = section.body.replace(/could not verify\.?/gi, "").replace(/\s+/g, " ").trim();
return body.length >= SECTION_MIN_CHARS;   // 150
```

**A field is "present" when 150 characters sit under its heading. Nothing extracts a value.
Nothing stores one per field.** On SRT: a 16,272 character research document parsed to
`{"answered": 9}`, and zero field values anywhere in the system.

So the completeness card can report `fears` as filled while nobody, human or machine, can say what
the fears are. It is a character count wearing a dataset's name, and that is why the research feels
like it does nothing.

‼️ **THEREFORE: ADDING FIELDS BEFORE W0 MAKES THIS WORSE, NOT BETTER.** Every new field added to a
registry whose `present()` is a character count is one more heading that can report green while
holding nothing. Widening the list first would turn a 24-field character counter into a 43-field
character counter and would make the completeness card confidently wrong about more things.
**Build W0, then widen.** In that order, the widening is cheap: `dataset_suggestions` already
shipped (`docs/2026-09-22-dataset-suggestions.sql`, live in production) and already refuses to
declare anything itself, so new fields arrive as proposals rather than as edits to this file.

### What W0 settles that this section depends on

From `docs/prompts/2026-09-23-twenty-pages-previews-and-offer-context.md`, W0, described there as
the most valuable thing in that prompt. Two of its decisions are the ones this section rests on:

- **Storage is one append-only place keyed by `(client_id, audience_id, field_key)`**, carrying the
  value, the section it came from, who confirmed it and when. Not 43 columns. Once that exists,
  `present()` means "a confirmed value exists", which is a real answer rather than a length.
- **Low confidence becomes a question, not a value.** ‼️ This is the one place the whole system can
  be poisoned in a single paste: a field filled with a plausible invention is worse than an empty
  one, because every later page argues from it and nothing downstream can tell it was never really
  answered. That rule has to survive the widening: more fields means more surface for exactly that
  failure, and the low-confidence path is the only thing holding it.

Note the correction W0 forced on the earlier plan, because it applies here too: **a paste must not
file evidence before the values are confirmed.** One press commits the values and files the
evidence together. A gate verifying pages against text nobody approved makes the confirmation card
theatre.

### Then, and only then: what to widen to

**What exists today: 24 fields in `src/lib/clients/dataset-spec.ts`.**

| Dataset | Fields |
|---|---|
| avatar (11) | who_buys, current_solutions, what_they_like, why_they_quit, beliefs, blame, exact_words, headline_ideas, search_phrases, sourced_numbers, emotional_language |
| audience (7) | avatar, vocabulary, market, compliance, buyer_map, dream_customer, own_reviews |
| offer (6) | short_offer, customer_terms, outcome_promise, positioning, lead_magnet, price |

**What Matthew named that has no field at all:**

| Asked for | Nearest existing | Why the existing one does not cover it |
|---|---|---|
| **fear** | `why_they_quit`, `blame` | Both are about a PAST purchase. A first-time buyer's fear of the procedure is a different thing and it is what the objection lane needs |
| **dreams / desires** | `dream_customer` | That is which CUSTOMER the client wants, not what the BUYER wants. Opposite ends of the transaction |
| **budget** | `price` | That is OUR price. What the buyer can spend is not recorded anywhere |
| **age** | none | |
| **zip code / geography** | none | The most surprising gap: the entire product is local AI visibility and the buyer's geography is not a dataset field |
| **product** | `short_offer` | Our framing of the offer, not the thing the client sells |

**Build: add a fourth dataset, do not stretch the three.**

`DatasetKey` is `"avatar" | "audience" | "offer"`. Add `"buyer_profile"` for the demographic and
economic facts: `age_range`, `income_band`, `budget_for_offer`, `geography` (metro, state, ZIP
radius), `household`, `life_trigger`. Keep fear, dreams and desires on **avatar**, where the
emotional fields already live, as `fears`, `desired_outcome` and `status_desire`.

‼️ **ROUTE THEM THROUGH `dataset_suggestions` RATHER THAN TYPING THEM INTO `dataset-spec.ts`.**
That table shipped on 2026-09-22 for this exact purpose and already refuses to declare anything
itself. A field that arrives as a suggestion carries who proposed it and why; a field typed
straight into the spec carries nothing, and the list above is Matthew's ask rather than a
measurement. Let the first real dentist and the first real med spa each propose against their own
research, then promote what both of them needed.

**The rules that make this safe, all of them already this repo's own:**

- ‼️ **A `FieldSpec` without a `filledBy` that names a real writer is a lie.** The `Filler` union
  (`research | document | step | audit | derived`) exists so every field says who fills it, and
  `built: false` is how a step-filled field admits it is owed. A field added with no filler makes
  the completeness card report a gap nobody can close, forever. Add the writer in the same change
  or mark it `built: false` and let the card say so.
- ‼️ **A widened field is only real once `present()` means "a confirmed value exists".** Until W0
  lands that is not what it means, which is the whole argument of this section.
- ‼️ **APPEND to `SECTIONS` in `deep-research-run.ts`, NEVER INSERT.** Section N maps to
  `RESEARCH_SECTION_KEYS[N-1]`, so inserting re-files every stored report's answers under new keys.
  Every research-filled field added here means a section appended at the end.
- **Widen rather than narrow**, per Matthew's standing rule already written into the other prompt:
  a field nobody uses yet is context for later and the cost of carrying it is a column.
- **Missing, empty, and "asked and nothing was there" are three states**, not two. The lane has
  learned this three times (`mx_ok`, `optimization_score`, `qualify_keep`).
- **`present()` is boolean today and the only counts are `> 0`.** There is no threshold concept in
  the dataset layer; `EMOTIONAL_FLOOR` lives outside it in the headline engine. If a widened field
  needs "enough of it", that is a new concept and it needs deciding, not assuming.

**And the keyword table, which is where this started.** `keyword-expansion.ts` has `PATIENT`
(med spa), `OWNER`, and `genericCategories(vocabulary)` for everyone else. `dentist_patient` is
deliberately absent so it falls through to generic. Once the widened fields exist, the right fix is
not a third hand-written table: it is to derive the categories from the buyer_profile and avatar
fields, so a vertical with a filled dataset gets a real table and one without gets the generic four
(price, fear, comparison, process). ‼️ **Those four survive by name.** `selectOfferPlan` fills its
supports from them two each, so a generic set that dropped them would quietly change how every page
plan is built.

---

## 4. Reviews: the door is built, and nobody has walked through it

Matthew, 2026-09-21: *"reviews also i will most likely post pictures so make the pictures create a
transcript with all the details to reuse that as content for a page for the specific thing
addressed in X review etc and how we can connect that with what pillar."*

**Almost all of this already exists. Measure before building.**

- `page_sources.source_type` includes `CUSTOMER_REVIEW`; `collected_via` includes
  `review_screenshot` and `review_tool`. Both are in the live CHECK constraint.
- The `review` command in `src/lib/clients/page-studio.ts:2174-2250` already takes a screenshot,
  reads the review out of it, and aims the result at the offer. Its own card says:
  *"Drop a screenshot of the review with `review` in the message, and I read it out."*
- `src/app/api/clients/[id]/hub/route.ts:354` explains why there is no other door, and it is worth
  quoting in full to whoever is tempted to add one:

  > ‼️ CUSTOMER_REVIEW IS DELIBERATELY NOT ON THIS LIST, and it is the one omission likely to look
  > like an oversight. A review quote is only worth anything if it is what the customer actually
  > published, and the guarantee that it is comes from being TRANSCRIBED off the screenshot it was
  > read from, then confirmed against that picture. A free text box types an approximation and
  > calls it a quote, with nothing to check it against.

**So the finding is not "build a review pipeline". It is that `page_sources` holds 7 rows, all
website crawl, and zero reviews.** The door has never been opened. That is also the root cause of
the emotional layer reporting green on borrowed data: `clientVocQuotes` returns nothing because
there is nothing to return.

**Build, in this order:**

1. **Run the existing `review` command on a real screenshot first.** If it works, most of this
   section is "use it", and the remaining work is small. If it does not, fix it before extending
   it. Do not design on top of an untested command.
2. **Widen the transcript.** Matthew wants "all the details", not just the quote: reviewer name as
   published, star rating, date, platform, the specific service named, and the outcome claimed.
   Those become structured fields on the source row, because "the specific thing addressed in X
   review" cannot be queried out of a paragraph.
3. **Connect it to the pillar.** ‼️ "Pillar" means two unrelated things in this codebase and
   conflating them will produce nonsense. `loom-script.ts` has three sales-script pillars
   (Findable, Familiar, and the third), which are **copy and must stay copy**, marked so in the
   file. The one Matthew means is `src/lib/ai.ts:159`: *"The page plan (one pillar, six supports)"*.
   A review attaches to a SUPPORT page under the client's one pillar, matched on the service it
   names. Say which meaning in the code, once, where the link is made.

---

## 5. The signing gate, and asking for ID before the contract

Matthew, 2026-09-21: *"always ask ID before contract so you can 'update the system while they sign'
(in the live call ideally)."*

**What the agreement is today.** `src/config/onboarding2-agreement.ts`, 1,032 lines, version
**v7**, three variants: `review_free`, `year_3300`, `month_349`. The structure is sound and should
not be disturbed:

- The template is resolved **once per signing** by `POST /api/onboarding2/start` and frozen into
  `onboarding2_signings.agreement_snapshot`. Every screen after that, the PDF, and the grounded
  chatbot read the snapshot. That is what lets the template be edited without changing what a
  signature taken last month says.
- `src/lib/onboarding2/agreement-pdf.ts` must never import the template, and
  `_probe-onboarding2-pdf.ts` fails if it does.
- ASCII only, structurally: the PDF kit embeds no TTF, and the probe round-trips the render through
  unpdf and asserts the extracted text equals the canonical text.
- `/sign/<token>` is the live-call surface. The token is a bearer credential in the path, noindex,
  unlinked, and a miss is a 404 rather than a 401 so the token space cannot be walked. Per-page
  initials, then signature.
- Clause `foot 3` still reads *"This document should be reviewed by a licensed attorney before use
  in production."* **That is unchanged and it is the honest state of it.**

**There is no ID capture anywhere.** The "identity form" the code refers to was name, email, phone
and website; it was removed on 2026-09-04 in favour of the chat asking. Grepping for driver's
licence, government ID or identity verification across `onboarding2` returns nothing.

**Build:**

1. **A new step before the agreement screen**, on `/sign/<token>`: capture a photo of a
   government ID plus the signer's legal name and title as they appear on it. Store the image the
   way concierge photos are stored, not in the signings row.
2. ‼️ **DECIDE THE RETENTION BEFORE WRITING THE UPLOAD, NOT AFTER.** The concierge lane set the
   precedent and the purge cron is load-bearing there: it is the entire implementation of the
   consent sentence. An ID is a stronger version of the same problem. Either keep it for the life
   of the contract because it is contract evidence, or purge it on a timer like the scan photos.
   Both are defensible; an unrecorded default is not. Write the answer into the migration comment.
3. **The pause is the feature.** Matthew's reason for the order is that the ID step gives the
   system a window to provision while the client signs. So the step should kick off the
   post-signature work it can safely start early and show its progress, rather than being a form
   that blocks. What can start early is a decision for the session that builds it; the signature is
   the only thing that must not be pre-empted.
4. Add the ID fields to the signing row as metadata (`id_captured_at`, `id_asset_path`,
   `id_kind`), never the image itself, and never into `agreement_snapshot`, which is frozen.

---

## 6. Already answered elsewhere

**DataForSEO as a lead source is superseded, not deferred.** §1 of the 2026-09-21 prompt replaces
Outscraper with a local gosom scraper feeding `scripts/pull-maps.ts`, which removes the reason to
build a paid Business Listings adapter at all. The earlier note that the adapter was "deferred
because it needs a new pull entry point" is answered: `pull-maps.ts` **is** that entry point. If a
paid source is ever wanted later, the spend ledger from §2 of that prompt is the thing that has to
exist first, and it is still schema-only (`list_pipeline_runs.cost_usd`, `provider_spend`,
`spend_approved_at`, `spend_approved_by` have no writer).

---

## Order of work

Two orders are already stated elsewhere and both still govern: the 2026-09-21 prompt's, and
**W0 → W2b → everything else** from the 2026-09-23 prompt. This slots in around them.

**There are two independent tracks here and they do not block each other.** The outbound track
feeds the top of the funnel; the delivery track makes what a client gets worth having. Run them in
whichever order the week demands, but keep each one's internal order.

**Outbound track:**

1. **Rebase `feat/workflow-c` onto `origin/main`.** It is 8 behind.
2. **The 10-row live drop. Before anything else.** For the reason §5 of the 2026-09-21 prompt
   gives: a 3️⃣ that silently ran workflow 2 buys a DataForSEO SERP per row with no error anywhere.
   Check the Vercel logs for a `task_post`. Nothing below is worth doing on top of a lane that does
   not work.
3. §1 here: the send boundary and the checkbox. Small, and it closes the last hole in "who have we
   mailed".
4. Spend recording, then `scripts/pull-maps.ts` (§2 then §1 of the 2026-09-21 prompt).

**Delivery track:**

5. **W0.** Everything else in this track is worth less until the research produces values instead
   of character counts. It is also Matthew's immediate unblock: step 11 prompts in that thread,
   then the three pastes, and W0 is what makes the third paste worth something.
6. **W2b**, which lets the gate see what W0 confirmed. Together those two are why twenty pages
   stop blocking.
7. §4 here: run the existing `review` command once, on a real screenshot. It is the cheapest way
   to get the first `CUSTOMER_REVIEW` row into a table that has none, and it may need no building
   at all.
8. §3 here: widen the dataset, through `dataset_suggestions`, **after W0 and not before**.
9. §2 here: the magnet audience axis, and the duplicate-spelling migration.

**Alone, last:**

10. §5 here: the ID step. It touches a signed document and a new class of personal data, so it goes
    by itself with its retention decision written down before the upload is built.

W1, W3 and W4 land whenever; the 2026-09-23 prompt says the previews and skin routing are small and
the headline lock depends on neither W0 nor W2b.

Run `bun run`, never `bunx tsx`: Bun auto-loads `.env.local` and Node does not. No em dashes in
anything that reaches a model or a client.
