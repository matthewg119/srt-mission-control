# Four documents per avatar and offer, and no page written without them

A build prompt for a fresh session, written 2026-09-21 on `feat/north-star-2`, measured against
production the same day.

**Read first, in this order:**

1. `CLAUDE.md` and `docs/DATA-AND-WORKFLOWS.md`
2. `docs/prompts/2026-09-22-compliance-gate-context-database-and-learning.md`: **BUILT and DEPLOYED**
3. `docs/prompts/2026-09-23-twenty-pages-previews-and-offer-context.md`: **NOT BUILT.** Its **W0** is
   the other half of this prompt and the two must be built together. W0 extracts field values from a
   pasted research document; **this** prompt is what makes sure the right documents exist, for the
   right avatar, against the right offer, before anything is written.

---

## The ask, verbatim

Matthew, 2026-09-21, attaching four real documents for the AI Referral Engine offer:

> *"this are the files each avatar needs to have in order to have good context, every file needs to
> have this documents for us to have the good context ... So I believe we should ask for this
> documents to get all of those empty fields for each time we create a new strategy for a client so we
> understand the avatars and the offers and if an avatar is going to target a new offer it will need
> deep research for that specific offer, so make sure whenever we create posts by drafting in the
> onboarding or after we always select the avatar that we are building the traffic for and the offer,
> and if we dont have it we need to upload the documents."*

The four he attached, which are the real shape of the requirement:

| his document | what it contains |
|---|---|
| `AI referral engine research.pdf` | the deep research, with a SIN VERIFICAR list naming what it could not verify |
| `AI_Referral_Engine_Avatar_Sheet.md` | demographics, pains, fears, verbatim quotes, the emotional journey |
| `AI_Referral_Engine_Short_Offer_Summary.md` | big idea, metaphor, UMP, UMS, objections, belief chains, funnel |
| `AI_Referral_Engine_Belief_Chain.pdf` | the six beliefs in strict order, and what was deliberately left out |

Plus the prompt chain that produces them, which he pasted in full: research prompt, then avatar
sheet, then short offer, then the Agora transcript and the six-belief prompt.

---

## ‼️ ALL FOUR ALREADY EXIST AS DOCUMENT KINDS. Do not invent a second store.

`audience_documents` declares exactly six kinds, and four of them are his four:

```ts
export type DocumentKind =
  | "sales_letter" | "deep_research" | "avatar_sheet"
  | "short_offer" | "necessary_beliefs" | "awareness_ladder";
```

The table already has the discipline this needs: append-only, `superseded_at`, replacement only
through the atomic `supersede_audience_document()` RPC, `source` (`client_site` | `drafted` |
`pasted`), `source_url`, `status` (`draft` | `approved`), `faults`, and the rule *"a draft with
faults cannot be approved"*. The paste-back verbs exist (`research:`, `avatar sheet:`,
`short offer:`, `beliefs:`) and `promptsFromGaps` already hands back the templates.

**So this build is scoping and gating, not storage.**

---

## ‼️ The scoping split that already exists, and where Matthew's model disagrees with it

`kindBelongsToOffer()` returns true for `sales_letter`, `short_offer`, `necessary_beliefs` and
`awareness_ladder`. Those carry a non-null `offer_id`. **`deep_research` and `avatar_sheet` do not:
they are per AUDIENCE, with `offer_id` NULL.**

Matthew says: *"if an avatar is going to target a new offer it will need deep research for that
specific offer."* And his own attached research is titled *"Documento base para copy de 'AI Referral
Engine'"*, and his avatar sheet is headed *"AI Referral Engine · Target: US Med Spa Owners"*. Both
are offer-scoped in his workflow.

### ‼️ DO NOT JUST MOVE deep_research ONTO THE OFFER. Read this first.

The per-audience scoping is load-bearing: `afterResearchPaste` writes the client's own copy to
`audience_documents` AND, when the shared bank is empty, to `avatar_briefs.research_text`, which is
keyed `(vertical, avatar_slug)` with NO `client_id` and is read by every client in that vertical.
That sharing is the thing that makes the second med spa cost nothing, and `final-prompt.ts` already
tells a reader when research is shared (`times_reused`).

**The honest reading is that the research has two halves, and his four documents show it:**

- **The avatar half** is a fact about the buyer: age, income, professional background, fears,
  verbatim language, the Groupon wound, the contract wound. Genuinely shareable, genuinely per
  avatar. His avatar sheet is almost entirely this.
