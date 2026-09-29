# Onboarding, end to end, with a test client

A complete dry run from intake to day thirty. Everything you type is here verbatim. You should
not need to open another document.

> **‼️ THIS IS THE 41-STEP BOARD, WHICH IS WHAT IS DEPLOYED TODAY.** Stage 13 of the
> destinations build merges and renames steps down to 37, which renumbers everything from the
> merge point on. This file is regenerated after that lands. The COMMANDS do not change; the
> numbers do.
>
> Every command below was read out of the source grammar, not written from memory. Where a
> command has an optional form, the form that works is the one printed.

---

## Before you start

| | |
|---|---|
| Channel | `#onboarding-srt-aeo` (`SLACK_CLIENT_ONBOARDING_CHANNEL`) |
| Shape | One top-level message per step. Everything for a step goes in **its own thread**. |
| Ticking | A checkmark is evidence, never a button press. `:white_check_mark:` means the app observed real state; `:ballot_box_with_check:` means a human put an artifact in the thread and the app read it back. |
| Refusals | A refusal is information. `not_yet` carries a `todo` and a `[Re-check]` button. `broken` carries a `fix` to paste into Claude Code and gets **no** button, because re-checking a code fault reproduces it. |
| Pace | One waiting step at a time. Resolving it reveals exactly one more. This is deliberate: Matthew asked for calm over throughput. |

### ‼️ The one grammar rule that bites everybody

**One command per message.** `offer:` and `terms:` in the same message is refused: the first
line decides what the message is, and the rest is read as part of it. This is enforced, not a
convention.

### Making the test client

Use a real-looking business you do not mind writing to nobody about. A domain you control is
ideal, because steps 26 and 31 want DNS.

```
Legal name:  Test Clinic LLC
DBA:         Test Clinic
Domain:      testclinic.example
City/State:  Charlotte, NC
```

---

# Phase 1 — Measure and prepare (steps 1 to 22)

Nothing here touches the client's live anything. It is all measurement.

## 1. `intake_received` · auto
Intake lands, the canonical NAP is locked, an audit is attached if one exists.

**You type:** nothing. **Refusal fix:** `rerun`.

## 2. `baseline_scan` · auto
The pre-call audit, the one that got them to book.

**You type:** nothing, if an audit is already attached to the client.
**If it refuses:** attach an audit to the client row, then press **[Re-check]**.

> ‼️ This resolves by `audit_reports.client_id`, newest first, with **no** fallback to contact
> or domain. Both of those can match a `prospect_audit`, and this is the baseline the day
> 30/60/90 numbers are measured against.

**Unblocks:** 6, 7, 11.

## 3. `site_dns_intel` · auto
Their site, hosting, DNS and (after Stage 8) whether the AI crawlers can read them.

**You type:** nothing.

## 4. `nap_sweep` · auto
The nineteen presence platforms, seeded.

**You type:** nothing. **Unblocks:** 5.

## 5. `presence_sweep_manual` · manual, screenshots
Search each platform and drop the screenshot in **this step's thread**.

**You do:** drop screenshots. Include the **browser address bar** in the shot.

> ‼️ The address bar is what attributes the screenshot to a platform. A brand mark in the page
> is not an address bar: a Bing Maps page was once read as Google Maps, which would have ticked
> the wrong platform. Four **distinct** platforms of any tier closes this (`SWEEP_GATE_COUNT`),
> not all nineteen.

**Then press:** `[Re-check]`.

## 6. `competitor_shortlist` · manual, on the board
The top three are pre-picked from the audit. Confirm or change them on the client board.

**You do:** open the board, adjust if needed, press **[Done]** on the step card.

> A tie at the cutoff is stated on the card. On the first real client two candidates had two
> mentions and five were level at one, so picks 2 and 3 were a coin toss and the card said so.

## 7. `avatar_confirmed` · manual
Which customer this whole build is aimed at.

**You type** (one message):
```
avatar: laser hair removal
```
Or a slug of your own: `avatar: busy-parent`. Candidates are offered on the card.

> ‼️ The slug is written to `question_bank.avatar`, a table with **no `client_id`**, shared
> across every client in a vertical forever. That is why it is a slug and not `a1`/`a2`/`a3`.

**Unblocks:** 9, 11, 13, 14.

## 8. `review_audit` · auto then manual
Them plus the three competitors, review counts.

