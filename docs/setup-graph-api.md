# Microsoft Graph API Setup — SRT Mission Control

Mission Control sends email **as Matthew** using Microsoft Graph with delegated OAuth. The app authenticates once via a browser-based OAuth flow; the refresh token is stored in Supabase and silently refreshed on every subsequent send. No per-email user interaction is needed.

---

## Architecture overview

```
Azure App (CLIENT_ID/SECRET/TENANT_ID)
        ↓  OAuth 2.0 authorization-code flow
Matthew's Outlook account consents
        ↓
Refresh token stored in Supabase → integrations row
        ↓  refreshed automatically in src/lib/microsoft.ts
Graph API /me/sendMail  →  email lands in Matthew's Sent folder
```

---

## Part 1 — Azure App Registration (one-time, already done for SRT)

If you ever need to re-register or set up a second environment:

1. Go to [portal.azure.com](https://portal.azure.com) and sign in with the SRT Microsoft account.

2. **App Registrations → New registration**
   - Name: `SRT Mission Control`
   - Supported account types: **Accounts in this organizational directory only** (Single tenant)
   - Redirect URI: `Web` → `https://mission.srtagency.com/api/integrations/microsoft/callback`
   - For local dev also add: `http://localhost:3000/api/integrations/microsoft/callback`
   - Click **Register**

3. **Copy the IDs from the Overview page**
   - Application (client) ID → `MICROSOFT_CLIENT_ID`
   - Directory (tenant) ID → `MICROSOFT_TENANT_ID`

4. **Certificates & secrets → New client secret**
   - Description: `Mission Control`
   - Expires: 24 months
   - Click **Add**, then immediately copy the **Value** (shown only once)
   - → `MICROSOFT_CLIENT_SECRET`

5. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**

   Add all of these:
   | Permission | Why |
   |-----------|-----|
   | `openid` | Required for OAuth sign-in |
   | `profile` | Required for OAuth sign-in |
   | `offline_access` | Enables refresh tokens (essential for background sending) |
   | `User.Read` | Read signed-in user's profile |
   | `Mail.Read` | Read inbox (for email monitoring features) |
   | `Mail.Read.Shared` | Read shared mailboxes (submissions@) |
   | `Mail.Send` | Send as Matthew |
   | `Mail.Send.Shared` | Send from shared mailboxes |
   | `Mail.ReadWrite` | Move/flag emails |
   | `Mail.ReadWrite.Shared` | Manage shared mailbox emails |
   | `Files.ReadWrite` | OneDrive file uploads |
   | `MailboxSettings.ReadWrite` | Read/write OOO and other settings |

   > **Note:** These are all *delegated* permissions — they only work when Matthew has consented and the token is active. No admin consent is required for delegated Mail.Send.

6. **(Optional) Scope sending to specific accounts**

   If you want to restrict which mailboxes the app can send from (useful for security), run this PowerShell as a tenant admin after the app is registered:

   ```powershell
   # Install module if needed: Install-Module ExchangeOnlineManagement
   Connect-ExchangeOnline -UserPrincipalName admin@srtagency.com

   # Create a mail-enabled security group
   New-DistributionGroup -Name "MissionControlSenders" -Type Security
   Add-DistributionGroupMember -Identity MissionControlSenders -Member matthew@srtagency.com
   Add-DistributionGroupMember -Identity MissionControlSenders -Member benjamin@srtagency.com

   # Scope the app to only those accounts
   New-ApplicationAccessPolicy `
     -AppId "YOUR_CLIENT_ID_HERE" `
     -PolicyScopeGroupId MissionControlSenders `
     -AccessRight RestrictAccess `
     -Description "Restrict Mission Control to matt + benjamin only"

   # Verify
   Test-ApplicationAccessPolicy -AppId "YOUR_CLIENT_ID_HERE" -Identity matthew@srtagency.com
   ```

---

## Part 2 — Environment variables

Add these to `.env.local` (never commit real values):

```env
MICROSOFT_CLIENT_ID=your-client-id-guid
MICROSOFT_CLIENT_SECRET=your-client-secret-value
MICROSOFT_TENANT_ID=your-tenant-id-guid
```

---

## Part 3 — Connect Matthew's account (one-time per environment)

After the env vars are set and the app is deployed:

1. In a browser, visit:
   ```
   https://mission.srtagency.com/api/integrations/microsoft/auth
   ```
   (or `http://localhost:3000/api/integrations/microsoft/auth` for local dev)

2. Microsoft will show a consent screen listing the permissions above. Sign in as **matthew@srtagency.com** and click **Accept**.

3. You'll be redirected back to Mission Control. The access token and refresh token are now stored in the `integrations` Supabase row with `name = 'Microsoft 365'`.

4. Verify the connection:
   ```
   GET https://mission.srtagency.com/api/integrations/microsoft/mail
   ```
   Should return the inbox JSON. If you see `"Microsoft 365 not connected"`, the OAuth flow needs to be re-run.

---

## Part 4 — Test send (PowerShell)

Quick smoke test from PowerShell after connecting:

```powershell
$body = @{
  to      = "matthewmzts@gmail.com"
  subject = "Test from Mission Control"
  message = "Graph API send test — if you see this, it works."
  isHtml  = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://mission.srtagency.com/api/integrations/microsoft/mail" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

Expected response: `{"success":true,"message":"Email sent"}`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Microsoft 365 not connected — no tokens found` | OAuth not completed | Run `/api/integrations/microsoft/auth` |
| `Token refresh failed` | Refresh token revoked (e.g., password changed) | Re-run the OAuth flow |
| `Send mail failed: 403` | Permission not granted | Verify Mail.Send is in API permissions and Matthew consented |
| `Send mail failed: 400` | Malformed request | Check `to`, `subject`, `body` fields |
| Redirect URI mismatch on consent screen | Wrong NEXT_PUBLIC_APP_URL | Verify env var matches the redirect URI in Azure |

---

## Token refresh cadence

Tokens are checked on every send in `src/lib/microsoft.ts → getValidAccessToken()`:
- If `expires_at` is more than 5 minutes in the future: uses cached token
- Otherwise: calls `refreshAccessToken()` and writes new tokens to Supabase
- If refresh fails: marks integration as `"error"` in Supabase and throws — the cron will surface this via `systemAlert()`
