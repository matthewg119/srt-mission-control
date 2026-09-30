# The onboarding conversation: architecture, for approval before any code

Answers the four questions NEXT-SESSION-PROMPT.md says to answer first: where state lives, how a
thread maps to a client, how the bot decides what is next, and how tool-calls map onto the
existing step engine and verifiers.

**Nothing below changes the 16 steps, the verifiers, the two evidence tiers, the Day-0 wall, the
publish gate or the data model.** The conversation is a new front end onto the existing engine.

---

## The one decision everything else follows from

**There is no agentic tool-use loop in this repository today, and I am not proposing to add a
general one.**

What exists: `callClaudeChat()` in `src/lib/claude-calls.ts` is multi-turn but text-only.
`callClaudeJSON()` accepts a `tools` array, but its own comment says those are Anthropic
*server-side* tools passed straight through, and that the client-side replay loop is deliberately
not implemented ("the assistant turn would have to replay the `server_tool_use`").

So the choice is real, and it is the architecture:

| | Free-form tool loop | **Closed action union (proposed)** |
|---|---|---|
| Model emits | arbitrary tool calls | one JSON object per turn |
| Server does | executes whatever was called | executes a typed, closed list |
| A new capability | model discovers it | somebody adds it to a union and a switch |
| A refusal | model may retry around it | surfaces verbatim, turn ends |

The closed union is the one that matches this codebase. Every boundary here is already a closed
allowlist that fails shut — `HUB_SLUG`, `RESERVED_PATHS`, `AUDIENCE_PRESETS`, `classifyHost()`,
`externalPathDecision()` — and each one carries a comment explaining that a prefix or an open set
is how the rule gets quietly widened later. A conversation that can call anything is that mistake
at the top of the stack, on the lane that spends money.

It also makes your own rules structural rather than instructions the model is asked to remember:
**buying a domain and publishing a page are not members of the union, so no prompt can talk the
bot into either.**

---

## 1. Where state lives

Two new tables. Nothing else moves.

```
launch_conversations   one row per client   (client_id unique)
launch_messages        the turns
```

> ‼️ **THE THREAD IS A TRANSCRIPT, NOT THE SOURCE OF TRUTH.** `client_launch_steps` and the
> verifiers stay authoritative exactly as they are. Delete the whole conversation and the board is
> unchanged; re-read it and every tick still has to survive its verifier. This is the same split
> `client_hosts` draws against `client_dns_records` and that `client_domain_orders` draws against
> the purchase: record what HAPPENED, and never let the narration become the record.

`launch_messages` carries, per turn: `role`, `content`, `actions` (jsonb — what the server actually
executed, and what each returned), and `step_key` when the turn settled one. That column is what
makes "here is where we are" cheap on return, and what makes a bad turn auditable afterwards.

`launch_conversations.updated_at` is what the unfinished-onboarding nudge reads. One table, one
timestamp, no second notion of "stale".

---

## 2. How a thread maps to a client

**One client per thread, and the client is in the URL:** `/dashboard/launch/[id]/chat`.

Enforced twice: a unique index on `launch_conversations.client_id`, and the route segment. The
board already refuses to render a Slack-lane client on this lane; the chat inherits that check
rather than repeating it.

