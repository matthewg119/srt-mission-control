# Continuation prompt: the no-website DM copy, rivals on that lane, and the city gate

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Production is mission.srtagency.com, deployed from `main`. Last commit shipped: `9b53e43`.
Read `CLAUDE.md`, then the header of `src/lib/audit-engine/dm-pitch.ts` and the header of
`src/lib/audit-engine/no-website-pitch.ts`. Both state rules this work has to stay inside.

There is a sibling doc, `docs/CONTINUATION-booking-link-lane.md`. Its two defects are **already
fixed and deployed** (`9b53e43`). What is still outstanding from it is the "Only a booking link"
button, described there. This doc is the newer and higher priority work.

The Chrome extension is a separate repo at `c:\Users\matth\Desktop\Code\srt-ig-extension`,
installed unpacked, so a reload in `chrome://extensions` is all a change needs.

## CONTEXT

The Instagram DM lane works end to end. `leahskinmethod` now runs and drafts. Matthew read the
draft and rejected the copy, and he is right.

The live example stays `https://www.instagram.com/leahskinmethod`: Leah, a nurse practitioner, no
website of her own, bio link is an Aesthetic Record booking page, clinic is The Plump Room. The run
took the `no-site` angle and produced this:

> I went looking for Leah the way an AI engine would, and you do not have a site of your own, so
> when someone asks an engine for a business like yours there is nothing of yours for it to cite.
> It can only repeat what a directory, a review site or a competitor's page says about you, and
> none of those are written by you.

It is true and it is limp. It reports a category fact about her and never says what actually
happened when the engines were asked, so there is nothing in it she can check and nothing that
stings.

## WHAT MATTHEW WANTS INSTEAD

His wording, verbatim, as the target:

> Leah! I ran a quick check and when someone asks ChatGPT for [services offered from lead in
> instagram] in [location], Competitor 1 and 2 shows up in 3 out of 4 searches and your clinic
> doesnt come back in any of them. when someone asks an engine for a business like yours there is
> nothing of yours for it to cite because your website is not visible and It can only repeat what a
> directory, a review site or a competitor's page says about you.
>
> Want me to send you the actual queries and results?
> Takes me 20 seconds to send, might change how you think about the next 6 months.

Four sentences plus the greeting, so it fits `DM_MAX_SENTENCES` (5) with nothing to spare. Count
before you add a word.

Three things in it do not exist on this lane yet, and one of them is blocked on purpose.

## TASK 1: rivals on the no-website lane (this is the blocked one)

`dmSubjectOf` in `src/lib/audit-engine/dm-pitch.ts` hardcodes `topRival: null` for the nowebsite
lane, and the field doc explains why:

> ‼️ NULL ON THE NO-WEBSITE LANE, ALWAYS, EVEN WHEN THAT CHECK CARRIES NAMES. [...] This message
> PRINTS the name it is given and attaches a claim to it, so the only acceptable source is
> extractRecommendedBatch. A name good enough to steer a model is not good enough to put in front
> of the person it is about.

**Do not delete that rule to satisfy the new copy. Satisfy the rule.** `MiniPromptResult.named` is
filled by `namesFrom(r.raw, aliases)`, a crude regex-ish extractor whose output only ever fed a
prompt. The fix is to give this lane the same extractor the hook lane uses.

In `src/lib/audit-engine/no-website-pitch.ts`, `runMiniVisibilityCheck` still has `r.raw` in hand
when it builds each `MiniPromptResult` (around line 190). Wire `extractRecommendedBatch` there, the
way `runHookCheck` does at `hook-pitch.ts` around line 265: collect the raw answers, one batched
Haiku call, filter out the client with `isClientName`, count each rival once per answer.

Then:

- Add the rival field to `MiniCheck`. Matthew wants **two** names, so make it a ranked list rather
  than the hook lane's single `topRival`. Something like `topRivals: Array<{name, count}>`.
