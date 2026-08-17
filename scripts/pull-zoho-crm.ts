// CLI script: pull the whole Zoho CRM into Supabase.
//
// This is the primary tool for the initial import. A Vercel route caps at 60s,
// which is the wrong shape for a full-history load — run this from a laptop
// and let it finish.
//
// Usage:
//   bun run scripts/pull-zoho-crm.ts --entity=leads --dry     # inspect first
//   bun run scripts/pull-zoho-crm.ts --entity=all             # the real import
//   bun run scripts/pull-zoho-crm.ts --entity=notes --resume  # continue after a crash
//   bun run scripts/pull-zoho-crm.ts --entity=calls --since=2026-08-01
//
// ORDER MATTERS: leads must land before notes/calls/tasks/events, because the
// activity mappers resolve their parent through an index built from contacts.
// --entity=all handles this. Running --entity=notes against an empty contacts
// table just reports everything as unmatched.
//
// Safe to re-run. Every write upserts on a unique index, so a second full pull
// should report the same totals and create nothing — that equality IS the
// acceptance test for this phase.

import {
  runPull,
  setStaleTaskDays,
  PULL_ENTITIES,
  type PullEntity,
  type PullResult,
} from "../src/lib/zoho-pull";

interface Args {
  entity: PullEntity | "all";
  dryRun: boolean;
  resume: boolean;
  maxPages?: number;
  since?: string;
}

function parseArgs(): Args {
  const out: Args = { entity: "all", dryRun: false, resume: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry" || a === "--dry-run") out.dryRun = true;
    else if (a === "--resume") out.resume = true;
    else if (a.startsWith("--entity=")) {
      const e = a.split("=")[1] as PullEntity | "all";
      if (e !== "all" && !PULL_ENTITIES.includes(e as PullEntity)) {
        console.error(`Unknown entity "${e}". One of: all, ${PULL_ENTITIES.join(", ")}`);
        process.exit(1);
      }
      out.entity = e;
    } else if (a.startsWith("--pages=")) {
      out.maxPages = parseInt(a.split("=")[1], 10);
    } else if (a.startsWith("--since=")) {
      out.since = a.split("=")[1];
    } else if (a.startsWith("--stale-task-days=")) {
      // An open Zoho task this far past due is imported as cancelled rather
      // than as a live follow-up. 0 disables, importing every open task as-is.
      setStaleTaskDays(parseInt(a.split("=")[1], 10));
    } else {
      console.error(`Unknown argument "${a}"`);
      process.exit(1);
    }
  }
  return out;
}

function pad(n: number): string {
  return String(n).padStart(7);
}

function printResult(r: PullResult) {
  console.log(`  ${r.entity.padEnd(16)} seen ${pad(r.seen)}  written ${pad(r.created + r.updated)}  unmatched ${pad(r.unmatched)}  errored ${pad(r.errored)}  ${r.complete ? "✓ complete" : "… more pages"}`);
  for (const e of r.errors.slice(0, 5)) {
    console.log(`      ! ${e.slice(0, 220)}`);
  }
  if (r.errors.length > 5) {
    console.log(`      ! …and ${r.errors.length - 5} more`);
  }
}

async function main() {
  const opts = parseArgs();

  console.log("Zoho → Supabase Pull");
  console.log("────────────────────");
  console.log(`  Entity:  ${opts.entity}`);
  console.log(`  Dry run: ${opts.dryRun}`);
  console.log(`  Resume:  ${opts.resume}`);
  if (opts.maxPages) console.log(`  Pages:   ${opts.maxPages}`);
  if (opts.since) console.log(`  Since:   ${opts.since}`);
  console.log("");

  const start = Date.now();
  let lastLine = "";

  const results = await runPull({
    entity: opts.entity,
    dryRun: opts.dryRun,
    resume: opts.resume,
    maxPages: opts.maxPages,
    since: opts.since,
    onProgress: (entity, seen, written) => {
      const line = `  ${entity}: ${seen} seen, ${written} written`;
      if (line !== lastLine) {
        process.stdout.write(`${line}\r`);
        lastLine = line;
      }
    },
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("");
  console.log("");
  console.log("Result");
  console.log("──────");
  for (const r of results) printResult(r);
  console.log("");
  console.log(`  Elapsed: ${elapsed}s`);

  const incomplete = results.filter((r) => !r.complete);
  if (incomplete.length > 0) {
    console.log("");
    console.log("  Not finished — the page budget ran out. Continue with:");
    for (const r of incomplete) {
      console.log(`    bun run scripts/pull-zoho-crm.ts --entity=${r.entity} --resume`);
    }
  }

  const unmatched = results.reduce((n, r) => n + r.unmatched, 0);
  if (unmatched > 0) {
    console.log("");
    console.log(`  ${unmatched} activities had no matching contact.`);
    console.log("  Some of that is normal (notes on Accounts, tasks on Contacts).");
    console.log("  A large number means leads didn't import first — run --entity=leads.");
  }

  const errored = results.reduce((n, r) => n + r.errored, 0);
  process.exit(errored > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
