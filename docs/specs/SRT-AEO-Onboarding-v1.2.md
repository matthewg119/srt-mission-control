# SRT Agency — AEO Onboarding v1.2

**Supersedes:** v1.1 and `SRT-AEO-Client-Onboarding-SOP.md` (v1.0) where they conflict.
**Still current:** `SRT-Review-Funnel-Spec.md`, `SRT-Prompt-Library.md` (§1 scan prompt is now a *fallback* — see Same-Day Scan below).
**Owner:** Matthew Garcia
**Target repo:** `srt-mission-control` (Next.js 14 · Supabase · Zoho v5 · Slack · MS365 → mission.srtagency.com)

---

## What changed from v1.1

| v1.1 | v1.2 |
|---|---|
| Earliest booking +2 business days | **Minimum notice 4 hours. Same-day possible.** |
| Manual deep-research scan (~90 min) | **Automated baseline via Audit Engine v2** + API calls; manual only for engines without APIs |
| Build funnel, webhook, audit from scratch | **Extend `src/lib/medspa/*`, `audit-engine/*`, `slack-bot.ts`** — most of this exists |
| Third-party booking tool | **Custom booking, built in Mission Control** |
| Subdomain "pick one" (undecided) | **`learn.` — decided. Fallback `guide.`** |
| Slack "TBD" | **Channel structure decided** — see below |
| Outreach targets in a flat `outreach` table | **`citation_sources` as a global, cross-client asset** |

---

## Repo reality check — read before building

- `CLAUDE.md` intro still says **"business financing brokerage."** Stale. AEO is truth. Fix it or ignore it, don't act on it.
- `config/onboarding.ts` is the **team-member** checklist (also stale, says "funding"). Not this.
- `srt-portal/src/app/portal/onboarding/page.tsx` is the **deprecated borrower intake**. Not this.
- `src/lib/medspa/*` (Aug 6–10) is Stripe order provisioning + audit fulfillment. **Adjacent and reusable** — this is the closest existing code to what we need.
- `slack-bot.ts:233–246` has `createChannel()` / `inviteToChannel()`, uncalled.
- **`srt-agwb` is on hold.** Another chat owns it. No commits there until Matthew confirms.

The July 26 plan (`i-mentioned-wanting-to-enumerated-harp.md`) was written and never built. This document replaces its Task B and Task C sections.

---

## The full funnel, end to end

```
srtagency.com/freeaudit          ← Task A, on hold for srt-agwb
  → lead capture (Meta Pixel + sendBeacon)
  → Audit Engine v2 runs → /r/[slug] report → #ai-visibility-audits
  → Matthew reviews, sends report (review-first rule holds — nothing auto-sends)
  → sales conversation
  → Stripe checkout
  ────────────────────────────────────────────  ← v1.2 starts here
  → checkout.session.completed
  → tenant provisioned + Slack client channel created
  → welcome email → srtagency.com/onboarding
  → funnel completed
  → FULL baseline audit fires immediately (not the free-audit subset)
  → booking, minimum notice 4h
  → findings doc auto-assembled
  → 60-minute call: findings + access + DNS
```

The `/freeaudit` audit and the post-payment baseline are **the same engine, different depth.** Free audit = 2–3 queries, one engine, teaser. Post-payment baseline = full query set, all engines, archived as Day 0. Don't build two things.

---

## Booking — build our own

Third-party tools can't express "minimum notice 4 hours, only after funnel completion, only for this tenant." Ours can, and it's a small build.

**Tables:** `availability_rules` (weekday, start, end, timezone), `blackout_dates`, `bookings` (tenant_id, starts_at, duration, status, ics_uid).

**Behavior:**
- Slots generated from rules minus existing bookings minus blackouts
- **Minimum notice: 4 hours.** Configurable, not hardcoded.
- Max 21 days out
- Duration 60 min
- Only reachable with a valid onboarding token — no public booking page
- Confirmation email with a real `.ics` attachment
- Writes to Matthew's calendar via **`src/lib/microsoft.ts`** (MS365 already wired — use Graph, don't add a calendar provider)
- Booking confirmed → Slack post to the client's channel + `#onboarding-srt-aeo`

