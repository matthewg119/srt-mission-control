# Continuation prompt: the four loose ends on the Instagram DM lane

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Production is mission.srtagency.com, deployed from `main`. Last commit shipped: `beaeab0`.

Read `CLAUDE.md`, and specifically the section **"The Instagram DM lane"**, which is the newest
section in that file and states the rules this work has to stay inside. Then read the header of
`src/lib/audit-engine/dm-pitch.ts` and the DM block at the end of `src/config/pitch.ts`.

The Chrome extension is a separate directory at `c:\Users\matth\Desktop\Code\srt-ig-extension`,
installed unpacked, so a reload in `chrome://extensions` is all a change needs. **Read TASK 1
before touching it.**

## CONTEXT

The no-website DM copy was rebuilt and shipped: rivals extracted properly on that lane, the trade
read off the prospect's Instagram bio, a city gate in the panel, and a `dm-cityless` lint rule. That
work is on `main` and `tsc` plus all three probes pass against it.

Four things were left. They are ordered by risk, not by size: task 1 is a real exposure, task 2 is
the only thing that actually proves the rebuild, task 3 is a feature, and task 4 is documentation of
an invariant that already holds.

The live example throughout stays `https://www.instagram.com/leahskinmethod`: Leah, a nurse
practitioner, no website of her own, bio link is an Aesthetic Record booking page, clinic is
The Plump Room in Coral Gables, FL.

---

## TASK 1: the extension is not under version control at all (do this first)

`c:\Users\matth\Desktop\Code\srt-ig-extension` has **no `.git`**. Confirm it yourself with
`git rev-parse --is-inside-work-tree` before doing anything else.

That directory is the entire front half of the DM lane: `content.js` (388+ lines, the profile
reader, all five panel states, the Lexical composer insertion), `panel.js`, `background.js`,
`manifest.json`, `options.*`. It has no history, no remote and no backup. One bad file save loses
it, and the most recent change to it, the `renderNeedsCity` panel, exists **only on that disk and
nowhere else**.

`git init`, a `.gitignore`, and a private GitHub repo under the same account as the other two
extensions. See the memory note `reference_srt_extension_repos`: the dialer and the call coach were
both moved to private repos for exactly this reason, and the same convention applies here.

- Commit the CURRENT state first, as one commit, before changing a line of it. The point is to
  capture what is already working.
- Then add a short `README.md` saying what it is, that it is loaded unpacked, and which backend
  endpoints it talks to (`POST /api/ext/instagram/prospect`, `GET .../{runId}`,
  `POST .../{runId}/redraft`).
- Do **not** commit any API token. `background.js` reads the token from `chrome.storage.local` and
  nothing is hardcoded, but check `options.js` and the manifest before the first commit rather than
  after.

---

## TASK 2: press the button on `leahskinmethod` and read what comes back

This is the only thing that proves the rebuild, and it has not been done. `tradeFromBio` and the ZIP
resolver in `resolveCityInput` are both live model calls and **no probe covers either of them**.

1. Confirm Vercel has finished deploying `beaeab0`.
2. Reload the unpacked extension.
3. Press the button on `leahskinmethod`. The expected path is:
   `needsWebsite` (the booking host is blocked, so no site is resolved) → press
   **"They have no website"** → **`needsCity`** → type `The Plump Room` and `Coral Gables, FL`.