**You do:** fill the counts on the board's Review audit panel, then **[Done]**.
Leave a count blank rather than typing zero: `Number("")` is 0, and an unknown count is not none.

## 9. `offer_proposed` · auto
One offer proposed from what they said at intake.

**You type:** nothing.

## 10. `offer_locked` · manual — **the prep call**
Phone them. Lock the one offer and the words their customers use for it.

**You type, ONE MESSAGE EACH, in this order:**
```
offer: laser hair removal packages
```
```
terms: laser hair removal, laser treatment, hair removal
```
```
outcome: smooth skin without shaving
```
```
price: 1200 for six sessions
```
```
guarantee: none
```

> ‼️ `offer:` and `terms:` in one message is **refused**. Five messages, not one.
> `guarantee: none` is a real answer and is better than leaving it: a guarantee is only ever
> the client's own words, and with none on file every downstream drafter refuses to promise one.

**Unblocks:** 11, 12, 13, 14, 21.

## 11. `avatar_harvest` · auto then manual
Buyer-phrase harvest, and the deep research for the confirmed avatar.

**You type** to get the research prompt:
```
prompt
```
Run it wherever you run deep research, then paste the result back:
```
research: <paste the whole thing>
```
Then, as separate messages:
```
avatar sheet: <paste>
```
```
short offer: <paste>
```
```
beliefs: <paste>
```

## 12. `keyword_set` · auto then manual — **and the tool decision**
Two hundred plus ways the offer is said, approved by you.

**You type:**
```
keywords prompt
```
Paste the results back, then:
```
keywords
```
to list them, and:
```
keywords pick 3, 7, 12
```
to keep specific ones. Also available: `keywords add`, `keywords drop`, `keywords more`,
`keywords map`, `keywords pillars`, `keywords variations`, `keywords approve`.

### ‼️ NEW — the tool, decided here
```
tools
```
Lists the tools this client could have, marking any already in their vertical's library, and
naming the client's own keywords whose results page wanted a tool.

```
tool pick 1
```
Picks it. That becomes the **eighth page**, beside the seven.

> ‼️ **Step twelve, not step twenty-one, and that is the point.** The evidence for which tool to
> build is the results pages you are looking at right now. By step twenty-one the pages are
> being drafted and a tool is a thing to squeeze in.
>
> Picking a second tool **replaces** the first. One slot, and changing your mind before the call
> is ordinary.

## 13. `custom_question_set` · auto
The twenty questions this client is measured on, frozen at Day 0.

**You type:** nothing.

> ‼️ This is the MEASUREMENT set. Step 14 is the PUBLISHING backlog. Same corpus, opposite jobs.

## 14. `page_candidates` · auto
Page candidates scored and ranked for the call.

**You type:** nothing.

## 15. `citation_cleanup_list` · auto
Citation cleanup list built and ranked. *(Renamed to off-site targets in Stage 13.)*

**You type:** nothing.

## 16. `hub_preview` · auto then manual
Hub built, themed, preview live, theme confirmed by you.

**You type** to see the four templates:
```
template
```
Then pick one:
```
template bold
```
`skin reset` puts it back. Then **confirm the theme on the board** — that is a separate act
from having overrides, and the step cannot complete until somebody confirms.

> ‼️ The preview URL on this card is a `/dashboard/` path and **cannot be handed to a client**:
> logged out they get a 404, not a login screen. The client-facing surface is `reviews.{domain}`.

**Unblocks:** 17, 18, 19, 20.

## 17. `referral_engine_preview` · auto
**You type:** nothing.

## 18. `concierge_preview` · auto then manual
```
concierge install
```
Works in **any** of this client's threads: it is the "come back later" door.

Also useful here:
```
booking: https://testclinic.example/book
```
or, when they take bookings by phone:
```
booking: callback
```

## 19. `site_replica` · auto then manual
A rebuild of their own site with the assistant on it.

**You type:** nothing. Walk the preview link when it posts.

> ‼️ This no longer drafts five offers about the business. The assistant on a replica hands over
> the same house offer it hands over everywhere else.

## 20. `review_card_pdf` · auto
**You type:** nothing.

## 21. `pre_call_pages` · auto then manual — **the big one**
Seven pages drafted before the call, one pillar and six supports, **plus the tool page**.

**In order:**

```
ladder
```
Shows the five offer-ladder rungs.

```
ladder pick 4
```
Anchors the build at one rung. (`anchor 4`, `rung 4` and `ladder 4` all work.)

