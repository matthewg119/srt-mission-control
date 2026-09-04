# Continuation prompt: fixing the first real run of the step board

> NOTE 2026-09-04: the step COUNT in this document is stale. The array in
> `src/config/delivery-steps.ts` is the only source of truth and now holds 38 steps:
> `agreement_signed` was appended to the During-the-call phase when the e-signature
> screens were removed from /onboarding2, which shifted every After-the-call step by one.
> Nothing in code hardcodes a number; `stepNumber()` computes from the array. Any step
> number written below is an index into an older array, not a key.

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Read `CLAUDE.md` first: "Client onboarding and delivery", especially the subsection
"One message per step, and a checkmark that means something", and "The client hub".
Production is mission.srtagency.com, deployed from `main`. Last commit shipped: `ac0b733`.

## CONTEXT

The delivery runner was rebuilt so each of the 33 steps gets its own top-level Slack message in
`#onboarding-srt-aeo` (channel id `C0BLK797PNU`), with all of that step's work in its thread, and
a checkmark that is only written after evidence is confirmed. **That shape works and Matthew is
happy with it. Do not redesign it.** What follows are six defects found on the first real run.

The live client is **SRT Agency LLC**, `clients.id = 50ab028c-7bad-423f-b7a3-cfc9e3cf8e38`,
slug `srt-agency-llc`, `domain = srtagency.com`, `subdomain = learn`. Its audit report is
`audit_reports.id = 6a94e448-ef38-4c0b-a455-375db01e13f3`, `status = done`, `score = 5`.
`lacasitatacos.com` is the only other client row and must not be touched.

Diagnose against the live database before theorising. `.env.local` carries
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and reading the actual row has beaten
reasoning about the code every single time. `SLACK_BOT_TOKEN` is there too;
`SLACK_CLIENT_ONBOARDING_CHANNEL` is **not** (it is set on Vercel only) — the id is `C0BLK797PNU`.

---

## 1. `baseline_scan` can never be confirmed, and it is blocking a third of the runner

Step 2's thread says:

> :warning: Not confirmed: Photograph I. I checked clients.audit_report_id. Found: no audit
> report is attached to this client.

The scan itself was perfect: 20 prompts, score 5/100, scorecard PDF posted in the step thread.
**The verifier reads the wrong column.**

- `STEP_VERIFIERS.baseline_scan` in `src/lib/clients/step-verify.ts` reads
  `clients.audit_report_id`. **Nothing in this codebase has ever written that column** — grep it:
  every hit is `outreach_prospects`, `medspa_orders` or `call_coach_sessions`, all different
  tables. The client-to-report link is stored the other way round, on `audit_reports.client_id`
  (`docs/2026-08-19-artifact-plumbing.sql`, `on delete set null`), and it IS populated.
- The same verifier selects `visibility_score`, which does not exist. The column is `score`.
  PostgREST answers `42703 column audit_reports.visibility_score does not exist`.

Fix it to resolve the report by `audit_reports.client_id`, newest first, and keep the existing
`audit_runs` count and answered-count evidence, which are correct and are the valuable part.

> ‼️ **THIS IS WHY STEPS 7 AND 9 NEVER APPEARED.** `competitor_shortlist` and `avatar_harvest`
> are both `blockedBy: ["baseline_scan"]`. They are not missing and the board is not dropping
> them; they are correctly waiting on a step that is falsely stuck. Fix step 2 and both post on
> their own. **Verify that, do not add anything to force them out.**

While you are in that file, audit the other 32 verifiers the same way: every column each one
names must exist and must actually be written by something. Two were wrong in one function.

## 2. `nap_sweep` is broken again, and the previous fix is the cause

Step 4 is in `status = error`:

```
duplicate key value violates unique constraint "nap_discrepancies_platform_listing_key"
```

History, so this does not get fixed in a circle a third time:

- It originally passed `onConflict: "client_id,platform,listing_url"`, which is a bare column
  list, against the only unique index on the table — an EXPRESSION index,
  `(client_id, platform, coalesce(listing_url, ''))` at
  `docs/2026-08-19-presence-and-competitors.sql:100`. ON CONFLICT infers by matching key
  expressions, a column name never matches an expression, so it raised `42P10` at PLAN time on
  every run including the first.
- The fix removed the `onConflict` option entirely, keeping `ignoreDuplicates: true`. That
  cleared 42P10 and the first run seeded 18 rows. **But PostgREST only emits `ON CONFLICT DO
  NOTHING` when a target is supplied.** With no target it sends a plain INSERT, so the second
  run collided. The production test that "proved" the fix inserted a single row into an empty
  table and therefore never exercised a duplicate at all.

The fix that satisfies both failure modes is an index the column list CAN infer:

```sql
create unique index if not exists nap_discrepancies_client_platform_url_key
  on public.nap_discrepancies (client_id, platform, listing_url) nulls not distinct;

drop index if exists public.nap_discrepancies_platform_listing_key;
```

then restore `onConflict: "client_id,platform,listing_url"` in `seedPresenceSweep`
(`src/lib/clients/presence-sweep.ts`) alongside `ignoreDuplicates: true`.

> ‼️ **`nulls not distinct` IS LOAD-BEARING AND IS NOT OPTIONAL.** Seeded rows have a null
> `listing_url`. Under default SQL semantics nulls compare distinct, so a plain unique index on
> those three columns would let every re-run insert eighteen fresh duplicates — the exact bug
> being fixed. `nulls not distinct` (PG15+, Supabase is on it) makes them compare equal, which
> is what the old `coalesce(listing_url,'')` index was expressing. The two are semantically the
> same; only one is inferrable from a column list.

**Prove idempotency before claiming it is fixed.** Run the seed twice against the live client and
assert 18 rows both times and no error. A single-row insert into an empty table proves nothing.
Then clear step 4's `error` state so it can complete.

## 3. Step 5's gate is 18 of 18. Matthew's decision: core six required, extended optional

`expectedUploads()` in `src/lib/clients/step-engine.ts:256` returns `PLATFORM_COUNT` (18) for
`presence_sweep_manual`, so `stepPrecondition` refuses until all eighteen screenshots are filed.
Matthew filed four and was told "4 of 18".

`src/config/presence-platforms.ts` already exports `CORE_SIX` and `EXTENDED` separately, and step
5's own card already prints them as two labelled groups with EXTENDED described as "context only.
Findings, not week-one cleanup". Make the gate agree with what the card already says:

- Required: the **six CORE platforms**. The step closes at six.
- The twelve EXTENDED are optional and never block.
- **The count is not enough on its own** — six screenshots that are all Yelp must not satisfy a
  six-platform gate. Filing is currently counted by `client_docs` rows on the step's thread with
  no idea which platform each one is for, so decide how a screenshot gets attributed to a
  platform and say so in the refusal message. If per-platform attribution is genuinely out of
  reach, then say plainly in the card and in the PDF that only a COUNT was checked, and never
  imply the six specific platforms were the six that were filed.

## 4. The presence PDF is client-facing. Matthew's decision.

Step 6 `presence_pdf` (`src/lib/clients/artifacts/presence-pdf.ts`) fires automatically once step
5 closes, and Matthew shows it **to the client on the onboarding call**. Two consequences:

- A platform that was not checked prints as **"not checked"**, never as "no issues found" and
  never omitted. This is the same wording rule `renderChecklist` enforced for skipped steps and
  the reason it exists. With the gate now at six, twelve platforms will routinely be unchecked,
  so this stops being an edge case and becomes the normal state of the document.
- If step 5 was SKIPPED, the PDF must say so on its face.

Read the current PDF generator and check what it does today with an unchecked row before
changing anything.

## 5. The theme cannot be confirmed, and it deadlocks step 15

Matthew: *"I was trying to save the theme inside mission control but it doesnt really allow me to
do anything at all."* The panel shows placeholder text (`https://theirsite.com/logo.svg`,
`#00705f`) which reads as filled-in values but is not, and says *"Nothing set. The hub renders the
default palette, which is a fine place to start."* — directly above a **disabled** Confirm button.

- `src/app/dashboard/clients/[id]/theme-form.tsx:255` disables Confirm on `!hasAny`.
- `themeConfirmed()` (`src/lib/clients/hub-setup.ts:51`) returns `activeTheme(...) !== null`.
- `activeTheme()` (`src/lib/hub/theme.ts:123`) returns null unless `confirmedAt` is set **AND**
  at least one of logoUrl / accent / accentSoft / fontFamily is set.

So "use the default palette" is an unconfirmable choice, and `hub_preview` requires a confirmed
theme, so **step 15 can never complete for any client who is happy with the defaults** — and 16,
26, 27, 30 sit behind it.

Split the two ideas, because they are two different facts:

- **Confirmed** = a person looked at it and said yes. That is `stored.confirmedAt !== null`, and
  it is what `themeConfirmed()` and step 15 should ask about.
- **Has overrides** = there is something to apply when rendering. That is what `activeTheme()`
  answers, and it should keep returning null for an empty theme so the hub renders its defaults.

Then let Confirm be pressed with nothing set, and make the panel say which of the two states it
is in. Check `review_tool_preview` and anything else calling `themeConfirmed()` still reads
correctly after the split.

## 6. The AI assistant is posting into the channel at top level