4. Read the new `ig_dm_runs` row. `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and the service role
   key. **Read the row rather than reasoning about the code** — that table is how the `threads`
   alias bug was found, and how the empty scan that started this rebuild was found.

What the row has to show, and what each failure means:

| Field | Expect | If it is wrong |
|---|---|---|
| `check_json.trade` | buyer language, e.g. `laser skin treatments` | `tradeFromBio` returned a device name (`bbl moxi morpheus`) or null. Tighten the prompt, not the validator, unless the validator let something through it should not have |
| `check_json.tradeSource` | `"bio"` | it fell back to research, so the bio call failed or was rejected. Check the server log for `trade-from-bio failed` |
| `check_json.topRivals` | 1 or 2 real clinic names with counts | empty means `extractRecommendedBatch` returned `{}`, which it does silently on any failure. The angle then correctly degrades to `buying-question` |
| `check_json.results[].appeared` | booleans, not all `null` | all null means the alias set was empty, which is now recorded honestly but produces no measured claim |
| `angle` | `rival-substitute` | see the table above for which gate refused |
| `contacts.business_name` | `The Plump Room` | the typed-name override did not overwrite. It was `"Leah"` before this |

Then press it again and click **"I don't know"** on the city. The draft must carry **no** location
clause and no `dm-cityless` finding, and the Slack card must say `NO CITY, national questions`.

Report what the three variants actually say. Matthew rejected the last draft on the copy, so the
copy is the deliverable, not a green probe run.

---

## TASK 3: `booking_only` has a pinned line and no producer

`dmReasonLine` in `src/config/pitch.ts` has three versions and `DmSubject.siteState` selects between
them. `dmSubjectOf` only ever produces two of them:

- `dm-pitch.ts:155` — hook lane → `"not_surfacing"`
- `dm-pitch.ts:180` — no-website lane → `"none"`

Nothing produces `"booking_only"`. The line reads *"the only page of yours it can find belongs to
your booking software"*, and **Leah is exactly that case**: her bio link is
`theplumproom.myaestheticrecord.com/online-booking`, that page ranks, and every word on it was
written to sell appointments rather than by her.

This is the outstanding feature in `docs/CONTINUATION-booking-link-lane.md`. **Read that doc — its
two defects are long fixed (`9b53e43`), but its feature spec is still accurate and it argues the
case better than this paragraph does.** Two things in it are now already done, so do not redo them:

- The pinned line it asks for exists (`dmReasonLine("booking_only")`).
- `myaestheticrecord.com` and the other booking hosts are already in `NEVER_THEIR_SITE_HOSTS`.

What is left is the flag path: a third button in the panel next to `#noSite`, `bookingOnly` and
`bookingUrl` on the route body, the flag threaded to `startDmRun` and onto `MiniCheck`, and
`dmSubjectOf` returning `"booking_only"` when it is set.

Two notes that doc could not have known:

- **The panel does not currently receive the resolved booking URL.** `needsWebsite` returns a prose
  `note` (`profile.ts:231`, "The bio link points at {host}, which is not a site they control") and
  no structured field. Either add one to that response or let the extension post
  `profile.externalUrl` back and re-resolve server-side.
- **`factsFromRow` in `dm-run.ts` is load-bearing.** A new `lane` value returns `null` there, which
  makes Regenerate 409 and the panel's evidence block disappear. Reuse `lane: "nowebsite"` and carry
  the booking flag on `MiniCheck`, rather than inventing a third lane.

**It must still ask the engines.** The finding is that she did not come back, and that claim is
measured here like everywhere else.

---

## TASK 4: pin the rival-count invariant, which currently holds by luck

**This is the low-priority one, and it is NOT a live bug. Do not "fix" it.** It was reported as one
during the last session and that report was wrong; the correction is the useful part, so here is the
whole reasoning.

`src/lib/audit-engine/hook-pitch.ts` counts two things over what look like different sets:

- `:244` — `measuredCount = raw.filter((r) => r.appeared !== null).length`
- `:266-280` — `rivalCounts` increments for **any** answer with `r.text`, including the `:239`
  branch where `aliases.length === 0` forces `appeared: null` but keeps the text

Read alone, that says a run can produce `rivalCount: 4` against `measuredCount: 3` and print
*"shows up in 4 of the 3 searches I ran"* in the one sentence a prospect is most likely to check.

It cannot, and the reason is three lines further down. `aliases` is computed **once**, at `:221`,
outside the map. So there are only two states:

- `aliases.length === 0` → every answer is `appeared: null` → `measuredCount === 0` → the guard at
  `:245` returns `ok: false` and no DM is ever built.
