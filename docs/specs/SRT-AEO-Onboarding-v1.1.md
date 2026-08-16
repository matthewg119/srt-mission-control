# SRT Agency — AEO Onboarding v1.1

**Companion to:** `SRT-AEO-Client-Onboarding-SOP.md` (v1.0)
**Owner:** Matthew Garcia
**Status:** Decisions locked. Build spec.

This document captures every decision made about the post-payment onboarding flow, attribution, data layer, review engine, and citation outreach. Where it conflicts with v1.0, **this document wins**.

---

## Summary of changes from v1.0

| v1.0 | v1.1 |
|---|---|
| Kickoff call (45m) + separate access screen-share (30m) | **One 60-minute call** — findings + access + DNS in a single session |
| Intake form sent manually after close | **Automated funnel** at `srtagency.com/onboarding`, triggered by Stripe |
| Client time: ~90 min | **Client time: ~60 min** |
| Monthly report only | **Weekly Slack report** + monthly deep report |
| Attribution not addressed | **Lead source layer** — referrer capture, AI crawler logs, post-submit attribution |
| Review engine = request flow + templates | **Review funnel** — quiz-style landing page producing quotable, AEO-optimized reviews |
| "Forum outreach" (undefined) | **Citation outreach** — cold email to local listicle publishers |
| No call tracking decision | **No call tracking. Traffic only.** |

---

## Phase 0.5 — Post-payment automation

**Trigger:** Stripe `checkout.session.completed`

```
Stripe webhook
  → create client record in Supabase (tenants table)
  → send welcome email (Outlook workflow, see below)
  → client lands on srtagency.com/onboarding
  → completes funnel
  → final step reveals booking link
  → booking webhook writes back to tenant record
  → auto-create Phase 2 scan task list
  → Matthew notified in Slack
```

### Booking constraint

**Earliest bookable slot = +2 business days from funnel completion.**

Non-negotiable. The core sequencing rule from v1.0 is *scan before you ask*. Two days is the minimum to run the AI baseline properly. If someone books next-day, you walk into the call with nothing and you're asking for access cold — which is the exact failure mode the whole SOP exists to prevent.

### Welcome email

Matthew writes this himself and sends it to his own Outlook inbox to build the workflow from. Requirements:

- Sent within 60 seconds of payment
- Single call to action: the onboarding funnel link
- Sets expectation: "~10 minutes, then you'll pick your call time at the end"
- Tells them what the call will be: "we'll show you exactly where AI is recommending your competitors, then get set up in about 20 minutes"
- No attachments, no PDF, no "here's what to expect" novel

### Funnel location

`srtagency.com/onboarding` — built in the existing Next.js app. **Not** Tally, not Fillout, not Typeform. Native from day one. Multi-step, one question group per screen, progress bar, saves partial state so they can resume.

---

## The onboarding funnel — question set

Everything below writes to the tenant record in Supabase. Fields marked **[NAP]** form the canonical NAP record and get confirmed out loud on the call.

### Step 1 — Business identity **[NAP]**
- Exact legal business name
- DBA / public-facing name
- Full address, formatted exactly as it should appear everywhere
- Primary public phone number
- Business email
- Website URL
- Hours, including holiday policy

### Step 2 — Services & market
- Full services list, in their own words
- Service area (radius / cities / in-clinic only)
- Insurance & payment types accepted
- Owner/provider credentials: degrees, licenses, board certs, years practicing
- Top 3 competitors they believe they lose business to

### Step 3 — Ideal customer *(new in v1.1)*

This block feeds the query generator and the content calendar. It is the most important block in the funnel.

- **What type of customer do you want to attract?** (open text — describe them like a person, not a demographic)
- **Which service is your highest *margin*?** (not highest volume — these are usually different)
- **Who do you *not* want calling you?** (the tire-kicker, the wrong-fit lead)
- **What are the top 3 objections you hear before someone books?** (fear, price, time, past bad experience — verbatim)
- **What does a customer usually try before they come to you?**

