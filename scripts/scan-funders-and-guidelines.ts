// One-shot funder discovery + underwriting-guideline harvester.
//
// Scans Sent Items of submissions@ and matthew@ to build the funder list (name,
// domain, ordered To-list, CC-set, how often we sent there), then scans the Inbox
// of both mailboxes for underwriting-guideline PDFs from those funder domains and
// saves them to a local review folder grouped by funder. Writes _funders-list.md +
// _funders.csv summarizing everything. READ-ONLY against mail + Supabase; the only
// writes are local files.
//
// Usage:
//   bun run scripts/scan-funders-and-guidelines.ts
//   bun run scripts/scan-funders-and-guidelines.ts --since=2025-09-01 --no-pdfs
//   bun run scripts/scan-funders-and-guidelines.ts --out="C:\\Users\\matth\\Desktop\\Funder Guidelines"

import { promises as fs } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";

const MAILBOXES = ["submissions@srtagency.com", "matthew@srtagency.com"];
const INTERNAL_DOMAINS = new Set(["srtagency.com"]);
// Personal / free webmail + consumer domains are merchants or test sends, not funders.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
  "protonmail.com", "proton.me", "ymail.com", "googlemail.com", "mac.com", "mail.com",
]);
function isExcludedDomain(dom: string): boolean {
  return !dom || INTERNAL_DOMAINS.has(dom) || PERSONAL_DOMAINS.has(dom);
}
const DEFAULT_SINCE_DAYS = 180;
const SENT_LIMIT_PER_MAILBOX = 2500;
const INBOX_MSG_CAP_PER_MAILBOX = 4000;
const MAX_PDFS = 600;
const DEFAULT_OUT = "C:\\Users\\matth\\Desktop\\Funder Guidelines";

const GUIDELINE_KEYWORDS = [
  "guideline", "guidelines", "guide", "partner info", "partner sheet", "rate sheet",
  "program", "criteria", "iso", "spec", "pricing", "matrix", "buy rate", "buyrate",
  "requirements", "onboarding", "underwriting", "uw", "stip", "stips", "parameters", "box",
];

interface Args { since?: string; out: string; noPdfs: boolean; }

function parseArgs(): Args {
  const out: Args = { out: DEFAULT_OUT, noPdfs: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--no-pdfs") out.noPdfs = true;
    else if (a.startsWith("--since=")) out.since = a.split("=")[1];
    else if (a.startsWith("--out=")) out.out = a.split("=")[1];
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
  return at < 0 ? "" : email.slice(at + 1).toLowerCase().trim();
}

function isGuidelinePdf(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  return GUIDELINE_KEYWORDS.some((kw) => lower.includes(kw));
}

function externalAddrs(
  recips: Array<{ emailAddress?: { address?: string; name?: string } }> | undefined,
  displayNames: Map<string, string>,
): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const r of recips ?? []) {
    const email = r.emailAddress?.address?.toLowerCase().trim();
    if (!email || !email.includes("@")) continue;
    const dom = domainOf(email);
    if (isExcludedDomain(dom)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    list.push(email);
    if (r.emailAddress?.name) displayNames.set(email, r.emailAddress.name);
  }
  return list;
}

interface Funder {
  name: string;
  domain: string;
  to_emails: string[];
  cc_emails: string[];
  count: number;
  source: string; // where we learned the routing
  guideline_files: string[];
}

