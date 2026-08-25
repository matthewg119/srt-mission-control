# LANE 4 RESULT — writing and publishing the pages

Built 2026-08-25. `bun run build` clean. `bun scripts/test-onboarding-artifacts.ts` 340 checks,
2 failing and **neither is mine** (`twelve extended platforms` / `eighteen in total` — lane 1 is
adding a 19th to `config/presence-platforms.ts`, which they own). Both step-verify probes pass,
live one included.

---

## The two questions, answered in the cards rather than in a conversation

**Step 12 is the MEASUREMENT set. Step 13 is the PUBLISHING backlog. Same corpus, opposite jobs.**
Step 12 is 40 or 60 questions approved on the call and frozen at Day 0, and the day 30/60/90
numbers are scored against exactly those; nothing is ever published from it. Step 13 is the same
phrases scored for which are worth writing a page about. That sentence is now on the step 12 card,
the step 13 card, the `first_page` card, the step 13 Slack note and the page-studio menu.

**There is no watermark in Claude's text output and Google does not read one.** SynthID is image,
audio and video; there is no text watermark on Anthropic API output. What Google's policy
penalises is scaled, unhelpful, unedited content, which is a fact about the writing rather than
about who typed it. **No third party was added and none is needed** — the pages exist so an engine
answering a buyer's question has something on the client's own domain to cite, and
`learn.{clientdomain}` already publishes, is indexed, has a per-host `sitemap.xml` and `llms.txt`,
carries `QAPage` markup and sits behind the Day 0 wall. What this lane gives instead is a lane
where his own words go in verbatim and a model only touches them when he types `polish`.

---

## What shipped

### A. The page studio — `src/lib/clients/page-studio.ts` (new)

Channel `C09QPHZGPUY`, resolved as `SLACK_PAGE_STUDIO_CHANNEL || "C09QPHZGPUY"`. Env-first like
every other channel, with the literal as a documented fallback rather than the usual "unset means
off": this lane has one channel, its id is known, and an unset var would make the whole feature
silently absent with nothing on screen saying so.

| He types | It does |
|---|---|
| `page <name or slug>` | Resolves the client, posts the ranked `page_candidates` numbered, each marked `[drafted]`/`[published]`, derived ideas under their own heading |
| a bare digit | Claims it. Opens a `client_pages` row at `status:'draft'`, question verbatim, empty body |
| any text | Appended to `answer_md` verbatim |
| a voice note | `transcribeAudio()` from `voice-notes.ts`, then appended verbatim |
| `polish` | `draftPage()` with his body as the material. Posted as a suggestion, never written |
| `done` | Board link, thread released |
| `cancel` | Drops the session |

`slack/events/route.ts` got exactly one gate, immediately above the `isContentFullChannel` block,
and it is a call, not an implementation. One import at the end of the import block.

Decisions worth knowing:
- **Ambiguity asks.** Two client matches is the same answer as zero: it lists them and refuses to
  guess. Guessing opens a draft against the wrong client's hub, and the mistake only surfaces once
  a page is live on somebody's real domain.
- **A bare digit is a claim only while nothing is claimed.** Once a page is open, `3` is something
  he said about the page and goes in the body. Same doctrine as `thread-assistant.ts`.
- **The menu is frozen on the session row.** Re-deriving the order at digit time would let a
  re-run of step 13 change what `2` means between the card and the number.
- **Claiming resumes rather than duplicating.** An existing unpublished page for the same question
  is returned with everything already dictated into it.
- **One reply per message, not one per file**, and `slack.downloadFile` is wrapped because it is
  the one Slack helper that throws.

### B. The editor — `src/app/dashboard/clients/[id]/hub-form.tsx`

Markdown toolbar (bold, italic, H2, bullets, numbered, quote, link), live preview beside the box,
and — new — **Edit on every page row**. `savePage` has always accepted an `id` and the route has
always forwarded it; there was simply no control that could set one, so every saved page was
write-once and unreachable from the board.

- **The font note is in the panel, and says why.** Font style and size are a THEME decision.
  `react-markdown` runs without `rehype-raw` deliberately: a body served on the client's own domain
  under their name must not carry a pasted `<script>`. `theme.fontFamily` is the correct control
  and the note points at the Identity and theme panel directly above.
- **An em dash in the body raises a warning** (`hasBannedDash`). It does not block: `savePage` has
  never checked it, so one typed by hand publishes silently today.
- **The body is fetched on Edit, not shipped with the page.** `page.tsx` is untouched.
- **The Day 0 wall is untouched.** `grep -rn "setPublished" src/` still returns exactly one caller,
  `api/clients/[id]/hub/route.ts:188`, still behind `assertDay0Archived`. **That grep is now also a
  test** (see below).