### Step 4 — Current review workflow *(new in v1.1)*

- Do you currently ask for reviews? (Never / Sometimes, verbally / Text / Email / QR code or card / Third-party tool)
- **Who** asks? (Owner / Front desk / Provider / Automated / Nobody)
- **When** in the visit? (During / At checkout / Same day after / Days later / No set time)
- What tool, if any?
- Roughly how many requests per month?
- Where do you send them? (Google / Yelp / Facebook / Trustpilot / Healthgrades / Other)
- What's stopped this from working so far? (open text)

> These answers determine which review workflow we install in Phase 5.4 and who on their team owns it. A clinic where the provider asks during the visit needs a completely different install than one where nobody asks at all.

### Step 5 — Access inventory
- Google Business Profile? Who manages it?
- Yelp business account?
- Domain registrar?
- Website platform, and who built it?
- Google Analytics / Search Console?
- Any previous SEO/marketing agencies who may still hold access?

### Step 6 — Book the call
Booking embed. Earliest slot +2 business days. Confirmation writes back to tenant record.

---

## Pre-call scan (the +2 days)

Runs automatically as a task list the moment the booking is confirmed.

| Task | Method | Time |
|---|---|---|
| WHOIS lookup | Automated — store registrar + nameservers on tenant record | instant |
| NAP sweep | Manual now, `[AUTO]` later — v1.0 §2.1 platform list | ~45 min |
| Review audit | Manual — client + 3 competitors | ~20 min |
| AI answer baseline | **Manual deep research** — see prompt library | ~90 min |
| Website technical audit | Manual + Lighthouse / Rich Results Test | ~30 min |
| Findings doc assembly | Template, populated from above | ~30 min |

WHOIS matters more than it looks: knowing the registrar before the call means you screen-share the right UI and never say "hmm, where is that in GoDaddy."

---

## The call — 60 minutes, one session

| Minutes | What |
|---|---|
| 0–20 | Findings doc, in v1.0 §3.1 order. Lead with the AI baseline screenshots. |
| 20–25 | Confirm canonical NAP out loud, field by field |
| 25–45 | Access grants — live, on screen-share, client driving |
| 45–50 | **DNS: CNAME + TXT** in their registrar, client driving |
| 50–60 | Walk through what happens over the next 21 days. Book the 30-day report. |

### DNS — two records, not one

While they're logged into the registrar:

1. **CNAME** — `[subdomain].clientdomain.com` → Vercel. This is the hub.
2. **TXT** — Google Search Console domain-level verification.

The TXT record is the upgrade over v1.0. Domain-level verification gives you Search Console data for **the entire domain including their main site**, not just the hub. Same five minutes, twice the data. It is the single highest-value thing you get on that call and it costs the client nothing.

**Never ask for registrar credentials.** Client stays logged in and drives. Them watching you not touch anything else is a trust event.

---

## Attribution & lead source layer

### What you can actually see

| Source | What it tells you | How |
|---|---|---|
| **Hub referrers** | Direct AI referral traffic — `chatgpt.com`, `perplexity.ai`, `gemini.google.com`, `copilot.microsoft.com` | Referrer header on every hub request → Supabase |
| **AI crawler hits** | Which engines are crawling, how often, which pages | Vercel log drain → Supabase. Filter UA: `GPTBot`, `OAI-SearchBot`, `PerplexityBot`, `ClaudeBot`, `Claude-Web`, `Google-Extended`, `Bytespider` |
| **Hub-hosted conversions** | Full funnel, zero attribution gap | Forms live on our infrastructure |
| **Post-submit attribution** | Self-reported, directional | "How did you hear about us?" popup after form completion |
| **Branded impressions** | Proxy for invisible AI discovery | Search Console, domain-level (thanks to the TXT record) |
| **Main-site tag** *(optional)* | Closes the hub → main site → conversion loop | GTM container or SRT script. Subdomain cookie on `.clientdomain.com` is readable by the main site. |

