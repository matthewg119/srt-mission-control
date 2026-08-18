# SRT — Patient Review Tool · Build Spec v2

**Replaces:** `SRT-Review-Funnel-Spec.md` — **retired, delete it.** That spec put a generation model in the path and asked for a staff name. Both are prohibited here.
**Governed by:** `SRT-AEO-Onboarding-v2-PILOT.md` §10.3 and §16.5–16.7, which are canon. This document is the build translation, not a new decision.
**Route:** `reviews.{clientdomain}` — a standalone mobile page, separate build from the funnel app. Its own host, not a path on the hub: `dns-records.ts` provisions a dedicated `reviews.` CNAME on the onboarding call, and that is the record the QR on the printed cards resolves through.

---

## What it is

A patient finishes her visit. She's handed a **printed card** with a QR code. That evening, at home, on her own phone, she scans it and answers four open questions in her own words — about ninety seconds, typed or voice-to-text.

The tool then does **exactly one thing**: it lays her own sentences back out as notes she can read, edit, and copy. Then it links her to Google (or RealSelf for procedure visits), where she posts it herself, from her own account.

A mirror, not a ghostwriter. Every constraint below follows from that sentence.

---

## The four questions — fixed, sentiment-neutral

1. What were you worried about before you came in?
2. What were you hoping would happen?
3. Had you had a bad experience somewhere before this one?
4. What actually happened at your appointment?

Same four for every patient, every clinic. Open text. Q3 is skippable; the other three are not required either — an empty answer just produces fewer bullets.

**Not asked, ever:** who treated her. How she'd rate it. Whether she'd recommend. Anything with a sentiment scale. Anything that would sort her into a path.

Question 1 is doing double duty — it's the patient-side mirror of the objection-shaped questions in the universal 20. That's why the reviews this produces get quoted: they contain the fear a future patient is typing into a chat box.

---

## String assembly — no model in the path

**There is no LLM call in this route.** Not for drafting, not for cleanup, not for tone. This is the single most important line in the document.

The transformation is:

```
for each answered question:
  trim whitespace
  collapse internal runs of whitespace
  capitalize first character if lowercase
  append a period if no terminal punctuation
  → one bullet
```

That is the entire transformation. Nothing else. No spelling correction, no grammar fixing, no reordering, no joining clauses, no adding transitions, no adjectives, no clinic name insertion, no treatment name insertion.

**Why:** FTC 16 CFR Part 465 and the Rytr fact pattern. A tool that generates review content its user didn't write is the thing being regulated. A tool that reformats what she typed is not. The line is bright and we stay well behind it.

### On-screen vs. copied text — build this carefully

**On screen**, show labeled bullets so she can see the structure:

> • **What I was worried about:** {a1}
> • **What I was hoping for:** {a2}
> • **Before this:** {a3}
> • **What happened:** {a4}

**In the copy buffer**, put **only her sentences**, joined by line breaks. No labels.

The labels are ours; her sentences are hers. Keeping labels out of the copied artifact means what gets posted to Google is one hundred percent her own words, with no SRT-authored text in it at all. If the tool is ever challenged, that's the answer.

Everything is editable before copying. The textarea is never read-only.

---

## Hard rules

| Rule | Why |
|---|---|
| Output contains only what she supplied. No invented details, no adjectives, no treatments she didn't name, no marketing language. **String assembly, no generation model.** | FTC 16 CFR Part 465 |
| **No staff field anywhere in this route.** Never ask who treated her, never suggest naming anyone. If she volunteers a name, leave it untouched. | Google 2026 — merchants may not request specific content, including staff names. Integrity Law 11. |
| Fully editable, nothing locked. | Her authorship in fact, not just in framing. |
| Never submits for her. Copy, then a link. She posts in her own account. | Reviewer identity must be genuine. |
| Own device only. No clinic tablet, no lobby completion, no clinic wifi. The card goes home with her. | Google 2026 kiosk ban; single-IP spam filtering. |
| **Every patient gets the card.** No sentiment pre-screen, no "how was it?" filter, no separate private path. | Review gating — prohibited and enforced. |
| The optional owner-contact line, if used, shows to **everyone**, worded identically regardless of what she wrote. | Sentiment-blind by construction. A conditional render here is gating with extra steps. |
| No incentive of any kind — no discount, gift, entry, points, or thank-you. | Prohibited regardless of the review's sentiment. |
| `question_set_version` logged with every submission. Answers stored with **no identifiers and no IP**. | A challenged review can be defended: here is what was asked, nothing was steered. |

---

## Data

`review_tool_submissions` — `tenant_id` · `question_set_version` · `answers jsonb` · `posted_destination` (nullable) · `created_at`

**No name, email, phone, IP, user agent, session ID, or device fingerprint.** If a field could identify her, it isn't collected. This is a deliberate constraint: the tool doesn't need it, and not having it is what makes "we never hold patient contacts" true rather than aspirational.

Answers also write to `client_corpus` with `source_type = 'review_funnel_answer'`, same no-identifier rule. Every submission is stored **whether or not she posts** — the objection language is the asset either way, and it feeds answer-page generation.

---

## Destinations

- **Google** — primary, always
- **RealSelf** — for procedure-specific visits

Configured per tenant, decided on the call (§8, minutes 43–50). Both links shown; she picks. No third destination without a decision.

---

## The mechanism

**The card** (§16.5) — printed, not on a tablet.

> **Front:** {Clinic name} · **Four questions. Ninety seconds. Your words.** · [QR] · *Scan when you're home.*
> **Back:** the four questions · *Answer in your own words. Nothing is posted unless you post it.*

Same card for every patient. No "if you loved your visit." No stars. No staff names. No gift.

**The automated request** (§10.4, copy at §16.6) — configured **inside the clinic's own booking / messaging system**. Trigger: visit completed. Delay: ~3 hours. Message identical for every patient.

We never import, store, or message patient contacts. No system → `review_request_mode = 'card_only'` on the tenant, and the card is the whole mechanism. That's acceptable; at least two of the three pilots should have a system so the automated path gets measured.

---

## Language

`en` / `es` / both, from the intake consent block (§16.4). The four questions, the card, and the automated text all need Spanish. **Have the Spanish reviewed by a native speaker** — a machine translation of a question designed to be sentiment-neutral can easily land as leading, and that's the one thing this tool can't afford.

---

## Metrics

- Cards handed → scans → completions → posted
- **% of posted reviews containing an objection phrase** — the AEO metric, the one that matters
- Average word count
- Split by `review_request_mode` (card only vs. card + automated) so the pilot measures whether the automated request is worth configuring

**Not tracked:** anything about staff names.

---

## Build note

This is a **separate build from the funnel app** — its own section in the Claude Code prompt, its own route, no shared components with `/onboarding`. Two reasons: it's the only route a patient ever touches, and it has data rules (no identifiers, no IP) that shouldn't be one refactor away from a form that does collect them.
