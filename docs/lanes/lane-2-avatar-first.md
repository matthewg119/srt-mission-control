# LANE 2 — Avatar first

**Read `docs/lanes/CONTRACT.md` first.** Three other sessions are working in this same
checkout right now. Stay inside your file list.

Migration file: `docs/2026-08-25-lane-2-avatar.sql`.
Write-up when done: `docs/lanes/RESULT-lane-2.md`. **Do not touch `CLAUDE.md`.**

---

## What is wrong, and it is bigger than the ordering

`clients.primary_avatar` has a CHECK constraint, a column, a verifier that reads it, and
**no writer anywhere in this codebase.** `grep -rn "primary_avatar" src/` returns two readers
and zero writes. Step 11's card says *"The proposal is on the board"* and **there is no such
panel.** On the live client, `avatar_confirmed` came out `skipped`, because no human being
could have ticked it. `page-candidates.ts` carries a comment asserting the column "DOES NOT
EXIST", which is how long this has been dead.

And it is in the wrong place. Matthew: *"for step 9 I believe is important that first we
select the avatar that we want to attract customers to, depending for a med spa for example
it can be laser hair removal, filler, hifu, BBL, whatever the case might be, always give me
the 3 default options and if I want a new option allow me to type it in there to create a new
one, or if this step is already done allow me to come back and run it once again but with a
new avatar and make sure we save the data for each avatar, this way if another client has the
same LHR client, we can use the same prompt saved in the databse and make it optional to run
deep research again."*

And: *"i see avatar is proposed in step 11 but this should be before step 9 for the actual
deep research for the avatar that we actually want."*

---

## 2A. Reorder

In `src/config/delivery-steps.ts`:

- Move `avatar_confirmed` to sit immediately **after** `competitor_shortlist`, with
  `blockedBy: ["baseline_scan"]`.
- `avatar_harvest` gains `avatar_confirmed` to its `blockedBy` list.
- `custom_question_set` and `page_candidates` already block on `avatar_confirmed`. Unchanged.

**Keys do not change. Labels and array position do.** That file says it twice and it is
right: renaming a key orphans every row already carrying it; labels are free. The ARRAY owns
the numbering, so moving an element renumbers the board and nothing else.

Two things to check rather than assume:

- **Phase contiguity.** All three steps are in `PHASE_BEFORE`, so it holds. The test asserts
  it, and `delivery-checklist-form.tsx` groups with a running-string sentinel, not a
  `groupBy`, so a phase that reappeared would render its header twice.
- **`reachableCursor`.** Read its doc block in `step-engine.ts` before touching anything near
  it. It is the single answer to what may appear and all three schedulers gate on it. You are
  changing the walk order, so re-run `_probe-cascade.ts` against a throwaway channel you
  create (`PROBE_SCRATCH_CHANNEL=<id>`) and confirm exactly one waiting step at a time still
  holds.

---

## 2B. Make the avatar writable, with three defaults and a typed one

- New `POST /api/clients/[id]/avatar` writing `primary_avatar`, `primary_avatar_label`,
  `primary_avatar_confirmed_at`, `primary_avatar_confirmed_by`. `auth()` in the route, like
  every other `/api/clients/*` route.

> **The CHECK constraint allows only `a1` / `a2` / `a3`, and that is fine, not a limitation.**
> The SLOT is a1/a2/a3. The LABEL is free text. "Type a new one" means it occupies a slot
> under his own label. No constraint change and no column migration is needed for this.

- The three candidates come from `niche_briefs.avatars`, keyed on `niche_key`. Step 11's card
  already states the caveat and **must keep stating it**: they are cached per NICHE, not per
  business, *"so every med spa audited this month has the same three."* They are candidates,
  never a default, and rejecting all three is an available answer.
- New `src/components/clients/avatar-form.tsx`, panel `id="avatar"`, placed **above** the
  existing `id="review-handover"` block in `src/app/dashboard/clients/[id]/page.tsx`.
- Slack: the card gets three buttons (`action_id: avatar_pick`) plus a line saying to reply
  `avatar: laser hair removal` in the thread for one of his own.
- Fix the stale comment in `page-candidates.ts`... **no. That file belongs to LANE 4.** Note
  it in `RESULT-lane-2.md` for the merge session instead.

---

## 2C. Per-avatar research, reusable across clients

This is the half he asked for by name: *"this way if another client has the same LHR client,
we can use the same prompt saved in the databse."*

Your migration:

```sql
create table if not exists public.avatar_briefs (
  vertical         text not null,
  avatar_slug      text not null,
  avatar_label     text not null,
  prompt_text      text,
  research_text    text,
  research_doc_id  uuid,
  first_client_id  uuid,
  times_reused     int  not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (vertical, avatar_slug)
);

alter table public.clients
  add column if not exists primary_avatar_slug text;

create table if not exists public.client_avatar_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null,
  slot          text not null,
  avatar_slug   text not null,
  avatar_label  text not null,
  confirmed_at  timestamptz not null default now(),
  confirmed_by  text,
  superseded_at timestamptz
);
```

Plus the `question_bank` key change:

> **`question_bank`'s unique key moves from `(vertical, normalized)` to
> `(vertical, avatar, normalized)` declared `NULLS NOT DISTINCT`.**
>
> `NULLS NOT DISTINCT` is load-bearing and is **not optional**, for exactly the reason
> `docs/2026-08-24-step-board-fixes.sql` records for `nap_discrepancies`: every existing row
> carries a NULL `avatar`, nulls compare distinct by default, so a plain unique index on
> those three columns would constrain none of them and every re-run would insert duplicates.
> It is also what makes the key inferrable from a bare column list, which PostgREST's
> `on_conflict` parameter requires because it takes column NAMES only.
>
> Then update the `onConflict` strings in `harvest.ts` and `research-intake.ts` to match. A
> target that does not match an index is 42P10 at PLAN time, not a data collision, so it
> fails on every single run. That has happened twice in this table's history.

- `harvest.ts` and `research-intake.ts` now write `avatar = <the confirmed slug>` instead of
  NULL. **Both files carry a comment saying the avatar stays NULL until step 11 confirms
  one.** Those comments were correct when step 11 came after step 9. **Rewrite them,** do not
  leave them contradicting the code.
- Step 9's runner checks `avatar_briefs` for `(vertical, avatar_slug)` first. A hit posts:
  *"This avatar already has research from {date}, reused by N clients."* with **[Reuse it]**
  and **[Run it again]** (`avatar_reuse_research`, `avatar_rerun_research`). Reuse copies the
  phrases into `question_bank` under this avatar and increments `times_reused`; run-again
  regenerates the prompt and waits for a paste.

---

## 2D. The brief becomes his three-message ChatGPT framework

Rewrite `buildDeepResearchBrief` in
`src/lib/clients/artifacts/deep-research-brief.ts`.

> **THE BRIEF IS WRITTEN, NOT GENERATED, AND THAT STAYS TRUE.** That file's own header says
> why: *"A model asked to write a research brief writes a different one every run, which
> makes two clients' phrase sets incomparable and makes a regression in the template
> invisible."* `test-onboarding-artifacts.ts` asserts
> `buildDeepResearchBrief(x) === buildDeepResearchBrief(x)` byte for byte, and that assertion
> is the whole reason it is a function and not a prompt. Keep it passing.

The output becomes three paste-ready blocks, in his wording, in Spanish, with the slots
filled from the record:

**Message 1.** *"Eres mi redactor experto y te especializas en escribir textos altamente
persuasivos de estilo de respuesta directa para mi marca..."* The slot
`[EXPLICA QUÉ ESTÁS VENDIENDO Y A QUIÉN]` is filled from the confirmed avatar, the vertical,
the city and the client's services. Followed by the instruction to attach the client's own
audit report PDF as the sales page.

**Message 2.** *"Te voy a enviar dos documentos que enseñan cómo hacer una investigación
profunda sobre tu producto..."* followed by the two documents.

> **The two documents are embedded as TEXT, not shipped as file attachments.** They are in
> the repo at `docs/lanes/research-method-parte-1.md` and `research-method-parte-2.md`. A
> file dependency would break the determinism assertion above and put two PDFs somewhere they
> can rot; the method is what teaches the model, and the method is words. If he wants the
> original PDFs alongside, he drops them in the thread by hand.
>
> Import them as string constants in a new `src/config/research-method.ts` rather than
> reading from disk at runtime: a file read in a Vercel lambda is a deployment concern, and a
> constant is what the determinism test can hold still.

**Message 3.** *"Genial, ahora que entiendes correctamente cómo hacer investigación, quiero
que crees un prompt completo para la nueva herramienta de OpenAI llamada deep research para
que realice esta investigación para [PRODUCTO]. Por favor, sé lo más específico posible aquí
para obtener la mejor calidad de investigación. Incluye también que quieres que deep research
compile toda la investigación encontrada."*

`[PRODUCTO]` is the **confirmed avatar**, which is the whole reason this lane exists.
Followed by the measured context the current brief already assembles and which must survive
the rewrite:

- **Seed sites** from `audit_runs.citations` on this client's own run, matched on
  `client_id` FIRST. That file's header explains why `contact_id` and `domain` are fallbacks
  and not equivalents: both can match a `prospect_audit`.
- **Businesses the engines named instead of this one.**
- **The owner's own words** for objections, ideal customer, who they do not want and what
  they already tried, quoted **exactly as typed, typos kept.** The header is emphatic and the
  test checks for the typo on purpose: *"an owner writing 'im scared itll look fake' has told
  you the register their buyers think in, and tidying it into 'concerns about unnatural
  results' throws that away."*

No em dashes anywhere in it.

Store the rendered message 3 on `avatar_briefs.prompt_text` so the next client in that
vertical with that avatar gets it back.

---

## 2E. [Done] wants the research back, and stays skippable

Matthew: *"If I click done I should paste back the PDF that It gave me for the deep research,
not just allow me to skip it since we need this phrases for the in depth ai visibility audit
(day 0 official run) with more strategic questions, but leave it skippable since we already
have the main 20 but if client doesnt like them we can re run them."*

- Add an `avatar_harvest` case to `stepPrecondition` in `step-engine.ts`. It refuses unless
  either a `deep_research`-sourced phrase set exists for this `(vertical, avatar_slug)`, or a
  document is filed against step 9's thread.
- **The [Skip] button is untouched.** The refusal says what skipping costs: the universal
  twenty still run so the Day-0 measurement is intact, but the tracked set will not carry
  this avatar's own wording.
- A PDF dropped into step 9's thread is text-extracted and run through the existing
  `ingestResearch`. Use `unpdf`, as `src/lib/deck/extract.ts` already does.

  > **No model runs in the extraction, and that is not an optimization.** `extract.ts` says
  > it: a model asked to transcribe a PDF tidies punctuation, drops a stray line and fixes
  > what it reads as a typo. Here that would destroy the exact thing this step is collecting.

- `ingestResearch`'s `research:` prefix trigger stays. Its header explains why sniffing is
  not acceptable: *"once a phrase is in question_bank it can end up in the custom tracked set,
  which is frozen at Day 0 and defines what the case study measures."* A PDF upload is an
  explicit act in the same way the prefix is, so it qualifies.

---

## 2F. Step 23 can change the avatar, before the stamp and never after

Matthew: *"So avatar can be changed in the call so make sure we ask follow up question
regarding the avatar and the questions we want to run in the AI for day 0 scan but leave the
first ai visibility thing there just in case and allow us to do this in the thread from step
23."*

- `day_zero_archive`'s card prints the confirmed avatar and the question set the scan will
  run, and accepts `avatar: X` and `questions:` replies in its own thread.
- Changing it writes a new `client_avatar_runs` row, supersedes the old one, and regenerates
  the custom question set as a new version.
- **After `day_0_archived_at` is stamped, it refuses.** The frozen set is the baseline the
  day 30, 60 and 90 numbers are measured against, and once a page is live that baseline
  cannot be recovered by being careful afterwards. This is the one hard rail in the repo;
  read `src/lib/clients/day-zero.ts` before going near it, and **do not import
  `delivery-checklist.ts` from it** (the dependency runs one way and reversing it leaves a
  module half-initialised).
- The existing universal-20 path stays in place underneath, exactly as he asked.

---

## Your file list

**Owned outright:** `src/config/delivery-steps.ts`, `src/lib/clients/harvest.ts`,
`src/lib/clients/research-intake.ts`,
`src/lib/clients/artifacts/deep-research-brief.ts`, plus new
`src/config/research-method.ts`, `src/lib/clients/avatars.ts`,
`src/app/api/clients/[id]/avatar/route.ts`,
`src/components/clients/avatar-form.tsx`.

**Shared, your arms only:**
- `step-engine.ts`: cases `avatar_confirmed`, `avatar_harvest`, `day_zero_archive`, plus a
  new `avatar_harvest` branch in `stepPrecondition`.
- `step-verify.ts`: verifier `avatar_confirmed`.
- `slack/actions/route.ts`: new `avatar_pick`, `avatar_reuse_research`,
  `avatar_rerun_research`.
- `page.tsx`: one panel, `id="avatar"`, above `review-handover`.

**Not yours:** `page-candidates.ts` and `custom-question-set.ts` are LANE 4 and LANE 3. If
their behaviour needs to change because the avatar is now real, write it down in
`RESULT-lane-2.md` rather than editing them.

---

## Done means

`avatar_confirmed` is tickable by a human being for the first time since the column was
created, and the live client can be walked from a `skipped` step 11 to a confirmed avatar
with a brief that reads like the framework he wrote.
