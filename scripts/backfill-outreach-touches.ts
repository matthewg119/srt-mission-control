// One-time backfill of outreach_touches from Sent Items.
//
// outreach_touches was empty from the day it was created: logTouch() upserted against a PARTIAL
// unique index, which PostgREST cannot emit a predicate for, so every insert failed with 42P10,
// was swallowed, and returned false. sent-sweep read false as "already logged" and skipped its
// ladder advance too. See docs/2026-08-20-outreach-touch-key.sql.
//
// The daily sweep only ever looks back to its watermark, which is parked at today, so history has
// to be replayed explicitly. Runs OLDEST FIRST (replay: true) because recordOutbound() anchors
// first_sent_at on the first sighting, and does NOT advance the watermark.
//
//   bunx tsx --env-file=.env.local scripts/backfill-outreach-touches.ts --since=2026-07-01 [--max=5000] [--apply]
//
// Dry by default. --apply is required to write.

import { supabaseAdmin } from "@/lib/db";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const APPLY = process.argv.includes("--apply");

async function counts() {
  const { count: touches } = await supabaseAdmin
    .from("outreach_touches").select("id", { count: "exact", head: true });
  const { count: outbound } = await supabaseAdmin
    .from("outreach_touches").select("id", { count: "exact", head: true }).eq("direction", "outbound");
  const { data: p } = await supabaseAdmin
    .from("outreach_prospects").select("id, first_sent_at, conversation_id, last_message_id, step");
  const rows = p ?? [];
  return {
    touches: touches ?? 0,
    outbound: outbound ?? 0,
    prospects: rows.length,
    withFirstSent: rows.filter((r) => r.first_sent_at).length,
    withConversation: rows.filter((r) => r.conversation_id).length,
    withMessageId: rows.filter((r) => r.last_message_id).length,
  };
}

async function main() {
  const since = arg("since");
  if (!since) {
    console.error('Refusing to run without --since. Example: --since=2026-07-01');
    process.exit(1);
  }
  const sinceISO = new Date(`${since.length === 10 ? `${since}T00:00:00Z` : since}`).toISOString();
  const max = Math.max(1, Number(arg("max")) || 5000);

  console.log(`\nBackfill window : ${sinceISO}`);
  console.log(`Message cap     : ${max}`);
  console.log(`Mode            : ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  const before = await counts();
  console.log("BEFORE:", before, "\n");

  if (!APPLY) {
    console.log("Dry run. Re-run with --apply to write.\n");
    return;
  }

  const { runSentMailSweep } = await import("@/lib/followup-operator/sent-sweep");
  const result = await runSentMailSweep({ sinceISO, max, replay: true, writeWatermark: false });
  console.log("\nSWEEP RESULT:", result, "\n");
  if (result.error) {
    console.error("Sweep reported an error. Watermark untouched; safe to re-run.");
    process.exit(1);
  }

  const after = await counts();
  console.log("AFTER :", after, "\n");
  console.log("DELTA :", {
    touches: after.touches - before.touches,
    prospects: after.prospects - before.prospects,
    withFirstSent: after.withFirstSent - before.withFirstSent,
    withConversation: after.withConversation - before.withConversation,
  });
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