### C. Tools, guides and comparisons — `page-candidates.ts`

- `themeOf()` gained `Tool` and `Guide`. Both are written narrowly and placed above `Price` but
  keyed so they cannot eat it: `how much does X cost` is still `Price`, and there is a test for it.
- A second pass proposes ideas that are not one-question-one-page: a cost estimator for the pricing
  cluster, a guide per cluster of questions sharing an opening stem, a comparison page per rival in
  `competitor_candidates`. Scored through the same `scoreCandidate`, capped at `DERIVED_CAP = 12`,
  **additional to the harvested cap and never inside it**.
- **Labelled derived everywhere**: `page_candidates.origin` + `derived_from`, its own PDF section
  saying out loud that nobody typed any of them, its own heading on the Slack menu.
- `currentlyNamed` is **always null** on a derived idea. No engine has ever been asked about a page
  that does not exist, so the visibility-gap bonus (the largest term) is not collected. That means
  a page we invented cannot out-rank a client's measured gap by being a guess. Tested.
- Both existing disclosures kept: the printed formula and "nothing is tuned against results".

### D. The cards

`instructionsFor` gained `custom_question_set` and `page_candidates`, and `first_page` was extended
with the same distinction plus the studio route. **See the defect below** — those two cases are
dead on the normal path and are marked as such in the code.

---

## The SQL — `docs/2026-08-25-lane-4-pages.sql`

```sql
create table if not exists public.page_studio_sessions (
  thread_ts   text        primary key,
  client_id   uuid        not null references public.clients(id) on delete cascade,
  page_id     uuid        references public.client_pages(id) on delete set null,
  candidates  jsonb       not null default '[]'::jsonb,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists page_studio_sessions_client_idx
  on public.page_studio_sessions (client_id, updated_at desc);

alter table public.page_studio_sessions enable row level security;

alter table public.page_candidates
  add column if not exists origin text not null default 'harvested';

alter table public.page_candidates
  add column if not exists derived_from text;

alter table public.page_candidates drop constraint if exists page_candidates_origin_check;
alter table public.page_candidates add constraint page_candidates_origin_check
  check (origin in ('harvested', 'derived'));
```

**Two departures from the SQL in the brief, both forced.** `page_id` is NULLABLE, because the card
is posted before anything is claimed and a NOT NULL column makes the first step of the lane
impossible. `candidates jsonb` freezes the numbered menu, for the reason above and because derived
ideas have no `page_candidates` row until somebody claims one.

Nothing touches `client_pages`. `answer_md` is `not null` with no CHECK, so `''` already satisfies
it, which is what lets a claimed question open an empty draft.

---

## ‼️ THE DEFECT THIS TURNED UP: STEPS 12 AND 13 POST NO CARD AT ALL

`custom_question_set` and `page_candidates` are both `mode: "auto"`. `postReadySteps` skips auto
steps at `step-engine.ts:1342`, so `postStep` is never called for them and `instructionsFor` is
never reached. They do not "post a label and three buttons" as the brief assumed — **they post
nothing**. The only thing that reaches Slack for either is the runner's `note` through
`notifyStep`. This is the same dead-card class CLAUDE.md records for `first_page` before
2026-08-25.

Matthew's instruction was explicitly not to restructure them: *"i like how they currently look …
dont change anything crazy i like getting that PDF but i want to take it a step further to actually
create the pages as drafts."* So:

- Both cases were added anyway, short, and **carry a comment saying they are dead on the normal
  path** and why they are there (correct the day a mode changes; live today only through
  `_debug-post-all-steps.ts`).
- **The line that actually fires went into step 13's runner note** in `page-candidates.ts`, which
  is mine. It states the 12-vs-13 distinction and tells him to post `page <client>` in the page
  channel to turn any candidate into a draft. That is the "step further" he asked for.

**OWED:** step 12's equivalent belongs in `generateCustomQuestionSet`'s note in
`src/lib/clients/artifacts/custom-question-set.ts`. That file is in **no lane's ownership table**,
including mine, so it was not edited. One added line to its returned `note` closes it.

---

## Everything else owed or worth knowing

- **`page-candidates.ts` still asserts `clients.primary_avatar` DOES NOT EXIST**, in the doc block
  above `themeOf`. **Lane 2 is making that wrong as this is written** — the column, its CHECK and
  its verifier all exist and they are building the writer. Left alone as the brief instructed. The
  merge session reconciles theme-vs-avatar grouping once both halves exist; the grouping code is
  already keyed on `theme`, so switching it is a change to one `byTheme` map.