Taking the client from the route rather than from the conversation means a thread can never drift
onto a second client mid-sentence — which is the failure your brief names ("Never two clients in
one thread") and the one a chat surface is otherwise most likely to produce.

"Like we did for Lumen" still works: other clients are **read-only context** assembled by the
server, never a writable target. The bot can quote Lumen; it cannot write to Lumen.

---

## 3. How it decides what is next

`nextLaunchStep(rows)` already exists and returns the first unresolved step. That is a fixed march,
and you asked for adaptive, so it becomes an input rather than the answer.

Each turn the server computes a **candidate set**: every step that is not settled and whose
`blockedBy` is resolved. It hands the model the whole board plus that set. The model picks one and
says why, in a line.

- **It picks from the set. It never emits a step key.** Same posture as the vertical allowlist: a
  key that is not on the board is not a thing that can be chosen.
- **Jumping works** ("skip to the domain", "do the pages now"). `blockedBy` is advisory everywhere
  in this lane by design — `launch-steps.ts` says so — so an out-of-order pick is allowed, and the
  one real wall, `day_zero_archive`, refuses in `day-zero.ts` regardless of what any surface thinks.
  The bot cannot open that wall by choosing differently.
- **The domain exception holds**: the step may only be skipped once pages are actually published,
  which is a server-side check on `pages_published`, not a sentence in a prompt.

---

## 4. How actions map onto the existing engine

One JSON object per turn:

```jsonc
{
  "say":     "one line of context, then the ask",
  "asks":    ["batched questions, answerable in any order, as one voice note"],
  "actions": [ /* closed union, below */ ],
  "confidence": 0.0
}
```

Every member maps 1:1 onto a function that **already exists**. The bot writes no new engine:

| action | calls | file |
|---|---|---|
| `propose_vocabulary` / `confirm_vocabulary` | `proposeVocabulary()` / `confirmVocabulary()` | `lib/launch/vocabulary.ts` |
| `read_offer` / `lock_offer` | `currentOffer()` / offer confirm | `lib/launch/offer.ts` |
| `store_document` | foundation upload + the second evidence write | `lib/launch/documents.ts` |
| `store_site_page` | `storeSitePage()` — sanitiser is the single door | `lib/hub/site-pages.ts` |
| `search_domains` | `searchDomains()` — public, tokenless, free | `lib/launch/domain.ts` |
| `file_artifact` | the filed-evidence path | `api/launch/[id]/artifact` |
| `complete_step` / `skip_step` | `setLaunchStep()` — runs the verifier | `lib/launch/steps.ts` |
| `hand_prompt` | new, and pure text — it returns a prompt, it does no research | new |

**Not in the union, and that is the point:**

- `buy_domain` — money. `domain.ts` rule 3: never called by a runner, a cron or a retry, only by a
  person pressing a button that showed them the price. The bot renders that button. It never presses it.
- `publish_page` — `publishPage()` is the one publisher and needs an explicit yes.
- anything touching the concierge, and any keyword change.

Execution is **server-side and sequential**, each through the gated function, bounded at N actions
per turn. A verifier refusal is not swallowed and not paraphrased: `refusalText()` already renders
`checked / found / todo`, and that string goes into the thread as-is. At `confidence < 0.9` the
actions are dropped and only the `asks` are shown — stop and ask, as you specified.

---

## 5. The 17th step

`hear_about_us`, filed tier: proof that the client added "How did you hear about us?" to how they
collect leads, screenshotted on **their own** site — not our pages, not a subdomain we serve.

Added to `launch-steps.ts` with a verifier reading a filed artifact. The exhaustive
`Record<LaunchStepKey, LaunchVerifier>` will refuse to compile until it is written, which is the
compiler enforcing this rather than me remembering it. The board becomes 17 steps, and
`launchStepNumber()` keeps every number that copy prints correct on its own.

---

## 6. The mechanic that matters most

> *"the best thing that it can do is give me the prompt so I can do the research and I can just
> paste back the answer."*

`hand_prompt` is the whole of it: one line saying what it needs, and a button producing a complete
copy-pasteable prompt for a separate session. You paste the result back; the parser fills the
dataset. **Page copy always routes through this** and is never drafted from nothing. The blank
investigation documents download from the thread.

The 7-prompt avatar chain is the fallback when the four documents are not in hand. `avatar-framework.ts`
holds `AVATAR_SHEET`, `SHORT_OFFER`, `RESEARCH_METHOD` and `BELIEFS_TRANSCRIPT` — the templates for
two of the four and some method text, **but not the chain, not its ordering, and not the two
investigation documents.** You are pasting those; I wire the real text and reconstruct nothing.

---

## 7. What I am deliberately not doing

- **Not replacing the board.** It gains a progress bar and a chat tab; the existing view stays.
- **Not training page style on finished onboardings.** You considered it and reversed it: every
  page is unique.
- **Not building the 2-week customer-success bot yet** — mapped, not built, and the
  "charge taxes" phrase still needs your reading before anything billing-shaped is designed.
- **Not touching the Slack lane.** `_probe-launch-isolation.ts` enforces that in both directions;
  the action union and the board serializer stay lane-agnostic so the same brain can drive the
  41-step lane later without a second one being written.

---

## Still owed by you

1. The **7 avatar prompts** and the **2 investigation documents** — you said you would paste them.
2. **"Where we're gonna charge taxes"** — what did you mean?
3. The **20-page batch**: the normal size, or an example?
4. **Sound notifications**: browser notification, or something else?
5. *"What do you mean specifically for a board?"* — "board" meant the 16-step checklist view, the
   column of steps on `/dashboard/launch/[id]`. My answer: the conversation replaces it as the
   thing you *work in*, and the board stays as the thing you *glance at* — plus a progress bar and,
   for a returning client, a summary with percent complete.
