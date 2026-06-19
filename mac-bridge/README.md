# SRT iMessage Bridge (Mac)

Pulls inbound merchant iMessages (and Matthew's own replies) from the Mac's
`~/Library/Messages/chat.db` into Mission Control, where each sender is matched
to a CRM contact (resolving unknown numbers against Zoho live and seeding a
contact on the fly) and mirrored into the lead's Slack channel with a
Vektor-drafted reply suggestion.

**Outbound is manual.** Matthew copies the suggested reply from Slack and pastes
it into the Messages app. The bridge then re-ingests that sent message and
mirrors it back to Slack. There is no automated send path.

## How it works

```
chat.db ──(sqlite3 read-only snapshot)──▶ imessage-bridge.mjs
        ──POST {messages:[…]}── X-Imessage-Secret ──▶ /api/imessage/inbound
                                                          │
                            normalizePhone → match contacts.phone/mobile_phone
                                  no match → searchLeads in Zoho → seed contact
                                  still unknown → thread stored under the phone #
                                  matched/resolved → sms_conversations + sms_messages
                                             → lead Slack channel + suggestion card
```

- Pure Node + the system `/usr/bin/sqlite3` (ships with macOS). No native
  modules, no BlueBubbles.
- Reads **both** directions (`is_from_me`), so your own replies show in Slack too.
- Dedupes on the chat.db message GUID server-side — safe to re-run / overlap.

## Requirements

- macOS with the Messages app signed into the Apple ID that holds the merchant
  threads, and the Mac left on (the agent keeps running).
- Node 18+ (`/usr/local/bin/node` — adjust the plist if yours differs; find it
  with `which node`).
- **Full Disk Access** for the `node` binary: System Settings → Privacy &
  Security → Full Disk Access → add your node binary. Required to read chat.db.

## Setup

### 0. Prerequisites (do these ONCE, before touching the Mac)

**a) Apply the two Supabase migrations.** Contact matching and dedupe depend on
columns that are added manually in the Supabase SQL editor. If they're missing,
contact matching errors out server-side and `--backfill` silently imports **0**.
Run both in the SQL editor (safe to re-run):

- `docs/2026-05-30-imessage-transport.sql` → `sms_messages.imessage_guid`
- `docs/2026-06-04-contacts-phone-last10.sql` → `contacts.phone_last10` / `mobile_last10`

Verify they took (expect 2 rows, then 1 row):

```sql
select column_name from information_schema.columns
where table_name='contacts' and column_name in ('phone_last10','mobile_last10');

select column_name from information_schema.columns
where table_name='sms_messages' and column_name='imessage_guid';
```

The `--doctor` step below also reports this as **"server DB migrated (contact
matching)"**, so you'll see it confirmed in `#srt-sub`.

**b) Set the shared secret in Vercel.** `IMESSAGE_WEBHOOK_SECRET` is a secret you
*generate*, not one you look up — it just has to be identical on both ends.
Generate it once, set it in Vercel, redeploy, then reuse the same value on the Mac:

```sh
openssl rand -hex 32     # generate once; this is THE secret
```

Vercel → Project → Settings → Environment Variables → `IMESSAGE_WEBHOOK_SECRET` =
that value (Production) → **redeploy** so the serverless functions pick it up.

### On the Mac

1. Copy this `mac-bridge/` folder onto the Mac (e.g. `~/srt/mac-bridge`).
2. Set the shared secret (the **same** value you put in Vercel in step 0b):
   ```sh
   export IMESSAGE_WEBHOOK_SECRET='…'   # same value as the server
   ```
3. **Run the doctor first** — checks Node, sqlite3, chat.db readability (Full Disk
   Access), the secret, server connectivity, and whether the server DB is migrated,
   and posts a PASS/FAIL report to Slack `#srt-sub` (so you can see the result
   without reading the terminal):
   ```sh
   node imessage-bridge.mjs --doctor
   ```
   Fix any `FAIL` lines before continuing. The most common one is "read chat.db
   (Full Disk Access)" — it prints the exact `node` binary that needs access. If
   "server DB migrated" FAILs, go back to step 0a.
4. **Backfill existing history** (CRM contacts only; no Slack spam — history is
   imported silently, then one summary is posted to `#srt-sub`):
   ```sh
   node imessage-bridge.mjs --backfill
   ```
5. **Run live**:
   ```sh
   node imessage-bridge.mjs          # foreground test
   ```
   or install the launchd agent so it runs on login and restarts on crash:
   ```sh
   # edit com.srt.imessage-bridge.plist: node path, script path, secret
   cp com.srt.imessage-bridge.plist ~/Library/LaunchAgents/
   launchctl load -w ~/Library/LaunchAgents/com.srt.imessage-bridge.plist
   tail -f /tmp/srt-imessage-bridge.err.log
   ```

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `IMESSAGE_WEBHOOK_SECRET` | — | **required**, must match the server |
| `IMESSAGE_API_URL` | `https://mission.srtagency.com/api/imessage/inbound` | webhook URL |
| `IMESSAGE_POLL_MS` | `10000` | live poll interval |
| `IMESSAGE_CHAT_DB` | `~/Library/Messages/chat.db` | source DB |
| `IMESSAGE_STATE_FILE` | `~/.srt-imessage-bridge-state.json` | last ROWID high-water mark |

## Notes / caveats

- On recent macOS, `message.text` is often NULL and the body lives in
  `attributedBody` (a typedstream blob). The bridge decodes it best-effort
  (`decodeAttributed`). If a rare message comes through empty, it's skipped.
- Group chats: `chat_identifier` is a group id, not a phone → those messages
  never normalize to a number and are discarded server-side.
- The bridge only reads a temp **snapshot** of chat.db; it never locks or writes
  the live database.
