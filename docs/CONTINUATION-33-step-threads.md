# Continuation prompt: one thread per delivery step

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Read `CLAUDE.md` first, especially "Client onboarding and delivery" and "The client hub".
Production is mission.srtagency.com, deployed from `main`. Last session shipped `8c956bb`.

## CONTEXT

Matthew ran the pilot onboarding for SRT Agency LLC and it worked, but it is unusable in
practice. Everything the 33-step Delivery Runner produced landed as a wall of ~18 replies in
one `#onboarding-srt-aeo` thread inside about 90 seconds: the checklist, the site and DNS
intelligence, the baseline scan, the prompt drop, the report, the competitor shortlist, the
WhatsApp drafts, two `[Done]` cards, and an intake question block. His words: **"this looks
very disorganized and it's hard for me to keep track of what needs to be done. Like this it's
just a mess and impossible to work on."**

The information is right. The SHAPE is wrong. He cannot work one step at a time because
nothing on screen corresponds to one step.

The SRT client row has already been deleted (`clients`, `client_onboarding_steps` x8,
`client_delivery_steps` x33, `client_messages` x2) so onboarding can be run clean. The
`audit_reports` rows for srtagency.com were deliberately KEPT. `lacasitatacos.com` is the only
remaining client row and must not be touched.

## WHAT HE ASKED FOR, IN HIS WORDS

> After onboarding intake is received I would like it better if it posts 33 messages and in each
> message we do the thread with what is being done for each step, this way I can be more
> organized and actually work 1 step at the time. Once the step is completed just post a
> checkmark to the step (BrainHeart needs to do this, so he needs to confirm that whatever
> needed to be done was actually done).

So: **33 top-level messages in `#onboarding-srt-aeo`, one per delivery step.** All the work,
cards, drafts, questions and evidence for a step go in THAT step's thread, never at top level.
When a step completes, BrainHeart marks the top-level message with a checkmark, and it does so
having CONFIRMED the work actually happened rather than because a button was pressed.

## WHAT TO WORK OUT BEFORE WRITING CODE

Read the current implementation first. The relevant files:

- `src/config/delivery-steps.ts` — `DELIVERY_STEPS`, the 33 definitions, `mode`, `auto`, `blockedBy`
- `src/lib/clients/delivery-checklist.ts` — `renderChecklist`, `refreshDeliveryChecklist`, `setDeliveryStep`
- `src/lib/clients/step-engine.ts` — `runReadyAutoSteps`, `postStep`, `autoCompleteStep`, the card builders
- `src/lib/clients/artifacts/registry.ts` — `AUTO_RUNNERS`
- `src/app/api/slack/actions/route.ts` — the `[Done]` / `[Skip]` / `[I hit a problem]` buttons
- `src/lib/clients/client-drafts.ts` — the WhatsApp drafts and their `step_next` / `step_done` triggers
- `clients.ops_thread_ts` and `clients.ops_checklist_ts` — the two ts values stored today

Questions the design has to answer. Decide them from the code, and ask Matthew only where the
answer genuinely changes the build:

1. **Where do the 33 ts values live?** There is one `ops_checklist_ts` column today and there
   will now be 33 message timestamps. A `client_delivery_steps.slack_ts` column is the obvious
   shape. Whatever you choose, a step ticked, unticked and re-ticked must not post twice, which
   is the same reasoning as the `unique (client_id, draft_key)` constraint on `client_messages`.
2. **Post all 33 at intake, or post each one when it becomes reachable?** He said 33 messages.
   Consider what a channel with 33 messages of which 30 are blocked actually reads like, and
   whether a blocked step's message should exist but say what it is waiting on. Do not silently
   decide to post fewer than he asked for; if you believe fewer is better, say so in one or two
   sentences and then build what he asked unless he changes it.
3. **Does the single running checklist survive?** `renderChecklist` is what he currently reads
   to know where he is. Thirty-three messages plus a 33-line checklist is the same wall again.
   Either the checklist becomes a short header (N of 33 done, next step, link) or it goes.
4. **What does "BrainHeart confirms it was actually done" mean per step?** This is the hardest
   and most valuable part of the request and it must not collapse into "tick when the button is
   pressed". Some steps have real evidence available: `baseline_scan` has `audit_runs` rows,
   `hub_preview` has `client_hosts` rows and a Vercel response, `subdomain_live` has
   `checkRecord`, `dns_records` has `client_dns_records.status`. Others are a human assertion
   and can only ever be that (`call_held`, `cards_printed`). Build the split explicitly, the way
   `day_0_source` distinguishes `photograph_2` from `manual_step`: a step verified against
   evidence must be visibly different from a step somebody said was done. **Never let a
   confirmation message claim evidence that was not checked.**
5. **Ordering.** Slack orders by post time, so 33 messages posted in a loop will read in step
   order only if they are posted in step order and never re-posted. Editing a message keeps its
   position; deleting and re-posting does not.

## RULES THAT ALREADY BIND THIS AREA

- `slackFetch` returns `{ok:false}` and never throws. Every `.catch(() => {})` around it catches
  nothing, so a failed post is invisible unless the return value is checked. This was fixed once
  already for the Done/Skip buttons. Do not reintroduce it in the new posting path.
- Slack is INTERNAL only. There are no per-client channels and no guest invites
  (`client-channel.ts` is deleted). Everything stays in `#onboarding-srt-aeo`.
- Client-facing messages are DRAFTS with a `wa.me` link. Nothing can send them. `sent_at` is
  stamped by a person pressing *Mark sent*.
- ASK drafts fire when their step becomes NEXT; NOTIFY drafts fire when their step COMPLETES.
  Reversing this asks for DNS records the day after they were added.
- The Day 0 wall is the one hard rail: `page_publish` refuses while `clients.day_0_archived_at`
  is null, and the check goes BEFORE `setPublished`.
- No em dashes in anything client facing. Paste full SQL in a ```sql block, never a file path.
- Never put a model anywhere near `src/lib/hub/review-assemble.ts` (FTC 16 CFR Part 465).
- Do not add domain-attach code outside `src/lib/hub/vercel-domains.ts`.
- Ask before deleting production data.

## A REAL BUG SEEN IN THE SAME RUN, WORTH FIXING WHILE YOU ARE HERE

```
:warning: Presence sweep: automated tier failed: there is no unique or exclusion
constraint matching the ON CONFLICT specification
```

Step 4 (`presence_sweep_auto`) fails on every run. Some upsert names an `onConflict` target that
has no matching unique index. Find the upsert, then either add the index (paste the SQL) or fix
the target. Diagnose against the live database before theorising: `.env.local` carries
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and reading the actual row has beaten
reasoning about the code every single time.

Also note `clients.subdomain` for `lacasitatacos.com` is `learn.lacasitatacos.com`, the full-host
value CLAUDE.md documents as a trap. `subdomainLabel()` absorbs it on read, so it is not urgent,
but do not let a new code path read that column raw.

## HOW TO VERIFY

Re-run the onboarding end to end on srtagency.com and read `#onboarding-srt-aeo` as Matthew
would. The test is not that 33 messages exist. It is: can he open the channel, see which single
step is next, open only that thread, do the thing, and watch it get a checkmark that means
something. Confirm a step that fails does NOT get a checkmark, and that a step whose evidence
cannot be found says so instead of claiming success.

## FIRST

Ask Matthew the questions from the list above that you genuinely cannot answer from the code,
and no more than that. Then show him the shape of ONE step's thread before building all 33.