**Crawler hits are the month-one metric.** Rankings haven't moved yet and there's nothing to report — but "Perplexity crawled your hub 47 times this week, up from 0" is real, verifiable, and nobody else in this market reports it. It's a leading indicator, and it buys you the runway to get to the 30-day report.

### No call tracking

Decided. A tracking number in the NAP breaks the citation consistency that Phase 5 exists to fix. We measure **traffic**, not calls. If a client insists later, dynamic number insertion on the hub only — canonical number stays in schema, footer, and every directory.

### The honest ceiling

Some AI-driven discovery is structurally invisible: someone reads an AI answer, doesn't click, then Googles the brand directly or walks in. Say this to the client on the call, before they ask. Branded impressions is the proxy, and naming the limitation up front is what makes the numbers you *do* report believable.

---

## Data layer

Same stack as everything else. No new infrastructure.

```
Form submit on hub
  → Next.js route handler
  → honeypot + Cloudflare Turnstile
  → insert into Supabase with tenant_id
  → RLS enforces tenant isolation
  → transactional email to client (Resend or Postmark)
  → optional webhook to their CRM / GHL
```

### Form policy — non-clinical only

**Every form we host collects exactly these fields:**
- Name
- Email
- Phone
- Service interest (dropdown, from the tenant's services taxonomy)

**After submit**, a popup: *"Quick question — how did you hear about us?"* with options including an explicit **"ChatGPT or another AI assistant"** choice.

> That option is mandatory. If it isn't there, everyone picks "Google" and your entire attribution story disappears.

**No symptoms. No conditions. No treatment questions. No health history. No file uploads.** Anything clinical hands off to the client's existing booking system with a link.

**Why:** the moment a TRT clinic form collects treatment interest tied to a person, it's PHI and SRT becomes a business associate — which means BAAs with Supabase, Vercel, and the email provider, plus the compliance overhead that comes with them. Staying non-clinical means you get all the attribution data and none of the liability. This is not a nice-to-have; it's the line.

### Core tables

- `tenants` — client record, branding, canonical NAP, services taxonomy, ideal-customer answers
- `leads` — form submissions, `tenant_id`, source, referrer, UTM, attribution answer
- `hub_traffic` — page views, referrer, timestamp, `tenant_id`
- `crawler_hits` — user agent, path, timestamp, `tenant_id`
- `ai_baseline` — engine, query, date, client appeared (bool), businesses named, sources cited, screenshot URL
- `nap_discrepancies` — platform, field, found value, canonical value, status, screenshot URL
- `client_corpus` — see below
- `question_bank` — see below

RLS on every table keyed to `tenant_id`. No exceptions.

---

## The corpus (not "training a model")

You are **not** fine-tuning anything. You're building a **retrieval corpus** — grounded source material that gets pulled into context when generating content. Framing it as training will lead you to build the wrong thing.

### `client_corpus`
`tenant_id` · `source_type` · `raw_text` · `embedding` (pgvector) · `created_at`

`source_type` values: `review`, `form_response`, `intake_answer`, `sales_call_transcript`, `gbp_qa`, `review_funnel_answer`

Retrieved when generating: hub pages, GBP Q&A answers, GBP posts, outreach emails. Gives you voice consistency and factual grounding with zero fine-tuning.

### `question_bank`
Same structure, `tenant_id` NULL, plus a `vertical` column.

Good questions from Reddit, forums, People Also Ask, AlsoAsked, GBP Q&A, and your own inbound forms — deduped and clustered by vertical. A great question found for one TRT clinic becomes a content brief for **every** TRT clinic you onboard.

**This is the compounding asset.** Client corpora don't transfer between clients. The question bank does. It's the actual moat.

### Weekly question harvest

Automated: pull from Reddit API, People Also Ask, GBP Q&A, inbound form text. Rank by frequency × commercial intent. Top 10 per vertical per week feed:
- The 30-day post calendar
- Hub content briefs
- GBP Q&A seeding
- Next month's query set expansion

---

## Weekly Slack report

Delivered to a shared Slack channel per client. Automated.

- **AI crawler activity** — hits by engine this week vs. last. *Lead with this in month one.*
- **Hub traffic** — sessions, top pages
- **AI referral traffic** — sessions from ChatGPT / Perplexity / Gemini / Copilot, named individually
- **New leads** — count + attribution breakdown
- **Content published** — pages and posts, with links
- **New reviews** — count, average, response status
- **One line of plain English** — what moved and what we're doing next week

Monthly report stays as v1.0 §6 defines it: re-run the exact Phase 2.3 query set, same engines, same wording, side-by-side vs. Day 0.

---

## Review funnel

Full spec in `SRT-Review-Funnel-Spec.md`. Summary:

A quiz-style landing page at `[subdomain].clientdomain.com/review` that walks a customer from *"what were you worried about?"* through to a pre-populated, editable ~30-word review they copy and paste into Google.

**Why it exists:** normal review prompts produce "Great service, highly recommend!" — which is worthless to an AI engine because it contains no retrievable information. The funnel structure produces reviews containing **the objection language real people type into ChatGPT**, plus staff names, plus a named outcome. Those are the reviews that get quoted.

**Installed after the onboarding call**, as a workflow handed to the client's team, because the Step 4 answers tell you who on their team can actually run it.

### Compliance guardrails — read before building

- **No gating.** Everyone reaches the review step regardless of how they answered. Routing only happy customers to the review page violates FTC's consumer review rule and Google's policies.
- **Editable draft.** The generated text is a starting point assembled from their own answers. They can change any word before copying.
- **Their words, not ours.** The draft is assembled from their inputs. We don't invent sentiment or details.
- **No incentives** tied to leaving a review, and especially not to a positive one.
- Unhappy respondents get the review link *and* an offer to have the owner contact them. Both. Not one instead of the other.

---

## Citation outreach

**Not Reddit. Not forum posting.** This is cold email to the publishers who already own the listicles AI engines cite.

### The target

Search the client's money queries, see which pages the AI engines cite, and email whoever runs them. Typically:
- Local blogs and city guides ("Best Med Spas in Greensboro")
- Regional news and lifestyle sites
- Niche vertical roundups
- Local business associations and chamber directories
- "Top 10" affiliate roundup sites

### The workflow

1. From the Phase 2.3 baseline, extract **every source cited** across all engines. That list is the target set — these pages are provably influencing AI answers for this client's queries.
2. Find the contact. Log to `outreach` table.
3. Send the pitch (template in the prompt library).
4. Follow up once, at 7 days. Then stop.
5. Log outcome. Re-check the query 30 days after any placement lands.

**Volume: 3–5 well-researched emails per day, per client.** Personalized to the specific post. Not a blast.

**Why this beats forum posting:** the pages you're targeting are already cited by the engines. Getting added to one is a direct injection into the exact source an AI reads when answering your client's money query. It's the highest-leverage outreach available and it carries none of the shadowban or FTC-disclosure risk that posting-as-the-client does.

---

## 30-day post calendar

Generated at onboarding, from three inputs:
1. The Phase 2.3 baseline queries where the client did *not* appear
2. The Step 3 ideal-customer answers (especially the top 3 objections — objections are content)
3. The weekly question harvest

Output: 30 days of GBP posts + hub content briefs, in the Mission Control review queue, scheduled. Every post maps to a specific query the client is currently losing.

---

## Definition of done — v1.1 additions

Everything in v1.0 Appendix C, plus:

- Onboarding funnel completed and canonical NAP locked
- Search Console verified at **domain level** (TXT record confirmed)
- Hub traffic, referrer, and crawler logging confirmed writing to Supabase
- At least one hub form live with the attribution popup
- Review funnel live and handed off to a named person on the client's team
- Weekly Slack report firing
- 30-day post calendar loaded and scheduled
- Outreach target list built from baseline citations
