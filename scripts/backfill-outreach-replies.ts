// One-time backfill of inbound replies.
//
// No reply sweep ever existed: last_reply_scan_at was written by nothing and applyReply() was
// exported and never called, so last_reply_at was NULL on every prospect. Nothing can safely
// send a follow-up until this has run, because "has this person already answered" was
// unanswerable.
//
//   bunx tsx --env-file=.env.local scripts/backfill-outreach-replies.ts --since=2026-07-01 [--apply]
//
// Dry by default.

import { supabaseAdmin } from "@/lib/db";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const APPLY = process.argv.includes("--apply");

async function snapshot() {
  const { data: p } = await supabaseAdmin
    .from("outreach_prospects").select("id, email, state, last_reply_at, paused, closed_reason");
  const rows = p ?? [];
  const { count: inbound } = await supabaseAdmin
    .from("outreach_touches").select("id", { count: "exact", head: true }).eq("direction", "inbound");
  return {
    prospects: rows.length,
    withReply: rows.filter((r) => r.last_reply_at).length,
    inboundTouches: inbound ?? 0,
    bounced: rows.filter((r) => r.closed_reason === "bounced").length,
    rows,
  };
}

async function main() {
  const since = arg("since");
  if (!since) {
    console.error("Refusing to run without --since. Example: --since=2026-07-01");
    process.exit(1);
  }
  const sinceISO = new Date(since.length === 10 ? `${since}T00:00:00Z` : since).toISOString();
  const max = Math.max(1, Number(arg("max")) || 3000);

  console.log(`\nWindow : ${sinceISO}`);
  console.log(`Mode   : ${APPLY ? "APPLY (writes)" : "DRY RUN (writes nothing)"}\n`);

  const before = await snapshot();
  console.log(`BEFORE: prospects=${before.prospects} withReply=${before.withReply} inboundTouches=${before.inboundTouches} bounced=${before.bounced}\n`);

  if (!APPLY) {
    console.log("Dry run. Re-run with --apply to write.\n");
    return;
  }

  const { runReplyMailSweep } = await import("@/lib/followup-operator/reply-sweep");
  const result = await runReplyMailSweep({ sinceISO, max, writeWatermark: true });
  console.log("SWEEP RESULT:", result, "\n");
  if (result.error) {
    console.error("Sweep reported an error. Watermark untouched; safe to re-run.");
    process.exit(1);
  }

  const after = await snapshot();
  console.log(`AFTER : prospects=${after.prospects} withReply=${after.withReply} inboundTouches=${after.inboundTouches} bounced=${after.bounced}\n`);

  const replied = after.rows.filter((r) => r.last_reply_at);
  console.log(`WHO REPLIED (${replied.length}):`);
  for (const r of replied) {
    console.log(`  ${String(r.email).padEnd(42)} ${String(r.state).padEnd(20)} ${String(r.last_reply_at).slice(0, 10)}`);
  }
  const bounced = after.rows.filter((r) => r.closed_reason === "bounced");
  if (bounced.length) {
    console.log(`\nBOUNCED, now closed (${bounced.length}):`);
    for (const r of bounced) console.log(`  ${r.email}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
