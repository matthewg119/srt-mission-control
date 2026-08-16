# SRT Agency — AEO Client Onboarding SOP

**Version 1.0 | Owner: Matthew Garcia | Delivery model: Hybrid subdomain hub**

---

## How to use this document

This is the standard operating procedure for taking a client from "payment received" to "live and reporting." Every step has an owner, a target day, and a definition of done. Steps marked **[VA]** can be delegated once documented. Steps marked **[AUTO]** are candidates for automation inside Mission Control.

**The core sequencing rule:** *Scan before you ask.* We never request account access until we can show the client exactly which problems that access will fix. This makes the request feel earned instead of invasive, and it means we only ask for what we actually need.

**Total timeline to live:** 14–21 days
**Client's total time commitment:** ~90 minutes across two calls

---

## Phase 0 — Deal close handoff

**Target: Day 0 | Owner: Matthew**

- [ ] Payment collected (down payment or first month, per agreed structure)
- [ ] Service agreement signed — confirm it includes:
  - [ ] Scope: what's built, what's managed, what's reported
  - [ ] Infrastructure clause: SRT hosts the content hub on SRT infrastructure; **client retains ownership of their domain at their own registrar at all times**
  - [ ] Cancellation/handover terms: on cancellation, SRT provides a full content export and releases the subdomain within 14 days
  - [ ] Access terms: SRT is added as a manager/user on client platforms; SRT does not request or store client passwords
- [ ] Client record created in Mission Control (Supabase) — this is the container for every artifact below
- [ ] Kickoff call scheduled (45 min, within 3 business days)

**Done when:** Client exists in Mission Control with signed agreement attached and kickoff on the calendar.

---

## Phase 1 — Intake

**Target: Day 0–1 | Owner: Matthew | [VA] after template is built**

### Intake form — send immediately after close

Collect and store in Mission Control:

**Business identity (this becomes the canonical NAP record — everything gets matched to it)**
- [ ] Exact legal business name
- [ ] Exact DBA / public-facing name (these are often different — the mismatch is frequently the root cause of citation problems)
- [ ] Full address, formatted exactly as it should appear everywhere (Suite vs. Ste., St vs. Street — pick one and enforce it)
- [ ] Primary phone number (the one that should appear publicly — not a tracking number unless we control it)
- [ ] Business email
- [ ] Website URL
- [ ] Hours of operation, including holiday policy

**Service and market**
- [ ] Full services list, in the client's own words
- [ ] Service area (radius, cities, or "in-clinic only")
- [ ] Insurance/payment types accepted (high-value for health verticals — AI answers cite this constantly)
- [ ] Owner/provider credentials: degrees, licenses, board certifications, years practicing
- [ ] Top 3 competitors they believe they lose business to

**Access inventory (what do they already know they have?)**
- [ ] Do you have a Google Business Profile? Who manages it?
- [ ] Do you have a Yelp business account?
- [ ] Who owns your domain, and at which registrar?
- [ ] What platform is your website on? Who built it?
- [ ] Do you have Google Analytics or Search Console?
- [ ] Any previous SEO/marketing agencies who may still hold access?

> **Note:** The last question matters more than it looks. Orphaned agency access on a Google Business Profile is one of the most common blockers we'll hit in Phase 3.

**Done when:** Intake complete and canonical NAP record locked in Mission Control.

---

## Phase 2 — Full presence scan

**Target: Days 1–3 | Owner: Matthew | [VA] + [AUTO] candidates throughout**

**No client access required for any step in this phase.** All of this is public. This is the phase that earns the access request in Phase 3.

### 2.1 — NAP consistency sweep

Check every platform below. For each, log: listing exists (Y/N), claimed (Y/N), name match, address match, phone match, hours match, website link correct, duplicates found.

**Universal platforms (all verticals)**
- [ ] Google Business Profile
- [ ] Google Maps (check for duplicate/unclaimed pins separately)
- [ ] Bing Places
- [ ] Apple Business Connect / Apple Maps
- [ ] Yelp
- [ ] Better Business Bureau
- [ ] Facebook Page
- [ ] Instagram business profile
- [ ] LinkedIn company page
- [ ] Nextdoor
- [ ] Yellow Pages / Superpages
- [ ] Chamber of Commerce (local)
- [ ] Secretary of State business registration (name + address of record)