function deriveName(displayNames: Map<string, string>, to: string[], domain: string): string {
  for (const addr of to) {
    const dn = (displayNames.get(addr) ?? "").trim();
    if (dn && !dn.includes("@") && !/^(submissions?|underwriting|deals?|apps?|info|sales)$/i.test(dn)) return dn;
  }
  const core = domain.split(".")[0] || domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

// ── Step 1: funder routing from Sent Items (both mailboxes) ──
async function scanSent(args: Args, displayNames: Map<string, string>): Promise<Map<string, Funder>> {
  const sinceMs = new Date(sinceISO(args)).getTime();
  // domain -> signature(JSON) -> {count, to, cc}
  const byDomain = new Map<string, { name: string; sigs: Map<string, { count: number; to: string[]; cc: string[] }> }>();

  for (const mailbox of MAILBOXES) {
    let scanned = 0;
    try {
      const iter = microsoft.listMessages({
        mailbox, folder: "sentitems", top: 100,
        select: ["id", "subject", "toRecipients", "ccRecipients", "receivedDateTime"],
      });
      for await (const msg of iter) {
        if (msg.receivedDateTime && new Date(msg.receivedDateTime).getTime() < sinceMs) break;
        scanned++;
        const to = externalAddrs(msg.toRecipients, displayNames);
        if (to.length > 0) {
          const cc = externalAddrs(msg.ccRecipients, displayNames).sort();
          const dom = domainOf(to[0]);
          const key = JSON.stringify({ to, cc });
          let bucket = byDomain.get(dom);
          if (!bucket) { bucket = { name: "", sigs: new Map() }; byDomain.set(dom, bucket); }
          const prev = bucket.sigs.get(key);
          if (prev) prev.count++; else bucket.sigs.set(key, { count: 1, to, cc });
        }
        if (scanned >= SENT_LIMIT_PER_MAILBOX) break;
      }
      console.log(`[scan] ${mailbox} sentitems: scanned ${scanned}`);
    } catch (e) {
      console.warn(`[scan] ${mailbox} sentitems FAILED: ${(e as Error).message}`);
    }
  }

  const funders = new Map<string, Funder>();
  for (const [domain, bucket] of byDomain) {
    let best: { count: number; to: string[]; cc: string[] } | null = null;
    let total = 0;
    for (const v of bucket.sigs.values()) { total += v.count; if (!best || v.count > best.count) best = v; }
    if (!best) continue;
    funders.set(domain, {
      name: deriveName(displayNames, best.to, domain),
      domain, to_emails: best.to, cc_emails: best.cc, count: total,
      source: "sent", guideline_files: [],
    });
  }
  return funders;
}

// ── Step 2: merge existing lenders (names + any domains we already know) ──
async function mergeExistingLenders(funders: Map<string, Funder>): Promise<void> {
  const { data } = await supabaseAdmin
    .from("lenders")
    .select("name, submission_email, rep_email, to_emails, cc_emails, is_active");
  for (const l of (data ?? []) as Array<{ name: string; submission_email: string | null; rep_email: string | null; to_emails: string[] | null; cc_emails: string[] | null; }>) {
    const emails = [l.submission_email, l.rep_email, ...(l.to_emails ?? []), ...(l.cc_emails ?? [])].filter(Boolean) as string[];
    const domains = new Set(emails.map(domainOf).filter((d) => !isExcludedDomain(d)));
    for (const dom of domains) {
      const existing = funders.get(dom);
      if (existing) {
        if (existing.name.toLowerCase() === dom.split(".")[0]) existing.name = l.name; // prefer real lender name
      } else {
        funders.set(dom, {
          name: l.name, domain: dom,
          to_emails: (l.to_emails ?? []).filter((e) => domainOf(e) === dom),
          cc_emails: (l.cc_emails ?? []).filter((e) => domainOf(e) === dom),
          count: 0, source: "db", guideline_files: [],
        });
      }
    }
  }
}

// ── Step 3: harvest underwriting PDFs from inboxes (both mailboxes) ──
async function harvestPdfs(args: Args, funders: Map<string, Funder>): Promise<{ saved: number; skipped: number }> {
  const since = sinceISO(args);
  // Graph rejects `hasAttachments eq true` combined with an orderby on receivedDateTime
  // ("InefficientFilter"). Filter by date only (same field as the sort) and check
  // hasAttachments per message in code.
  const filter = `receivedDateTime ge ${since}`;
  let saved = 0, skipped = 0;

  for (const mailbox of MAILBOXES) {
    let scanned = 0;
    try {
      for await (const msg of microsoft.listMessages({
        mailbox, folder: "inbox", filter, top: 100,
        select: ["id", "from", "subject", "receivedDateTime", "hasAttachments"],
      })) {
        if (saved >= MAX_PDFS) break;
        scanned++;
        if (scanned > INBOX_MSG_CAP_PER_MAILBOX) break;
        if (!(msg as unknown as { hasAttachments?: boolean }).hasAttachments) continue;
        const senderDomain = domainOf(msg.from?.emailAddress?.address ?? "");
        const funder = senderDomain ? funders.get(senderDomain) : undefined;
        if (!funder) continue;

        let attachments: Awaited<ReturnType<typeof microsoft.getMessageAttachments>>;
        try { attachments = await microsoft.getMessageAttachments(msg.id, mailbox); } catch { continue; }

        for (const att of attachments) {
          if (!att.name?.toLowerCase().endsWith(".pdf") || !att.contentBytes) continue;
          // Keep clear UW docs; also keep any sizable PDF from a funder (catches unlabeled rate sheets).
          if (!isGuidelinePdf(att.name) && att.size < 60_000) continue;

          const safe = att.name.replace(/[/\\?%*:|"<>]/g, "_");
          const dir = path.join(args.out, `${funder.name} [${funder.domain}]`.replace(/[/\\?%*:|"<>]/g, "_"));
          const dest = path.join(dir, safe);
          try {
            await fs.mkdir(dir, { recursive: true });
            try { await fs.access(dest); skipped++; if (!funder.guideline_files.includes(safe)) funder.guideline_files.push(safe); continue; } catch { /* not present, write it */ }
            await fs.writeFile(dest, Buffer.from(att.contentBytes, "base64"));
            if (!funder.guideline_files.includes(safe)) funder.guideline_files.push(safe);
            saved++;
            console.log(`  ✓ ${funder.name} — ${safe}`);
          } catch (e) {
            console.warn(`  ✗ ${funder.name}/${safe}: ${(e as Error).message}`);
          }
        }
      }
      console.log(`[scan] ${mailbox} inbox: scanned ${scanned} msgs (saved so far ${saved})`);
    } catch (e) {
      console.warn(`[scan] ${mailbox} inbox FAILED: ${(e as Error).message}`);
    }
  }
  return { saved, skipped };
}

// ── Step 4: write the review files ──
async function writeSummary(args: Args, funders: Funder[]): Promise<void> {
  await fs.mkdir(args.out, { recursive: true });
  const sorted = funders.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const csvEsc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = ["name,domain,to_emails,cc_emails,sent_count,source,guideline_files"];
  for (const f of sorted) {
    csv.push([
      csvEsc(f.name), csvEsc(f.domain), csvEsc(f.to_emails.join("; ")), csvEsc(f.cc_emails.join("; ")),
      String(f.count), csvEsc(f.source), csvEsc(f.guideline_files.join("; ")),
    ].join(","));
  }
  await fs.writeFile(path.join(args.out, "_funders.csv"), csv.join("\n"), "utf8");

  const md: string[] = [
    `# SRT Funder List — scanned ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Mailboxes: ${MAILBOXES.join(", ")} · since ${sinceISO(args).slice(0, 10)}`,
    `Funders: ${sorted.length} · with guideline PDFs: ${sorted.filter((f) => f.guideline_files.length).length}`,
    "",
    "For each funder: where to send (To / CC), how often we've sent, and any underwriting/guideline PDFs found.",
    "",
  ];
  for (const f of sorted) {
    md.push(`## ${f.name}  \`[${f.domain}]\`${f.count ? ` — sent ${f.count}×` : " — (from DB only)"}`);
    if (f.to_emails.length) md.push(`- **To:** ${f.to_emails.join(", ")}`);
    if (f.cc_emails.length) md.push(`- **CC:** ${f.cc_emails.join(", ")}`);
    if (!f.to_emails.length && !f.cc_emails.length) md.push(`- _no external recipients captured_`);
    if (f.guideline_files.length) md.push(`- **Guideline PDFs:** ${f.guideline_files.join(", ")}`);
    else md.push(`- _no guideline PDF found_`);
    md.push("");
  }
  await fs.writeFile(path.join(args.out, "_funders-list.md"), md.join("\n"), "utf8");
}

async function main() {
  const args = parseArgs();
  console.log(`\n=== Funder + guideline scan → ${args.out} ===\n`);
  const displayNames = new Map<string, string>();

  const funders = await scanSent(args, displayNames);
  await mergeExistingLenders(funders);
  console.log(`[scan] ${funders.size} funder domains total (sent + db).`);

  let pdfStats = { saved: 0, skipped: 0 };
  if (!args.noPdfs) pdfStats = await harvestPdfs(args, funders);

  await writeSummary(args, [...funders.values()]);

  console.log(`\nDone.`);
  console.log(`  Funders: ${funders.size}`);
  console.log(`  Guideline PDFs saved: ${pdfStats.saved} (skipped existing: ${pdfStats.skipped})`);
  console.log(`  Review folder: ${args.out}`);
  console.log(`  Summary: ${path.join(args.out, "_funders-list.md")} + _funders.csv`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("[scan] fatal:", e); process.exit(1); });
