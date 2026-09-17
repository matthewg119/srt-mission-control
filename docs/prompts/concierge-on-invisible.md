# Build prompt: ship the AI Concierge onto srtagency.com/invisible

A build prompt for a fresh session. Everything in a **Ground truth** block was read in the repo or
queried against production on 2026-09-17 and is quoted, not remembered. Line numbers drift; symbol
names and column values are right.

**Two repos.** `Mission control 2.0/srt-mission-control` (the app and the widget) and `srt-agwb`
(the static marketing site, where the one line of markup lives). Work in your own git worktree.
Run `git branch --show-current` before every commit. Read `CLAUDE.md` and `docs/lanes/CONTRACT.md`
before writing code.

---

## What this is

The magnet lane put the concierge pill on **one** funnel, `/invisible`, as the sample Matthew
judges before the other six get it. Two commits, `4774e9f` and `9bed29c`, both touching only
`invisible/index.html`. They are on branch `magnet` in `srt-agwb` and **deliberately not merged**:
they cannot go to production as they stand, and the file's own comments say so twice.

Your job is to make them shippable and ship them.

### ‼️ BEFORE ANYTHING ELSE: THERE IS A LIVE SECRET IN THAT BRANCH

`invisible/index.html` on `magnet` carries this on the script tag:

```
?x-vercel-protection-bypass=secret69696969sinnadaqueverrimac&x-vercel-set-bypass-cookie=samesitenone
```

That is a **Vercel deployment-protection bypass token**. Merging that file publishes it in the
HTML of a public page, where anyone reading source can use it to reach protected preview
deployments. Verified on 2026-09-17: it is **not** currently exposed on the live site, because
these commits were held back for exactly this reason.

**Tell Matthew to rotate that token in Vercel** (Project Settings, Deployment Protection,
Protection Bypass for Automation, Regenerate) regardless of what else happens. It has been sitting
in a pushed branch.

The token is legitimate in a PREVIEW. `embed.js` copies any `x-vercel-*` param off its own `src`
onto the config fetch and onto the frame, because all four surfaces sit behind SSO on a preview and
a cross-site cookie does not reach them. See `src/app/embed.js/route.ts:17-20` and
`src/app/w/[slug]/route.ts:66-73`. None of that applies in production, where there is no SSO.

---

## Ground truth: the three things that were thought to be outstanding, and which actually are

Matthew was told this needed (1) the domain attached, (2) `allowed_origins` updated, (3) the
markup changed. **Queried against production on 2026-09-17, (2) is already done.**

`concierge_configs` for `srt-agency-llc` (client `4cc5c683-8feb-4f17-8ff5-28d6cc50887a`):

```json
{
  "enabled": false,
  "allowed_origins": [
    "https://learn.srtagency.com",
    "https://reviews.srtagency.com",
    "https://srtagency.com",
    "https://www.srtagency.com"
  ],
  "audience": "owner",
  "audience_confirmed_at": null,
  "booking_mode": "none",
  "booking_url": null,
  "addon_status": "included"
}
```

`https://srtagency.com` is already in the allowlist, because `seedOrigins()`
(`src/lib/clients/concierge-setup.ts:109-124`) derives it from `clients.domain`, which is
`srtagency.com`. **No SQL is needed for origins. Do not write a migration for it.**

What IS outstanding is four things, and three of them are in the database rather than in the
markup:

| # | Blocker | Where | Who |
|---|---|---|---|
| 1 | `concierge.srtagency.com` does not resolve | GoDaddy DNS, then attach in Vercel | Matthew |
| 2 | `enabled` is `false` | `concierge_configs` | this session, or step 36 |
| 3 | `audience_confirmed_at` is null | `concierge_configs` | a human decision |
| 4 | `booking_mode` is `none`, `booking_url` null | `concierge_configs` | Matthew's call |

Plus the markup change, which is the easy part.

### ‼️ A FIFTH THING NOBODY HAS NOTICED

The script tag carries `data-magnet="visibility_scan"`. **`lead_magnets` is EMPTY in production.**
Not "missing that row", empty: the query returns zero rows for every key. So the attribute names a
magnet that does not exist.

The file's comment says removing it means "the pill falls back to whatever the ladder ranks, which
is the same thing on every page, which is the problem this attribute exists to fix." With an empty
table there is nothing for the ladder to rank either. **Find out what the pill actually renders
with no magnet at all before shipping** (`rungOf()` and `magnets.ts` are the path), and say so.
Shipping a widget whose offer resolves to nothing is worse than shipping no widget.