- **The offer half** is about THIS offer against THAT buyer: the UMP, the UMS, the objection list,
  the belief chain, the sophistication read. Not shareable, and a new offer invalidates it. His short
  offer summary and belief chain are entirely this.

**Recommendation: keep `avatar_sheet` and `deep_research` per audience, and make the OFFER half
re-derivable per offer.** The offer-scoped kinds already are. What is missing is that nothing says
"this avatar has research, but none of it was done against this offer".

‼️ **Whatever is decided, say which, and do not silently re-scope a stored kind.** Rows exist with
`offer_id` NULL; adding a NOT NULL or re-filing them changes what every stored row means.

---

## ‼️ TWO `offerFingerprint` FUNCTIONS EXIST AND THEY DISAGREE

```
audience-documents.ts   offerFingerprint(offer)                      -> `${treatment}|${outcomePromise}`
client-keywords.ts      offerFingerprint(treatment, terms, audience) -> a different string entirely
```

Both claim to answer "is this still the same offer". `documentsState` uses the first to decide
`letterApproved`; the keyword lane uses the second to decide which keywords still belong. **A change
to `terms` invalidates keywords and not documents; a change to `outcomePromise` does the reverse.**

That is a real inconsistency and this build will trip over it, because "the offer changed, redo the
offer documents" is exactly what it has to answer. **Settle it: one fingerprint, or two with
different names that each say what they cover.** Do not add a third.

---

## W1. The page does not know its avatar or its offer. Measured.

```
page_studio_sessions   thread_ts, client_id, page_id, candidates, claimed_at, created_at,
                       updated_at, studio_mode, evidence_topic, proposed_review, undo_body
                       -> NO audience_id, NO offer_id
client_pages           -> NO audience_id, NO offer_id
page_dataset           -> HAS audience_id AND offer_id (2026-09-17)
```

So the corpus records which avatar and offer a page was written for, and **the page itself never
knew.** `capturePage` resolves them at capture time through the plan row. A page drafted in the
studio without a plan row resolves neither.

That is Matthew's ask, unbuilt: *"whenever we create posts by drafting in the onboarding or after we
always select the avatar that we are building the traffic for and the offer."*

### What to build

1. **The studio session carries the audience and the offer.** The `avatar` and `offer` commands
   already exist in the studio (`avatarCommand`, `offerCommand`); what is missing is that the session
   remembers the answer and the card shows it.
2. **`draft` refuses without both**, and says which is missing and how to set it. ‼️ **`ask`, `add:`
   and dictation must NOT be gated.** Writing down what somebody said is never blocked: that is the
   best case this product has, and gating it would push people out of the lane. Only the model-driven
   `draft` needs the context, because that is the one that invents.
3. ‼️ **Do not add a fourth `client_pages.status`.** This is a precondition on a command, not a state
   a page moves through. CLAUDE.md refuses a fourth status value twice.

---

## W2. The four documents, as a gate on writing rather than a wish

### The rule

**No `draft` for an (audience, offer) pair whose four documents are not on file and approved.**

- `avatar_sheet` and `deep_research` for the **audience**
- `short_offer` and `necessary_beliefs` for the **offer**

`currentDocument()` already answers "is it on file", `status` already answers "approved", and
`offerFingerprint` already answers "still about this offer" (once W0's two-fingerprint problem is
settled).

### The card when they are missing

‼️ **Hand back the PROMPTS, not a complaint.** `promptsFromGaps` already builds them, pre-filled with
what is on file, each with its own `pasteBack` line. This build adds Matthew's chain to that lane:
the research prompt first, then the avatar sheet, then the short offer, then the beliefs.