**Don't build:** rescheduling UI, cancellation flow, multi-host, round-robin, payment-on-booking. Reschedules go through Matthew by reply. Fewer than 10 clients.

---

## Same-day scan

Fires on funnel completion. Target: **complete in under 20 minutes.**

| Engine | Method | Automated? |
|---|---|---|
| ChatGPT | OpenAI API, search enabled | ✅ |
| Perplexity | Perplexity API | ✅ |
| Gemini | Google AI API, grounding enabled | ✅ |
| Claude | Anthropic API, search tool | ✅ |
| Google AI Overviews | SERP provider (SerpApi or equivalent) | ✅ if provider supports it — **verify current AI Overview coverage before committing** |
| Bing Copilot | No API | ❌ Manual spot-check, or drop from the standard set |

Everything else in parallel: NAP sweep (queue per platform), review audit, WHOIS, Lighthouse, schema validation, robots.txt / llms.txt check.

### Store structured, render visual

Every run writes a row to `ai_baseline`: engine, query, run_date, `client_appeared`, `businesses_named` (ordered jsonb), `sources_cited` (jsonb), `raw_response`.

The **structured record is the artifact.** Screenshots are a rendering of it. Store the data, generate screenshot-style cards for the deck. This is what makes the monthly report a diff instead of a manual comparison — the whole point of Appendix B item 1.

### Fidelity disclosure

API responses differ from the consumer chat UI: different retrieval, no personalization, no session history. **Say this in the report footer.** What you're measuring is a consistent, repeatable signal of whether the client is in the retrieval set — and consistency is what makes a month-over-month delta meaningful. Overclaiming here is how you lose a client who checks your work.

For the client-facing deck, take **3–5 real UI screenshots** of the most damning queries. Those are the emotional hook. The other 50 stay structured.

`SRT-Prompt-Library.md` §1 remains the fallback for anything the engine can't cover, and for the Bing Copilot spot-check.

---

## Subdomain convention — DECIDED

### `learn.clientdomain.com`

Locked. Every client, no exceptions, no per-client debate.

**Why `learn.` over `resources.`:**
- Shorter, and it appears in every AI citation as the source URL
- Reads like something the business made, not something an agency bolted on
- Works in every vertical — `learn.trtclinic.com` and `learn.roofingco.com` both read naturally
- `resources.` collides with the docs/support-portal pattern and reads more like scaffolding

**Fallback: `guide.`** Used only when `learn.` already resolves for that domain.

**Rule:** before assigning, check DNS for an existing `learn.` record. If one exists, use `guide.` and log the exception on the tenant record. Two options total. Never a third.

**Footprint note, honestly:** N clients on the same subdomain pattern is a detectable agency footprint. It's a minor risk — subdomain choice isn't a ranking signal and legitimate businesses use `learn.` constantly. The consistency is worth more to your operations than the footprint costs you. But know it's a tradeoff you chose, not a free win.

---

## Slack structure — DECIDED

### Internal (SRT workspace)

| Channel | Purpose | Status |
|---|---|---|
| `#hot-leads` | New lead captures | exists |
| `#ai-visibility-audits` | Audit Engine output | exists |
| `#ops-new-deals` | Closed-won handoff | exists |
| `#onboarding-srt-aeo` | Onboarding ops — funnel completions, bookings, blockers | exists |
| `#alerts-infra` | Webhook failures, DNS/SSL, crawler-log gaps | **new** |

### Client-facing

**One channel per client: `#srt-{client-slug}`**, provisioned automatically by the Stripe webhook via the existing `createChannel()` / `inviteToChannel()` in `slack-bot.ts`.

**Slack Connect (shared external channel), not guest accounts.** Client stays in their own workspace — no new login, no adoption friction, and they don't see your internal side. Slack Connect availability and external-channel limits vary by plan and change; **verify against your current plan before wiring it.** If Connect isn't available, fall back to multi-channel guests in a dedicated Client Hub workspace and note the switch on the tenant record.

Posted to the client channel: booking confirmation, hub-live notification, weekly report, monthly report, new-review alerts.
Never posted there: internal notes, other clients, audit engine raw output, anything from `#ops-*`.

Store `slack_channel_id` on the tenant row. Every client-facing post resolves through it — never hardcode a channel.

---

## Citation sources — the compounding asset