- `aliases.length > 0` → every answer with text gets a boolean, and answers without text contribute
  no rivals. So `rivalCount <= measuredCount` always.

The invariant holds. What it does not have is anything **stating** that it holds, so the next person
who moves `buildAliases` inside the map, or relaxes the `measuredCount === 0` guard into a warning,
breaks a printed number with no test failing.

So the work is one probe check in `scripts/_probe-hook-pitch.ts` asserting
`topRival.count <= measuredCount` over a fixture with mixed `no_data` and real answers, plus one
sentence next to `:244` naming the guard that makes it true. Nothing else.

Verify the argument above against the code yourself before writing either. If you find a reachable
case I missed, that changes this task from documentation into a real fix, and it would then be the
highest-priority item in this document rather than the lowest.

---

## RULES THAT STILL APPLY

- **Measured counts only.** Never a fixed or default number. A hardcoded "1 of 4" was asked for
  once and declined; the reason holds, which is that the prospect can check it in the thread they
  are reading it in. If nothing was measured, the angle does not fire.
- **Gated in both directions.** An absence angle handed to a business that showed up everywhere is a
  lie they disprove from their phone, and the mirror is just as bad.
- **Each rival prints its own count.** Two names under one count is a false claim about at least one
  of them. See `dmRivalLine`.
- **Five sentences, one question mark**, enforced by the `dm` stage in `draft-linter.ts`. The
  rival angle is now at four before the opener, so there is exactly one sentence of headroom.
  **Count before you add a word.**
- **No em dashes** in prospect-facing copy. Commas, periods, hyphens.
- Every claim-carrying sentence lives in `pitch.ts`, not in a prompt string.
- A stale warning comment is worse than none. If you change what a `‼️` block describes, rewrite the
  block in the same commit.

## VERIFY

```
npx tsc --noEmit -p tsconfig.json
npx tsx scripts/_probe-dm-pitch.ts
npx tsx scripts/_probe-hook-pitch.ts
npx tsx --env-file=.env.local scripts/_probe-no-website-pitch.ts
```

`_probe-dm-pitch.ts` is 85 checks and `_probe-no-website-pitch.ts` makes real model calls, so it
needs the env file and costs a few cents. **The DM probe's summary and `process.exit` must stay at
the very end of the file.** They sat mid-file once and five checks appended after them never ran at
all. If you append checks, append them above the summary and confirm your new labels actually appear
in the output before believing a green run.

`bun run lint` is broken on this checkout (eslint 8.57.1 against a flat config wanting eslint 9).
Pre-existing on `main`. Do not try to fix it.

A local `tsc` run proves nothing about what deploys, because the deployed tree is HEAD plus your
paths and not your working tree. Extract the index with `git write-tree` and `git archive`, junction
`node_modules`, and run `tsc` and the probes there before pushing.

## WARNING ABOUT THIS REPO

Another Claude session works in this repo at the same time and the working tree changes underneath
you. **Check `git status` before staging, stage only your own paths by name, and never
`git add -A`.**

‼️ **THAT OTHER SESSION STAGES BY SWEEP, AND IT HAS TAKEN OTHER PEOPLE'S WORK TWICE.** `ea011f1`
says so in its own title ("Pre-existing working-tree changes, not authored in this session"), and
`ed9f384` ("Stop a table this project never created from rolling back the rename") silently carried
ten files of the DM-lane rebuild, which is why that work has no commit message of its own and why
`git log` for `dm-pitch.ts` blames a migration fix.

Practical consequence for you: **commit early and commit often.** Do not leave finished work sitting
in the working tree while you verify something else, because it will not be there under your name
when you come back. If a file you need is dirty with work that is not yours, build the version you
want to commit from `git show HEAD:<path>` plus your own edits and stage it with
`git hash-object -w --path` followed by `git update-index --add --cacheinfo`, which stages a blob
without writing to the working tree.
