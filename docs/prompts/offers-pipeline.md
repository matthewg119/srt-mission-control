# Offers pipeline: one page per offer, sub-pages beneath, a magnet on each

A build prompt for a fresh session. Everything below was measured against the repo on 2026-09-07,
not remembered. Line numbers are where they were then; if one is off by a few, the symbol name is
still right.

## Goal

On the onboarding call the first thing captured is what the client actually sells. Every offer then
gets its own page, keyword-derived sub-pages beneath it, and a lead magnet per page whose job is to
book an appointment.

## Repo

`Mission control 2.0/srt-mission-control`. Work in your own git worktree: the tree is shared and
other sessions switch branches under you. Run `git branch --show-current` before every commit. Read
`docs/lanes/CONTRACT.md` first, all of it.

---

## Do not rebuild these. They work.

**The magnet lane, end to end.** `src/lib/concierge/magnet-drafts.ts` drafts five candidates
(`MIN_CANDIDATES`, `:37`) from `loadNumberedEvidence` (`:330`) plus the avatar (`:347-360`), through
one shared body `draftInto()` (`:445`). `approveMagnetCandidate` (`:710`) holds the **only** insert
into `lead_magnets` anywhere in `src/` (`:807`). Do not add a second one.

**Client-scoped drafting.** `draftMagnetsForClient(clientId, sections)` (`:434-441`) passes a null
`page_id`. `docs/2026-09-04-client-magnets.sql:21` dropped the NOT NULL, and `rungOf()` scores a
client row at 8, above every library rung, so ONE approved client magnet is offered on every page
that client ever gets.

**The booking path.** `src/lib/concierge/tools.ts` and `engine.ts`: `offer_magnet` then
`offer_booking`, real Calendly slots through `src/lib/calendly.ts`, tracked at
`/api/concierge/booked`. The owner lane already books.

**The candidate backlog.** `question_bank` is global by vertical
(`docs/2026-08-19-harvest.sql:66-90`, **no `client_id`**) and `page_candidates` is per client, with
`themeOf()` clustering and `deriveIdeas()`.

**The evidence library.** `page_sources` rows with `page_id IS NULL` are read by every later page
for that client. This is the cheapest on-ramp for offers and the reason a new table may not be
needed at all.

---

## The four structural problems, which are the actual work

### 1. There is no offer entity, and the singular is deliberate

`clients.services` is a jsonb bag whose `services_list` is free text
(`src/config/client-intake.ts:118`, "Everything you offer, in your own words"). Then
`src/lib/clients/question-sets.ts:252` calls `firstLine()` on it (`:211-213`, splits on `\n` or `;`
and takes `[0]`), throwing away every line but the first. It is the middle link of the
`treatmentPrimary` chain at `:250-254`.

The comment that explains why is at `src/config/client-intake.ts:130-131`, and it governs
`primary_treatment`, not `services_list`: a paragraph there "would come back as a menu again, and a
menu cannot be interpolated into a sentence." Everything downstream interpolates ONE string.
Introducing offers means confronting that singular, not routing around it.

### 2. `lead_magnets.treatment` is the per-offer axis, and it is currently dead

Real column (`docs/2026-09-01-concierge.sql:44`), in two partial indexes (`:78-79` and
`docs/2026-09-03-concierge-audience.sql:114-115`), scored by `rungOf()` at weight 2
(`src/lib/concierge/magnets.ts:138`).

All **six** query sites pass `treatment: null`: `concierge/engine.ts:424` and `:442`,
`concierge/for-client.ts:105`, `concierge/magnets.ts:325`, `api/concierge/config/route.ts:67`,
`api/concierge/start/route.ts:127`. The mint at `magnet-drafts.ts:816` writes null too.

Because `axis()` returns false for a named row against a null query (`magnets.ts:133`), library rows
that name a treatment are currently **unreachable**, not merely unused.

Wiring offers to that axis lights up the ladder, the `[treatment]` substitution in the
page-candidate chain, and the drafter's evidence block without rewriting any of them. **This is the
highest-leverage hook in the codebase for this feature.** Start here.

### 3. Pages are flat, and the flatness is enforced in three separate places

- `client_pages` has no `parent_id`, `cluster` or `topic` (`docs/2026-08-18-client-hub.sql:63-85`;
  later additions are `evidence_map` and `lead_magnet_key` only). It is unique on
  `(client_id, lower(slug))` (`:98-99`), and `savePage` names that 23505 by hand
  (`src/lib/hub/pages.ts:242-244`).
