// Funder-routing seeder for the email-driven submissions flow.
//
// Scans submissions@srtagency.com Sent Items and, per funder (grouped by the
// PRIMARY external recipient domain), captures the most frequent full recipient
// signature — the ORDERED To-list + the CC-set we actually used. Some funders
// require a specific set/order of people (one needs 5); this preserves that.
//
// Output per funder: { name, domain, to_emails (ordered), cc_emails, count }.
// --write upserts into `lenders`: if a lender already exists in that domain it is
// UPDATED with to_emails/cc_emails; otherwise a new row is inserted. The Slack
// card path inserts NEW funders only (updates need --write).
//
// Usage:
//   bun run scripts/seed-lenders-from-sent.ts --dry-run
//   bun run scripts/seed-lenders-from-sent.ts --since=2026-01-01 --limit=2000 --dry-run
//   bun run scripts/seed-lenders-from-sent.ts --write       # apply update/insert directly
//   bun run scripts/seed-lenders-from-sent.ts               # post the Slack approval card

import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";
import { postApprovalRequest } from "../src/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "../src/lib/ai-intel/types";

const MAILBOX = "submissions@srtagency.com";
const DEFAULT_SINCE_DAYS = 180;
const MAX_MESSAGES = 3000;
const TOP_N = 60;
const INTERNAL_DOMAINS = new Set(["srtagency.com"]);

interface Args {
  dryRun: boolean;
  write: boolean;
  limit: number;
  since?: string;
}

interface Sig {
  to: string[]; // ordered external To recipients
  cc: string[]; // sorted external CC recipients
}

