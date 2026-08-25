# LANE 2 — Avatar first

Built 2026-08-25. Migration: `docs/2026-08-25-lane-2-avatar.sql`, **applied to production**.
`CLAUDE.md` was not touched. Session 5 folds this in.

---

## Done means: the tick is earned, and here is the proof

`avatar_confirmed` is tickable by a human being for the first time since the column was created.
Proven end to end on a throwaway client, not asserted:

```
SLACK_CLIENT_ONBOARDING_CHANNEL=C0AJXH7PTBM bunx tsx --env-file=.env.local scripts/_probe-cascade.ts
```

```
At the avatar
  ok    exactly one step is waiting
  ok    and it is the avatar (avatar_confirmed)
  ok    avatar_confirmed got an anchor by itself
  ok    avatar_confirmed got its card
  ok    avatar_harvest is STILL not anchored
  ok    the avatar is writable at all
  ok    avatar_confirmed CONFIRMS rather than skipping
  ok    and its evidence is system tier, off the column (system)
```

That last line is the whole lane. `setDeliveryStep` verifies BEFORE it writes, and the verifier
reads `clients.primary_avatar`, the column that had two readers and no writer anywhere. A
`system` verdict on it is a green tick nobody could have earned before today. Every cascade check
passes, including "every anchor was posted in DELIVERY_STEPS order" after the move.

### The live client is one press away, and that press is deliberately not mine

On `a11e0bda-46e9-4d90-94ff-54e47c244f23` the panel and the card now resolve three real
candidates:

```
ok: true | vertical: aeo-agency | nicheKey: aeo-marketing-agency | matchedBy: business_type
  a1  cash-pay-clinic-operator-...   Cash-Pay Clinic Operator (Functional Medicine, Aesthetics...)
  a2  multi-location-local-serv...   Multi-Location Local Service Franchise (HVAC, Plumbing...)
  a3  healthcare-group-or-dso-...    Healthcare Group or DSO Expanding Into Cash-Pay Ancillary...
```

**I did not pick one.** Choosing which customer SRT's own build is aimed at is Matthew's call, and
"a person confirms" is the doctrine this entire lane exists to restore. Writing an avatar onto the
live client to make a checkbox go green would have been the machine deciding, which is the
failure, not the fix. Step 8 sits at `not_yet: no avatar has been confirmed`, which is now a true
and answerable statement rather than a dead end.

### The diagnosis that decided whether any of this worked

**`niche_briefs` has no row keyed `aeo-agency`.** It is keyed on `niche_key`, and nothing keys it
on `vertical_slug`. The live client's `vertical_slug` IS `aeo-agency`; the matching brief is keyed
`aeo-marketing-agency`, and what identifies it is that its `business_type` is character for
character the client's own.

A lookup written the obvious way, `niche_key = vertical_slug`, returns **zero rows on the one
client this lane has to work for**. The panel would have rendered three empty slots and it would
have looked like the briefs were missing rather than mis-keyed. `avatarCandidatesFor` walks
vertical_slug, then business_type, then niche_key-as-business_type, and reports which one matched
so the card can say so. A miss returns an empty list and invites a typed avatar; it never invents
a candidate.

---

## What shipped

### 2A. The reorder
- `avatar_confirmed` moved from position 11 to position 8, immediately after
  `competitor_shortlist`, `blockedBy: ["baseline_scan"]`. `avatar_harvest` gained it as a blocker.
- **Keys unchanged.** Only array position and labels. Renaming would have orphaned every
  `client_delivery_steps` row carrying it, including the `skipped` one on the live client.
- It stays `mode: "manual"`, which is load-bearing: `reachableCursor` breaks the walk on the first
  unresolved step that waits for a person, and that break is what stops the harvest being anchored
  before the avatar it researches has been chosen. **The cost, stated:** `review_audit` and
  `avatar_harvest` now wait behind it. That is the calm-over-throughput trade the cursor's own doc
  block already describes.
- Phases stay contiguous, asserted in the test suite.

### 2B. The writer that never existed
- `src/lib/clients/avatars.ts` — candidates, confirmation, history, the thread reply, the slug.
- `POST /api/clients/[id]/avatar` with `auth()`, plus a `GET` for the panel.
- A panel at `id="avatar"` above `id="review-handover"`, and **three buttons on the Slack card**
  (`avatar_pick`) plus a line saying to reply `avatar: laser hair removal`.