- **Approve was dropped**, on Matthew's call. There is no approve state in `client_pages` — `status`
  CHECK is draft/published/archived and there is no `approved_at`. Adding one means either a
  migration on the CHECK or two new columns, and making Publish depend on it would put a **second
  hard rail** into a codebase whose stated doctrine is that Day 0 is the one place it blocks. So
  `page_approve` was **not built**, despite being named in the contract. `page_publish_request` was.
- **`page_publish_request` does not publish, and must not be changed to.** It reads the Day 0 state
  and answers — open, or not and here is what to tick — then links the board. `setPublished` having
  exactly one caller is what makes the grep a real hole check; a Slack publisher would be a second
  place to get the before/after ordering wrong, on a surface with no session behind it. Both this
  and the two new `pages.ts` writers are documented in `day-zero.ts`'s `NOT_GATED` list.
- **A test found a hole check that failed OPEN.** The obvious comment-stripper (block comments,
  then line comments) latches onto the `/*` inside `"/dashboard/*"` in the hub route's auth header
  and eats everything to the next `*/` — including `await setPublished(...)`. My first version of
  the Day-0 test therefore reported **zero** callers, i.e. safer than reality. Line comments are
  stripped first now, with the reason written above it. **Lane 3's `stripComments` at the end of
  the same file has the identical shape** and is only safe because its three target files happen
  not to contain `/*` in a line comment. Worth the merge session's attention.
- **`/dashboard/clients/[id]` first-load JS went from ~130 kB to 156 kB**, from `react-markdown` +
  `remark-gfm` in the preview pane. It is an internal ops page behind auth. The alternative was
  importing `hub-bodies.tsx`, which is a server component and cannot be imported into a
  `"use client"` file. The preview is therefore a **second `react-markdown` call site** beside it;
  the one thing that may never drift between them is the absence of `rehype-raw`, and there is now
  a test asserting neither file imports it or passes `rehypePlugins`.
- **`draftPage` gained an optional `existingBody`.** Without it, unchanged — the board's `Draft it`
  button is untouched. With it, the prompt tidies HIS draft and is forbidden from adding a fact,
  number, service, price or claim not already in it. The existing validator (120+ words, no H1, no
  links, no em dash) is untouched.
- **The contract lists `src/components/clients/hub-form.tsx`.** The real path is
  `src/app/dashboard/clients/[id]/hub-form.tsx`. Same file; the brief's paths are aspirational for
  several lanes.
- **`applySubstitutions` / `substitutionsFor` did not move** under lane 3's work. `page-candidates.ts`
  calls both and the build is clean. Nothing was edited in `question-sets.ts`.
- **`themeOf` is now exported** (it was module-private) so the test can reach it. No behaviour change.
- **`step-verify.ts` needed no change.** My named arm, `first_page` (`step-verify.ts:905`), already
  counts published pages, already refuses with `not_yet`, and already names the Day-0 wall as the
  expected reason. Inspected and left alone rather than silently skipped. The live probe reads
  `first_page  not_yet  no pages written yet`, which is correct.

## Before this works in production

1. Run the SQL above.
2. Invite the bot to `C09QPHZGPUY`. Optionally set `SLACK_PAGE_STUDIO_CHANNEL` in Vercel; the code
   falls back to that id.
3. `OPENAI_API_KEY` must be set for voice notes — `transcribeAudio` is whisper-1 and returns
   `{ok:false, error:"OPENAI_API_KEY is not set"}` rather than throwing, and the thread says so.

## Files

**New:** `src/lib/clients/page-studio.ts`, `docs/2026-08-25-lane-4-pages.sql`, this file.

**Owned, changed:** `src/lib/hub/pages.ts` (+`startPageDraft`, +`appendPageBody`),
`src/lib/hub/draft-page.ts` (optional existing-body mode),
`src/lib/clients/artifacts/page-candidates.ts`, `src/app/dashboard/clients/[id]/hub-form.tsx`.

**Shared, my arms only:** `step-engine.ts` (two new cases, `first_page` extended, one import at the
end of the import block; switch not reordered, nothing reformatted, no import removed),
`slack/events/route.ts` (one gate above `isContentFullChannel`, one import),
`slack/actions/route.ts` (one case appended before `default:`, one handler; no existing arm
edited), `day-zero.ts` (`NOT_GATED` documentation only), `test-onboarding-artifacts.ts` (appended
under `// ---- LANE 4 ----`, above the summary).
