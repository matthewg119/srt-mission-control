// Does audit_reports.website actually accept NULL? None of the column-existence checks can
// answer that, because dropping a NOT NULL leaves nothing new behind to look at.
//
// Writes ONE throwaway row and deletes it. status is 'failed' deliberately: audit-watchdog only
// selects status 'running', so nothing can pick this up in the seconds it exists.
// Run: bunx tsx --env-file=.env.local scripts/_probe-nullable.ts
import { supabaseAdmin } from "@/lib/db";

const SLUG = "zzz-nullable-probe-delete-me";

async function main() {
  // Clean up anything a previous interrupted run left behind.
  await supabaseAdmin.from("audit_reports").delete().eq("slug", SLUG);

  const { data, error } = await supabaseAdmin
    .from("audit_reports")
    .insert({
      slug: SLUG,
      website: null,
      client_name: "NULLABLE PROBE - safe to delete",
      status: "failed",
      research_source: "declared",
      error: "schema probe, not a real audit",
    })
    .select("id,website,research_source")
    .single();

  if (error) {
    console.log("FAIL: website is still NOT NULL, or the insert was rejected.");
    console.log("  ", error.message);
    console.log("\n=> docs/2026-08-19-audit-no-website.sql has NOT been applied.");
    process.exit(1);
  }

  console.log("ok: inserted a row with website = null");
  console.log("   id             :", data.id);
  console.log("   website        :", data.website);
  console.log("   research_source:", data.research_source, "(the new fourth value)");

  const { error: delErr } = await supabaseAdmin.from("audit_reports").delete().eq("slug", SLUG);
  if (delErr) {
    console.log(`\n!! COULD NOT DELETE THE PROBE ROW. Remove it by hand:`);
    console.log(`   delete from audit_reports where slug = '${SLUG}';`);
    process.exit(1);
  }

  const { count } = await supabaseAdmin
    .from("audit_reports")
    .select("id", { count: "exact", head: true })
    .eq("slug", SLUG);

  console.log("cleaned up      :", count === 0 ? "yes, row is gone" : `NO - ${count} row(s) remain`);
  process.exit(count === 0 ? 0 : 1);
}

main();
