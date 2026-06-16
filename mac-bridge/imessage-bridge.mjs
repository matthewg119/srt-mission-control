#!/usr/bin/env node
// SRT iMessage bridge — runs on Matthew's Mac.
//
// Reads ~/Library/Messages/chat.db and POSTs new messages (both directions) to
// Mission Control's /api/imessage/inbound webhook. CRM filtering + Slack
// mirroring all happen server-side; this script just ships rows.
//
// Pure Node + the system sqlite3 CLI (/usr/bin/sqlite3, ships with macOS). No
// native modules, no BlueBubbles.
//
// OUTBOUND (Option A — no LoopMessage): in live mode, after each inbound poll the
// bridge also drains the server's outbox. It GETs /api/imessage/outbox, sends each
// queued message via AppleScript to Messages, then POSTs an ack. The sent message
// then shows up as is_from_me=1 in chat.db, so the SAME inbound poll mirrors it
// into Slack + logs sms_messages — outbound needs no extra server write here.
//
// AppleScript send (iMessage ONLY — green-bubble SMS is not supported):
//   on run {targetBuddy, targetText}
//     tell application "Messages"
//       send targetText to participant targetBuddy of (1st account whose service type = iMessage)
//     end tell
//   end run
// Args are passed via osascript argv (NOT string-interpolated) so quotes/newlines
// in the body can't break the script. A buddy-of-service fallback is tried if the
// participant form fails.
//
// Usage:
//   node imessage-bridge.mjs            # live: poll every POLL_MS, ship + drain outbox
//   node imessage-bridge.mjs --once     # one poll, then exit
//   node imessage-bridge.mjs --backfill # ship ALL history once, then finalize
//   node imessage-bridge.mjs --doctor   # preflight checks; report PASS/FAIL to #srt-sub
//
// Env:
//   IMESSAGE_WEBHOOK_SECRET   (required) shared secret, must match the server
//   IMESSAGE_API_URL          default https://mission.srtagency.com/api/imessage/inbound
//   IMESSAGE_OUTBOX_URL       default = IMESSAGE_API_URL with /inbound → /outbox
//   IMESSAGE_POLL_MS          default 10000
//   IMESSAGE_CHAT_DB          default ~/Library/Messages/chat.db
//   IMESSAGE_STATE_FILE       default ~/.srt-imessage-bridge-state.json

import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir, hostname } from "node:os";
import { join } from "node:path";

const SECRET = process.env.IMESSAGE_WEBHOOK_SECRET;
const API_URL = process.env.IMESSAGE_API_URL || "https://mission.srtagency.com/api/imessage/inbound";
const OUTBOX_URL = process.env.IMESSAGE_OUTBOX_URL || API_URL.replace("/inbound", "/outbox");
const POLL_MS = parseInt(process.env.IMESSAGE_POLL_MS || "10000", 10);
const CHAT_DB = process.env.IMESSAGE_CHAT_DB || join(homedir(), "Library", "Messages", "chat.db");
const STATE_FILE = process.env.IMESSAGE_STATE_FILE || join(homedir(), ".srt-imessage-bridge-state.json");
const SQLITE = "/usr/bin/sqlite3";
const PAGE = 500;

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 UTC in unix ms
const RS = "\x1e"; // row separator (control char — never appears in message text)
const US = "\x1f"; // unit/field separator

// Loud, unmissable failure reporting (the user couldn't see prior errors).
process.on("uncaughtException", (e) => { console.error("[bridge] FATAL (uncaught):", e?.stack || e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("[bridge] FATAL (rejection):", e?.stack || e?.message || e); process.exit(1); });

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { lastRowid: 0 }; }
}
function writeState(s) { writeFileSync(STATE_FILE, JSON.stringify(s), "utf8"); }

// Copy chat.db (+ wal/shm) to a temp file so we never lock the live database.
// Throws (EPERM/EACCES) if Full Disk Access isn't granted to this node binary.
function snapshotDb() {
  const dest = join(tmpdir(), `srt-chatdb-${process.pid}.db`);
  copyFileSync(CHAT_DB, dest);
  for (const ext of ["-wal", "-shm"]) {
    if (existsSync(CHAT_DB + ext)) { try { copyFileSync(CHAT_DB + ext, dest + ext); } catch { /* ignore */ } }
  }
  return dest;
}
function cleanupSnapshot(dest) {
  for (const ext of ["", "-wal", "-shm"]) { try { rmSync(dest + ext, { force: true }); } catch { /* ignore */ } }
}

// Run sqlite3 with control-char separators (works on ALL sqlite3 versions —
// avoids -json/-csv which Big Sur's sqlite 3.32 doesn't support). Returns raw text.
function sqlite(dbPath, sql) {
  return execFileSync(
    SQLITE,
    ["-readonly", "-batch", "-noheader", "-newline", RS, "-separator", US, dbPath, sql],
    { maxBuffer: 256 * 1024 * 1024 }
  ).toString("utf8");
}