**Health / TRT clinic vertical — add:**
- [ ] Healthgrades
- [ ] WebMD / Vitals
- [ ] Zocdoc
- [ ] RateMDs
- [ ] Doximity (provider-level)
- [ ] NPI Registry (provider-level — check address on file)
- [ ] RealSelf (if aesthetics services offered)
- [ ] Psychology Today (if any behavioral health services)
- [ ] State medical board listing

**Home services / contractor vertical — add:**
- [ ] Angi
- [ ] HomeAdvisor
- [ ] Thumbtack
- [ ] Houzz
- [ ] Porch
- [ ] BuildZoom
- [ ] State contractor license lookup
- [ ] Manufacturer/brand dealer locators (roofing, windows — often overlooked and high-authority)

**Deliverable:** Discrepancy log in Mission Control — one row per platform per issue, with a screenshot.

### 2.2 — Review audit

For each platform with reviews (Google, Yelp, Facebook, plus vertical-specific):
- [ ] Total review count
- [ ] Average rating
- [ ] Date of most recent review
- [ ] Owner response rate (%)
- [ ] Themes in negative reviews (these show up in AI-generated summaries — worth knowing before the client is blindsided)
- [ ] Same metrics for the 3 named competitors, for the gap analysis

### 2.3 — AI answer baseline **[critical — this is the report engine]**

Run the client's money queries across every major answer engine and **screenshot everything**. This is Day-0 evidence and the baseline every monthly report is measured against. Never skip it, never do it after we've started making changes.

**Engines to test:**
- [ ] ChatGPT (with search enabled)
- [ ] Perplexity
- [ ] Google AI Overviews
- [ ] Google Gemini
- [ ] Claude (with search)
- [ ] Bing Copilot

**Query templates — run each engine against all of these:**

1. `best [service] in [city]`
2. `best [service] near [neighborhood/landmark]`
3. `top rated [business type] [city]`
4. `who should I see for [problem the service solves] in [city]`
5. `is [client business name] any good` *(brand query — what does AI say about them right now?)*
6. `[client business name] vs [competitor name]`
7. `how much does [service] cost in [city]`
8. `[service] [city] reviews`
9. Two to three long-tail questions pulled from the client's actual services list

**Log for each query:** which businesses were named, in what order, what sources were cited, and whether the client appeared at all.

**Deliverable:** Baseline scorecard — "Client appeared in X of Y queries. Competitor A appeared in Z." Screenshots archived in Mission Control.

### 2.4 — Website technical audit

- [ ] Platform identified (GoHighLevel, WordPress, Wix, Squarespace, custom)
- [ ] Schema markup present? What types? Valid?
- [ ] Page speed (mobile + desktop)
- [ ] Sitemap.xml exists and is accurate
- [ ] robots.txt — is anything blocking crawlers, including AI crawlers?
- [ ] llms.txt present? (Almost never — this is an easy differentiator)
- [ ] Site crawlable? JS-rendered content that bots can't read?
- [ ] Content depth: how many real pages, how many answer actual customer questions?
- [ ] Blog present? Last publish date?
- [ ] SSL valid
- [ ] Mobile usability

**Done when:** All four sub-audits complete and stored, with screenshots.

---

## Phase 3 — Findings presentation + access request

**Target: Days 3–5 | Owner: Matthew | Client call: 45 min**

### 3.1 — Build the findings doc

Structure it in this order every time:

1. **Where AI recommends your competitors instead of you** — lead with the baseline screenshots. This is the emotional hook and it's undeniable.
2. **Why** — the discrepancy log. "Your address appears three different ways across seven platforms. AI can't confirm who you are."
3. **The review gap** — client vs. competitors, side by side.
4. **The technical gap** — no schema, no answer-shaped content, etc.
5. **The fix list, ranked by impact** — what we do in the next 21 days.
6. **What we need from you** — the access list, and only the access list.

