# Continuation prompt: the prospect whose only link is an online booking page

Paste everything below the line into a new Claude Code session.

---

Repo: `c:\Users\matth\Desktop\Code\Mission control 2.0\srt-mission-control` (branch `main`).
Production is mission.srtagency.com, deployed from `main`. Last commit shipped: `dfd756f`.
Read `CLAUDE.md` first, then `src/lib/audit-engine/dm-pitch.ts` from the top: its header states the
rules the whole DM lane is built on, and everything below depends on them.

The Chrome extension is a separate repo at `c:\Users\matth\Desktop\Code\srt-ig-extension`.
It is installed unpacked, so a reload in `chrome://extensions` is all a change needs.

## CONTEXT

The Instagram DM lane shipped and works. Matthew pressed the button on a real profile it cannot
currently handle, and found two defects plus one missing feature.

The live example is `https://www.instagram.com/leahskinmethod`. Leah is a nurse practitioner
posting under her own handle; the clinic is The Plump Room (`@theplumproom`). Her bio link is
`theplumproom.myaestheticrecord.com/online-booking`, an Aesthetic Record booking page, and
Instagram shows "and 3 more". **She has no website of her own at all.** This is common in med spa
prospecting and Matthew expects to hit it constantly, so it needs a real lane rather than a patch.

The panel showed, repeatedly:

> https://theplumproom.myaestheticrecord.com/ loaded but there was too little on it to work out
> what they sell, so the questions would have been generic. Nothing was drafted.

He then pressed "They have no website" and **the same message came back**, which is the part that
looks impossible and is not.

## DEFECT 1: the claim guard replays failed runs, so the panel looks frozen

`src/app/api/ext/instagram/prospect/route.ts` around line 127. The guard reads the most recent run
for the handle inside `IG_CLAIM_MINUTES` (5, in `src/lib/instagram/dm-run.ts`):

```ts
.select("id, status")
.eq("handle", handle)
.gte("created_at", since)
```

It selects `status` and never filters on it. A run whose status is already `failed` is therefore
treated as in flight, and the route returns `reused: true` with that run's id. The panel then polls
that id and renders its stored `error_detail` again.

So "They have no website" did post `noWebsite: true` (extension `content.js`, button `#noSite`,
which calls `start({ noWebsite: true })`). The route never got as far as reading the flag. For five
minutes, every press of every button returns the first failure. **Fix this first.** It is small,
and until it is fixed nothing else can be tested on a profile that has already failed once.

Only `running` should hold the claim. A `failed` run must never block a retry. A `done` run may
still be worth reusing, since pressing twice otherwise costs a whole scan, which is why the guard
exists at all. Keep the guard, narrow it.

While you are in there: the panel's "Try again" button (`#again` in `content.js`) re-posts the same
payload, so it hits the same stale claim. Confirm it recovers once the guard is narrowed.

## DEFECT 2: booking platforms are accepted as the business's own website

`src/lib/audit-engine/web-hosts.ts` holds `NEVER_THEIR_SITE_HOSTS`. It has `calendly.com`,
`booksy.com`, `vagaro.com`, `mindbodyonline.com` and `square.site`, but **not**
`myaestheticrecord.com`. So `resolveBioLink` accepted the booking subdomain as her site, the
crawler fetched it, `isThinResearch` correctly judged it too thin, and `runHookCheck` bailed at
`src/lib/audit-engine/hook-pitch.ts` line 181.

That bail is right. The page was thin. The mistake was upstream: that page was never hers.

Add the booking and practice-management hosts. At minimum `myaestheticrecord.com`,
`aestheticrecord.com`, `zenoti.com`, `boulevard.io`, `getboulevard.com`, `janeapp.com`,
`acuityscheduling.com`, `setmore.com`, `schedulicity.com`, `fresha.com`, `phorest.com`,
`glossgenius.com`, `simplybook.me`, `timely.com`, `podium.com`. Subdomains already match, because
`isNeverTheirSite` checks `host.endsWith("." + h)`, and that is what makes
`theplumproom.myaestheticrecord.com` resolve correctly once the apex is listed.

**This also arms a protection that is currently off for these hosts.** `buildAliases` in
`src/lib/audit-engine/mention-match.ts` refuses to take a bare-domain token off any host in these
lists. Unlisted, that URL would have contributed the alias "myaestheticrecord", and `isMentioned`
is a substring test, so she would have scored as present in every answer that named the platform.
That is the same defect class as the `threads.com` bug fixed in `dfd756f`; read that commit message
before touching this area.

With both defects fixed, this profile falls through to `needsWebsite: true`, the panel asks, and
Matthew presses "They have no website", which reaches `runMiniVisibilityCheck` (name and city only,
no site needed). That path already works. **Confirm it end to end before building anything new.**

## THE FEATURE: a third button, "Only a booking link"

Matthew wants this treated as its own pitch rather than folded into "no website", because the two
are not the same situation and this one is stronger.

"No website" means there is nothing to read. "Only a booking link" means there IS a page, it does
rank, it is the thing a search engine finds, and **it belongs to the software vendor rather than to
her**. Every word describing her business on it was written to sell appointments rather than to
explain what she does, and she cannot change most of it. That is specific, checkable, and it is the
finding.

### What to build

1. **Extension** (`content.js`): a third button next to `#noSite`, labelled "Only a booking link".
   It posts `{ bookingOnly: true }` and should send the resolved booking URL too, so the backend can
   name the platform. Match the existing button markup exactly; do not restyle the panel.