- Update `dmSubjectOf` to read it, and **rewrite that ‼️ field doc** so it states the new rule
  (extractRecommendedBatch on both lanes) rather than leaving a comment that now contradicts the
  code. A stale warning comment is worse than none.
- Consider giving the hook lane the same top-two treatment for symmetry, but only if it does not
  disturb `rival-substitute`, which is working and which Matthew has approved.

### The two-rival trap

"Competitor 1 and 2 shows up in 3 out of 4 searches" is only true if **both** appeared in three.
They usually will not. Naming two businesses under one count is a false claim about at least one
of them, and it is the kind a prospect checks.

Print each one's own count. For example: "Aesthetemed shows up in 3 of the 4 searches I ran and
Bogat Aesthetics in 2, and The Plump Room isn't in any of them." If only one rival was extracted,
say one. If none were, fall back to the countless absence wording rather than inventing a second
name. Gate the angle on having at least one.

## TASK 2: the services should come from her Instagram bio

Matthew wants `[services offered from lead in instagram]`. Right now the no-website lane never sees
the bio. `runMiniVisibilityCheck(businessName, city)` takes two arguments, and `trade` is derived
from `identity.whatTheyDo`, which comes from research, not from the profile.

Her bio is explicit and better than anything research will infer:

```
Skin Strategist x Laser Layering
Advanced Skin @theplumproom
Sciton Clinical Specialist @sciton
BBL • Moxi • Morpheus • Skin
```

The route already has the bio (it passes it to `cityFromBio`). Thread it through to the mini check
as a hint and prefer it over the researched trade when it yields something usable, or feed it to
the classifier as an override the way the hook lane pins the typed business name.

Keep `shortTrade`'s job intact: a buyer question has to read like a buyer wrote it. "BBL, Moxi and
Morpheus" is device branding, not what a patient types. Something like "laser skin treatments" or
"skin tightening" is what belongs in the prompt. Do not put a bullet list into a search query.

## TASK 3: the city gate, when the location cannot be found

Matthew's request, in his words: if it cannot find the location, "make the prospector ask me what
city or zip code or something, make it ask me for stuff maybe i can research online or simply click
i dont know and then draft a generic answer".

This is exactly the `needsWebsite` flow that already exists, and it should be built as its twin.

- **Backend**: `resolvedCity` in `runMiniVisibilityCheck` is
  `city?.trim() || identity.city+state || null`. When it lands null, the route should return
  `needsCity: true` **before spending the scan**, the same way it returns `needsWebsite: true` at
  `src/app/api/ext/instagram/prospect/route.ts` step 3. Accept `cityOverride?: string` and
  `noCity?: boolean` on the body.
- **Panel**: mirror `renderNeedsWebsite` in `content.js`. A text input taking a city or a ZIP, a
  "Use this location" button, and a ghost "I don't know" button that posts `{ noCity: true }`.
  Matthew explicitly wants the option to go and look it up first, so the panel must not block or
  time out while he does.
- **ZIP handling**: if he types a ZIP, either resolve it to a city or pass it through. Do not print
  a raw ZIP in the DM. `hookPositioningLine` and the `dm*Line` functions all split the city on the
  first comma to drop the state, because a person writing that sentence would not say it.

### The generic draft must stay honest

When he clicks "I don't know", the scan runs without a city, so the prompts are national rather
than local. The copy then **must not imply a local result**. "when someone asks ChatGPT for laser
skin treatments in your area" is a claim about a search that was never run. Either drop the
location clause entirely or say plainly that the questions were not localised. Add a lint check or
an angle gate so a cityless run cannot emit a city-shaped sentence.

## TASK 4: the copy itself

New pinned lines in the DM block at the end of `src/config/pitch.ts`, siblings of
`NO_WEBSITE_LINE`, and a rewritten or replacement `no-site` angle in `DM_ANGLES` gated on having
measured answers and at least one rival. Keep the existing `no-site` angle as the floor for when
there are no rivals and no measured answers, because that case still has to produce something.

