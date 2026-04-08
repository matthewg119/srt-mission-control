// CLI script: sweep all Supabase contacts and ensure their Zoho lead is
// linked + up-to-date with the latest field data.
//
// Usage:
//   bun run scripts/backfill-zoho-leads.ts                    # full run
//   bun run scripts/backfill-zoho-leads.ts --dry              # dry run, no writes
//   bun run scripts/backfill-zoho-leads.ts --limit=50         # only first 50
//   bun run scripts/backfill-zoho-leads.ts --since=2026-01-01 # only updated since
//
// Loads .env.local automatically when run via bun.

import { runZohoBackfill } from "../src/lib/zoho-backfill";

function parseArgs(): { dryRun: boolean; limit?: number; since?: string } {
  const args = process.argv.slice(2);
  const out: { dryRun: boolean; limit?: number; since?: string } = { dryRun: false };
  for (const a of args) {
    if (a === "--dry" || a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--since=")) out.since = a.split("=")[1];
  }
  return out;
}

async function main() {
  const opts = parseArgs();

  console.log("Zoho Backfill");
  console.log("─────────────");
  console.log(`Dry run: ${opts.dryRun}`);
  if (opts.limit) console.log(`Limit: ${opts.limit}`);
  if (opts.since) console.log(`Since: ${opts.since}`);
  console.log("");

  const start = Date.now();

  const result = await runZohoBackfill({
    dryRun: opts.dryRun,
    limit: opts.limit,
    since: opts.since,
    onProgress: (n, total, current) => {
      if (n % 10 === 0 || n === total) {
        process.stdout.write(`  [${n}/${total}] ${current.email}\n`);
      }
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  console.log("Result");
  console.log("──────");
  console.log(`  Checked:  ${result.checked}`);
  console.log(`  Created:  ${result.created}`);
  console.log(`  Updated:  ${result.updated}`);
  console.log(`  Linked:   ${result.linked}  (existing Zoho leads matched by email)`);
  console.log(`  Skipped:  ${result.skipped}  (no email or no fields to send)`);
  console.log(`  Errored:  ${result.errored}`);
  console.log(`  Elapsed:  ${elapsed}s`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Errors:");
    for (const e of result.errors.slice(0, 20)) {
      console.log(`  - ${e.email || e.contactId}: ${e.reason.slice(0, 200)}`);
    }
    if (result.errors.length > 20) {
      console.log(`  ... and ${result.errors.length - 20} more`);
    }
  }

  // Post a summary to the CEO Slack channel (not #hot-leads — that's for sales)
  if (!opts.dryRun) {
    try {
      const { slack } = await import("../src/lib/slack-bot");
      const ceoChannel = process.env.SLACK_CEO_CHANNEL || "";
      if (ceoChannel) {
        await slack.postMessage(
          ceoChannel,
          [
            "🔄 *Zoho Backfill Complete*",
            `Checked: ${result.checked}`,
            `Created: ${result.created}  •  Updated: ${result.updated}  •  Linked: ${result.linked}`,
            `Skipped: ${result.skipped}  •  Errored: ${result.errored}`,
            `Elapsed: ${elapsed}s`,
          ].join("\n")
        );
      }
    } catch (err) {
      console.error("Failed to post Slack summary:", err);
    }
  }

  process.exit(result.errored > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
