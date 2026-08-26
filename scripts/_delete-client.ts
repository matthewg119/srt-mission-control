/**
 * Delete one client, after writing everything it owns to a JSON backup.
 *
 * Requires --yes. The backup is written BEFORE the delete and its path is printed, so this is
 * recoverable by hand if it turns out to have been the wrong call.
 *
 * It does NOT detach the client's hostnames from Vercel. Deleting client_hosts rows only removes
 * our record of them; the domains stay on the project, which is what makes re-onboarding the same
 * domain work (attachHost GETs first and finds them already attached).
 */
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "../src/lib/db";

const id = process.argv[2];
const CONFIRMED = process.argv.includes("--yes");
const OUT = process.argv[process.argv.indexOf("--out") + 1];

if (!id || !OUT) {
  console.error("usage: _delete-client.ts <clientId> --out <backup.json> --yes");
  process.exit(1);
}

const CHILD_TABLES = [
  "client_delivery_steps", "client_onboarding_steps", "client_docs", "client_hosts",
  "client_pages", "client_dns_records", "client_messages", "client_drafts",
  "page_candidates", "harvest_runs", "nap_discrepancies", "review_audit_rows",
  "review_tool_submissions", "hub_hits", "time_log", "client_question_sets",
  "client_weekly_reports", "competitor_candidates", "page_studio_sessions",
  "page_sources", "page_gate_runs",
];

const { data: client } = await supabaseAdmin.from("clients").select("*").eq("id", id).maybeSingle();
if (!client) {
  console.log("No such client. Nothing to do.");
  process.exit(0);
}

const backup: Record<string, unknown> = { client, children: {} as Record<string, unknown> };
const children = backup.children as Record<string, unknown>;

for (const t of CHILD_TABLES) {
  const { data, error } = await supabaseAdmin.from(t).select("*").eq("client_id", id);
  if (error) {
    children[t] = { error: error.message };
    continue;
  }
  if ((data ?? []).length) children[t] = data;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(backup, null, 2), "utf8");
console.log(`Backup written: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);

const counts = Object.entries(children)
  .filter(([, v]) => Array.isArray(v))
  .map(([k, v]) => `${k}=${(v as unknown[]).length}`);
console.log(`Backed up: ${counts.join(", ")}`);

if (!CONFIRMED) {
  console.log("\nDry run. Pass --yes to actually delete.");
  process.exit(0);
}

// Everything else cascades from clients.id.
const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
if (error) {
  console.error(`DELETE FAILED: ${error.message}`);
  process.exit(1);
}

const { data: gone } = await supabaseAdmin.from("clients").select("id").eq("id", id).maybeSingle();
console.log(gone ? "STILL PRESENT, delete did not take." : "Deleted.");

// What survived, and should have.
for (const t of ["client_delivery_steps", "client_pages", "client_docs", "page_candidates"]) {
  const { count } = await supabaseAdmin
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);
  if ((count ?? 0) > 0) console.log(`  !! ${t} still has ${count} rows for this id`);
}

const { data: remaining } = await supabaseAdmin.from("clients").select("id, slug, legal_name");
console.log(`\nClients remaining: ${(remaining ?? []).length}`);
for (const r of remaining ?? []) console.log(`  ${r.slug as string} - ${r.legal_name as string}`);

process.exit(0);
