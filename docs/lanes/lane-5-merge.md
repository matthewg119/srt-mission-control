# LANE 5 — Merge

Run this **only after all four lanes have written their `docs/lanes/RESULT-lane-N.md`.**

All four lanes worked in this same checkout, so there is nothing to `git merge`. What there
is instead is four sets of edits sitting side by side that have never been built, tested or
run together.

---

## 1. Read what they did

`docs/lanes/RESULT-lane-1.md` through `RESULT-lane-4.md`. Each says what shipped, what SQL it
needs, what it left owed, and what it noticed in another lane's files but did not touch.

---

## 2. Build it and see what broke

```
bun run build
bun scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts
```

Expected collisions, all of them anticipated:

- **`step-engine.ts`** - four lanes added `case` arms to `instructionsFor` and three added
  branches to `stepPrecondition`. The arms are disjoint by design. Check that no lane
  reordered the switch and that every import at the top is still used.
- **`step-verify.ts`** - disjoint verifier keys. `STEP_VERIFIERS` is
  `Record<StepKey, Verifier>`, so a missing one is a build failure, which is the point.
- **`page.tsx`** - three panels at three anchors plus lane 1's `id="theme"`.
- **`slack/actions/route.ts`** - seven appended `action_id` handlers.
- **`test-onboarding-artifacts.ts`** - four appended banners. Confirm the total check count
  went UP and that nothing was overwritten.

---

## 3. The three real interactions, which are not merge conflicts

These are the places where two lanes' correct changes make a third thing wrong.

**a. `page_candidates` grouping.** Lane 4 was told to leave the comment in
`page-candidates.ts` asserting `clients.primary_avatar` does not exist. Lane 2 has now built
the writer for it. So the document's line *"Not grouped by avatar: nothing in the system
records which avatar was confirmed, so an a1/a2/a3 tag here would be invented rather than
read"* is **now false**. Either group by the confirmed avatar or rewrite that paragraph. Do
not leave a client-facing PDF explaining an absence that has been filled.

**b. The cursor after the reorder.** Lane 2 moved `avatar_confirmed` earlier in
`DELIVERY_STEPS`, and `page_candidates` and `custom_question_set` are both
`blockedBy: ["avatar_confirmed"]`. Walk `reachableCursor` on a throwaway client and confirm
**exactly one waiting step at a time** still holds, and that resolving it reveals exactly one
more:

```
PROBE_SCRATCH_CHANNEL=<your throwaway channel> bunx tsx --env-file=.env.local scripts/_probe-cascade.ts
```

Create the throwaway channel yourself and invite the bot. The probe refuses production
`C0BLK797PNU`, `#srt-sub`, and any id already present in your env, so it cannot fall back onto
a channel somebody reads.

**c. `applySubstitutions`.** Lane 3 changed `substitutionsFor` and the fallback behaviour.
`custom-question-set.ts` and `page-candidates.ts` both call into that chain. Confirm a
non-med-spa client still gets a coherent question set rather than a set of empty brackets,
and that the med spa path is byte-identical to before.

---

## 4. Fold the docs into CLAUDE.md

The four lanes were forbidden from touching `CLAUDE.md` precisely so this could be done once,
by one session, as one coherent section rather than four appended ones.

Write **ONE** new section under "Client onboarding and delivery", dated 2026-08-25, in the
voice the rest of that file is written in: what changed, and the trap each change was avoiding.
The material is in the four RESULT files and in the four briefs.

Then delete `docs/lanes/RESULT-lane-*.md`. Keep `docs/lanes/CONTRACT.md` and the four briefs
as the record of what was asked for; keep `research-method-parte-1.md` and `-2.md`, which
lane 2's code imports from.

---

## 5. One SQL block, in lane order

Four migrations exist:

```
docs/2026-08-25-lane-1-screenshots.sql
docs/2026-08-25-lane-2-avatar.sql
docs/2026-08-25-lane-3-payment.sql
docs/2026-08-25-lane-4-pages.sql
```

**Paste all four inline, as one fenced sql block, in that order.** Matthew cannot find `.sql`
files on his machine; a file path is not a deliverable. Say which statements are destructive
(lane 2 drops and recreates a unique index on `question_bank`) and which are add-only.

---

## 6. The end-to-end proof, on the live client

`871f51be-26a1-4a85-a18a-6df0ce82395f`. Four things, one per lane:

1. **Lane 1.** Re-run attribution over the **five unattributed screenshots still sitting in
   step 5's thread**. They resolve from their address bars with nobody typing anything. If
   any cannot, name which and why. Do not lower the gate to make it pass.
2. **Lane 2.** `avatar_confirmed` moves from `skipped` to a confirmed avatar, and the
   deep-research brief comes out as the three-message framework with that avatar in it.
3. **Lane 3.** The regenerated call sheet stops asking a marketing agency about lip filler.
4. **Lane 4.** A voice note in `C09QPHZGPUY` becomes a `client_pages` draft with his words in
   it.

```
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts 871f51be-26a1-4a85-a18a-6df0ce82395f
```

---

## 7. Then, and only then

Commit. **Do not deploy without saying what is being deployed.** Production is
mission.srtagency.com from `main`, last shipped `ea011f1`, and there are unrelated
uncommitted shot-grammar changes in this tree that were left alone by every lane and must
stay left alone.

Report honestly: what shipped, what is owed, what any lane could not finish.