interface FunderCandidate {
  name: string;
  domain: string;
  to_emails: string[];
  cc_emails: string[];
  count: number;
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

function deriveName(displayNames: Map<string, string>, to: string[], domain: string): string {
  // Prefer a real display name attached to the primary recipient.
  for (const addr of to) {
    const dn = (displayNames.get(addr) ?? "").trim();
    if (dn && !dn.includes("@") && !/^submissions?$/i.test(dn)) return dn;
  }
  const core = domain.split(".")[0] || domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

// External, ordered, de-duped (case-insensitive, first-seen order).
function externalAddrs(
  recips: Array<{ emailAddress?: { address?: string; name?: string } }> | undefined,
  displayNames: Map<string, string>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of recips ?? []) {
    const email = r.emailAddress?.address?.toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    const dom = domainOf(email);
    if (!dom || INTERNAL_DOMAINS.has(dom)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (r.emailAddress?.name) displayNames.set(email, r.emailAddress.name);
  }
  return out;
}

async function scan(args: Args): Promise<FunderCandidate[]> {
  const since = sinceISO(args);
  console.log(`[seed-lenders] scanning ${MAILBOX} Sent Items since ${since} (limit ${args.limit})`);
  const sinceMs = new Date(since).getTime();
  const displayNames = new Map<string, string>();

  // domain -> signature frequency
  const byDomain = new Map<string, Map<string, { count: number; sig: Sig }>>();
  let scanned = 0;

  const iter = microsoft.listMessages({
    mailbox: MAILBOX,
    folder: "sentitems",
    top: 100,
    select: ["id", "subject", "toRecipients", "ccRecipients", "receivedDateTime"],
  });

  for await (const msg of iter) {
    if (msg.receivedDateTime && new Date(msg.receivedDateTime).getTime() < sinceMs) break;
    scanned++;
    const to = externalAddrs(msg.toRecipients, displayNames);
    if (to.length === 0) {
      if (scanned >= args.limit) break;
      continue;
    }
    const cc = externalAddrs(msg.ccRecipients, displayNames).sort();
    const primaryDomain = domainOf(to[0]);
    const sigKey = JSON.stringify({ to, cc });
    let sigs = byDomain.get(primaryDomain);
    if (!sigs) {
      sigs = new Map();
      byDomain.set(primaryDomain, sigs);
    }
    const prev = sigs.get(sigKey);
    if (prev) prev.count++;
    else sigs.set(sigKey, { count: 1, sig: { to, cc } });
    if (scanned >= args.limit) break;
  }

  console.log(`[seed-lenders] scanned ${scanned} sent messages, found ${byDomain.size} funder domains`);

  // For each domain, take the most-frequent signature.
  const candidates: FunderCandidate[] = [];
  for (const [domain, sigs] of byDomain) {
    let best: { count: number; sig: Sig } | null = null;
    let total = 0;
    for (const v of sigs.values()) {
      total += v.count;
      if (!best || v.count > best.count) best = v;
    }
    if (!best) continue;
    candidates.push({
      name: deriveName(displayNames, best.sig.to, domain),
      domain,
      to_emails: best.sig.to,
      cc_emails: best.sig.cc,
      count: total,
    });
  }
  candidates.sort((a, b) => b.count - a.count);
  return candidates.slice(0, TOP_N);
}

interface ExistingLender {
  id: string;
  name: string;
  submission_email: string | null;
  to_emails: string[] | null;
}

async function loadExisting(): Promise<ExistingLender[]> {
  const { data } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_email, to_emails");
  return (data ?? []) as ExistingLender[];
}

// Match a candidate to an existing lender: exact email overlap first, then unique domain.
function matchExisting(c: FunderCandidate, existing: ExistingLender[]): ExistingLender | null {
  const candEmails = new Set([...c.to_emails, ...c.cc_emails]);
  for (const l of existing) {
    if (l.submission_email && candEmails.has(l.submission_email.toLowerCase())) return l;
    for (const e of l.to_emails ?? []) if (candEmails.has(e.toLowerCase())) return l;
  }
  const inDomain = existing.filter((l) => l.submission_email && domainOf(l.submission_email) === c.domain);
  return inDomain.length === 1 ? inDomain[0] : null;
}

async function main() {
  const args = parseArgs();
  const candidates = await scan(args);
  if (candidates.length === 0) {
    console.log("[seed-lenders] no funders found.");
    return;
  }

  const existing = await loadExisting();
  const updates: Array<{ lender: ExistingLender; c: FunderCandidate }> = [];
  const inserts: FunderCandidate[] = [];
  for (const c of candidates) {
    const m = matchExisting(c, existing);
    if (m) updates.push({ lender: m, c });
    else inserts.push(c);
  }

  console.log(`\n[seed-lenders] ${candidates.length} funders — ${updates.length} update existing, ${inserts.length} new:\n`);
  const fmt = (c: FunderCandidate) =>
    `  ${c.count.toString().padStart(4)}×  ${c.name}  [${c.domain}]\n` +
    `        To: ${c.to_emails.join(", ")}\n` +
    (c.cc_emails.length ? `        CC: ${c.cc_emails.join(", ")}\n` : "");
  if (updates.length) {
    console.log("── UPDATE existing lenders ──");
    for (const u of updates) console.log(`  → "${u.lender.name}"\n${fmt(u.c)}`);
  }
  if (inserts.length) {
    console.log("── INSERT new funders ──");
    for (const c of inserts) console.log(fmt(c));
  }

  if (args.dryRun) {
    console.log("\n[seed-lenders] --dry-run: nothing written.");
    return;
  }

  if (args.write) {
    let upd = 0;
    for (const { lender, c } of updates) {
      const { error } = await supabaseAdmin
        .from("lenders")
        .update({ to_emails: c.to_emails, cc_emails: c.cc_emails, recipient_source: "seeded_from_sent" })
        .eq("id", lender.id);
      if (error) console.error(`  update ${lender.name} failed:`, error.message);
      else upd++;
    }
    if (inserts.length) {
      const rows = inserts.map((c) => ({
        name: c.name,
        tier: 2,
        is_active: true,
        submission_method: "email",
        submission_email: c.to_emails[0],
        to_emails: c.to_emails,
        cc_emails: c.cc_emails,
        recipient_source: "seeded_from_sent",
      }));
      const { data, error } = await supabaseAdmin.from("lenders").insert(rows).select("id");
      if (error) console.error("  insert failed:", error.message);
      else console.log(`[seed-lenders] inserted ${data?.length ?? 0} new, updated ${upd}. Edit names/tiers on /dashboard/lenders.`);
    } else {
      console.log(`[seed-lenders] updated ${upd} lenders.`);
    }
    return;
  }

  // Slack card path: NEW funders only (updates require --write).
  if (inserts.length === 0) {
    console.log("[seed-lenders] all matched funders already exist; run with --write to refresh their To/CC.");
    return;
  }
  const channel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const lines = inserts
    .map((c) => `• *${c.name}* — To: \`${c.to_emails.join(", ")}\`${c.cc_emails.length ? ` · CC: \`${c.cc_emails.join(", ")}\`` : ""} _(${c.count}×)_`)
    .join("\n");
  const payload: PendingActionPayload = {
    action_type: "seed_lenders",
    lenders_to_seed: inserts.map((c) => ({ name: c.name, email: c.to_emails[0], to_emails: c.to_emails, cc_emails: c.cc_emails })),
  } as PendingActionPayload;

  const res = await postApprovalRequest({
    summary: `🏦 *Seed funder list* — ${inserts.length} new funders from submissions@ Sent Items.\nApprove to add them (ordered To + CC captured). Edit on /dashboard/lenders.\n\n${lines}`,
    payload,
    channel,
  });
  console.log(`[seed-lenders] posted approval card (ts=${res.slackTs ?? "—"}). 👍 to seed. (${updates.length} existing need --write to refresh.)`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("[seed-lenders] fatal:", e);
  process.exit(1);
});