### One wording decision to put to Matthew

His draft says "because your website is not visible". For Leah that is not true in the way it
reads: she does not have a website at all, so there is nothing to be invisible. `NO_WEBSITE_LINE`
already says the accurate thing, "you do not have a site of your own".

The honest split is:

- **No site at all**: "there is nothing of yours for it to cite, because you do not have a site of
  your own."
- **Booking link only** (the other doc's lane): "the only page of yours it can find belongs to your
  booking software."
- **Has a site that did not surface**: "your site is not showing up in what it pulls back", which is
  the only case where his original wording is correct.

Ask him which he means before shipping, or implement all three behind the angle gates, which is
cheaper than getting it wrong in front of a prospect.

## RULES THAT STILL APPLY

- **Measured counts only.** Never a fixed or default number. Matthew asked for a hardcoded "1 of 4"
  earlier and it was declined; the reason holds, which is that the prospect can check it in the
  thread they are reading it in. If nothing was measured, the angle does not fire.
- **Gated in both directions.** An absence angle handed to a business that showed up everywhere is
  a lie they disprove from their phone, and the mirror is just as bad.
- **Five sentences, one question mark**, enforced by the `dm` stage in `draft-linter.ts`.
- **No em dashes** in prospect-facing copy. Commas, periods, hyphens.
- Every claim-carrying sentence lives in `pitch.ts`, not in a prompt string.

## FILES

- `src/lib/audit-engine/no-website-pitch.ts` (extractor, `topRivals`, bio hint)
- `src/lib/audit-engine/dm-pitch.ts` (`dmSubjectOf`, the angle, the stale field doc)
- `src/config/pitch.ts` (new pinned lines, DM block at the end)
- `src/app/api/ext/instagram/prospect/route.ts` (`needsCity`, `cityOverride`, `noCity`, bio pass-through)
- `src/lib/instagram/dm-run.ts` (thread the new inputs)
- `scripts/_probe-dm-pitch.ts` (extend; it is the regression net)
- `c:\Users\matth\Desktop\Code\srt-ig-extension\content.js` (the city prompt)

## VERIFY

```
npx tsc --noEmit -p tsconfig.json
npx tsx scripts/_probe-dm-pitch.ts
npx tsx scripts/_probe-hook-pitch.ts
```

`_probe-dm-pitch.ts` is 52 checks. **Its summary and `process.exit` must stay at the very end of
the file.** They sat mid-file for a while and five checks appended after them never ran at all;
that was fixed in `9b53e43`. If you append checks, append them above the summary and confirm your
new labels actually appear in the output before believing a green run.

`bun run lint` is broken on this checkout (eslint 8.57.1 against a flat config wanting eslint 9).
Pre-existing on `main`. Do not try to fix it.

Read the live rows rather than reasoning about them. `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`
and the service role key. `ig_dm_runs.check_json` holds the prompts, the per-question `appeared`
flags and the rival data. Reading that table has beaten reading the code every time: it is how the
"threads" alias bug was found.

Then press the button on `leahskinmethod` and read what the panel shows.

## WARNING ABOUT THIS REPO

Another Claude session works in this repo at the same time, and the working tree changes underneath
you. **Check `git status` before staging, stage only your own paths by name, and never
`git add -A`.**

`src/config/pitch.ts` is the usual casualty: it has been mid-refactor by the other session for a
while, with `OFFER_TIERS`, `RECOMMENDED_TIER` and `guaranteeFor` being removed. If it is dirty with
work that is not yours, build the file you want to commit from `git show HEAD:src/config/pitch.ts`
plus your own edits, and stage it with `git hash-object -w --path` followed by
`git update-index --add --cacheinfo`, which stages a blob without writing to the working tree. Two
commits were made that way already.

A local `tsc` run proves nothing about what deploys, because the deployed tree is HEAD plus your
paths and not your working tree. Check the commit out into a throwaway worktree, junction
`node_modules`, and run `tsc` and the probes there before pushing.