2. **Route** (`src/app/api/ext/instagram/prospect/route.ts`): accept `bookingOnly?: boolean` and
   `bookingUrl?: string` on the body. Treat it like `noWebsite` for step 1 (no site research) but
   persist the booking host on the run so the drafter can use it. `ig_dm_runs` has no column for it;
   either add one (`booking_host text`) or fold it into `check_json`. Prefer the column, because
   `check_json` is documented as the scan result and this is an input.

3. **The lane** (`src/lib/instagram/dm-run.ts`): `bookingOnly` runs use `runMiniVisibilityCheck`,
   the same as the no-website lane. **It must still ask the engines.** The pitch below claims she
   did not come back, and that claim has to be measured rather than assumed, exactly as everywhere
   else in this codebase.

4. **The angle** (`src/lib/audit-engine/dm-pitch.ts`): a new entry in `DM_ANGLES` above `no-site`,
   gated on the booking flag and on a measured miss. Gate it in both directions like every other
   angle: if she DID come back, this angle cannot fire, because its whole finding is that she did
   not.

5. **The lines** (`src/config/pitch.ts`): new constants in the DM block at the end of the file,
   siblings of `NO_WEBSITE_LINE` and `NOTHING_TO_FIND_LINE`, pinned there for the same reason those
   are. Do not let the model phrase these.

### The copy Matthew asked for

His shape, in his words: say it did not show up, tease that there is something in their online
presence affecting it, then **ask permission** before sending the detail. He was explicit that he
likes asking before sending anything.

Close to this, subject to the rules below:

> Hey Leah, I ran a quick check and when someone asks ChatGPT for [service] in [city], [Rival] comes
> back in [n] of the [m] searches I ran and The Plump Room isn't in any of them. There's something
> in how your business shows up online that looks like the reason, and it isn't your content. Want
> me to send you what I found?

The permission ask is the close for this angle. Keep `DM_CLOSE_LINE`. Matthew wants the same hook
available in the email lane, so put the sentence in `pitch.ts` where both lanes can reach it rather
than inlining it in the DM angle.

### Rules this must not break

- **The tease needs a real finding under it.** `draft-linter.ts` rule 3 already enforces this for
  the email's "something on your own site" line, because a vague tease with nothing behind it is
  unfalsifiable. Here the finding is concrete: no site of her own, and the page that does rank
  belongs to a booking platform. Tie the tease to that fact in the brief so the model cannot wander
  into "something is wrong with your SEO".
- **Five sentences, one question mark.** `DM_MAX_SENTENCES` is 5 and the `dm` lint stage enforces
  both. The draft above is already at the limit. Count before adding anything.
- **Measured counts only.** `dmRivalLine` / `dmAbsenceLine` / `dmPresentLine` take a counts object
  and print what was measured. Do not add a fixed or default number. Matthew asked for a hardcoded
  "1 of 4" earlier and it was declined; the reason still holds, which is that the prospect can check
  it in the thread they are reading it in. If nothing was measured, the angle must not fire.
- **At most one rival, and only from `extractRecommendedBatch`.** See the `topRival` field doc in
  `dm-pitch.ts`. The mini check's `namesFrom()` is explicitly not good enough to print.
- **No em dashes in prospect-facing copy.** Commas, periods, hyphens.

## FILES

- `src/app/api/ext/instagram/prospect/route.ts` (claim guard, new flags)
- `src/lib/audit-engine/web-hosts.ts` (booking hosts)
- `src/lib/instagram/dm-run.ts` (lane selection, persist booking host)
- `src/lib/audit-engine/dm-pitch.ts` (new angle, gated both ways)
- `src/config/pitch.ts` (new pinned lines, in the DM block at the end)
- `scripts/_probe-dm-pitch.ts` (extend; it is the regression net for all of this)
- `c:\Users\matth\Desktop\Code\srt-ig-extension\content.js` (third button)
- a migration in `docs/` if you add `booking_host`

## VERIFY

```
npx tsc --noEmit -p tsconfig.json
npx tsx scripts/_probe-dm-pitch.ts
npx tsx scripts/_probe-hook-pitch.ts
```

`bun run lint` is broken on this checkout (eslint 8.57.1 against a flat config wanting eslint 9).
Pre-existing on `main`. Do not try to fix it.

Read the live rows rather than reasoning about them. `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`
and the service role key, and `ig_dm_runs` stores `check_json` with the prompts, the per-question
`appeared` flags and `topRival`. That table is how the "threads" alias bug was found, and reading it
beat reading the code every time.

Then press the button on `leahskinmethod` and read what the panel shows.

## WARNING ABOUT THIS REPO

Another Claude session works in this repo at the same time. The working tree usually holds a large
amount of unrelated uncommitted work, and it changes underneath you. **Check `git status` before
staging, stage only your own paths by name, and never `git add -A`.**

`src/config/pitch.ts` in particular has been mid-refactor by the other session. If it is dirty with
work that is not yours, build the file you want to commit from `git show HEAD:src/config/pitch.ts`
plus your own edits, and stage it with `git hash-object -w --path` followed by
`git update-index --add --cacheinfo`, which stages a blob without writing to the working tree. That
is how the last two commits were made.

Verify what you are about to deploy rather than what you have locally: check the commit out into a
throwaway worktree, junction `node_modules`, and run `tsc` and the probes there. The deployed tree
is HEAD plus your paths, which is not the same thing as your working tree.
