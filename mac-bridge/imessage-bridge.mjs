#!/usr/bin/env node
// SRT iMessage bridge — runs on Matthew's Mac.
//
// Reads ~/Library/Messages/chat.db and POSTs new messages (both directions) to
// Mission Control's /api/imessage/inbound webhook. CRM filtering + Slack
// mirroring all happen server-side; this script just ships rows.
//
// Pure Node + the system sqlite3 CLI (/usr/bin/sqlite3, ships with macOS). No
// native modules, no BlueBubbles. Outbound is NOT handled here — replies are
// manual copy/paste from the Messages app.
//
// Usage:
//   node imessage-bridge.mjs            # live: poll every POLL_MS, ship new rows
//   node imessage-bridge.mjs --once     # one poll, then exit
//   node imessage-bridge.mjs --backfill # ship ALL history once, then finalize
//
// Env:
//   IMESSAGE_WEBHOOK_SECRET   (required) shared secret, must match the server
//   IMESSAGE_API_URL          default https://mission.srtagency.com/api/imessage/inbound
//   IMESSAGE_POLL_MS          default 10000
//   IMESSAGE_CHAT_DB          default ~/Library/Messages/chat.db
//   IMESSAGE_STATE_FILE       default ~/.srt-imessage-bridge-state.json

import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = process.env.IMESSAGE_WEBHOOK_SECRET;
const API_URL = process.env.IMESSAGE_API_URL || "https://mission.srtagency.com/api/imessage/inbound";
const POLL_MS = parseInt(process.env.IMESSAGE_POLL_MS || "10000", 10);
const CHAT_DB = process.env.IMESSAGE_CHAT_DB || join(homedir(), "Library", "Messages", "chat.db");
const STATE_FILE = process.env.IMESSAGE_STATE_FILE || join(homedir(), ".srt-imessage-bridge-state.json");
const SQLITE = "/usr/bin/sqlite3";
const PAGE = 500;

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 UTC in unix ms

if (!SECRET) {
  console.error("[bridge] IMESSAGE_WEBHOOK_SECRET is not set — refusing to start.");
  process.exit(1);
}
if (!existsSync(CHAT_DB)) {
  console.error(`[bridge] chat.db not found at ${CHAT_DB}. Grant Full Disk Access and check the path.`);
  process.exit(1);
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { lastRowid: 0 }; }
}
function writeState(s) { writeFileSync(STATE_FILE, JSON.stringify(s), "utf8"); }

// Copy chat.db (+ wal/shm) to a temp file so we never lock the live database.
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

// chat.chat_identifier is the counterpart handle for 1:1 chats (phone/email) and
// a group id for group chats (those won't normalize to a phone → discarded server-side).
function queryPage(dbPath, sinceRowid) {
  const sql =
    `SELECT m.ROWID AS rowid, m.guid AS guid, c.chat_identifier AS handle, ` +
    `m.text AS text, hex(m.attributedBody) AS attributed_hex, ` +
    `m.is_from_me AS is_from_me, m.date AS date ` +
    `FROM message m ` +
    `JOIN chat_message_join cmj ON cmj.message_id = m.ROWID ` +
    `JOIN chat c ON c.ROWID = cmj.chat_id ` +
    `WHERE m.ROWID > ${Number(sinceRowid) || 0} ` +
    `ORDER BY m.ROWID ASC LIMIT ${PAGE};`;
  const out = execFileSync(SQLITE, ["-json", "-readonly", dbPath, sql], { maxBuffer: 256 * 1024 * 1024 }).toString();
  return out.trim() ? JSON.parse(out) : [];
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
    is_from_me: row.is_from_me === 1 || row.is_from_me === true,
    date: appleDateToISO(row.date),
  };
}

async function post(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Imessage-Secret": SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`server ${res.status}: ${await res.text()}`);
  return res.json();
}

async function poll({ backfill = false } = {}) {
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

const args = process.argv.slice(2);
if (args.includes("--backfill")) {
  await poll({ backfill: true });
} else if (args.includes("--once")) {
  await poll();
} else {
  console.log(`[bridge] live mode — polling ${CHAT_DB} every ${POLL_MS}ms`);
  for (;;) {
    try { await poll(); } catch (e) { console.error("[bridge] poll error:", e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
