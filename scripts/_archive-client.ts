// Archive one client whole, retire its onboarding channel, and delete it, so it can be re-onboarded from zero.
//
//   bun run --env-file=.env.local scripts/_archive-client.ts <slug> --reason "why" [--yes]
//
// Without --yes it archives nothing and prints what it would do. With --yes, in order, stopping at the first
// failure: client_archives row (read back and compared), a JSON copy under Desktop\client-backups, the ops
// channel renamed to <name>-archived-<yyyymmdd> and archived, then the client deleted and checked gone.
//
// ‼️ THE CHANNEL IS ARCHIVED, NOT EMPTIED. The bot can delete only its own messages, and the humans' replies in
// its threads would survive as orphans. Renaming first frees the name, so the new onboarding's channel is not
// adopted into the old one (createOpsChannel adopts an existing channel on name_taken).
//
// The shared research is untouched: avatar_briefs has no client_id, and question_bank rows only lose their
// harvest_run_id (ON DELETE SET NULL, measured 2026-09-15).

import fs from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "../src/lib/db";
import { archiveClient, deleteArchivedClient } from "../src/lib/clients/archive";

export {};

const slug = process.argv[2];
const yes = process.argv.includes("--yes");
const reasonAt = process.argv.indexOf("--reason");
const reason = reasonAt > 0 ? process.argv[reasonAt + 1] : "";
if (!slug || !reason) {
  console.error('usage: _archive-client.ts <slug> --reason "why" [--yes]');
  process.exit(1);
}

async function slackCall(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

const { data: client } = await supabaseAdmin
  .from("clients")
  .select("id, slug, legal_name, ops_channel_id, ops_channel_name")
  .eq("slug", slug)
  .maybeSingle();
if (!client) {
  console.error(`No client with slug ${slug}.`);
  process.exit(1);
}
console.log(`${client.legal_name} (${client.id}), channel ${client.ops_channel_name ?? "none"} ${client.ops_channel_id ?? ""}`);
if (!yes) {
  console.log("Dry run. Pass --yes to archive, retire the channel and delete.");
  process.exit(0);
}

// 1. The archive.
const archived = await archiveClient({ clientId: client.id as string, by: "scripts/_archive-client.ts", reason });
if (!archived.ok) {
  console.error(`ARCHIVE FAILED, nothing deleted: ${archived.error}`);
  process.exit(1);
}
console.log(`Archived as ${archived.archiveId}: ${Object.entries(archived.counts).map(([t, n]) => `${t}=${n}`).join(", ")}`);
console.log(`Documents with text kept: ${archived.snapshot.files.filter((f) => f.text).map((f) => `${f.filename} (${f.text!.length} chars)`).join(", ") || "none"}`);

// 2. A copy on disk, in case the database is the thing that goes wrong.
const day = new Date().toISOString().slice(0, 10);
const out = path.join("C:/Users/matth/Desktop/client-backups", `${slug}-${day}-archive.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ archiveId: archived.archiveId, snapshot: archived.snapshot }, null, 2), "utf8");
console.log(`Backup written: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);

// 3. The channel.
if (client.ops_channel_id) {
  const channel = client.ops_channel_id as string;
  const info = await slackCall("conversations.info", { channel });
  const name = ((info.channel as Record<string, unknown> | undefined)?.name as string | undefined) ?? (client.ops_channel_name as string);
  const newName = `${name}-archived-${day.replace(/-/g, "")}`.slice(0, 80);
  const renamed = await slackCall("conversations.rename", { channel, name: newName });
  console.log(renamed.ok ? `Channel renamed to #${newName}` : `Channel NOT renamed: ${renamed.error}`);
  const archivedChannel = await slackCall("conversations.archive", { channel });
  console.log(archivedChannel.ok || archivedChannel.error === "already_archived" ? "Channel archived." : `Channel NOT archived: ${archivedChannel.error}`);
}

// 4. The delete.
const deleted = await deleteArchivedClient({ clientId: client.id as string, archiveId: archived.archiveId });
if (!deleted.ok) {
  console.error(`DELETE FAILED: ${deleted.error}`);
  process.exit(1);
}
console.log(`Deleted ${client.legal_name}. Re-onboard it from Start pilot: the duplicate warning offers Import data from duplicate.`);
