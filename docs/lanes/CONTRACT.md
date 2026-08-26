# The four-lane contract

Four Claude Code sessions are building four features in this repo **at the same time, in
this same working tree**. There are no branches: four sessions in one folder share one
checkout, so a branch per lane would just mean four sessions fighting over `HEAD`.

**What keeps you out of each other's way is file ownership, and it is not advisory.**

Read your own brief (`docs/lanes/lane-N-*.md`) and this file. Nothing else in here is yours.

---

## Ground truth, measured against production on 2026-08-25

Client `a11e0bda-46e9-4d90-94ff-54e47c244f23`, slug `srt-agency-llc`, re-onboarded that day.
Audit `92dd11c2-5822-4314-9089-ef6f6590f78b`, score 10, 20 runs, `status done`, linked.

| Fact | Why it matters |
|---|---|
| 18 files in step 5's thread, 13 attributed across 10 platforms, **5 attributed to nothing**, every one `image.png` | Lane 1's whole job |
| `client_docs.presence_source_url` and `presence_attributed_by` **already exist** | Lane 1 needs no migration for the vision path |
| `nap_discrepancies` already has `proposed_status`, `raw_name/address/phone`, `listing_url`, `screenshot_ref` | Lane 1's cleanup pass needs no new columns |
| `review_audit_rows` already has `listing_url`, `screenshot_ref`, `source` | Lane 1 |
| **`clients.primary_avatar` has a CHECK constraint, a verifier, and NO WRITER ANYWHERE** | Lane 2. Step 11 was **skipped** on the live client because no human could tick it |
| `clients.review_destination_primary = 'trustpilot'` | Intake already collects Trustpilot; it is not one of the 18 platforms |
| `question_bank`: 63 rows, all `vertical='aeo-agency'`, `avatar` NULL on every one | Lane 2 |
| `clients.billing_status = 'pilot'`; nothing Stripe touches `clients` | Lane 3 |
| The live call sheet asked an SEO agency "Who does the best lip filler in Greensboro, NC?" | Lane 3 |

Confirmed working in production, **do not re-fix**:
`clients.vertical_slug = "aeo-agency"` (adoptAuditClassification fired on step 2) ·
`competitor_shortlist` verifies "3 of 11 picked" · one-anchor-at-a-time held ·
`presence_sweep_manual` passes.

---

## Who owns what

### Files ONE lane owns outright

| Lane | Owns |
|---|---|
| 1 | `config/presence-platforms.ts`, `clients/presence-sweep.ts`, `clients/review-audit.ts`, `clients/onboarding-docs.ts`, `clients/review-preview.ts`, `clients/artifacts/citation-cleanup.ts`, `clients/artifacts/presence-pdf.ts`, plus new `screenshot-read.ts`, `review-read.ts`, `listing-read.ts` |
| 2 | `config/delivery-steps.ts`, `clients/harvest.ts`, `clients/research-intake.ts`, `clients/artifacts/deep-research-brief.ts`, plus new `clients/avatars.ts`, `api/clients/[id]/avatar/`, `components/clients/avatar-form.tsx` |
| 3 | `clients/question-sets.ts`, `clients/artifacts/call-sheet.ts`, plus new `clients/artifacts/call-questions.ts`, `api/clients/[id]/payment/`, `components/clients/payment-form.tsx` |
| 4 | `hub/pages.ts`, `hub/draft-page.ts`, `clients/artifacts/page-candidates.ts`, `components/clients/hub-form.tsx`, plus new `clients/page-studio.ts` |

If you need to change a file another lane owns, **stop and say so** rather than editing it.

### Files SEVERAL lanes touch

| File | The rule |
|---|---|
| `src/lib/clients/step-engine.ts` | Everyone edits `instructionsFor`. **Touch only the `case` arms your brief names.** Do not reorder the switch. Do not reformat. Do not remove an import. New imports go on their own line at the end of the import block. |
| `src/lib/clients/step-verify.ts` | Same, per verifier key. Your brief names yours. `STEP_VERIFIERS` is `Record<StepKey, Verifier>` and must stay exhaustive. |
| `src/app/api/slack/events/route.ts` | Lane 1 owns the existing `#onboarding-srt-aeo` gate's **files** branch. Lane 4 adds ONE new channel gate for `C09QPHZGPUY`, immediately **above** the `isContentFullChannel` block. Lanes 2 and 3 add nothing here. Put real logic in a new module; this file gets a call, not an implementation. |
| `src/app/api/slack/actions/route.ts` | Append new `action_id` handlers. Never edit an existing one. |
| `src/app/dashboard/clients/[id]/page.tsx` | One import, one panel, your own `id=`. Lane 2 `id="avatar"` **above** the existing `id="review-handover"`. Lane 3 `id="payment"` **below** it. Lane 4 edits inside the existing Hub panel. Lane 1 only adds `id="theme"` to the theme panel that already exists. |
| `scripts/test-onboarding-artifacts.ts` | **Append only**, under your own `// ---- LANE N ----` banner at the end. |
| `CLAUDE.md` | **Do not edit it at all.** Write to `docs/lanes/RESULT-lane-N.md`. Session 5 folds all four in as one section. This is the biggest conflict source in the repo and it is being avoided entirely. |
| Migrations | Your own file, `docs/2026-08-25-lane-N-<name>.sql`. Never add to another lane's. |
| `git commit` | Commit only the files your brief names. `git add -A` will sweep up three other lanes' half-finished work. |