### 3.2 — Run the findings call

- [ ] Walk through the doc top to bottom
- [ ] Confirm the canonical NAP record with the client, out loud, field by field ("we're standardizing on this exact format everywhere — confirm?")
- [ ] Present the access list as the natural consequence of the findings, not as a separate ask
- [ ] Schedule the 30-minute access screen-share (don't leave access to email follow-up — it stalls)

### 3.3 — Access request list

**Always request manager/user-level access. Never ask for passwords.**

| Platform | What we need | How |
|---|---|---|
| Google Business Profile | Manager access | Client sends invite to SRT email via GBP dashboard |
| Google Search Console | Full user | Client adds SRT email |
| Google Analytics | Editor | Client adds SRT email |
| Yelp Business | Additional user | Client adds via Yelp account settings |
| Facebook Page | Admin or Editor role | Via Meta Business Suite |
| Bing Places | Manager | Client invite |
| Domain registrar / DNS | **One CNAME record added** — that's all the hybrid model needs | Screen-share, 5 minutes, client stays logged in and in control |
| Vertical directories | Case by case, per discrepancy log | Varies |

> **On DNS:** Do the CNAME on a screen-share, in the client's own registrar account, with them driving. It takes five minutes, it costs them nothing, and them watching us not touch anything else is a trust event. Do not ask them to hand over registrar credentials — that request is where deals go cold and where our liability starts.

**Common blockers and how to handle them:**
- *Unclaimed GBP listing* → claim it together on the call. Instant credibility moment.
- *Old agency still holds GBP ownership* → Google's ownership-request flow; 7-day wait. Start this immediately, it's often the long pole.
- *Client doesn't know their registrar* → look up WHOIS ahead of the call so we can tell them.
- *Duplicate GBP listings* → file for merge/removal; can take 2–3 weeks. Start early.

**Done when:** All access granted or a documented workaround is in motion for each blocker.

---

## Phase 4 — Infrastructure spin-up

**Target: Week 1 | Owner: Matthew | [AUTO] most of this once templated**

### Hybrid subdomain hub (default model)

- [ ] Choose subdomain — **standardize on one convention across all clients** (recommend `resources.` or `learn.`; pick one and never deviate, it keeps the SOP clean)
- [ ] Add `[subdomain].clientdomain.com` as a custom domain on the multi-tenant Vercel project
- [ ] Client adds the CNAME record (Phase 3 screen-share)
- [ ] Verify DNS propagation + SSL provisioned
- [ ] Create client tenant record in Supabase: branding, colors, logo, canonical NAP, services taxonomy
- [ ] Generate and inject JSON-LD schema — `LocalBusiness` / `MedicalClinic` / `HomeAndConstructionBusiness` as appropriate, using the **corrected** NAP
- [ ] Add `Physician` / `Person` schema for named providers (health vertical)
- [ ] Generate `sitemap.xml`
- [ ] Generate `llms.txt`
- [ ] Confirm `robots.txt` allows AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended)
- [ ] Add hub to Google Search Console, submit sitemap
- [ ] Add cross-links: main site → hub, hub → main site (the interlink is what passes authority in both directions)
- [ ] Smoke test: load on mobile, validate schema in Google's Rich Results Test, confirm pages render server-side

**Done when:** Hub is live on the client's subdomain with valid schema and is submitted for indexing.

---

## Phase 5 — Fix and build

**Target: Weeks 1–3 | Owner: Matthew + [VA]**

### 5.1 — Citation cleanup

- [ ] Correct every discrepancy in the log to match the canonical NAP
- [ ] Request removal/merge of duplicate listings
- [ ] Claim any unclaimed listings
- [ ] Log completion date per platform (some take weeks to reflect — track them)

### 5.2 — Google Business Profile buildout

This is the highest-leverage single asset for local AI answers. Do it thoroughly.

