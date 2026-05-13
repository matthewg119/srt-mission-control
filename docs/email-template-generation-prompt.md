# Email Template Generation Prompt
# Paste everything below this line into a new Claude session

---

You are writing email templates for **Matthew** at **SRT Agency**, a business funding brokerage that helps small businesses get Merchant Cash Advances (MCAs). Matthew is the founder and primary relationship manager.

**Tone:** Direct, confident, no fluff. Conversational but professional. Short paragraphs. Never desperate or pushy. Never say "I hope this email finds you well." No emojis. No bullet lists unless truly necessary. Sound like a smart person who texts, not a marketing department.

**About SRT Agency:**
- Helps small businesses get funded via MCAs and other alternative business financing products
- Speed and simplicity are the core value props — get funded in 24–72 hours, minimal paperwork
- No hard credit pull on the initial application
- Matthew personally reviews every file and submits to lenders
- The portal (portal.srtagency.com) is where clients track their application and upload bank statements

**Magic link:** Some emails include `{magic_link}` — this is a personalized portal login link that gets replaced at send time. When referencing it, frame it as "your funding portal" or "your portal."

---

## What to generate

Write **email body HTML** for each sequence below. Each email should be a complete `<p>`, `<ul>`, `<ol>` HTML fragment (no `<html>/<body>` wrapper). Use `{{first_name}}` for the contact's first name. End every email with `<p>— Matthew</p>` (no more, no less — the Outlook signature is appended automatically).

Keep emails **short**. Under 150 words preferred. Under 100 words is even better if the message is complete. Never pad.

---

## SEQUENCE 1: FU — New Inbound Lead (`fu-new-inbound`)
> Contact submitted a web form or was entered into CRM. No application started yet. Goal: get them to start the application or reply.

**Step 1 — Day 1** (subject: "Following up on your inquiry")
Write a short, direct opening email. Acknowledge their interest without being sycophantic. Tell them the next step is a 5-minute application at srtagency.com/apply. No pressure, just clarity on what happens next.

**Step 2 — Day 3** (subject: "Still here when you're ready")
Brief check-in. One concrete reason to act now vs. later (queue, funding timing, etc.). Keep it under 80 words.

**Step 3 — Day 7** (subject: "Quick question")
Ask one genuine question about what's holding them back or what they need the capital for. Make it feel personal, not templated. Short — under 60 words.

**Step 4 — Day 14** (subject: "Funding programs update")
New angle: something has changed or updated (programs, rates, availability). Creates FOMO without being fake. Under 100 words.

**Step 5 — Day 21** (subject: "Still thinking it over?")
Soft check-in. Acknowledge that timing matters and you're not going anywhere. Give them an easy reply option ("just reply 'yes' and I'll send next steps"). Under 80 words.

**Step 6 — Day 30** (subject: "Last check-in from me")
Clean breakup email. Not emotional. Matter-of-fact. Leave the door open. Under 70 words.

---

## SEQUENCE 2: Awaiting Bank Statements (`awaiting-statements`)
> Contact completed the application but hasn't uploaded bank statements yet. Goal: get them to send their last 3 months of business bank statements. The portal has a file upload at `{magic_link}`.

**Step 1 — Day 1** (subject: "One thing needed to move forward")
Explain that bank statements are the only bottleneck. Make uploading sound easy. Direct them to `{magic_link}` for the upload. Under 100 words.

**Step 2 — Day 3** (subject: "Statements — quick reminder")
Short nudge. Mention that files are reviewed same day once received. Under 70 words.

**Step 3 — Day 7** (subject: "How to get your statements in 2 minutes")
Step-by-step: log into your bank → Statements or Documents → download last 3 months as PDF → upload at `{magic_link}` OR reply to this email with them attached. Make it feel dead simple.

**Step 4 — Day 14** (subject: "Last request before I close your file")
Final email. State that the file will be archived if no statements are received. Leave the door open to reopen later. Under 80 words.

---

## SEQUENCE 3: Pre-Approved Nurture (`pre-approved-nurture`)
> Contact has been pre-approved — they passed underwriting criteria and a lender has expressed interest. Goal: get them to sign off and move to funded. Portal link: `{magic_link}`.

**Step 1 — Day 1** (subject: "You're pre-approved — here's what's next")
Congratulate without being over-the-top. Explain what pre-approved means (lender has reviewed, offer is ready, needs their confirmation). Tell them to log into `{magic_link}` to see the offer. Urgent but calm.

**Step 2 — Day 4** (subject: "Your offer is waiting")
Second nudge. Mention that pre-approvals have an expiration window (vague — "these don't stay on the table long"). Give them `{magic_link}` again. Under 80 words.

**Step 3 — Day 10** (subject: "Last chance on this offer")
Final email. Be direct that the offer will expire. Offer to get on a quick call to answer any questions. Under 70 words.

---

## SEQUENCE 4: Post-Call Follow-Up (`post-call-followup`)
> Matthew just had a call with this contact. Goal: recap the call, keep momentum, move toward application or next step.

**Step 1 — Day 1** (subject: "Good talking with you, {{first_name}}")
Warm but brief follow-up to the call. Reference that they spoke (no specifics needed — Claude will personalize at send time, this is the template). Remind them of the next step (application, statements, or waiting on an offer depending on their stage). Include apply link or `{magic_link}` as appropriate.

**Step 2 — Day 3** (subject: "Following up from our call")
Check if they've had a chance to take the next step. Brief. No pressure.

**Step 3 — Day 7** (subject: "Circling back")
One-liner style. Ask if they're still interested or if timing changed. Easy yes/no question.

---

## SEQUENCE 5: Approved — Renewal Nurture (`approved-nurture`)
> Contact was previously funded by SRT. Goal: stay top of mind for when they need capital again (renewals or top-ups). These are low-pressure relationship maintenance emails, one every 30 days.

**Step 1 — Month 1** (subject: "Checking in, {{first_name}}")
Simple warm check-in after they got funded. Ask how the capital is working for the business. No ask — just relationship. Under 70 words.

**Step 2 — Month 2** (subject: "How's business going?")
Another light touch. Mention that when they're ready for a renewal or top-up, the process is even faster the second time. Under 70 words.

**Step 3 — Month 3** (subject: "Renewal programs available")
Slightly more direct — new programs are available that might be a fit. Invite them to reply or log in to see options. Under 80 words.

**Step 4 — Month 4** (subject: "Quarterly check-in")
Brief. "Just checking in — anything I can help with?" Light, human, no sell. Under 50 words.

---

## Format your output

For each email, output:

```
### [Sequence Name] — Step N (Day X)
Subject: [subject line]

[HTML email body — no html/body wrapper, ends with <p>— Matthew</p>]
```

Write all 20 emails in one pass. Do not add commentary between them.
