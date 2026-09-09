// Which of the two 2026-09-08 migrations are actually visible to the app?
//
// ‼️ POSTGREST CACHES THE SCHEMA, so "column does not exist" can mean the migration has not run
// OR that it ran seconds ago and the cache has not reloaded. Those need different answers, so
// this reports the exact error rather than a yes/no.
//
//   bunx tsx --env-file=.env.local scripts/_probe-migration-check.ts
import { supabaseAdmin } from "@/lib/db";

async function probe(label: string, table: string, columns: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select(columns).limit(1);
  if (!error) {
    console.log(`  OK   ${label}`);
    return true;
  }
  console.log(`  MISS ${label}`);
  console.log(`       ${error.message}`);
  if (error.code) console.log(`       code ${error.code}`);
  return false;
}

async function main() {
  console.log("\ndocs/2026-09-08-customer-review-evidence.sql");
  const a1 = await probe("page_studio_sessions.proposed_review", "page_studio_sessions", "proposed_review");

  // The CHECK constraint cannot be read through PostgREST, so it is tested by behaviour: an
  // insert with the new type either passes the constraint or is rejected by it. Rolled back
  // immediately, and it uses a client_id that cannot exist so a leaked row is impossible.
  let a2 = false;
  const fakeClient = "00000000-0000-0000-0000-000000000000";
  const { error: cErr } = await supabaseAdmin.from("page_sources").insert({
    client_id: fakeClient,
    page_id: null,
    source_type: "CUSTOMER_REVIEW",
    source_content: "probe",
    collected_via: "review_screenshot",
  });
  if (cErr?.message?.includes("page_sources_type_check")) {
    console.log("  MISS page_sources accepts CUSTOMER_REVIEW");
    console.log("       the type CHECK constraint still refuses it");
  } else if (cErr?.message?.includes("page_sources_via_check")) {
    console.log("  MISS page_sources accepts collected_via review_screenshot");
    console.log("       the via CHECK constraint still refuses it");
  } else if (cErr?.message?.toLowerCase().includes("foreign key") || cErr?.code === "23503") {
    // Refused by the client_id foreign key, which means BOTH check constraints passed first.
    console.log("  OK   page_sources accepts CUSTOMER_REVIEW and review_screenshot");
    a2 = true;
  } else if (!cErr) {
    console.log("  OK   page_sources accepts CUSTOMER_REVIEW (row inserted, deleting it)");
    await supabaseAdmin.from("page_sources").delete().eq("client_id", fakeClient);
    a2 = true;
  } else {
    console.log(`  ?    page_sources: ${cErr.message}`);
  }

  console.log("\ndocs/2026-09-08-client-ops-channel.sql");
  const b1 = await probe("clients.ops_channel_id", "clients", "ops_channel_id");
  const b2 = await probe("clients.ops_channel_name", "clients", "ops_channel_name");
  const b3 = await probe("clients.ops_index_ts", "clients", "ops_index_ts");

  const reviewOk = a1 && a2;
  const channelOk = b1 && b2 && b3;

  console.log("");
  console.log(`  customer-review-evidence  ${reviewOk ? "LIVE" : "NOT APPLIED"}`);
  console.log(`  client-ops-channel        ${channelOk ? "LIVE" : "NOT APPLIED"}`);

  if (!reviewOk || !channelOk) {
    console.log("");
    console.log("If you just ran it, PostgREST may still be serving a cached schema. In the");
    console.log("Supabase SQL editor:  notify pgrst, 'reload schema';");
    console.log("Then re-run this. If it still says NOT APPLIED, the block did not execute.");
    process.exit(1);
  }
  console.log("\nBoth applied.");
}

main();

export {};