- [ ] Primary category set correctly (research what competitors who *are* ranking use)
- [ ] All relevant secondary categories added
- [ ] Every service listed individually with descriptions
- [ ] Business description rewritten — answer-shaped, includes services and service area naturally
- [ ] Hours + special hours
- [ ] Attributes completed (accessibility, payments, amenities)
- [ ] Photos: exterior, interior, team, service-in-action (10+ minimum)
- [ ] Products/services section populated
- [ ] Q&A section seeded with the real questions from our AI baseline queries, answered
- [ ] Booking/appointment link
- [ ] First GBP post published; cadence scheduled

### 5.3 — Content hub initial load

- [ ] 5–10 answer-shaped pages targeting the exact queries from the Phase 2.3 baseline
- [ ] Each page: direct answer in the first 100 words, clear H-structure, FAQ schema, internal links
- [ ] Provider/practitioner bio pages with credential schema (health vertical — AI weighs authorship signals heavily)
- [ ] Location/service-area page
- [ ] All content routed through the Mission Control review queue before publish

### 5.4 — Review engine

- [ ] Review request flow live (SMS/email — respect A2P status; until approved, lead-initiated or email only)
- [ ] Short-link review URLs for Google and the top vertical platform
- [ ] Response templates written for 5-star, 3-star, and 1-star scenarios
- [ ] Owner trained on the response cadence, or SRT takes it over
- [ ] Baseline review count logged for the 30-day comparison

**Done when:** Citations corrected, GBP complete, hub populated, review flow producing.

---

## Phase 6 — Ongoing rhythm

**Owner: Matthew + [AUTO]**

### Weekly
- [ ] Content published per cadence (Mission Control queue)
- [ ] GBP post published
- [ ] New reviews responded to within 48 hours

### Monthly — the report that retains the client
- [ ] **Re-run the exact same Phase 2.3 query set, same engines, same wording**
- [ ] Screenshot everything
- [ ] Build the side-by-side: Day 0 vs. today — who AI recommended then, who it recommends now
- [ ] Review count and rating delta
- [ ] Citation health check (did anything drift back?)
- [ ] Content published + traffic to hub
- [ ] Deliver with the framing: *"You're measuring me, not trusting me."*

### Quarterly
- [ ] Full re-audit (abbreviated Phase 2)
- [ ] Competitor set refresh — new entrants?
- [ ] Expand query set based on new services or seasonality
- [ ] Upsell conversation: full site migration off their current platform onto our infrastructure

---

## Appendix A — The migration conversation (Phase 6 upsell)

The hybrid hub is the entry point, not the endpoint. Once the client has seen two or three monthly reports showing movement, the migration ask gets easy:

> "The hub is doing the work — you've watched it move. But it's fighting your main site, which is slow, has no schema, and can't be updated without a ticket. Let me rebuild the whole thing on the same infrastructure. Same reporting, everything under one roof."

**Migration note for GoHighLevel clients:** GHL has no meaningful site export — the builder is proprietary. Migration means a rebuild: copy content, structure, and images into the multi-tenant app. Most GHL sites are 3–8 pages, so this is a day of work, not a project. Scope it that way and price it as a one-time build fee.

---

## Appendix B — Automation roadmap for Mission Control

Priority order for building this into the platform:

1. **AI query runner** — scheduled execution of the client's query set across engines, screenshot capture, results diffed against baseline. This single feature turns the monthly report from hours into minutes and is the backbone of retention.
2. **NAP sweep** — automated directory checks against the canonical record, flagging drift.
3. **Content pipeline** — draft → review queue → approve → publish to tenant, with schema auto-generated.
4. **Review monitoring** — new review alerts, response tracking.
5. **Onboarding checklist as a Mission Control object** — this document, as a per-client task list with completion state, so nothing gets skipped and a VA can be dropped in.

---

## Appendix C — Definition of done

A client is "onboarded" when all of the following are true:

- Canonical NAP is locked and matched across every platform in the discrepancy log
- Google Business Profile is fully built and SRT has manager access
- Content hub is live on their subdomain with valid schema and is indexed
- Baseline AI scorecard is captured and archived
- Review engine is live
- First monthly report is scheduled

Anything less, and the 30-day report will be weak — which is the only moment where this offer is at risk of churn.
