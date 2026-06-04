# SRT iMessage Bridge (Mac)

Pulls inbound merchant iMessages (and Matthew's own replies) from the Mac's
`~/Library/Messages/chat.db` into Mission Control, where they're filtered to
**CRM contacts only** and mirrored into each lead's Slack channel with a
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
                                  no match → DISCARD (no DB, no Slack)
                                  match    → sms_conversations + sms_messages
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

1. Copy this `mac-bridge/` folder onto the Mac (e.g. `~/srt/mac-bridge`).
2. Set the shared secret (must match `IMESSAGE_WEBHOOK_SECRET` in Vercel):
   ```sh
   export IMESSAGE_WEBHOOK_SECRET='…'   # same value as the server
   ```
3. **Run the doctor first** — checks Node, sqlite3, chat.db readability (Full Disk
   Access), the secret, and server connectivity, and posts a PASS/FAIL report to
   Slack `#srt-sub` (so you can see the result without reading the terminal):
   ```sh
   node imessage-bridge.mjs --doctor
   ```
   Fix any `FAIL` lines before continuing. The most common one is "read chat.db
   (Full Disk Access)" — it prints the exact `node` binary that needs access.
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