- `pageSlug()` (`src/lib/hub/pages.ts:122-131`) collapses every non-alphanumeric to a hyphen, so a
  slash cannot survive it.
- `HUB_SLUG` (`src/middleware.ts:54`) forbids a slash, a dot and any encoded traversal, and the
  route is `src/app/hub/[host]/[slug]/page.tsx`, a single dynamic segment, not a catch-all.

Sub-pages therefore need an explicit decision about URL shape, and widening `HUB_SLUG` is a security
decision about hostnames a client's registrar controls, not a formatting one.

Note the contrast: `client_replica_pages.path` keeps slashes and its own comment
(`docs/2026-09-04-site-replica.sql:26-30`) says that is legal **only because that table is never
served on a client host**.

### 4. There is no keyword research

No volume API touches the client lane. Scores come from a deterministic hand-written formula plus a
human pasting a `KEYWORDS` block into Slack. `src/lib/scraper/dataforseo.ts` exists but belongs to
the lead-prospecting scraper and is billed per task.

Decide honestly whether to wire it in, and say so plainly if the answer is that the existing harvest
is better because it uses the market's own wording rather than a keyword tool's.

---

## Where offers should be captured

On the call, which is step 22 `call_held`, and before the page work at step 30.

The cheapest correct path is `recordSource({ pageId: null, ... })` per offer, which files each one as
a client-library evidence row that every later page and every magnet draft already reads. A new
`EVIDENCE_TOPIC` with `scope: "client"` makes the page studio ask for it.

Decide whether a real `client_offers` table earns its place on top of that, and justify it in the
migration header rather than in a commit message.

## Close the magnet gap

Magnets draft from **four** places today:

| Where | Call site |
|---|---|
| The `site_replica` step, client-scoped | `src/lib/clients/site-replica.ts:368` |
| A page claimed in the Slack page studio | `src/lib/clients/page-studio.ts:432` |
| `magnet more` in that thread | `src/lib/clients/page-studio.ts:845` |
| The board's `page_magnets_draft` action | `src/app/api/clients/[id]/hub/route.ts:187` |

They do **not** draft on the dashboard `savePage` path (`src/lib/hub/pages.ts:184-253`). The
`page_save` action at `route.ts:220-226` can only *mint* an already-approved candidate through
`resolveMagnetChoice`; it never drafts. And `route.ts:181-185` explicitly refuses to draft for a page
that has not been saved yet.

So a page created from the board form is a two-step manual dance, and "a magnet for every page" is
not true today. Closing that is part of this build.

---

## Invariants. Do not loosen any of these.

- `skin.ts` is CSS custom properties only. The markup is not themable.
- `draft-page.ts`'s link ban is enforced in code, not just asked for in the prompt.
- The publish gate, and `setPublished` having exactly one caller. `page-gate.ts` carries a
  hole-check saying `grep -rn "setPublished" src/` must return one result.
- The Day 0 wall: `page_publish` refuses while `clients.day_0_archived_at` is null, and the check
  goes BEFORE `setPublished`.
- `copy-guard`'s dash ban. A `---` markdown rule is not a dash; that is handled in
  `draft-replica.ts` with `withoutRules()` and it cost four pages of a live replica to learn. The
  ten cases proving the exemption did not become a hole are in `scripts/_probe-page-gate.ts:195-222`.
- `STEP_VERIFIERS` is `Record<StepKey, Verifier>` and must stay exhaustive, so a new step forces a
  verifier or the build fails.
- **A step must appear LATER in `DELIVERY_STEPS` than everything it names in `blockedBy`.**
  `scripts/_probe-step-verify.ts:80-89` asserts it. Violating it empties `reachableCursor` and
  silently stops the whole board from that point down, for every client.
- A green tick over unchecked work is the worst bug this design can have. `verified_source` is
  `system` or `thread` and there is no third value and no override.
- No em dashes anywhere. Paste every migration as a fenced sql block in chat, never a file path.

## Verification

```
bun run build
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-step-verify.ts
bunx tsx --env-file=.env.local scripts/_probe-magnet-drafts.ts
bunx tsx --env-file=.env.local scripts/_probe-concierge-lane.ts
bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts
```

Without `--env-file=.env.local` the probes return nothing at all. Not an error. Nothing.

Then prove it on a real client resolved **by slug**: offers captured on the call, one page per offer,
sub-pages generated beneath each, a magnet on every one of them, and a booking click recorded against
a concierge session.
