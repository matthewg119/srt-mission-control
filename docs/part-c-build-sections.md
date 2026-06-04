# Part C — Statement-drop → dual-draft builder (6 build sections)

Each section is self-contained: **Diagnose** (find the exact endpoints/functions), **Wire** (implement),
**Test** (verify before moving on). Repo: `srt-mission-control` (Next.js/TS/Vercel, deploy via git push).
Test deal: **SOUTHERN NEVADA TRAINING CENTER** (Zoho Deal `7318039000003565006`, MC contact
`1bff5b79-708a-4333-9f92-5e6b872b7a66`, #srt-sub thread `1780594107.744339`). BTF overlay already
built: `src/lib/btf/overlay.ts` → `fillBtfApplication(values)`; assets bundled in `src/lib/btf/`.

Channel: `#srt-sub` = `C0AJXH7PTBM` (env `SLACK_SUB_CHANNEL`). Connected M365 mailbox =
`matthew@srtagency.com`; shared `submissions@srtagency.com` (Send-As confirmed).

---

## Section 1 — Trigger + lead resolution ("find lead & build draft")
**Diagnose:** Slack inbound in `src/app/api/slack/events/route.ts` — how `#srt-sub` thread replies are
routed (`handleSubDealThreadReply`), and the general message handler. Fuzzy/lookup helpers:
`fuzzyNameMatch` + `findEmailSubmissionForFunderReply` (`src/lib/ai-intel/email-submissions.ts`),
`findContactByBusinessName` (`src/lib/ai-intel/inbound-classifier.ts`), `findDealByName` + `searchLeads`
(`src/lib/zoho.ts`).
**Wire:** add a trigger — Matthew drops files in a #srt-sub thread, then replies `build` (or
`build <business>`). Resolve the business → MC contact/deal (fuzzy) + Zoho Deal (`findDealByName`,
fallback Lead). Persist the resolution (reuse the `email_submissions` row for the thread, or a new
`deal_drafts` row) incl. `zoho_deal_id`, `mc_contact_id`. Post a confirmation card: matched lead +
any similar-name candidates if ambiguous (ask Matthew to pick).
**Test:** in the SOUTHERN NEVADA thread reply `build` → bot replies "Matched: Southern Nevada Training
Center → Zoho Deal …, MC contact …". Misspell ("Souther Nevada") → still matches via fuzzy.

## Section 2 — OneDrive routing to the specific deal folder
**Diagnose:** `handleFileShared` (`slack/events/route.ts:~1148-1208`) — deal lookup by `slack_thread_ts`
(only `deals` today; `_Inbox` fallback). Helpers `microsoft.createDriveFolder`, `uploadDriveFile`,
`getDriveItem`, `downloadDriveItem`.
**Wire:** resolve business from `deals` **and** `email_submissions`/`deal_drafts` (the Section 1
resolution) so every dropped statement lands in `Deals/{business}/Bank Statements` and the SRT app in
`Deals/{business}/Completed Package`. Never `_Inbox` when business is known; if unknown, stage then
**move** once resolved. Fire on `#srt-sub` too (not just `SLACK_PIPELINE_CHANNEL`).
**Test:** drop a statement PDF in the SOUTHERN NEVADA thread → appears under
`Deals/Southern Nevada Training Center/Bank Statements`.

## Section 3 — Statement analysis → report
**Diagnose:** `analyzeBankStatements` (`src/lib/ai-intel/bank-statement-analyzer.ts`) + the metrics
extraction in `src/app/api/agent/bank-statements/route.ts` (`BankMetrics`: `revenue_table`
[month, deposits, **avg_daily_ledger**, deposit_count, nsf_count], `existing_mca_positions`,
`top_mca_lenders`, `existing_mca_monthly_burden`, `statement_months_covered`, `red_flags`).
**Wire:** on `build`, gather the deal's statements (OneDrive folder drive items), run the analyzer,
and format a **report** posted to the #srt-sub thread: the calculator table; **missing-month gaps**
(diff `statement_months_covered` vs expected consecutive months); **daily/weekly draws** (list the MCA
positions w/ cadence + amount); **monthly patterns** (red flags / recurring). Persist metrics for
Section 5's deposit table.
**Test:** drop 3–4 statements → report posts with AVG Daily Ledger per month + missing/draw/pattern notes.

## Section 4 — SRT app extraction → BTF values + filled PDF
**Diagnose:** `extractApplicationPDF` (`slack/events/route.ts:~1223`, Claude document-block pattern),
`field-map.ts`, and `BtfValues` + `fillBtfApplication` (`src/lib/btf/overlay.ts`, done).
**Wire:** extract the SRT app PDF → map to `BtfValues` applying the format rules (phone `(XXX) XXX-XXXX`,
DOB `MM/DD/YYYY`, incorporation `MM/YYYY`, amount `$XXX,XXX`, EIN `XX-XXXXXXX`, `%` on ownership; flag
typos, default to corrected legal name; signature = owner name, date = today). `fillBtfApplication` →
filled BTF PDF → upload to `Deals/{business}/Completed Package/BTF_App_{business}.pdf`.
**Test:** drop the SRT app → filled BTF PDF in Completed Package with values in the right boxes
(letterhead intact). (Already verified standalone via `BTF_TEST_Southern_Nevada.pdf`.)

## Section 5 — Dual Outlook drafts
**Diagnose:** `microsoft.createDraft` (`src/lib/microsoft.ts`, currently `/me`, single `to`, no
attachments) and the Graph draft API (`POST /users/{mailbox}/messages`, `isDraft:true`, attachments).
The "New Deal" email template (deposit table HTML + SRT Submissions signature).
**Wire:** extend `createDraft({mailbox, subject, html, attachments[], to?})`. Build the deal-email
template (deposit table from Section 3 metrics). Create **Draft A — BTF** (subject `New Deal — {biz}`,
filled BTF PDF attached) and **Draft B — Submissions "father email"** (SRT app PDF attached) as Outlook
drafts in `matthew@srtagency.com`. Post links in the #srt-sub thread.
**Test:** reply `build` → two drafts appear in matthew@ Outlook → Drafts: BTF (with BTF PDF) +
Submissions (with SRT app), both with the pre-filled deposit table. Matthew edits notes + sends.

## Section 6 — Action notes (Zoho + MC + Slack) + end-to-end test
**Diagnose:** `deal_notes` table schema; `addNoteResilient` (`src/lib/zoho.ts`), `replyBullets`
(`submissions/route.ts`); `forward-deal-to-funders.ts` (where sends happen). Funder-reply → Slack+Zoho
already shipped.
**Wire:** on fan-out send, write a "Submitted to {funders}" note to the Zoho Deal **and** an MC
`deal_notes` row (mirror). Ensure approved/declined/stips already mirror to both (they hit Zoho;
add the MC `deal_notes` mirror). Keep everything ≤3 bullets.
**Test (full E2E):** drop statements + SRT app in a #srt-sub thread → `build` → report posts + 2
Outlook drafts created + files in OneDrive; send Draft B to submissions@ → #srt-sub parent → reply
funders → fan-out (ordered To+CC, attachments) + "Submitted" notes in Zoho/MC; funder replies →
bullets in Slack thread + Zoho Deal note.
