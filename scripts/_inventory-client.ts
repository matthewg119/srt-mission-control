/** Read-only inventory of everything hanging off one client, before deleting it. */
import { supabaseAdmin } from "../src/lib/db";

const id = process.argv[2];
if (!id) {
  console.error("usage: _inventory-client.ts <clientId>");
  process.exit(1);
}

const { data: client } = await supabaseAdmin
  .from("clients")
  .select("*")
  .eq("id", id)
  .maybeSingle();

if (!client) {
  console.log("No such client.");
  process.exit(0);
}

const c = client as Record<string, unknown>;
console.log("CLIENT");
for (const k of [
  "id", "slug", "legal_name", "dba_name", "domain", "subdomain", "contact_id",
  "billing_status", "day_0_archived_at", "day_0_source", "ops_thread_ts",
  "slack_channel_id", "provisioned_at", "created_at",
]) {
  if (c[k] !== undefined && c[k] !== null) console.log(`  ${k}: ${String(c[k])}`);
}

const TABLES = [
  "client_delivery_steps", "client_onboarding_steps", "client_docs", "client_hosts",
  "client_pages", "client_dns_records", "client_messages", "client_drafts",
  "page_candidates", "question_bank", "harvest_runs", "nap_discrepancies",
  "review_audit_rows", "review_tool_submissions", "hub_hits", "time_log",
  "client_question_sets", "client_weekly_reports", "competitor_candidates",
  "page_studio_sessions", "page_sources", "page_gate_runs",
];

console.log("\nROWS THAT WOULD GO WITH IT");
for (const t of TABLES) {
  const { count, error } = await supabaseAdmin
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);
  if (error) console.log(`  ${t.padEnd(26)} -- ${error.message.slice(0, 60)}`);
  else if ((count ?? 0) > 0) console.log(`  ${t.padEnd(26)} ${count}`);
}

// Published pages are the only thing here that is visible to the public.
const { data: pub } = await supabaseAdmin
  .from("client_pages")
  .select("slug, title, status, published_at")
  .eq("client_id", id);
const published = (pub ?? []).filter((p) => p.status === "published");
console.log(`\nPUBLISHED PAGES (live on the client's own domain): ${published.length}`);
for (const p of published) console.log(`  /${p.slug as string} - ${p.title as string}`);

// Hostnames attached to the Vercel project. Deleting the row does NOT detach the domain.
const { data: hosts } = await supabaseAdmin
  .from("client_hosts")
  .select("host, kind, vercel_attached_at, vercel_verified")
  .eq("client_id", id);
console.log(`\nVERCEL HOSTNAMES: ${(hosts ?? []).length}`);
for (const h of hosts ?? []) {
  console.log(
    `  ${h.host as string} (${h.kind as string}) attached=${Boolean(h.vercel_attached_at)} verified=${String(h.vercel_verified)}`
  );
}

// The contact this client was reconciled against. Deleting the client must NOT touch it.
if (c.contact_id) {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, company, email, stage")
    .eq("id", c.contact_id as string)
    .maybeSingle();
  console.log("\nLINKED CRM CONTACT (kept, not deleted)");
  console.log(`  ${JSON.stringify(contact)}`);
}

process.exit(0);
