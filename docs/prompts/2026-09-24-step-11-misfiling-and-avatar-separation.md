# Step 11 ate four documents, and one offer needs more than one avatar

Fifth prompt. Read `2026-09-22-send-tracking-datasets-and-the-signing-gate.md` first for the
branch map and the two-track order. This one is the delivery track, and it starts with a live
data problem rather than a build.

## Where the work is

`feat/w0-research-values`, pushed, based on `origin/main`. A peer session commits to it too, so
rebase and re-read before editing. Shipped there this session: W0 + W2b, the letter quote-fault
fix, and letter-command file attachments.

---

## 1. ‼️ FOUR DOCUMENTS WENT IN AND NOTHING WAS STORED. Fix this before anything else.

Matthew dropped four files in step 11's thread on 2026-09-22: an avatar sheet, a short offer
summary, a research PDF and a belief chain PDF. Every one replied ":books: Research filed."

**Measured in production afterwards:**

| Check | Result |
|---|---|
| `audience_documents` for srt-agency-llc | `sales_letter` (09-22), `awareness_ladder` (09-16), `deep_research` (09-15). **Nothing from 09-22's four files.** |
| `avatar_sheet` / `short_offer` / `necessary_beliefs` rows | **none, for any client** |
| `question_bank` where vertical/avatar = med spa owner | `deep_research` **321 rows, newest 09-22 14:18** |
| `question_bank.client_id` | **the column does not exist** |

So: three of the four files were shredded into phrases and written into a corpus **every client
targeting `med-spa-owner` reads**, with nothing recording which client they came from. The fourth,
`AI referral engine research.pdf`, answered "that file has no text in it", which is an image-only
PDF and a correct refusal.

**The completeness card is right and the reply was wrong.** It still says Avatar 11/43, Offer
6/23, and lists the avatar sheet, short offer and beliefs as missing, because they are.

### Why it happened

`storeFrameworkFile` routes a file by the prefix typed with it **or by the file's own first
line** (`framework-thread.ts:419-421`). His files begin with a title (`# AI Referral Engine Avatar
Sheet`), not with `avatar sheet:`. No prefix matched, so every file fell through to
`ingestResearchFile`, which prepends `research:` itself
(`research-intake.ts:798`) and files phrases.

`ingestResearch` then refused to store the DOCUMENT, correctly: a full answer needs
`FULL_RESEARCH_MIN_SECTIONS = 4` numbered sections and an avatar sheet has none. **But the phrase
extraction had already run and already written.** That ordering is the bug: the document was
judged not to be research after its contents were filed as research.

### What to build

1. **Route a file by its filename when its first line does not carry a prefix.**
   `AI_Referral_Engine_Avatar_Sheet.md` names itself. Match on the filename against the same three
   kinds, case and separator insensitive. ‼️ Filename is a WEAKER signal than a typed prefix or a
   first line, so it must lose to both, and it must never reach `research:` by that route: a file
   called `research.pdf` is already handled by the fall-through.

2. ‼️ **REFUSE BEFORE WRITING, NOT AFTER.** `ingestResearch` writes phrases and then decides the
   paste was not research. Move the `FULL_RESEARCH_MIN_SECTIONS` test above the phrase write, so a
   document that is not research contributes nothing to the shared bank. This is the single most
   important fix in this prompt, because `question_bank` has no `client_id` and a wrong write
   there cannot be unpicked.

3. **Say what was recognised.** The reply should name the kind it filed the file as and say which
   kinds exist, so a misfiling is visible in the thread rather than three cards later.

4. **Clean up the 09-22 rows.** 321 `deep_research` phrases are under that avatar and some
   fraction arrived today from documents that are not research. They cannot be attributed to a
   client, so they cannot be selectively removed by client. They CAN be removed by
   `created_at` window plus `source = 'deep_research'`. ‼️ Read the count back before and after,
   and do not widen the window: the 09-15 rows are the real research paste.

---

## 2. One offer, several avatars, and nothing mixed

Matthew: *"one offer can have more than 1 avatar different ages etc. but I need to make sure all
of this is separated correctly."*

**What is already right.** `client_audiences` is per client per avatar and supports several, one
primary (`audiences.ts`). `client_field_values` (new, W0) carries `client_id` AND `audience_id`,
so a confirmed value belongs to one audience of one client and a wrong one is correctable.
`lead_magnets` has an `audience_id` column.

**What is not.** Three shared tables key on `(vertical, avatar_slug)` with no client:

- `question_bank` — no `client_id`, and three migration comments defend that. 321 rows under this
  avatar.
- `avatar_briefs` — `voc_quotes`, `approved_numbers`, `research_text`, `avatar_sheet`, shared by
  every client in the vertical.
- `niche_briefs` — per niche.

That sharing is deliberate and it is the feature: two med spas aiming at the same buyer should not
each pay for the same research. ‼️ **Do not add `client_id` to `question_bank` as the fix.** The
readers refuse rather than default precisely because it has none (`verticalFor`, `buildContext`,
`ingestResearch`), and adding one would make every one of those refusals look removable.

**The actual fix is that a different buyer is a different AVATAR SLUG.** "Med spa owner, 45 plus,
multi location" is not `med-spa-owner`; it is its own slug with its own bank. So:

