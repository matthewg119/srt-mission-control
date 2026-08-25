# Continuation prompt: make onboarding runnable end to end

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Read `CLAUDE.md` first: "Client onboarding and delivery" (especially "One message per step, and a
tick that means something" and "The first real run, and the ten things it found"), and
"The client hub" (especially the `reviews.{domain}` section).
Production is mission.srtagency.com, deployed from `main`. Last shipped: `60ef26a`.
Migration `docs/2026-08-24-step-board-fixes.sql` is APPLIED.

## CONTEXT

The step board works: one top-level Slack message per delivery step, work in that step's thread,
and a checkmark only after `verifyStep()` confirms evidence. **Do not redesign that.** The last
pass fixed ten defects in it. This pass is about making the 33 steps actually *runnable by a
person*, because Matthew walked the board and most of them tell him nothing.

He is about to delete SRT Agency LLC and re-onboard it as a fresh client to prove the whole flow.
Everything below has to be true before he does.

Diagnose against the live database before theorising. `.env.local` carries
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SLACK_BOT_TOKEN`.
`SLACK_CLIENT_ONBOARDING_CHANNEL` is NOT there (Vercel only); the id is `C0BLK797PNU`.
Probes need `--env-file=.env.local` or every query silently returns nothing.

---

## PHASE 0 — delete SRT Agency, keep the audit

Matthew approved this explicitly. **Ask him to confirm once more before running it**, then:

- `clients.id = 50ab028c-7bad-423f-b7a3-cfc9e3cf8e38` (slug `srt-agency-llc`).
- Deleting the row cascades: `client_delivery_steps` (33), `client_docs` (7),
  `nap_discrepancies` (18), `competitor_candidates` (11), `client_dns_records` (3),
  `client_hosts` (2), `client_messages`, `harvest_runs`, `review_audit_rows`, `time_log`.
- **`audit_reports.client_id` is `on delete set null`, so report `6a94e448-ef38-4c0b-a455-375db01e13f3`
  and its 20 `audit_runs` SURVIVE.** That is the point: re-point `client_id` at the new client
  after intake and step 2 confirms instantly with score 5, saving a 40-engine-call re-run.
- Nothing is published (`client_pages` empty) and there are no `review_tool_submissions`, so
  nothing goes dark. The two Vercel domains stay attached, which is fine:
  `vercel-domains.ts` GETs before POSTing and handles "already ours".

**Also purge the contamination** (see bug 1): `question_bank` currently holds 40 rows, ALL from
one harvest run, ALL wrongly labelled `med_spa`. Delete them, or a real med spa client inherits
"how to choose an AEO agency" as their tracked question set.

---

## THE BUGS

### 1. The audit's classification is thrown away, then guessed at

`clients.vertical_slug` and `clients.business_type` are **both NULL** for a client that has a
finished audit. The audit knew: `audit_reports.vertical_slug = "aeo-agency"`,
`business_type = "AI visibility (AEO) marketing agency for local businesses"`. **Nothing in the
repo copies that onto the `clients` row.**

So `harvest.ts:219` — `((client.vertical_slug || client.business_type) as string) ?? "med_spa"` —
took its fallback and filed 40 correctly-extracted phrases under `med_spa`.
`research-intake.ts:95` has the identical line and the identical fallback.

Fix: when `baseline_scan` completes, write the audit's `vertical_slug` and `business_type` onto
`clients`. Then decide what the two `?? "med_spa"` fallbacks should do when there is still no
vertical — a silent wrong-vertical write is worse than a refusal, and this is the bug that proves it.

### 2. Step 27 `first_page` has a card that can never be posted

`delivery-steps.ts:150` declares `mode: "auto_then_manual"`, but `first_page` has **no entry in
`AUTO_RUNNERS`** (`artifacts/registry.ts`). The only writer of `status: "ready"` is
`runReadyAutoSteps`, gated on `AUTO_RUNNERS[step.key]`. `postReadySteps` skips
`auto_then_manual` unless the row is `ready`. So the good copy at `step-engine.ts:214-223` is dead
code on the normal path. It appeared in Slack only because `scripts/_debug-post-all-steps.ts`
calls `postStep` directly.

It also escapes `unreachableAutoSteps()` because that filters on `s.auto === true` and this step
carries `mode` without `auto`. Fix the reachability AND widen that check so the next one is caught.

### 3. Three more columns with readers and no writer

Same class as the `clients.audit_report_id` bug already documented in CLAUDE.md.

| column | read by | consequence |
|---|---|---|
| `clients.review_request_mode` | step 29 verifier, `call-sheet.ts` | **step 29 can NEVER be confirmed.** Its refusal says "Set it on the client board" and there is no such control |
| `clients.review_owner_name` | step 30 verifier | the "the record says X" parenthetical never fires |
| `clients.review_workflow.google_url` / `.realself_url` | `review-tool.tsx:18-29` `destinationsFor()` | **the "Post on Google" button has never appeared for any client.** Everyone gets the fallback hint text |

Intake step 4 collects `destinations` as a multiselect of NAMES ("Google", "RealSelf") but no URL
field, and `save/route.ts` writes the bag verbatim, so the URL keys are never populated.
`review_destination_secondary` has zero readers anywhere.

---

## THE WORK

### A. Cards that say what to do, and link what already exists

`instructionsFor()` (`step-engine.ts:60-252`) has 11 cases and a `default: return null`. When it
returns null, `blocks()` adds no body section at all — the card is a label and three buttons.

Two separate problems, fix both:

1. **Six manual steps post genuinely empty cards**: 19 `call_booked`, 20 `call_held`,
   24 `gbp_buildout`, 25 `citation_cleanup`, 29 `review_request_configured`, 33 `day_30_date`.
   Plus 9 and 26, which post an empty body once their runner leaves them `ready`.
2. **No card in the switch reads `client_delivery_steps.output_ref`**, so no step ever shows the
   artifact an earlier step produced. `instructionsFor` receives only `ClientFacts`, but
   `hub_preview` and `dns_records` already prove a case can query freely.

`deliverArtifact` (`artifacts/deliver.ts:62-66`) writes `output_ref: stored.docId`, openable at
`${appUrl()}/api/clients/${clientId}/docs/${docId}` (`deliver.ts:58`). The links that are missing
and matter most:

| step | should link | from |
|---|---|---|
| 23 `day_zero_archive` | **the AI Visibility Scorecard PDF** | `client_docs` where `delivery_step_key = 'baseline_scan'`. Matthew asked for this by name |
| 25 `citation_cleanup` | step 14's cleanup PDF + the per-platform list | `output_ref` + `loadSweep`/`countByStatus`, which its own verifier already computes |
| 27 `first_page` | step 13's page-candidates PDF, and the `client_pages` drafts | `output_ref` + `listAllForBoard` |
| 28 `cards_printed` | step 17's card PDF, and the real reviews host | `output_ref` + `client_hosts` where `kind='reviews'` |
| 11 `avatar_confirmed` | step 9's deep-research brief | `output_ref` |
| 33 `day_30_date` | the computed day-30 date | `clients.day_0_archived_at` |

**Matthew's general instruction: every step that CAN be pre-populated from earlier steps should
be.** A card that repeats what a refusal would have said is the point — he should not have to
press Done to find out what is missing.

Step 31 `time_log_entries` is `mode: "auto"` so no card is posted at all; it is ticked by
`/api/clients/[id]/time-log`. Decide whether it needs a card or just a better anchor line.

### B. Regroup the phases into before / during / after the call

Matthew's decision. **Step order, numbers and `blockedBy` do not change.** Only `phase` changes:

- `Measure` + `Prepare` (1-18) -> **before the call**
- `The call` (19-22) -> **during the call**
- `Day 0` + `Build` (23-33) -> **after the call**

`headerText()` in `step-board.ts` then shows three counts instead of five. Check
`delivery-checklist-form.tsx` and the client board's phase grouping still read right, and check
nothing keys on the literal string `"Day 0"` (the Day-0 wall keys on `step.gate` and
`DAY_ZERO_STEP_KEY`, not on the phase, but verify).

### C. One anchor at a time

`ensureReachableAnchors` currently posts EVERY step whose blockers are clear: 2 at intake, then
4, then 2. Matthew wants exactly one — the single next step, with the following one appearing
only when it is ticked.

> Say out loud in the code what this costs: work that could legitimately happen in parallel
> (booking the call while the scan runs) is now serialised. He asked for calm over throughput.
> `headerText`'s "the one next step" line becomes the whole board.

### D. Auto-pick the top 3 competitors

Matthew: *"I didnt really pick any competitors, just make sure it auto selects the top 3 most
mentioned from the audit."*

Pre-select the top 3 by `times_named` as a DEFAULT he can change on the board. He still presses
Done, so the evidence rule is untouched. Two things the card must say:

- **Filter the junk.** His intake recorded `competitors: "a"`, which became a candidate with
  `times_named: 0`. `isExcludedFromShortlist` already drops aggregators and national chains;
  a zero-mention intake guess is a different filter.
- **Say when the pick is arbitrary.** On the live data Posirank and D3 Corp had 2 mentions each
  and then FIVE businesses tied at 1, so the third pick is a coin toss. The card must not present
  a tie-break as a ranking.

### E. The review tool

Three changes, and one hard limit.

> ‼️ **NO MODEL GOES NEAR THIS, AND MATTHEW HAS BEEN TOLD WHY.** He asked for reviews rewritten
> to a 6th-grade reading level with an emotional hook added. That is generating review content
> the customer did not write, attributed to her, on the client's Google profile: FTC 16 CFR Part
> 465, the Rytr fact pattern. `review-assemble.ts` imports nothing and must keep importing
> nothing; `assembleLabelled` and `assemblePlain` stay separate functions and must not be derived
> from each other. The same rule is restated in `api/hub/reviews/submit/route.ts`,
> `review-preview.ts` and `review-client.tsx`. **He accepted this and chose the readability hint
> instead.** Do not reopen it.

1. **Microphone, on-device only.** The browser's `SpeechRecognition` / `webkitSpeechRecognition`,
   dictating into the four boxes. **No audio reaches our servers and none is stored** — that is
   the whole reason this option was chosen over the existing `transcribeAudio()` (OpenAI
   whisper-1) in `voice-notes.ts`. Do NOT wire that helper in here:
   `review_tool_submissions` has deliberately no column for a name, email, phone, IP, user agent
   or session id, and uploading a customer's recorded voice from a client's own domain is exactly
   the kind of thing that table's schema comment forbids. Hide the mic where the API is absent
   and leave the keyboard as it is. She can edit the transcript before submitting.

2. **A readability hint, Hemingway style.** Matthew's words: *"readability hint like
   hemingway.app is fire, this way they clean the review themselves after speaking directly to
   the mic and it looks fire and they write it themselves."* So: live, advisory, never applied.
   Grade level plus the specific sentences that are long or dense, highlighted in place, and a
   word count. **It may point at a sentence. It may not rewrite one, and there must be no
   "fix it for me" button** — the moment software supplies the replacement words, we are back
   across the FTC line. Pure client-side arithmetic (syllables, words, sentences); no API call.

3. **"Copy and go", with a real destination.** Rename the `Copy my words` button
   (`review-client.tsx:151`) and make the second half work: `destinationsFor()` already renders
   "Post on Google" / "Post on RealSelf" from `review_workflow.google_url` / `.realself_url`, and
   nothing writes those. **Capture them at step 29** along with `review_request_mode` (see bug 3),
   which is what makes step 29 confirmable at the same time. Keep the existing rule from
   `review-tool.tsx:12-16`: absent beats wrong, never synthesise a link, because a guessed URL
   sends her to somebody else's business.

**Do not confuse the three review steps.** Step 8 `review_audit` is the competitor review-COUNT
grid and touches nothing a customer sees. Step 16 `review_tool_preview` owns whether the tool
renders and is themed. Step 30 `review_tool_handed` owns the handover. Matthew conflated 8 and
16; the cards should make the difference obvious.

**The preview URL cannot be handed to a client.** `reviewPreviewUrl()` returns a `/dashboard/`
path and the page calls `notFound()` without a session, so a logged-out visitor gets a 404, not a
login page. It is already posted into step 16's thread, which is correct for an internal channel.
The client-facing surface is the live `reviews.{domain}` host.

### F. Step 9 is NOT redundant with the audit. Do not merge them.

Matthew asked whether the avatar phrase harvest duplicates the AI visibility audit and whether it
is burning tokens. **It makes ZERO model calls** — `harvest.ts` imports only `supabaseAdmin`, and
the deep-research brief is a pure template whose test asserts byte-identical output. Its whole
cost is up to 40 plain page fetches. It already CONSUMES the audit: it reads
`audit_runs.citations` and scrapes the pages the engines cited.

Three reasons not to replace it with `audit_reports.prompts`:

1. **`audit_reports.prompts` is REGENERATED by every audit run.** `findings.ts:24-25` spells out
   the hazard: quoting it would let a later audit silently rewrite the questions in a report
   already sent to a client. The Day-0 tracked set has to be frozen.
2. The 20 prompts are model-invented clean phrasing; `question_bank` is verbatim market wording
   with typos preserved on purpose, carrying `frequency_score`, `commercial_intent_score`,
   `objection_phrase` and a `source_url`.
3. **Deleting the harvest breaks step 12 outright** — `custom-question-set.ts` hard-fails with
   "Run the avatar phrase harvest (step 9) first" — and starves `page-candidates.ts`.

**The avatars are not in step 9 at all.** They live in `niche_briefs.avatars`, per vertical,
TTL-cached, written by `getNicheAvatars()`. Step 9 deliberately leaves `question_bank.avatar` NULL
until step 11. **Rename the step** so it stops reading as a duplicate of the audit, and say in its
card that it runs on the audit's cited sources.

---

## RULES THAT BIND THIS AREA

- **A checkmark is evidence.** `verified_source` is `system` (the app observed real state,
  :white_check_mark:) or `thread` (a human put an artifact in the thread and the app read it
  back, :ballot_box_with_check:). A thread-tier line may only describe the ARTIFACT, never the
  fact it stands for. **There is no override** — the CHECK constraint has no third value. A
  refusal is `not_yet` (todo + Re-check button) or `broken` (a fix to paste into Claude Code, no
  button). `STEP_VERIFIERS` is `Record<StepKey, Verifier>`; keep it exhaustive.
- **A green tick over unchecked work is the worst bug this design can have.** Two shipped last
  time (`citation_cleanup`, `subdomain_live`). When a helper returns an `ok` flag, check what the
  flag actually means before passing it through.
- Slack is INTERNAL only. Everything in `#onboarding-srt-aeo`, one top-level message per step,
  work in that step's thread. `notifyStep()` is the only door; `notifyThread()` only for
  client-level messages. **Edit anchors, never re-post** — Slack orders by post time.
- `slackFetch` returns `{ok:false}` and never throws. Check the body; `slackOk()` is the pattern.
- Client-facing messages are DRAFTS with a `wa.me` link. Nothing can send them.
- The Day 0 wall is the one hard rail: `page_publish` refuses while `clients.day_0_archived_at`
  is null, and the check goes BEFORE `setPublished`.
- No em dashes in anything client facing. Paste full SQL in a ```sql block, never a file path.
- `test-onboarding-artifacts.ts` asserts `no issues found` appears NOWHERE in a rendered client
  PDF, in any casing, including inside a sentence disclaiming it.
- Do not add domain-attach code outside `src/lib/hub/vercel-domains.ts`.
- Ask before deleting production data.

## HOW TO VERIFY

`bun run build`, `bun scripts/test-onboarding-artifacts.ts` (190 checks) and
`bunx tsx scripts/_probe-step-verify.ts` must all pass, plus the live table:

```
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts <clientId>
```

`scripts/_probe-cascade.ts` proves steps post themselves on unblock, on a throwaway client. It
refuses to run against `C0BLK797PNU` and needs `SLACK_CLIENT_ONBOARDING_CHANNEL` pointed at a
scratch channel. **Ask Matthew for that channel id.**

Then the real test: delete SRT Agency, re-onboard it, and walk all 33 steps with him. It is only
done when every step's card tells him what to do without pressing Done to find out, no step is
unconfirmable, and nothing appears at channel top level except step anchors and the pinned header.
