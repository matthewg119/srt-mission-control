// One-time funder-list seeder for the email-driven submissions flow.
//
// Scans the submissions@srtagency.com Sent Items, groups by recipient address,
// and proposes a funder -> submission_email list. Posts ONE Slack approval card
// to #srt-sub; on 👍 a `seed_lenders` action upserts the rows into `lenders`
// (submission_method='email', is_active=true). Fix names/tiers afterward on
// /dashboard/lenders.
//
// Usage:
//   bun run scripts/seed-lenders-from-sent.ts --dry-run
//   bun run scripts/seed-lenders-from-sent.ts --since=2026-01-01 --limit=2000
//   bun run scripts/seed-lenders-from-sent.ts                      # post the card
//
// Loads .env.local automatically when run via bun.

import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";
import { postApprovalRequest } from "../src/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "../src/lib/ai-intel/types";

const MAILBOX = "submissions@srtagency.com";
const DEFAULT_SINCE_DAYS = 180;
const MAX_MESSAGES = 3000;
const TOP_N = 40;                 // cap proposed funders on the card
const INTERNAL_DOMAINS = new Set(["srtagency.com"]);

interface Args {
  dryRun: boolean;
  write: boolean;
  limit: number;
  since?: string;
}

function parseArgs(): Args {
  const out: Args = { dryRun: false, write: false, limit: MAX_MESSAGES };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run" || a === "--dry") out.dryRun = true;
    else if (a === "--write") out.write = true;
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--since=")) out.since = a.split("=")[1];
  }
  return out;
}

function sinceISO(args: Args): string {
  if (args.since) return new Date(args.since).toISOString();
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_SINCE_DAYS);
  return d.toISOString();
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

// Prefer a real display name; otherwise derive a title-cased name from the domain.
function deriveName(displayName: string | undefined, email: string): string {
  const dn = (displayName ?? "").trim();
  if (dn && !dn.includes("@") && !/^submissions?$/i.test(dn)) return dn;
  const dom = domainOf(email);
  const core = dom.split(".")[0] || dom;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

async function main() {
  const args = parseArgs();
  const since = sinceISO(args);
  console.log(`[seed-lenders] scanning ${MAILBOX} Sent Items since ${since} (limit ${args.limit})`);

  // address -> { count, name, domain }
  const acc = new Map<string, { count: number; name: string; domain: string }>();
  let scanned = 0;

  // Paginate Sent Items newest-first (listMessages orders by receivedDateTime desc)
  // and stop once we pass `since`. Avoids combining $filter + $orderby on different
  // properties, which Graph rejects.
  const sinceMs = new Date(since).getTime();
  const iter = microsoft.listMessages({
    mailbox: MAILBOX,
    folder: "sentitems",
    top: 100,
    select: ["id", "subject", "toRecipients", "receivedDateTime"],
  });

  for await (const msg of iter) {
    if (msg.receivedDateTime && new Date(msg.receivedDateTime).getTime() < sinceMs) break;
    scanned++;
    for (const r of msg.toRecipients ?? []) {
      const email = r.emailAddress?.address?.toLowerCase().trim();
      if (!email || !email.includes("@")) continue;
      const dom = domainOf(email);
      if (!dom || INTERNAL_DOMAINS.has(dom)) continue;
      const prev = acc.get(email);
      if (prev) prev.count++;
      else acc.set(email, { count: 1, name: deriveName(r.emailAddress?.name, email), domain: dom });
    }
    if (scanned >= args.limit) break;
  }

  console.log(`[seed-lenders] scanned ${scanned} sent messages, found ${acc.size} distinct external recipients`);

  // Drop addresses already in lenders.
  const allEmails = [...acc.keys()];
  const existing = new Set<string>();
  for (let i = 0; i < allEmails.length; i += 200) {
    const batch = allEmails.slice(i, i + 200);
    const { data } = await supabaseAdmin.from("lenders").select("submission_email").in("submission_email", batch);
    for (const row of (data ?? []) as Array<{ submission_email: string | null }>) {
      if (row.submission_email) existing.add(row.submission_email.toLowerCase());
    }
  }

  const candidates = [...acc.entries()]
    .filter(([email]) => !existing.has(email))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, TOP_N)
    .map(([email, v]) => ({ name: v.name, email, count: v.count }));

  if (candidates.length === 0) {
    console.log("[seed-lenders] no new funders to propose (all already in lenders, or none found).");
    return;
  }

  console.log(`[seed-lenders] proposing ${candidates.length} funders:`);
  for (const c of candidates) console.log(`  ${c.count.toString().padStart(4)}×  ${c.name}  <${c.email}>`);

  if (args.dryRun) {
    console.log("\n[seed-lenders] --dry-run: not writing or posting.");
    return;
  }

  // --write: insert directly into the lenders table, skipping the Slack approval
  // card entirely (handy while Slack reactions are being fixed). Dedup already
  // removed existing submission_emails above.
  if (args.write) {
    const rows = candidates.map((c) => ({
      name: c.name,
      tier: 2,
      is_active: true,
      submission_method: "email",
      submission_email: c.email,
      cc_emails: [] as string[],
    }));
    const { data, error } = await supabaseAdmin.from("lenders").insert(rows).select("id");
    if (error) {
      console.error("[seed-lenders] insert failed:", error.message);
      process.exitCode = 1;
      return;
    }
    console.log(`\n[seed-lenders] --write: inserted ${data?.length ?? 0} funders into lenders. Edit names/tiers on /dashboard/lenders.`);
    return;
  }

  const channel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const lines = candidates.map((c) => `• *${c.name}* — \`${c.email}\` _(${c.count}×)_`).join("\n");
  const payload: PendingActionPayload = {
    action_type: "seed_lenders",
    lenders_to_seed: candidates.map((c) => ({ name: c.name, email: c.email })),
  } as PendingActionPayload;

  const res = await postApprovalRequest({
    summary: `🏦 *Seed funder list* — ${candidates.length} recipients found in submissions@ Sent Items.\nApprove to add them to the lender list (submission_email, email method). Edit names/tiers later on /dashboard/lenders.\n\n${lines}`,
    payload,
    channel,
  });

  console.log(`[seed-lenders] posted approval card to ${res.channel ?? channel} (ts=${res.slackTs ?? "—"}). 👍 to seed.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[seed-lenders] fatal:", e);
  process.exit(1);
});