1. **Make a second avatar reachable.** `confirmAvatar` writes `clients.primary_avatar_slug`, and
   `ensurePrimaryAudienceForAvatar` creates the audience. Confirm what happens on a SECOND avatar
   for the same client: `_probe-audience-seed.ts` already asserts the primary/option behaviour, so
   read it before assuming this is missing.
2. **Name the avatar in every reply that files something.** Today's replies said "med spa owner"
   only in the completeness card, not in the "Research filed" line. A phrase filed against the
   wrong avatar is unrecoverable, so the thread should say which one it used every time.
3. ‼️ **`lead_magnets.audience_id` is null on all 12 rows and `magnets.ts` never reads it.**
   `rungOf` scores on stance, client, vertical, treatment and category. Two avatars under one
   client therefore share one magnet pool. Add `audience_id` to `MagnetQuery` and to `rungOf` as
   the highest-weight axis below `clientId`. Detail in the 2026-09-22 prompt, §2.

---

## 3. The KEYWORDS block, and whether it can come out of a report

Matthew: *"is there any way that we can come up with a list of keywords from that report?"*

**Partly, and the part that is refused is the part that matters.** `extractKeywords` wants literal
rows: `phrase | volume | intent | source_url`. The reply's own words: *"Four pipes on every row,
unknown where there is no number, no link where there is no source."*

‼️ **A VOLUME WITHOUT A SOURCE IS PINNED TO 1 ON PURPOSE.** `research-intake.ts` records the
measurement: 306 research phrases on SRT's vertical, **0 with a source URL**, and nothing in the
thread ever said so. A model asked to produce keyword rows from prose will invent plausible
volumes, and a ranked keyword set built on invented volumes is worse than no keyword set.

**So build the narrow thing, not the wide one:**

- A `keywords` command that reads a stored research document and emits **phrase candidates only**,
  with `volume: unknown` and `source_url: null`, marked as candidates. That is honest and it is
  already most of what ranking needs.
- ‼️ Do not let it emit a volume. If a number is wanted, that is a DataForSEO `search_volume` call
  (`keyword-set.ts:9` notes $0.075 per task for up to 1,000 keywords, not wired), and it has to go
  behind the spend gate that is still schema-only.
- The card already tells him to re-ask for just the block. Keep that path: it is the one that
  returns real volumes with sources.

---

## 4. The question he asked, answered, and it should be on the card

Matthew: *"if I wouldn't have had the research documents, would I have had to run the prompt that
says the research pdf? or how do we work with the prompt."*

The step card already answers it and he still had to ask, which means the card is not saying it
where he is looking:

> *The deep research runs itself. It used to hand you three messages to paste into ChatGPT; it now
> researches the eight sections in parallel with web search and files the report here as a PDF.*

So: **no**. The research runs on its own and files a PDF. `prompt` hands back the single prompt it
ran if he wants to run it elsewhere. `research:` plus a paste still works, and so does dropping a
PDF in.

**But the four framework documents are a different thing and the card does not draw the line.**
Those are never generated here: message 4 (avatar sheet), message 5 (short offer) and message 7
(beliefs) of the framework script are filled by a person in claude.com and pasted back. The card
lists "Four documents, four messages" under "Do this now" without saying that one of the four
arrives by itself and three do not. Fix the copy so the two halves are visibly different.

‼️ And the framework script only posts once a sales letter is approved
(`framework-thread.ts:46-54`). He has no approved letter, so he has never seen messages 4, 5 or 7,
which is why he produced those documents by hand and why they did not match the parser. The letter
attachment fix shipped this session unblocks that: his `.md` now lands as `source: "pasted"`, whose
faults are warnings rather than blocks.

---

## Still owed from the approved plan

Sections 2, 3 and 4 of `2026-09-22-send-tracking-datasets-and-the-signing-gate.md`, unchanged:

- **§2 the emotional quotes prompt.** The new build. `dr-headline-engine.ts` and
  `client-headlines.ts` already turn quotes into 20 headlines; nothing builds the Reddit scrape
  prompt from a client's own data, and nothing writes pasted quotes into `avatar_briefs.voc_quotes`.
  Subreddits are the one input nothing holds: ask once per vertical, never let a model invent them.
- **§3 step 10 voice intake.** `voice-notes.ts` transcription is live; route an `offer_locked`
  voice note into `field-extraction.ts` with a first-party system prompt and `CLIENT_VOICE`
  evidence, not `EXTERNAL_RESEARCH`.
- **§4 the letter reads the research.** `draftLetterText` reads offer, intake and quotes, and not
  the research at all, which is why a draft with a thin bank invents buyer language.

## Order

1. §1.2 first, the write-before-refuse ordering. Every hour it is unfixed, another misfiled
   document can pollute a corpus that cannot be unpicked.
2. §1.1 and §1.3, filename routing and a reply that says what it recognised.
3. §1.4, the cleanup, with counts read back either side.
4. §4, the card copy, which is free and stops the next person asking the same question.
5. Then §2 of the 2026-09-22 prompt, the emotional quotes, which is the one that unlocks headlines.

Run `bun run`, never `bunx tsx`. Paste SQL, do not run it. No em dashes in anything that reaches a
model or a client.