// chat.chat_identifier is the counterpart handle for 1:1 chats (phone/email) and
// a group id for group chats (those won't normalize to a phone → discarded server-side).
function queryPage(dbPath, sinceRowid) {
  const sql =
    `SELECT m.ROWID, m.guid, c.chat_identifier, ` +
    `m.text, hex(m.attributedBody), ` +
    `m.is_from_me, m.date ` +
    `FROM message m ` +
    `JOIN chat_message_join cmj ON cmj.message_id = m.ROWID ` +
    `JOIN chat c ON c.ROWID = cmj.chat_id ` +
    `WHERE m.ROWID > ${Number(sinceRowid) || 0} ` +
    `ORDER BY m.ROWID ASC LIMIT ${PAGE};`;
  const raw = sqlite(dbPath, sql);
  if (!raw) return [];
  return raw.split(RS).filter((r) => r.length > 0).map((r) => {
    const f = r.split(US);
    return {
      rowid: Number(f[0]),
      guid: f[1] ?? "",
      handle: f[2] ?? "",
      text: f[3] ?? "",
      attributed_hex: f[4] ?? "",
      is_from_me: Number(f[5]) === 1,
      date: f[6] ?? "",
    };
  });
}

// Apple stores date in nanoseconds (modern macOS) or seconds (legacy) since 2001.
function appleDateToISO(d) {
  const n = Number(d);
  if (!n) return new Date().toISOString();
  const ms = n > 1e12 ? n / 1e6 : n * 1000; // ns→ms or s→ms
  return new Date(ms + APPLE_EPOCH_MS).toISOString();
}

// Best-effort decode of attributedBody (NSAttributedString typedstream) when
// message.text is NULL (common on recent macOS). Extracts the NSString payload.
function decodeAttributed(hex) {
  if (!hex) return "";
  const buf = Buffer.from(hex, "hex");
  const marker = buf.indexOf("NSString");
  if (marker === -1) return "";
  let i = buf.indexOf(0x2b, marker); // '+' precedes the length+string
  if (i === -1) return "";
  i += 1;
  let len = buf[i]; i += 1;
  if (len === 0x81) { len = buf[i]; i += 1; }
  else if (len === 0x82) { len = buf.readUInt16LE(i); i += 2; }
  if (!len || i + len > buf.length) return "";
  return buf.slice(i, i + len).toString("utf8");
}

function toMessage(row) {
  const text = (row.text && row.text.length) ? row.text : decodeAttributed(row.attributed_hex);
  return {
    guid: row.guid,
    handle: row.handle || "",
    text: text || "",
    is_from_me: row.is_from_me === true,
    date: appleDateToISO(row.date),
  };
}

async function post(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Imessage-Secret": SECRET },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`server ${res.status}: ${txt}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

async function poll({ backfill = false } = {}) {
  if (!SECRET) throw new Error("IMESSAGE_WEBHOOK_SECRET is not set");
  if (!existsSync(CHAT_DB)) throw new Error(`chat.db not found at ${CHAT_DB}`);
  const state = readState();
  let since = backfill ? 0 : (state.lastRowid || 0);
  const dbPath = snapshotDb();
  let total = 0;
  try {
    for (;;) {
      const rows = queryPage(dbPath, since);
      if (rows.length === 0) break;
      const messages = rows.map(toMessage).filter((m) => m.guid && m.handle);
      if (messages.length) {
        const r = await post({ backfill, messages });
        total += messages.length;
        console.log(`[bridge] shipped ${messages.length} (server imported=${r.imported} dup=${r.duplicates} discarded=${r.discarded})`);
      }
      since = rows[rows.length - 1].rowid;
      if (!backfill) writeState({ lastRowid: since });
      if (rows.length < PAGE) break;
    }
  } finally {
    cleanupSnapshot(dbPath);
  }
  if (backfill) {
    writeState({ lastRowid: since }); // start live polling from the end of history
    const summary = await post({ finalizeBackfill: true });
    console.log(`[bridge] backfill done: ${summary.messages} messages / ${summary.threads} threads`);
  }
  return total;
}

// ── Outbound (outbox drain) ─────────────────────────────────────────────────
// Send one message via Messages.app over iMessage. Args go through osascript argv
// (NOT string-interpolated) so quotes/newlines in the body can't break the script.
// iMessage ONLY — green-bubble SMS via the SMS service is not handled here.
function sendViaMessages(phone, text) {
  const script =
    'on run {targetBuddy, targetText}\n' +
    '  tell application "Messages"\n' +
    '    try\n' +
    '      set targetService to 1st account whose service type = iMessage\n' +
    '      send targetText to participant targetBuddy of targetService\n' +
    '    on error\n' +
    '      send targetText to buddy targetBuddy of service "iMessage"\n' +
    '    end try\n' +
    '  end tell\n' +
    'end run';
  // osascript -e <script> -- <arg1> <arg2> passes args to the `on run` handler.
  execFileSync("/usr/bin/osascript", ["-e", script, phone, text], { timeout: 30000 });
}

// GET the server outbox, send each queued message, and ack the result. Resilient:
// a failure on one message never crashes the loop — it's acked as failed and the
// drain continues.
async function pollOutbox() {
  if (!SECRET) return;
  let messages = [];
  try {
    const res = await fetch(OUTBOX_URL, {
      method: "GET",
      headers: { "X-Imessage-Secret": SECRET },
    });
    if (!res.ok) { console.error(`[bridge] outbox GET ${res.status}`); return; }
    const json = await res.json().catch(() => ({}));
    messages = Array.isArray(json.messages) ? json.messages : [];
  } catch (e) {
    console.error("[bridge] outbox GET failed:", e.message);
    return;
  }

  for (const m of messages) {
    if (!m?.id || !m?.phone || !m?.body) continue;
    try {
      sendViaMessages(m.phone, m.body);
      await ackOutbox(m.id, true);
      console.log(`[bridge] outbox sent ${m.id} → ${m.phone}`);
    } catch (e) {
      const err = (e && e.message) ? e.message : String(e);
      console.error(`[bridge] outbox send failed ${m.id}:`, err);
      await ackOutbox(m.id, false, err);
    }
  }
}

async function ackOutbox(id, ok, error) {
  try {
    await fetch(OUTBOX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Imessage-Secret": SECRET },
      body: JSON.stringify(error ? { id, ok, error } : { id, ok }),
    });
  } catch (e) {
    console.error(`[bridge] outbox ack failed ${id}:`, e.message);
  }
}