You called this right. Building it as a flat per-client `outreach` list wastes the best data you generate.

### Structure

**`citation_sources`** — GLOBAL, no `tenant_id`. Deduped by URL.

`id` · `url` · `domain` · `page_title` · `publication_name` · `source_type` (listicle / directory / review_site / news / blog / association / affiliate) · `city` · `state` · `verticals` (text[]) · `contact_email` · `contact_name` · `contact_found_via` · `contact_verified_at` · `first_seen_at` · `last_seen_at` · `times_cited` · `notes`

**`citation_observations`** — the join. This is where `tenant_id` lives.

`tenant_id` · `citation_source_id` · `engine` · `query` · `run_date` · `position` · `client_mentioned_on_page` (bool)

**`outreach`** — `tenant_id` · `citation_source_id` · `status` · `sent_at` · `followed_up_at` · `outcome` · `placement_url` · `placement_confirmed_at`

### Why global matters

Onboard three Greensboro med spas and the same local listicles surface for all three. Under a per-client model you research the same editor's contact info three times. Under this model you research it once and it's warm by client two.

Same logic as `question_bank`: **client corpora don't transfer, cross-client intelligence does.** After twenty clients you own a contact-verified map of which local publications actually feed AI answers, by city and by vertical. That's not a feature, it's the business.

### Populate from day one

Every baseline run extracts `sources_cited` and upserts into `citation_sources` automatically. Contact enrichment happens later, lazily, when you're actually ready to pitch. **The database fills itself starting with client one whether or not you ever send an email.** Build the write path now; the pitch layer can wait.

### The retention artifact

When an outreach placement lands, `placement_confirmed_at` is set — and the next baseline run shows whether the AI answer changed. Before/after on a query, tied to a specific placement you got, is a stronger monthly-report moment than any traffic chart. Wire the linkage now so the data exists when you want to show it.

---

## Spam protection

Every public-facing form: `/freeaudit`, `/onboarding`, every hub lead form, the review funnel.

1. **Honeypot** — hidden field, CSS-hidden not `display:none` on the input itself (bots read the style). Any value submitted → silent 200, discard. Never show an error; that teaches the bot.
2. **Cloudflare Turnstile** — server-side verification. Invisible mode. Free.
3. **Rate limit by IP** — 5 submissions per hour per endpoint.
4. **Timing check** — submitted under 3 seconds after page load → flag, don't discard (real users on a prefilled mobile form can be fast).

Log rejections to `#alerts-infra` with a daily count. If it spikes you want to know before the client's inbox does.

---

## Everything from v1.1 that still stands

Carried forward unchanged — see v1.1 for detail:

- **Onboarding funnel question set** — 6 steps, including Step 3 ideal-customer and Step 4 current-review-workflow
- **DNS: three records, two CNAMEs and one TXT** on the call, client driving, domain-level Search Console verification
- **No call tracking.** Traffic only.
- **Non-clinical forms only.** Name, email, phone, service interest. Post-submit "how did you hear about us" with an explicit "ChatGPT or another AI assistant" option. No PHI, no BAA exposure.
- **Attribution layer** — hub referrers, AI crawler logs, hub-hosted conversions, branded impressions as the proxy for invisible discovery
- **`client_corpus` + `question_bank`** with pgvector. Retrieval, not fine-tuning.
- **Weekly Slack report** — lead with crawler activity in month one
- **Review funnel** — full spec in `SRT-Review-Funnel-Spec.md`, including the no-gating rule
- **Citation outreach** — cold email to publishers, 3–5/day/client, one follow-up

---

## Definition of done — v1.2

v1.0 Appendix C, plus:

- Onboarding funnel live, token-gated, canonical NAP locked
- Custom booking live with 4-hour minimum notice, writing to MS365 calendar
- Baseline audit fires on funnel completion and completes in under 20 min
- Slack client channel auto-provisioned, `slack_channel_id` on tenant
- Hub live at `learn.clientdomain.com` (or `guide.`, logged)
- Search Console verified at **domain level**
- Traffic, referrer, and crawler logging confirmed writing to Supabase
- `citation_sources` populated from the baseline run
- Review funnel live, handed to a named person
- Weekly Slack report firing
- 30-day post calendar loaded