---

## What to do

### 1. Hand Matthew the DNS, and be specific

He is attaching `concierge.srtagency.com` himself at GoDaddy. Give him the exact record, read off
Vercel rather than guessed, and tell him which Vercel project it attaches to
(`srt-mission-control`, not `srt-agwb`).

`CONCIERGE_HOST` defaults to `concierge.srtagency.com`
(`src/lib/clients/concierge-setup.ts:44-46`), so **if he uses that exact hostname no env var needs
setting.** If he picks a different one, `CONCIERGE_HOST` has to be set in Vercel and
`host-classify.ts` has to agree. Say which you are relying on.

Do not proceed to step 3 until `curl -sI https://concierge.srtagency.com/embed.js` returns a
status. On 2026-09-17 it returned nothing at all.

### 2. The database, and it is not a migration

`enabled`, `audience_confirmed_at` and `booking_mode` / `booking_url` are ROW VALUES, not schema.
There is a step that sets them properly and there are buttons that do it. Prefer those to a
hand-written UPDATE, because `concierge_live`'s verifier
(`src/lib/clients/step-verify.ts:1075-1190`) checks all of them and a row poked by hand can satisfy
the column while failing the intent.

`audience` is already `owner`, which is right: this is SRT's own marketing site and the widget must
speak the OWNER lane, booking a 15 minute call rather than a patient consult. See
`src/lib/concierge/lane-name.ts`. What is missing is `audience_confirmed_at`, which is a human
ratifying it, and there is a button for that.

**`booking_mode: "none"` is the one that needs a decision, not a keystroke.** The widget currently
has nowhere to send anybody. Ask Matthew what a booked call from `/invisible` should do before you
turn `enabled` on.

### 3. The markup, which is the small part

In `srt-agwb/invisible/index.html`, on the `magnet` branch's version of the script tag:

- Swap the `src` host from the `srt-mission-control-git-magnet-...vercel.app` preview alias to
  `https://concierge.srtagency.com`.
- **Delete the entire `?x-vercel-...` query string.** Not shorten it, delete it.
- Rewrite the two `‼️` comment blocks, which currently say this must not ship. Leaving a comment
  saying "MUST NOT SHIP TO PRODUCTION" on a line that is in production is how the next reader
  concludes the file is broken.
- Keep the note that `/invisible` is the ONE funnel carrying this on purpose, and keep the list of
  the six that must not get it until Matthew has judged the sample.

Then cherry-pick onto `main` rather than merging `magnet` wholesale, the same way the offer work
was shipped on 2026-09-16: `magnet` may carry other unfinished things by then, so check
`git log --oneline origin/main..magnet` first and say what you are leaving behind.

---

## Which onboarding step this is, and it is two of them

**Step 18 of 41, `concierge_preview`**, "AI Concierge preview live, ready to demo on the call".
Phase: before the call. `auto_then_manual`, blocked by `hub_preview`. This is the step that CREATES
the `concierge_configs` row and seeds `allowed_origins`, which is why SRT already has one.

**Step 36 of 41, `concierge_live`**, "AI Concierge enabled: audience confirmed, booking destination
set, consent copy approved". Phase: after the call. `manual`, blocked by `subdomain_live` and
`call_held`. **This is the step that flips `enabled` and the one this work is really about.** Its
three named conditions are exactly blockers 2, 3 and 4 above.

`/invisible` is SRT's own marketing site running SRT's own tenant, so it walks the same two steps
any client does. That is the point of dogfooding it, and it means anything you learn here is a
finding about the client path too.

---

## Verification

```
bun run build
bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts
bunx tsx --env-file=.env.local scripts/_probe-step-verify.ts 4cc5c683-8feb-4f17-8ff5-28d6cc50887a
```

Probes without `--env-file=.env.local` return nothing at all. Not an error. Nothing.

Then, on the real page:

- `curl -s https://srtagency.com/invisible | grep -c x-vercel` returns **0**. If it returns
  anything, stop and rotate the token again.
- The pill opens, speaks the owner lane, and offers a real next step rather than a dead magnet.
- The other six funnels (`/PDF`, `/aivisibility`, `/trtquiz`, `/trtquiz2`, `/autopsystart`,
  `/audit`) are untouched.

## Invariants

- No em dashes anywhere client facing. Paste full SQL in a fenced sql block, never a file path.
- A green tick over unchecked work is the worst bug this design can have.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- A card body over 3,000 characters fails the whole message. Everything goes through
  `bodySections()`.
- Ask before deleting production data.