Matthew pasted his screenshots into step 5's thread. The delivery runner filed them correctly
(4 of 18, ephemeral reply, working as designed). Separately, the **general AI assistant**
(`runConversationWithTools`, via `src/app/api/slack/events/route.ts`) analysed the images and
posted a long answer **at channel top level**, in raw markdown — `## What I See`, `**bold**` —
which Slack renders literally.

Matthew's decision: **reply in the step's thread, in Slack formatting.** The analysis was useful,
it was in the wrong place and the wrong format.

- Route it into the step thread. `clientForThread()` in `src/lib/clients/onboarding-docs.ts`
  already resolves a `client_delivery_steps.slack_anchor_ts` to `{ id, legalName, stepKey }`, so
  the step is already known at that point in the events route.
- Convert to Slack mrkdwn: `*bold*` not `**bold**`, no `#` headings.
- A top-level post in this channel that is not a step anchor or the pinned header is the wall
  coming back. `notifyStep()` in `src/lib/clients/step-board.ts` is the only door.

---

## STEP 3 — a change Matthew asked for, not a bug

He expected the CNAME and TXT records in step 3 and found them in step 15. Both steps are working
as built: step 3 `site_dns_intel` answers **where and who** (registrar GoDaddy, the click path to
the DNS screen, mail on Microsoft 365, hosting), step 15 `hub_preview` answers **what to type**.

His decision: **show them in both.** Step 3 keeps its intel and prints the three records
read-only underneath, so the whole DNS conversation is in one thread while he is on the phone.
Step 15 stays the step that gets ticked once the client has added them.

`formatDnsRecords(rows, domain)` in `src/lib/clients/hub-setup.ts:67` is the existing renderer and
already has two callers — use it a third time rather than writing a second one. Step 3's copy must
make clear the records are **for reference, and step 15 is where they get confirmed**, so nobody
ticks step 3 believing they have done the DNS work.

---

## RULES THAT ALREADY BIND THIS AREA

- `slackFetch` returns `{ok:false}` and never throws. Every `.catch(() => {})` around it catches
  nothing, so a failed post is invisible unless the return value is checked. `slackOk()` in the
  actions route is the precedent. Do not reintroduce it in a new posting path.
- Slack is INTERNAL only. No per-client channels, no guest invites. Everything stays in
  `#onboarding-srt-aeo`, one top-level message per step, work in that step's thread.
- **A checkmark is evidence.** `verified_source` is `system` (the app observed real state,
  :white_check_mark:) or `thread` (a human put an artifact in the thread and the app read it
  back, :ballot_box_with_check:). A thread-tier line may only describe the ARTIFACT it found,
  never the fact it stands for. **There is no override**, by Matthew's explicit instruction and
  by a CHECK constraint with no third value. A refusal is `not_yet` (a todo and a Re-check
  button) or `broken` (a fix to paste into Claude Code, no button).
- `STEP_VERIFIERS` is `Record<StepKey, Verifier>`, so a new step breaks the build until somebody
  says what evidence confirms it. Keep it that way.
- Client-facing messages are DRAFTS with a `wa.me` link. Nothing can send them.
- ASK drafts fire when their step becomes NEXT; NOTIFY drafts fire when their step COMPLETES.
- The Day 0 wall is the one hard rail: `page_publish` refuses while `clients.day_0_archived_at`
  is null, and the check goes BEFORE `setPublished`.
- No em dashes in anything client facing. Paste full SQL in a ```sql block, never a file path.
- Never put a model anywhere near `src/lib/hub/review-assemble.ts` (FTC 16 CFR Part 465).
- Do not add domain-attach code outside `src/lib/hub/vercel-domains.ts`.
- Ask before deleting production data.

## HOW TO VERIFY

`bun run build`, `bun scripts/test-onboarding-artifacts.ts` (186 checks) and
`bunx tsx scripts/_probe-step-verify.ts` must all pass. Then run the probe against the live
client, which prints all 33 verdicts:

```
bunx tsx scripts/_probe-step-verify.ts 50ab028c-7bad-423f-b7a3-cfc9e3cf8e38
```

The run is only fixed when, on the live board:

1. Step 2 confirms from `audit_runs` and gets a :white_check_mark: with a real evidence line.
2. Steps 7 and 9 appear in the channel **by themselves**, because step 2 unblocked them.
3. Step 4 leaves `error`, seeds 18 rows, and seeding twice is a no-op rather than a duplicate.
4. Step 5 closes on the core six and its refusal names what is still missing.
5. Step 15 can be completed with the default palette confirmed and nothing else set.
6. Nothing new appears at channel top level except step anchors and the pinned header.

Anything that cannot be confirmed must still say so and stay open. A step that fails must not get
a checkmark, and a step whose evidence cannot be found must say that rather than claim success.
