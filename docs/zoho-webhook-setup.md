# Zoho CRM → Mission Control Webhook Setup

One-time manual setup in the Zoho CRM UI. Takes ~10 minutes.

This wires Zoho's Lead `Stage` field into Mission Control so every stage
change fires a Slack thread reply and a `deal_events` row. The endpoint lives
at `https://mission.srtagency.com/api/zoho/webhook` and is authenticated by a
shared secret.

---

## Step 0 — Generate the shared secret

On your laptop:

```bash
# Produce a 32-char random secret
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Copy the output. Example: `x7B3qL2fN9pK8vR5tWzYeH1jGcDaMoSu`.

Paste it into Vercel as a **Production** environment variable:

```
ZOHO_WEBHOOK_SECRET=<the value above>
```

(Project → Settings → Environment Variables → Add.) Redeploy, or it won't
take effect until the next deploy.

Also set:

```
SLACK_PIPELINE_CHANNEL=C0AUGL4KMS5
```

---

## Step 1 — Create the Workflow Rule in Zoho

1. Log in to **Zoho CRM** → top-right gear icon → **Setup**.
2. In the left nav: **Automation → Workflow Rules**.
3. Click **+ Create Rule** (top-right).
4. Fill in:
   - **Module:** `Leads`
   - **Rule Name:** `Stage change → Mission Control`
   - **Description:** *(optional)* "Fires MC webhook whenever a Lead's Stage changes."
5. Click **Next**.

### WHEN should the rule execute?

- **Execute this workflow based on** → `A record action`
- **When a record is** → **Edited**
- Sub-option: **Specific field(s) is/are modified** → select `Stage`
- Click **Next**.

### Which leads should it apply to?

- **Condition** → `All Leads`
- Click **Next**.

### What action should happen?

- Under **Instant Actions** click **Webhooks** → **+ New**.

---

## Step 2 — Configure the webhook

Fill in exactly:

| Field | Value |
|---|---|
| **Name** | `MC stage webhook` |
| **URL to Notify** | `https://mission.srtagency.com/api/zoho/webhook?secret=PASTE_YOUR_SECRET_HERE` |
| **Method** | `POST` |
| **Module** | `Leads` |
| **Body Type** | `JSON` |
| **Authentication** | None |

### Parameters (Body)

Click **Parameters** → **Add Parameter** for each row:

| Parameter Name | Value Type | Value |
|---|---|---|
| `id` | `Leads Field` | `Lead Id` |
| `Stage` | `Leads Field` | `Stage` |
| `Modified_Time` | `Leads Field` | `Modified Time` |

*(If Zoho's "Lead Id" option is labeled differently in your org — e.g.
"Record Id" — pick that one. The endpoint just needs the Zoho record id
so it can look up the contact via `contacts.zoho_lead_id`.)*

Click **Save**.

---

## Step 3 — Attach the webhook to the rule

Back on the workflow screen, under **Instant Actions → Webhooks**, tick the
box next to **MC stage webhook**.

Leave **Scheduled Actions** and everything else empty.

Click **Save**.

---

## Step 4 — Activate

Toggle the rule to **Active** (top-right of the rule detail page).

---

## Step 5 — Verify end-to-end

1. Pick any non-critical test Lead in Zoho (or create a new one).
2. Change its `Stage` field (Detail view → click the stage dropdown → pick anything different).
3. Within 10–30 seconds, you should see:
   - A row in Supabase `deal_events` with `event_type='stage_change'`, `source='zoho_webhook'`, and the `old_stage` + `new_stage` columns populated.
   - A Slack thread reply in **#pipeline-new** (or, if it's the first event for that deal, a new parent message + a thread reply beneath it).

If nothing happens, check:

- Vercel deploy logs for `POST /api/zoho/webhook` — the endpoint logs every received payload and why it skipped if it did (e.g. `skipped: no_contact` means the Zoho Lead isn't linked to a contact in Supabase by `zoho_lead_id`).
- Zoho CRM → **Setup → Automation → Actions → Webhooks → MC stage webhook → Logs**: Zoho keeps its own delivery log and will show the exact request + response for each firing.

### Troubleshooting 401 responses

`401 unauthorized — bad_secret` means the `?secret=` in the webhook URL
doesn't match the `ZOHO_WEBHOOK_SECRET` env var on Vercel. The two most
common causes:

1. You updated the env var but didn't redeploy.
2. You copy-pasted the secret with a trailing newline or space.

---

## Step 6 — Backfill / reconciliation (later)

The webhook covers real-time changes going forward. For:

- Leads whose stage was changed before this webhook existed, or
- Leads whose webhook delivery failed (Zoho retries 3x then gives up),

a separate cron at `/api/cron/zoho-sync` will reconcile every 10 min. That's
not live yet (Phase 1.2 second half). Ping in chat when you want it added —
10 minutes of work.

---

## What the payload looks like

For reference, a typical request body:

```json
{
  "id": "4287654000000123456",
  "Stage": "Pre-Approved",
  "Modified_Time": "2026-04-20T14:32:11-04:00"
}
```

The endpoint is idempotent on re-delivery: if the new stage equals the
current `deals.zoho_stage`, it returns `{ ok: true, skipped: "no_transition" }`
without posting to Slack or logging a new event.