There are **pre-existing uncommitted changes on `main`** from unrelated shot-grammar work.
Leave them alone. Do not stash, do not revert, do not commit them.

---

## The invariants that bind every lane

Already CLAUDE.md doctrine. Restated because four sessions each get their own chance to
break them.

- **A green tick over unchecked work is the worst bug this design can have.** Three have
  shipped so far. `verified_source` is `system` (:white_check_mark:, the app observed real
  state) or `thread` (:ballot_box_with_check:, a human put an artifact in the thread and the
  app read it back). The CHECK constraint has no third value and **there is no override**.
  A thread-tier line may only describe **the artifact it found**, never the fact it stands
  for. When a helper returns an `ok` flag, check what the flag actually means before passing
  it through.
- **The tool proposes, a person confirms.** Anything a model reads off a screenshot lands in
  a `proposed_*` slot. `confirmed_status`, `review_count` and `primary_avatar` are written by
  a human action and by nothing else.
- **Ambiguity stays null and says so.** Zero matches and two matches are the same answer.
  A model that returns something it is unsure of is zero matches, not a weak yes.
- **One anchor at a time.** `reachableCursor` in `step-engine.ts` is the single answer to
  what may appear. All three schedulers gate on it and all three must, because `postStep`
  and `notifyStep` both CREATE anchors. Read its doc block before touching any of them.
- **Slack is INTERNAL only.** One top-level message per step, work in that step's thread.
  `notifyStep()` is the only door. **Edit anchors, never re-post** - Slack orders by post
  time, so a delete-and-repost moves a step to the bottom of the channel permanently.
- **`slackFetch` returns `{ok:false}` and never throws.** Check the body, never the promise.
- **A card body over 3,000 characters fails the whole message.** Everything added to a card
  goes through `bodySections()`, which splits on line boundaries and never mid-line.
- **Client-facing messages are DRAFTS with a `wa.me` link.** Nothing can send them.
- **The Day 0 wall is the one hard rail.** `page_publish` refuses while
  `clients.day_0_archived_at` is null, and the check goes BEFORE `setPublished`.
- **No em dashes in anything client facing.** Paste full SQL in a fenced sql block, never a
  file path.
- `test-onboarding-artifacts.ts` asserts the string `no issues found` appears **nowhere** in
  a rendered client PDF, in any casing, including inside a sentence disclaiming it.
- **No model goes near `src/lib/hub/review-assemble.ts` or the review tool.** FTC 16 CFR
  Part 465. A model reading a URL off an ops screenshot is a different thing in a different
  place; do not let it become a precedent for the customer-facing lane.
- **Ask before deleting production data.**

---

## Verification, every lane, before you say you are done

```
bun run build
bun scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts a11e0bda-46e9-4d90-94ff-54e47c244f23
```

`.env.local` carries `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SLACK_BOT_TOKEN`. `SLACK_CLIENT_ONBOARDING_CHANNEL` is **not** there (Vercel only);
production is `C0BLK797PNU`.

`_probe-cascade.ts` no longer reads `SLACK_CLIENT_ONBOARDING_CHANNEL` at all. It takes
`PROBE_SCRATCH_CHANNEL`, and it refuses any id that is a real channel or that already appears
in your env, so there is no id you can leave lying around that turns into a destination.
**Create your own throwaway channel, invite the bot, and pass that id.** Do not reuse
`C0AJXH7PTBM` (`#srt-sub`): this brief used to name it as "the scratch channel" and on
2026-08-25 seven probe runs left seventy-two undeletable anchors in it.

> **Probes without `--env-file=.env.local` silently return nothing.** Not an error. Nothing.

`bun run build` will fail while another lane is mid-edit on a shared file. That is expected.
Re-run it; if it still fails on a file you do not own, say so and carry on rather than
"fixing" their work.

## When you finish

1. Write `docs/lanes/RESULT-lane-N.md`: what shipped, what the SQL is, what is still owed,
   and anything the merge session needs to know.
2. Commit only your own files, with a real message.
3. Do not deploy. Do not push to `main`. Session 5 does that.