‼️ **THE ORDER IS NOT COSMETIC AND HIS OWN DOCUMENTS PROVE IT.** The belief chain is written FROM the
avatar sheet and the short offer, and his prompt says so (*"ADJUNTA LA HOJA DE AVATAR, EL RESUMEN DE
OFERTA Y LOS DOCUMENTOS DE INVESTIGACIÓN"*). Asking for beliefs before the sheet exists produces
beliefs invented from nothing, which is the poisoning failure W0 is built to prevent.

### ‼️ The SIN VERIFICAR list is a feature, and the system currently throws it away

His research document ends with a numbered list of what it could NOT verify, including that the
**84 to 89% citation figure is unverified** and that no owner was ever found saying a patient came
from ChatGPT. His avatar sheet marks items `[INFERRED]` and `[UNVERIFIED]` and says they must not be
used as fact.

**This is exactly the distinction the page gate blocks on.** `unsupported` and `experience_claims`
refuse a claim no source carries, and an `[UNVERIFIED]` item is a claim no source carries, declared
as such by the research itself.

**So: when W0 extracts, an item marked UNVERIFIED or SIN VERIFICAR must never become a confirmed
value, and must never be filed as `EXTERNAL_RESEARCH` evidence.** It is the research telling you, in
advance, which claims will block. Carry the flag; do not drop it. ‼️ This is the single highest-value
line in this prompt: the document already separates fact from inference, and the system currently
reads the whole blob as one undifferentiated character count.

---

## W3. Onboarding: the documents become part of the lead's path

Matthew: *"Please do a continuation prompt so we can add this as part of the onboarding for the new
leads."*

Step 11 `avatar_harvest` already needs three of the four (`avatar sheet:`, `short offer:`,
`beliefs:`) and `deep_research` is already the research paste. **The onboarding half is largely
declared already.** What to add:

1. **A new strategy for a client starts by naming the avatar and the offer**, and the four documents
   are that strategy's preconditions. Matthew: *"each time we create a new strategy for a client"*.
2. **A second offer against the same avatar re-opens the offer half only.** The avatar sheet and the
   research stand; `short_offer` and `necessary_beliefs` are owed again. This is where the
   fingerprint decision above becomes load-bearing.
3. **Say what is inherited and what is owed, out loud.** `final-prompt.ts:161-164` is the model: it
   tells the reader when an avatar's research is shared with other clients. A card that silently
   reuses another offer's belief chain is the failure to avoid.

---

## Verification

```
./node_modules/.bin/tsc --noEmit
bun run build
bunx tsx scripts/_step-wiring.ts && bunx tsx scripts/_step-wiring.ts --check
bun run scripts/test-onboarding-artifacts.ts
bunx tsx scripts/_probe-policy-scan.ts
bunx tsx scripts/_probe-page-studio.ts
bunx tsx scripts/_probe-datasets.ts
bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
bunx tsx --env-file=.env.local scripts/_probe-final-prompt.ts
bunx tsx --env-file=.env.local scripts/_probe-research-paste.ts
bun  run --env-file=.env.local scripts/_probe-page-datasets.ts
```

**The new probe** asserts offline: that `draft` refuses without an audience and an offer while `ask`,
`add:` and dictation do not; that the four documents are asked for in dependency order and never
beliefs-first; that an item marked UNVERIFIED or `[INFERRED]` is never proposed as a confirmed value
and never filed as evidence; that a changed offer invalidates the offer-scoped documents and leaves
the audience-scoped ones standing; and that exactly one fingerprint decides each of those.

**The end-to-end test** is `srt-agency-llc`, whose four documents are the ones attached to this
prompt: paste the research, confirm the extraction (W0), paste the avatar sheet, the short offer and
the beliefs, then open the studio, select the avatar and the offer, and draft. The gate should pass
on claims the research carries and block on the 84 to 89% figure, because the research itself says
that one is unverified.

---

## Rules that have already cost a day each

- **A field is declared in `dataset-spec.ts` or it does not exist.**
- **An absence and a guess are different facts.** An UNVERIFIED claim promoted to a value poisons
  every page written afterwards, and nothing downstream can tell.
- **Never re-scope or repurpose a stored column or kind in place.** Existing rows carry the old
  meaning and `capturePage` has already snapshotted them.
- **Two functions that answer the same question will disagree.** There are already two
  `offerFingerprint`s.
- **Do not gate dictation.** Only the model-driven `draft` needs the context; writing down what a
  person said is the best case this product has.
- **No fourth `client_pages.status`.** Refused twice in CLAUDE.md.
- `question_bank` and `avatar_briefs` have no `client_id`; a wrong write there is not correctable.
- Anchor every new Slack verb at both ends. Unmatched text is appended to the page verbatim.
- A card body over 3,000 characters fails the WHOLE message. Split under 2,900 on line boundaries.
- `slackFetch` returns `{ok:false}` and never throws. Check the body, never the promise.
- Write TypeScript containing regexes with the Write tool; heredocs and `sed` mangle escapes.
- Never an em dash in copy or in anything a model writes.
- Paste full SQL in a fenced `sql` block, never a file path.
- Ask before deleting production data.