- **The a1/a2/a3 CHECK constraint stays and needed no migration.** The SLOT is a1/a2/a3; the LABEL
  is free text, so "type a new one" is a write to two existing columns.
- The per-niche caveat still gets stated on the card and on the panel: cached per NICHE, not per
  business, so every client audited in this niche this month has the same three. Rejecting all
  three is an available answer, not a fallback.

### 2C. Per-avatar research, reusable across clients
- `avatar_briefs (vertical, avatar_slug)`, `client_avatar_runs`, `clients.primary_avatar_slug`.
- `question_bank`'s unique key is now `(vertical, avatar, normalized) NULLS NOT DISTINCT`, and the
  `onConflict` strings in `harvest.ts` and `research-intake.ts` match it exactly. All 63 existing
  rows carry a NULL avatar, so without NULLS NOT DISTINCT the index would constrain none of them
  and every re-run would insert 63 duplicates.
- Both files write `avatar = <the confirmed slug>`, and **both of their "the avatar stays NULL
  until step 11" comments were rewritten** rather than left contradicting the code.
- Step 10's card offers **[Reuse it]** / **[Run it again]** when the avatar already has research,
  with the date and how many clients have used it. [Run it again] never deletes what is stored:
  that research belongs to every client in the vertical, not just the one pressing the button.

### 2D. The brief is his three-message framework
- `src/config/research-method.ts` carries both documents as TEXT constants, generated from the
  markdown once. Verbatim, minus the editorial note at the top of each file, which is a comment
  about the repo rather than part of the method. Zero em dashes.
- `buildDeepResearchBrief` emits MENSAJE 1 / 2 / 3, fenced so each can be copied without picking
  up the next. `[EXPLICA QUÉ ESTÁS VENDIENDO Y A QUIÉN]` is FILLED from the avatar, the trade, the
  city and the services. `[PRODUCTO]` is the confirmed avatar.
- The measured context survives: seed sites matched on `client_id` FIRST, the businesses named
  instead, and the owner's own words with the typos kept.
- **Determinism holds**, byte for byte, and is still asserted.
- The rendered message 3 is filed on `avatar_briefs.prompt_text` for the next client in the
  vertical.

### 2E. [Done] wants the research back, and stays skippable
- An `avatar_harvest` branch in `stepPrecondition` refuses [Done] unless a `deep_research` phrase
  set exists for this `(vertical, avatar_slug)` or a document is filed against the step's thread.
- **[Skip] is untouched**, and the refusal says what skipping costs rather than hiding it.
- A PDF dropped in the thread is extracted with the existing `extractPdfText` (`unpdf`) and run
  through `ingestResearch`. **No model reads the PDF**: one would tidy the punctuation and fix the
  typos, which are the exact thing this step collects.
- The `research:` prefix is unchanged. The PDF path adds the prefix in code rather than relaxing
  the trigger, so there is still exactly one rule about what counts as research.

### 2F. Step 23 can change the avatar, before the stamp and never after
- `day_zero_archive`'s card prints the confirmed avatar and the question set the scan will run,
  and says both freeze once it is ticked.
- `avatar: X` in that thread re-confirms and **regenerates the custom question set as a new
  version**, but only when the avatar actually changed.
- After `day_0_archived_at` is stamped it refuses, in the thread handler AND in the route.
  `avatars.ts` reads the one column directly rather than importing `day-zero.ts`, because that
  dependency runs one way and reversing it leaves a module half-initialised.
- The universal twenty stay in place underneath, exactly as asked.

---

## What the merge session needs to know

### 1. The migration is APPLIED, both of them

`bun run scripts/db.ts --file=docs/2026-08-25-lane-2-avatar.sql` — 17/17 committed, and lane 1's
6/6. Matthew approved it explicitly rather than it being assumed. Nothing else in either lane is
owed to the database.

The `question_bank` index swap is the only non-additive statement in either file: the old
`question_bank_phrase_key` was dropped and `question_bank_phrase_avatar_key` created in the same
run. The 63 existing rows were NOT backfilled to an avatar. They were harvested before anybody had
confirmed one, and writing a slug onto them would be inventing which buyer they were collected for.

### 2. `question_bank.avatar` holds the SLUG now, and the CHECK constraint widened for it