```
pillar: 7
```
Names the pillar keyword by its rank. `pillar: auto` lets it choose.

```
supports auto
```
Writes the six supports.

```
angles auto
```
Three ideas per planned page: what it argues, the story, the belief it installs, the two
awareness stages.

```
angle 3 pick 2
```
Picks option 2 for page 3. Do this for each page.

### ‼️ NEW — asking for one shape across every page
```
angles all roundup
```
Every page that has no pick, all as a roundup. The nine shapes are `answer_first`, `list`,
`comparison`, `decision_guide`, `teardown`, and the four added by this build: `roundup`,
`review`, `tool`, `data_study`. An underscore or a space both parse.

```
headlines
```
Then:
```
headlines pick 4, 9, 12
```

```
cta 3: Free: the five questions to ask before you book.
```
Sets the one sentence page 3 hands over with. Left alone, it uses the house offer's own label.

```
plan approve
```
Approves the plan and starts drafting. `plan new` re-proposes. `plan drop 4`, `plan swap 4`,
`plan edit 4: <new title>` adjust it.

> ‼️ **`magnets` and `magnet N pick K` now refuse.** Offers are not written per page any more.
> Every page hands over to a house offer, `cta N:` sets the words it uses, and one page can be
> the tool instead.

## 22. `call_sheet` · auto
Call sheet, findings, presence PDF, thirty-three closing questions.

**You type:** nothing.

---

# Phase 2 — The call (steps 23 to 27)

## 23. `call_booked` · manual
**You press:** [Done].

## 24. `call_held` · manual
NAP read aloud, question set approved, consent confirmed, preview and drafted pages walked.
**You press:** [Done].

## 25. `access_granted` · manual
GBP manager, Search Console, Analytics.
**You press:** [Done].

## 26. `dns_records` · manual — **three records, two CNAMEs and one TXT**
Say it that way. "CNAME and TXT" reads as two.

All three go in live on the call, even though `reviews.` is unbuilt: an unattached CNAME just
does not resolve, and getting a client back into their registrar weeks later is worse.

**You do:** read the three records off the card. **You press:** [Done] once they say they typed
them. `added` is a human saying so; `verified` is the resolver seeing it. Two different facts.

## 27. `agreement_signed` · manual
**You press:** [Done].

---

# Phase 3 — Day 0 and build (steps 28 to 41)

## 28. `day_zero_archive` · manual · **‼️ THE WALL**
The Day-0 scan, archived **before any change lands**.

**You press:** [Done].

> ‼️ **`page_publish` refuses while this is unticked.** It is one of exactly two places this
> repo blocks instead of warning. What it protects is the baseline the day 30/60/90 numbers are
> measured against, and once a page is live that baseline cannot be recovered by being careful
> afterwards.
>
> The waiver is a door, not a bypass: it needs a real sentence, records who, and posts to
> `#alerts-infra`. It is offered only **after** a publish has been refused.

## 29. `gbp_buildout` · manual
Categories, services, photos, Q&A seeded. **[Done]**.

## 30. `citation_cleanup` · manual
Executed from step 15's list. **[Done].** *(Renamed to off-site executed in Stage 13.)*

## 31. `subdomain_live` · auto then manual
Subdomain live and verified in Search Console. Gated on the hub CNAME specifically resolving.

## 32. `first_page` · manual — **publishing, with a destination**

Open the page studio in `#aeo-seo-page-drafting`:
```
page Test Clinic
```
Then a bare digit to claim one of the frozen candidates:
```
2
```

Write it. Everything you type or dictate goes into the body **verbatim**:
```
add: <whatever you want to say>
```
Or walk the evidence questions:
```
ask
```
`next` or `skip` moves on. `body` switches to dictation. `undo` takes the last thing back out.

```
outline
```
```
draft
```
```
check
```
```
polish
```
```
done
```

Point the page at a house offer:
```
magnet
```
lists them. Then:
```
magnet book_consult
```
`magnet none` hands it back to the ladder.

### ‼️ NEW — where the page goes
On the board, press **Publish**.

- **One destination wired** (every client today): it publishes, no question asked.
- **More than one**: it refuses and asks. Tick one, press **Publish here**. Nothing is
  pre-selected, and there is no "publish anyway" — nothing is wrong with the page, somewhere to
  put it has not been decided.

