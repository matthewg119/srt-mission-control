# Zoho CRM Custom SMS Buttons — Setup Guide

Three buttons for the **Leads** module detail view. Each button calls
`https://mission.srtagency.com/api/zoho/initiate-sms` and creates a Slack channel
for the lead so you can text them directly from Slack.

---

## Step 1: Get your CRON_SECRET

Find it in Vercel → Project → Settings → Environment Variables → `CRON_SECRET`.

---

## Step 2: Create each button in Zoho

Go to: **Zoho CRM → Setup → Customization → Modules → Leads → Links and Buttons → New Button**

Set the button to run a **Deluge function** (not a URL). Use the scripts below.

---

## Button 1: "📱 New Lead Text"

**Label:** `New Lead Text`  
**Where:** Detail view (Leads)  
**Execute:** Deluge function

```deluge
zohoLeadId = input.get("entityId");
cronSecret = "<paste your CRON_SECRET here>";

response = invokeurl
[
  url: "https://mission.srtagency.com/api/zoho/initiate-sms"
  type: POST
  parameters: {"zoho_lead_id": zohoLeadId, "template": "new-lead"}.toString()
  headers: {"Authorization": "Bearer " + cronSecret, "Content-Type": "application/json"}
];

info response;
```

---

## Button 2: "☎️ Nice Speaking With You"

**Label:** `Nice Speaking With You`  
**Where:** Detail view (Leads)  
**Execute:** Deluge function

```deluge
zohoLeadId = input.get("entityId");
cronSecret = "<paste your CRON_SECRET here>";

response = invokeurl
[
  url: "https://mission.srtagency.com/api/zoho/initiate-sms"
  type: POST
  parameters: {"zoho_lead_id": zohoLeadId, "template": "nice-speaking-with-you"}.toString()
  headers: {"Authorization": "Bearer " + cronSecret, "Content-Type": "application/json"}
];

info response;
```

---

## Button 3: "🔄 Follow-Up 1"

**Label:** `Follow-Up 1`  
**Where:** Detail view (Leads)  
**Execute:** Deluge function

```deluge
zohoLeadId = input.get("entityId");
cronSecret = "<paste your CRON_SECRET here>";

response = invokeurl
[
  url: "https://mission.srtagency.com/api/zoho/initiate-sms"
  type: POST
  parameters: {"zoho_lead_id": zohoLeadId, "template": "fu-1", "enroll_sequence": true}.toString()
  headers: {"Authorization": "Bearer " + cronSecret, "Content-Type": "application/json"}
];

info response;
```

---

## Step 3: Seed the real template text

Matthew: provide the 3 template bodies and I'll seed them into the `message_templates` table.
Until then the system uses these fallbacks:

- **new-lead:** "Hey {{first_name}}! This is Matthew from SRT Agency — saw you were looking into business funding. What's a good time to connect? I think we can get you something solid 💪"
- **nice-speaking-with-you:** "Hey {{first_name}}, was great speaking with you today! Just following up on what we discussed. Ready to move forward whenever you are 🤙"
- **fu-1:** "Hey {{first_name}}, just circling back — still want to help you get funded. What's been the hold up? Sometimes I can clear the path 💪"

---

## Step 4: Add Vercel env vars

Add these to Vercel → Project → Settings → Environment Variables:

```
LINQ_API_KEY=9f2b202f-a989-5ec1-8e10-4ba6ffef6d8c
LINQ_FROM_NUMBER=+14043848588
```

Also add `CRON_SECRET` to GitHub → Settings → Secrets → Actions (same value as Vercel).

---

## Step 5: Configure Linq webhook

In [Linq dashboard](https://app.linqapp.com) → Settings → Webhooks → set:
- **Webhook URL:** `https://mission.srtagency.com/api/sms/inbound`
- **Events:** Inbound messages

---

## How it works

1. Click button on any Zoho lead
2. System fetches the lead's phone from Zoho
3. SMS is sent via Linq from `+1 (404) 384-8588`
4. A Slack channel `sms-{name}-{last4}` is created automatically
5. All replies flow into that Slack channel with AI drafts for approval
6. React ✅ to send the AI draft · type your own text and press 1 or 2