It allowed only `a1` / `a2` / `a3`. That is the right vocabulary for `clients.primary_avatar`,
where a slot is read against the niche brief that offered it, and the wrong one here:
`question_bank` has **no `client_id`** and is shared across every client in a vertical forever, so
"a1" would mean whatever that client's brief had in position one on the day they confirmed. Two
clients would file two different buyers under one tag.

It is `^[a-z0-9][a-z0-9-]{0,59}$` now. `a1` still passes, so nothing already written can violate
it, and `slugifyAvatar` is unit-tested against that exact regex because a slug that fails it does
not fail at the panel, it fails at the next harvest write.

Nothing read `question_bank.avatar` before this. Verified by grep, not assumed.

### 3. Three files carry step numbers that are now wrong, and they are not lane 2's

The board renumbered: `avatar_confirmed` 11 to 8, `review_audit` 8 to 9, `avatar_harvest` 9 to 10,
`findings_doc` 10 to 11. Everything from 12 down is unchanged. I fixed every reference in the
files this lane owns and in the shared ones it touches. These are somebody else's:

| file | line | says | should say |
|---|---|---|---|
| `artifacts/custom-question-set.ts` | ~201 | "Run the avatar phrase harvest (step 9) first." | step 10 |
| `artifacts/page-candidates.ts` | ~455 | "The avatar phrase harvest (step 9) fills question_bank" | step 10 |
| `clients/page-studio.ts` | ~234 | "it needs the phrase harvest (step 9) to have run first" | step 10 |

`page-candidates.ts` also carries a comment asserting `clients.primary_avatar` **"DOES NOT
EXIST"**, and at line ~535 tells the reader "nothing in the system records which avatar was
confirmed". Both were true when they were written and both are false now. That file is LANE 4's,
so it is recorded here rather than edited. Its `page_candidates.avatar` column can be filled from
`confirmedAvatarFor()` whenever lane 4 wants it.

### 4. `scripts/_probe-cascade.ts` was rewritten for the new walk, and had to be

It skipped `competitor_shortlist` then `review_audit` and expected `avatar_harvest` next. Under
the new order the avatar sits between them, so the old sequence measured nothing. It now walks
through the avatar, **confirms it for real rather than skipping it**, and asserts the verdict is
`system` tier. That assertion is the one that could not have gone green on any run before today.

### 5. `avatar-form.tsx` is colocated, not under `src/components/clients/`

The brief names `components/clients/avatar-form.tsx`. That directory does not exist: all thirteen
existing client forms live in `src/app/dashboard/clients/[id]/`. It is
`src/app/dashboard/clients/[id]/avatar-form.tsx`.

### 6. Lane 2 added ONE call to `slack/events/route.ts`, which its brief said it would not

`avatar: laser hair removal` typed in a step thread otherwise falls through to branch 3 and is
answered by the general assistant instead of writing the column, which is the same shape of bug
that left `primary_avatar` with no writer. The branch is a **call into `avatars.ts`**, never an
implementation, per that file's own rule, and it sits inside the existing onboarding gate at line
~800, nowhere near lane 4's `C09QPHZGPUY` addition above `isContentFullChannel`.

The PDF-in-the-thread branch (2E) went into the **files** branch, which lane 1 owns. Running both
lanes in one session is what made that possible without a collision.

### 7. `blocks()` in `step-engine.ts` gained an optional fourth argument

The three standard buttons are untouched in order and meaning; `extraActionsFor(step, c)` appends
per-step ones after them, and exactly two steps have any. A step whose entire content is a choice
between three named things needs those three pressable where the card is: telling somebody to open
a dashboard to press one of three buttons is how a step ends up `skipped`, which is precisely what
happened to this one.

## Verification run

```
bun run build                                          passes, /api/clients/[id]/avatar in the route list
bun scripts/test-onboarding-artifacts.ts               All 406 checks passed (368 before this lane)
bunx tsx scripts/_probe-step-verify.ts                 All checks passed
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts <client>    All checks passed
SLACK_CLIENT_ONBOARDING_CHANNEL=C0AJXH7PTBM bunx tsx --env-file=.env.local scripts/_probe-cascade.ts
                                                       All checks passed
```

`bunx tsc --noEmit` is clean for every file in this lane. One error seen during the session,
`clients.payment_recorded` in `access_granted`'s verifier, is another lane mid-edit and is not
lane 2's to fix.