### ‼️ NEW — export, which is never gated
Beside every page: **body HTML**, **markdown**, **JSON-LD**, **standalone page**,
**paste-here sheet**. Plus **Export every page (.zip)** above the list.

Export writes nothing: not status, not published_at. A file is not a publication. It is never
disabled, including before Day 0 — a client on Wix cannot publish through us at all, and gating
it would make the waiver the normal way to hand somebody their own pages.

### If the gate refuses
The refusal now names **both** ways forward:
1. **Get a source.** `ask` in the page thread, or run the `quote_request` workflow to draft an
   email asking a named person for one quotable sentence.
2. **Publish anyway, with a reason.** On the board, the box under the refusal. In a page
   thread: `waive: <the reason>` — at least ten characters, recorded against your name, posted
   to `#alerts-infra`, and stale the moment the page is edited.

## 33. `cards_printed` · manual
**[Done]**.

## 34. `review_request_configured` · manual
Set the mode on the board's Review handover panel, and the destination URLs:
```
review link: https://g.page/r/xxxx/review
```
> ‼️ Without these the review tool's "Post on Google" button never appears. Absent beats wrong:
> a guessed review URL sends a real customer to somebody else's business.

## 35. `referral_engine_handed` · manual
Handed to the named person. **[Done]**.

## 36. `concierge_live` · manual
Audience confirmed, booking destination set, consent copy approved. This is the only thing that
sets `concierge_configs.enabled`.

## 37. `tracking_installed` · auto then manual
SRT pixel live, first real session seen.

## 38. `self_report_field` · manual
Six "how did you hear about us" options on their booking form. **[Done]**.

## 39. `time_log_entries` · auto
Ticked by `/api/clients/[id]/time-log`. No button: it is not a button press.

## 40. `weekly_report` · auto
Counts the reports that actually fired.

## 41. `day_30_date` · manual
**[Done]**. *(Deleted in Stage 13; day 30 is derived from the Day-0 stamp.)*

---

# The off-site walk-through

Run these from the client chat, or ask the assistant to run them by name.

### 1. Plan a page with a shape that can earn a link
At step 21:
```
angles all roundup
```
A roundup names other people, including things that are not ours. Everyone listed has an honest
reason to link to it: they are in it.

### 2. Hit a MISSING field
A required field of a format with no answer is recorded **MISSING** on `page_dataset`, never
invented. A `roundup` with no "what ranked them" is a named gap and a person to ask.

### 3. Turn a blocked claim into an email
Run the workflow **`quote_request`**. It reads the pages currently refused by the gate, takes
the first blocked claim, and drafts one email asking somebody who would know for one quotable
sentence. One claim per run.

File the reply against the page as `EXTERNAL_RESEARCH`, collected via `outreach_reply`.

> ‼️ A reply clears the **block**. It does not raise `first_party_ratio`, which is a **warn**:
> an expert's sentence is evidence, and it is not the client's own words.

### 4. Resolve a refusal both ways
Do it once with `waive: <reason>` and once by getting a source, so you have seen both.

### 5. Read where the engines get their answers
Run the workflow **`offsite_targets`**. It reads every URL the engines cited across this
client's audits, rolls them up by domain, classifies each one, and saves the list.

The same data now renders as a section on the public report at `/r/<slug>`:
**"Where the engines get their answers."**

> ‼️ This data has been collected on every audit since 2026-07 and thrown away. `harvest.ts`
> read the URLs, fetched forty of the pages, and stored a **count**.

### 6. Queue an outreach draft
*(Stage 10 of the build. Not yet deployed.)*

### 7. Submit one foundation listing
*(Stage 9 of the build. Not yet deployed.)*

---

# What to check when something looks wrong

| Symptom | Where to look |
|---|---|
| A step will not tick | Its refusal already says. `not_yet` means work is owed; `broken` means a code fault and the `fix` line is meant to be pasted into Claude Code. |
| A card posted with no buttons | The body went over 3,000 characters and Slack refused the whole message. |
| Publish refuses and Day 0 is ticked | It is the quality gate. Press Check to see the verdict. |
| Publish asks where the page goes | The client has more than one destination wired. Nothing is wrong. |
| The widget offers the generic thing | The page's `lead_magnet_key` is null, or names a key that no longer resolves. `magnet` in the page thread lists what is available. |
| A tool page renders no tool | `component_key` names something not in `src/config/tool-components.ts`. An unknown key renders nothing on purpose. |