// Preflight: run checks, print locally, and POST the report so it lands in #srt-sub.
async function doctor() {
  const checks = [];
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

  add("node", true, process.version);

  let sqliteVer = "";
  try { sqliteVer = execFileSync(SQLITE, ["--version"]).toString().trim().split(" ")[0]; add("sqlite3 present", true, sqliteVer); }
  catch (e) { add("sqlite3 present", false, e.message); }

  add("chat.db exists", existsSync(CHAT_DB), CHAT_DB);

  // The real Full Disk Access test: copy + read chat.db.
  try {
    const dbPath = snapshotDb();
    try {
      const out = sqlite(dbPath, "SELECT COUNT(*) FROM message;");
      add("read chat.db (Full Disk Access)", true, `${out.trim()} messages`);
    } finally { cleanupSnapshot(dbPath); }
  } catch (e) {
    const fda = `${e.code || ""} ${e.message}`.trim();
    add("read chat.db (Full Disk Access)", false,
      `${fda} → grant Full Disk Access to this node binary (${process.execPath}) in System Settings → Privacy & Security → Full Disk Access, then re-run`);
  }

  add("secret set", !!SECRET, SECRET ? "present" : "IMESSAGE_WEBHOOK_SECRET missing");

  // Connectivity + secret match: harmless empty batch.
  let serverOk = false;
  try {
    await post({ messages: [] });
    add("server reachable + secret OK", true, API_URL);
    serverOk = true;
  } catch (e) {
    add("server reachable + secret OK", false, `${e.message} (401 ⇒ secret mismatch with Vercel)`);
  }

  // Schema readiness — asks the server whether the contact-matching columns exist.
  // This is the check that catches a silent 0-count backfill: if the Supabase
  // migrations weren't applied, every message is discarded server-side. Only
  // meaningful once the server is reachable + the secret matches.
  if (serverOk) {
    try {
      const probe = await post({ probe: "db" });
      add("server DB migrated (contact matching)", probe.ok === true,
        probe.ok ? (probe.detail || "ready") : (probe.detail || "migrations missing — backfill would import 0"));
    } catch (e) {
      add("server DB migrated (contact matching)", false, e.message);
    }
  }

  // Try to surface the report in Slack (only works if secret+connectivity pass).
  try { await post({ diagnostics: { checks, host: hostname() } }); console.log("[bridge] doctor report posted to #srt-sub"); }
  catch (e) { console.error("[bridge] could not post doctor report to Slack:", e.message); }

  const allOk = checks.every((c) => c.ok);
  console.log(allOk ? "\n[bridge] ALL CHECKS PASS — safe to run --backfill" : "\n[bridge] ISSUES FOUND — fix the FAIL lines above, then re-run --doctor");
  return allOk;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--doctor")) {
    const ok = await doctor();
    process.exit(ok ? 0 : 1);
  } else if (args.includes("--backfill")) {
    await poll({ backfill: true });
  } else if (args.includes("--once")) {
    await poll();
  } else {
    console.log(`[bridge] live mode — polling ${CHAT_DB} every ${POLL_MS}ms (inbound + outbox)`);
    for (;;) {
      try { await poll(); } catch (e) { console.error("[bridge] poll error:", e.message); }
      try { await pollOutbox(); } catch (e) { console.error("[bridge] outbox error:", e.message); }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((e) => { console.error("[bridge] FATAL:", e?.stack || e?.message || e); process.exit(1); });
