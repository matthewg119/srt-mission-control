// "find lead & build draft" — Section 1: resolve a dropped deal to a lead in Mission Control
// + Zoho CRM (fuzzy on misspellings), and post a confirmation in #srt-sub. Later sections
// extend handleBuildCommand to also produce the report + the two Outlook drafts.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { findDealByName, addNoteResilient, updateLead } from "@/lib/zoho";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { callClaudeJSON, callClaudeText } from "@/lib/claude-calls";
import { fillBtfApplication, type BtfValues } from "@/lib/btf/overlay";
import { resolveSubmissionSignature } from "@/config/email-signature";
import {
  createStatementDrop,
  updateStatementDrop,
  getStatementDropByThread,
  type StatementFileRef,
  type AppFileRef,
  type StatementDropRow,
} from "./statement-drops";

/** Zoho Lead_Status picklist value used when a deal is disqualified. */
const ZOHO_DNQ_STATUS = "DNQ";

export interface LeadMatch {
  query: string;
  businessName: string | null;   // canonical name from the best match
  mcContactId: string | null;
  mcDealId: string | null;
  zohoLeadId: string | null;
  zohoDealId: string | null;
  confidence: "exact" | "fuzzy" | "none";
  candidates: Array<{ name: string; contactId: string }>;
}

type ContactRow = { id: string; business_name: string | null; zoho_lead_id: string | null };

async function logEvent(event_type: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert({ event_type, description: `[build-draft] ${event_type}`, metadata });
  } catch { /* non-fatal */ }
}

const STOP = new Set(["llc", "inc", "corp", "co", "the", "and", "group", "company", "services", "service"]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Token-overlap similarity 0..1 (Jaccard-ish, weighted to the query tokens). */
function similarity(query: string, candidate: string): number {
  const q = tokens(query);
  const c = new Set(tokens(candidate));
  if (q.length === 0) return 0;
  let hit = 0;
  for (const t of q) {
    if (c.has(t)) hit++;
    else if ([...c].some((x) => x.startsWith(t.slice(0, 4)) || t.startsWith(x.slice(0, 4)))) hit += 0.5; // prefix-fuzzy for typos
  }
  return hit / q.length;
}

/**
 * Resolve a business name to MC contact/deal + Zoho lead/deal. Exact ilike first, then a
 * token-overlap fuzzy scan so misspelled/abbreviated names still match.
 */
export async function resolveLead(query: string): Promise<LeadMatch> {
  const q = (query || "").trim();
  const base: LeadMatch = { query: q, businessName: null, mcContactId: null, mcDealId: null, zohoLeadId: null, zohoDealId: null, confidence: "none", candidates: [] };
  if (q.length < 3) return base;

  // 1) exact-ish substring
  const { data: exact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name, zoho_lead_id")
    .ilike("business_name", `%${q}%`)
    .limit(5);

  let contact: ContactRow | null = null;
  let confidence: LeadMatch["confidence"] = "none";

  if (exact && exact.length > 0) {
    contact = (exact.find((c) => (c.business_name ?? "").toLowerCase() === q.toLowerCase()) ?? exact[0]) as ContactRow;
    confidence = "exact";
    base.candidates = exact.map((c) => ({ name: (c.business_name as string) ?? "", contactId: c.id as string }));
  } else {
    // 2) fuzzy: scan candidates that share the first significant token, then rank by similarity
    const qt = tokens(q);
    if (qt.length > 0) {
      const { data: pool } = await supabaseAdmin
        .from("contacts")
        .select("id, business_name, zoho_lead_id")
        .or(qt.map((t) => `business_name.ilike.%${t}%`).join(","))
        .limit(50);
      const scored = (pool ?? [])
        .map((c) => ({ c, s: similarity(q, (c.business_name as string) ?? "") }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s);
      if (scored.length > 0) {
        contact = scored[0].c as ContactRow;
        confidence = "fuzzy";
        base.candidates = scored.slice(0, 5).map((x) => ({ name: (x.c.business_name as string) ?? "", contactId: x.c.id as string }));
      }
    }
  }

  if (contact) {
    base.mcContactId = contact.id;
    base.businessName = contact.business_name;
    base.zohoLeadId = contact.zoho_lead_id;
    base.confidence = confidence;
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("contact_id", contact.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    base.mcDealId = (deal?.id as string) ?? null;
  }

  // Zoho converted Deal (notes/tracking target) — by canonical name, else the raw query.
  base.zohoDealId = await findDealByName(base.businessName || q);
  return base;
}

/** True when a #srt-sub message is the build trigger. */
export function isBuildCommand(text: string): boolean {
  return /^\s*build\b/i.test(text || "");
}

/** Extract the business name from "build <business>" (empty → derive from thread/files later). */
export function parseBuildBusiness(text: string): string {
  return (text || "").replace(/^\s*build\s*(draft|deal)?\s*/i, "").trim();
}

// ── §3 metrics (mirrors agent/bank-statements) ───────────────────────────────
interface RevenueRow { month: string; deposits: number | null; avg_daily_ledger: number | null; deposit_count: number | null; nsf_count: number | null; }
interface BankMetrics {
  account_holder: string | null;
  account_type: "business" | "personal" | null;
  avg_monthly_deposits: number | null;
  avg_daily_balance: number | null;
  total_nsfs: number | null;
  existing_mca_positions: number | null;
  existing_mca_monthly_burden: number | null;
  revenue_trend: string | null;
  top_mca_lenders: string[];
  red_flags: string[];
  qualification_signal: string | null;
  statement_months_covered: string[];
  revenue_table: RevenueRow[];
}
const METRICS_SYSTEM = `Extract structured underwriting metrics from a bank-statement analysis report. Output JSON only:
{"account_holder":string|null,"account_type":"business"|"personal"|null,"avg_monthly_deposits":number|null,"avg_daily_balance":number|null,"total_nsfs":number|null,"existing_mca_positions":number|null,"existing_mca_monthly_burden":number|null,"revenue_trend":"growing"|"stable"|"declining"|null,"top_mca_lenders":string[],"red_flags":string[],"qualification_signal":"strong"|"moderate"|"weak"|null,"statement_months_covered":string[],"revenue_table":Array<{"month":string,"deposits":number|null,"avg_daily_ledger":number|null,"deposit_count":number|null,"nsf_count":number|null}>}
Rules: dollar values as plain numbers; statement_months_covered in YYYY-MM; revenue_table one row per month with the report's short month label; daily/weekly MCA paybacks → existing_mca_positions + top_mca_lenders; null when absent. account_type: "personal" if the account holder is an individual person's name (no business/LLC/Inc/Corp/DBA) and the activity looks like personal banking; "business" if it's a company account; null if unclear.`;

async function extractMetrics(report: string): Promise<BankMetrics> {
  const empty: BankMetrics = { account_holder: null, account_type: null, avg_monthly_deposits: null, avg_daily_balance: null, total_nsfs: null, existing_mca_positions: null, existing_mca_monthly_burden: null, revenue_trend: null, top_mca_lenders: [], red_flags: [], qualification_signal: null, statement_months_covered: [], revenue_table: [] };
  try {
    const r = await callClaudeJSON<BankMetrics>({ model: "claude-sonnet-4-6", system: METRICS_SYSTEM, user: report, maxTokens: 1800, temperature: 0.1 });
    return { ...empty, ...r.data };
  } catch (e) {
    console.warn("[build-draft] metrics extraction failed:", (e as Error).message);
    return empty;
  }
}

// Months YYYY-MM between first and last covered that are absent.
function missingMonths(covered: string[]): string[] {
  const ms = covered.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
  if (ms.length < 2) return [];
  const out: string[] = [];
  const [y0, m0] = ms[0].split("-").map(Number);
  const [y1, m1] = ms[ms.length - 1].split("-").map(Number);
  const set = new Set(ms);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m++) {
    if (m > 12) { m = 1; y++; }
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!set.has(key)) out.push(key);
  }
  return out;
}

const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

/** Concise Slack report: calculator table + missing months + draws + patterns. */
function formatReport(business: string, m: BankMetrics): string {
  const rows = m.revenue_table.map((r) =>
    `${(r.month || "").padEnd(6)} ${fmtUsd(r.deposits).padStart(10)} ${fmtUsd(r.avg_daily_ledger).padStart(10)} ${String(r.deposit_count ?? "—").padStart(4)} ${String(r.nsf_count ?? "—").padStart(4)}`
  );
  const table = rows.length
    ? ["```", "Month   Deposits   AvgLedger  #Dep  NSF", ...rows, "```"].join("\n")
    : "_no monthly table extracted_";
  const miss = missingMonths(m.statement_months_covered);
  const lines = [
    `📊 *Underwriter report — ${business}*`,
    table,
    `• *Avg monthly deposits:* ${fmtUsd(m.avg_monthly_deposits)} · *Avg daily ledger:* ${fmtUsd(m.avg_daily_balance)} · *NSFs:* ${m.total_nsfs ?? "—"}`,
    `• *Existing positions / draws:* ${m.existing_mca_positions ?? 0}${m.top_mca_lenders.length ? ` (${m.top_mca_lenders.join(", ")})` : ""}${m.existing_mca_monthly_burden ? ` · ~${fmtUsd(m.existing_mca_monthly_burden)}/mo` : ""}`,
    miss.length ? `• *⚠️ Missing statements:* ${miss.join(", ")}` : `• *Statements:* ${m.statement_months_covered.join(", ") || "—"} (no gaps)`,
    m.red_flags.length ? `• *Patterns/flags:* ${m.red_flags.slice(0, 4).join("; ")}` : null,
    `• *Signal:* ${m.qualification_signal ?? "—"}`,
  ].filter(Boolean);
  return lines.join("\n");
}

// Two-decimal money for the email deposit table ($55,100.00). The Slack report
// table keeps the rounded fmtUsd above.
const fmtUsd2 = (n: number | null | undefined) =>
  n == null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── §5 deal email — matches Matthew's target format exactly.
// Body: "Hello Team," → deposit table (2-decimal) → editable "Merchant is looking
// for…" line (filled manually before shopping) → "Best regards," → branded
// SRT Submissions signature.
function buildDealEmailHtml(rows: RevenueRow[]): string {
  const trows = rows.map((r) =>
    `<tr><td style="border:1px solid #ccc;padding:4px 8px">${r.month ?? ""}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${fmtUsd2(r.deposits)}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${fmtUsd2(r.avg_daily_ledger)}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${r.deposit_count ?? ""}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${r.nsf_count ?? ""}</td></tr>`
  ).join("");
  const table = trows
    ? `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
<tr><th style="border:1px solid #ccc;padding:4px 8px"></th><th style="border:1px solid #ccc;padding:4px 8px">Deposits</th><th style="border:1px solid #ccc;padding:4px 8px">AVG daily ledger</th><th style="border:1px solid #ccc;padding:4px 8px"># of deposits</th><th style="border:1px solid #ccc;padding:4px 8px">NSF</th></tr>${trows}</table>`
    : "";
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p>Hello Team,</p>
${table}
<p><i>Merchant is looking for $______ for ______. ASAP</i></p>
<p>Best regards,</p>
${resolveSubmissionSignature()}
</div>`;
}

/**
 * Best-effort detection of the statement's primary month (YYYY-MM) so statements
 * can be sorted newest→oldest and trimmed to the most-recent N. Cheap Haiku call;
 * returns null on any failure (caller treats null as "unknown / oldest").
 */
async function detectStatementMonth(buffer: Buffer): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 20,
        system: "You are given one bank statement PDF. Reply with ONLY its primary statement month as YYYY-MM (the month the statement period mostly covers). No other text.",
        messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } },
          { type: "text", text: "Statement month?" },
        ] }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const raw = json.content?.find((b) => b.type === "text")?.text ?? "";
    return raw.match(/\d{4}-\d{2}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Sort statement refs newest→oldest by detected month (nulls last), trim to N. */
function pickStatements<T extends { month: string | null }>(items: T[], monthsLimit: number | null): T[] {
  const sorted = [...items].sort((a, b) => {
    if (a.month && b.month) return b.month.localeCompare(a.month);
    if (a.month) return -1;
    if (b.month) return 1;
    return 0;
  });
  const trimmed = monthsLimit && monthsLimit > 0 ? sorted.slice(0, monthsLimit) : sorted;
  // Re-sort ascending for natural chronological order in the email.
  return [...trimmed].sort((a, b) => {
    if (a.month && b.month) return a.month.localeCompare(b.month);
    if (a.month) return 1;
    if (b.month) return -1;
    return 0;
  });
}

// ── §4 SRT app → BTF values ──────────────────────────────────────────────────
async function extractBtfValues(buffer: Buffer): Promise<BtfValues> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return {};
  const schema = `{"legal_business_name":s,"dba":s,"industry":s,"tax_id_ein":s,"date_of_incorporation":s,"entity_type":s,"length_of_ownership":s,"business_street":s,"business_city":s,"business_state":s,"business_zip":s,"requested_amount":s,"use_of_funds":s,"estimated_credit_score":s,"owner_name":s,"owner_ssn":s,"owner_birthday":s,"owner_ownership_pct":s,"owner_street":s,"owner_city":s,"owner_state":s,"owner_zip":s,"owner_cell_phone":s,"owner_email":s,"partner_name":s,"partner_ssn":s,"partner_birthday":s,"partner_ownership_pct":s,"partner_street":s,"partner_city":s,"partner_state":s,"partner_zip":s,"partner_cell_phone":s,"partner_email":s}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: `Extract fields from this SRT Agency merchant application for a Black Tie Funding form. Return ONLY JSON (null for missing), keys: ${schema}. Formatting: phone "(XXX) XXX-XXXX"; date_of_incorporation "MM/YYYY"; owner_birthday/partner_birthday "MM/DD/YYYY"; requested_amount "$X,XXX"; tax_id_ein "XX-XXXXXXX"; *_ownership_pct include "%"; owner_ssn full or "XXX-XX-XXXX". If the legal name has an obvious typo, use the corrected name. Leave partner_* null if 100% single owner. No markdown.`,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } },
        { type: "text", text: "Extract the application fields." },
      ] }],
    }),
  });
  if (!res.ok) { console.warn("[build-draft] BTF extract failed:", res.status); return {}; }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const raw = json.content?.find((b) => b.type === "text")?.text ?? "{}";
  let v: BtfValues = {};
  try { v = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, "")) as BtfValues; } catch { return {}; }
  v.owner_signature = v.owner_name ?? undefined;
  v.owner_signature_date = new Date().toLocaleDateString("en-US");
  return v;
}

function isAppFile(name: string): boolean {
  return /\b(application|merchant[\s_-]?app|mca[\s_-]?app|srt[\s_-]?app)\b/i.test(name) || /^application[\s_-]/i.test(name);
}

/**
 * §2–§6: a bank-statement drop in #srt-sub → analyze → report → fill BTF → two Outlook drafts.
 * Long-running; call fire-and-forget. Posts progress to the thread.
 */
export async function handleStatementDrop(args: {
  channel: string;
  threadTs: string;
  userId: string;
  files: Array<{ name?: string; url_private_download?: string; mimetype?: string; filetype?: string }>;
  text?: string;
}): Promise<void> {
  const pdfs = args.files.filter((f) => f.filetype === "pdf" || f.mimetype === "application/pdf" || /\.pdf$/i.test(f.name ?? ""));
  await logEvent("build_drafts_start", { files: args.files.length, pdfs: pdfs.length, withUrl: pdfs.filter((f) => f.url_private_download).length });
  if (pdfs.length === 0) {
    await slack.postThreadReply(args.channel, args.threadTs, "No PDF files found in that drop.");
    return;
  }
  await slack.postThreadReply(args.channel, args.threadTs, `📥 Got ${pdfs.length} PDF(s) — downloading…`);

  // Track the Slack download URL per file so the draft can be rebuilt later
  // (e.g. "3 months") by re-downloading from Slack.
  const downloaded: Array<{ name: string; buffer: Buffer; slack_url: string }> = [];
  for (const f of pdfs) {
    if (!f.url_private_download) continue;
    try { downloaded.push({ name: f.name ?? `doc-${Date.now()}.pdf`, buffer: await slack.downloadFile(f.url_private_download), slack_url: f.url_private_download }); }
    catch (e) { console.warn("[build-draft] download failed:", (e as Error).message); }
  }
  if (downloaded.length === 0) {
    await logEvent("build_drafts_no_download", { pdfs: pdfs.length });
    await slack.postThreadReply(args.channel, args.threadTs, "⚠️ Couldn't download the files from Slack (files:read scope / expired link). Re-drop or check the bot's file permissions.");
    return;
  }

  const appDoc = downloaded.find((d) => isAppFile(d.name)) ?? null;
  const statementDocs = downloaded.filter((d) => !isAppFile(d.name));
  await slack.postThreadReply(args.channel, args.threadTs, `Analyzing ${statementDocs.length} statement(s)${appDoc ? " + application" : ""}…`);

  // §3 analyze
  let metrics: BankMetrics | null = null;
  if (statementDocs.length > 0) {
    try {
      const analysis = await analyzeBankStatements(statementDocs.map((s) => ({ name: s.name, buffer: s.buffer })));
      metrics = await extractMetrics(analysis.report);
    } catch (e) {
      await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Statement analysis failed: ${(e as Error).message}`);
    }
  }

  // §1 resolve business (explicit "build X" text → else account holder from analysis)
  const guess = parseBuildBusiness(args.text ?? "") || metrics?.account_holder || "";
  const match = guess ? await resolveLead(guess) : null;
  const business = (match?.businessName || guess || "Unknown Merchant").trim();
  // Subject uses the name exactly as it appears on the statements.
  const accountHolder = (metrics?.account_holder || business).trim();

  // §2 OneDrive routing → the deal's folder
  try {
    await microsoft.createDriveFolder("Bank Statements", `Deals/${business}`).catch(() => {});
    for (const s of statementDocs) await microsoft.uploadDriveFile(`Deals/${business}/Bank Statements`, s.name, s.buffer, "application/pdf");
    if (appDoc) {
      await microsoft.createDriveFolder("Completed Package", `Deals/${business}`).catch(() => {});
      await microsoft.uploadDriveFile(`Deals/${business}/Completed Package`, appDoc.name, appDoc.buffer, "application/pdf");
    }
  } catch (e) {
    console.warn("[build-draft] OneDrive upload failed:", (e as Error).message);
  }

  // §3 report
  if (metrics) await slack.postThreadReply(args.channel, args.threadTs, formatReport(business, metrics));

  // Detect the month each statement covers (for newest→oldest sorting + month-trim).
  const statementsWithMonth = await Promise.all(
    statementDocs.map(async (s) => ({ name: s.name, buffer: s.buffer, slack_url: s.slack_url, month: await detectStatementMonth(s.buffer) }))
  );
  const statementRefs: StatementFileRef[] = statementsWithMonth.map((s) => ({ name: s.name, slack_url: s.slack_url, month: s.month }));
  const appRef: AppFileRef | null = appDoc ? { name: appDoc.name, slack_url: appDoc.slack_url } : null;
  const metricsJson = (metrics as unknown as Record<string, unknown> | null) ?? null;

  // ── Gate 1: personal bank statements → auto-DNQ, no drafts ──────────────────
  if (metrics?.account_type === "personal") {
    await dnqDeal({ channel: args.channel, threadTs: args.threadTs, accountHolder, business, match });
    await createStatementDrop({
      slackChannel: args.channel, slackThreadTs: args.threadTs, businessName: business, accountHolder,
      subject: `New Deal - ${accountHolder}`, status: "dnq", metricsJson, statementsJson: statementRefs,
      appJson: appRef, monthsLimit: null, zohoLeadId: match?.zohoLeadId ?? null, zohoDealId: match?.zohoDealId ?? null,
    });
    return;
  }

  // §4 BTF fill (+ capture the application's business name for the mismatch gate)
  let btfPdf: Buffer | null = null;
  let appBusinessName: string | null = null;
  if (appDoc) {
    try {
      const vals = await extractBtfValues(appDoc.buffer);
      appBusinessName = vals.legal_business_name ?? null;
      if (!vals.legal_business_name && business !== "Unknown Merchant") vals.legal_business_name = business;
      btfPdf = await fillBtfApplication(vals);
      await microsoft.uploadDriveFile(`Deals/${business}/Completed Package`, `BTF_App_${business}.pdf`, btfPdf, "application/pdf").catch(() => {});
    } catch (e) {
      console.warn("[build-draft] BTF fill failed:", (e as Error).message);
    }
  }

  // ── Gate 2: statements name ≠ application name → hold for a thread override ──
  if (appBusinessName && metrics?.account_holder && !namesMatch(metrics.account_holder, appBusinessName)) {
    await createStatementDrop({
      slackChannel: args.channel, slackThreadTs: args.threadTs, businessName: business, accountHolder,
      subject: `New Deal - ${accountHolder}`, status: "awaiting_name_confirm", metricsJson,
      statementsJson: statementRefs, appJson: appRef, monthsLimit: null,
      zohoLeadId: match?.zohoLeadId ?? null, zohoDealId: match?.zohoDealId ?? null,
    });
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `⚠️ *Name mismatch* — statements: *${metrics.account_holder}* vs application: *${appBusinessName}*.\nNo drafts built. Reply \`override\` to use the statement name, or \`use <name>\` to set the correct one.`
    );
    return;
  }

  // ── Build the two drafts (shared path with thread rebuilds) ─────────────────
  await buildAndPostDrafts({
    channel: args.channel, threadTs: args.threadTs, accountHolder, business, metrics,
    statements: statementsWithMonth, app: appDoc ? { name: appDoc.name, buffer: appDoc.buffer } : null,
    btfPdf, monthsLimit: null, match,
  });

  // Persist for thread controls (N-months trim, conversation).
  await createStatementDrop({
    slackChannel: args.channel, slackThreadTs: args.threadTs, businessName: business, accountHolder,
    subject: `New Deal - ${accountHolder}`, status: "built", metricsJson, statementsJson: statementRefs,
    appJson: appRef, monthsLimit: null, zohoLeadId: match?.zohoLeadId ?? null, zohoDealId: match?.zohoDealId ?? null,
  });
}

/** True if two business names plausibly refer to the same entity. */
function namesMatch(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  return similarity(a, b) >= 0.5 || similarity(b, a) >= 0.5;
}

/** Personal statements → post DNQ, set Zoho Lead_Status + note. */
async function dnqDeal(args: { channel: string; threadTs: string; accountHolder: string; business: string; match: LeadMatch | null }): Promise<void> {
  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `🚫 *DNQ — personal bank statements.* This looks like a personal account (${args.accountHolder}), not a business account. Need business statements to shop this deal.`
  );
  if (args.match?.zohoLeadId) {
    await updateLead(args.match.zohoLeadId, { Lead_Status: ZOHO_DNQ_STATUS }).catch((e) => console.warn("[build-draft] DNQ updateLead failed:", (e as Error).message));
  }
  await addNoteResilient({
    zohoLeadId: args.match?.zohoLeadId ?? null,
    businessName: args.business,
    title: `SRT — DNQ (personal statements)`,
    content: `Auto-DNQ: the statements submitted are a personal bank account, not a business account.`,
  }).catch(() => {});
}

interface StatementBuf { name: string; buffer: Buffer; month: string | null }

/** Create the Submissions (father email) draft: statements (trimmed to N) + application. */
async function createSubmissionDraft(args: {
  subject: string;
  metrics: BankMetrics | null;
  statements: StatementBuf[];
  app: { name: string; buffer: Buffer } | null;
  monthsLimit: number | null;
}): Promise<{ ok: boolean; statementsAttached: number }> {
  const picked = pickStatements(args.statements, args.monthsLimit);
  const allRows = args.metrics?.revenue_table ?? [];
  const rows = args.monthsLimit && args.monthsLimit > 0 ? allRows.slice(-args.monthsLimit) : allRows;
  const body = buildDealEmailHtml(rows);
  const attachments = [
    ...picked.map((s) => ({ name: s.name, contentType: "application/pdf", contentBytes: s.buffer.toString("base64") })),
    ...(args.app ? [{ name: args.app.name, contentType: "application/pdf", contentBytes: args.app.buffer.toString("base64") }] : []),
  ];
  try {
    await microsoft.createDraft({ subject: args.subject, body, attachments });
    return { ok: true, statementsAttached: picked.length };
  } catch (e) {
    console.warn("[build-draft] submissions draft failed:", (e as Error).message);
    return { ok: false, statementsAttached: 0 };
  }
}

/** Create both Outlook drafts (Submissions + BTF), note Zoho, post the receipt. */
async function buildAndPostDrafts(args: {
  channel: string;
  threadTs: string;
  accountHolder: string;
  business: string;
  metrics: BankMetrics | null;
  statements: StatementBuf[];
  app: { name: string; buffer: Buffer } | null;
  btfPdf: Buffer | null;
  monthsLimit: number | null;
  match: LeadMatch | null;
}): Promise<void> {
  const subject = `New Deal - ${args.accountHolder}`;
  const created: string[] = [];

  const sub = await createSubmissionDraft({ subject, metrics: args.metrics, statements: args.statements, app: args.app, monthsLimit: args.monthsLimit });
  if (sub.ok) created.push(`Submissions (father email) — ${sub.statementsAttached} statement(s)${args.app ? " + application" : ""}`);

  if (args.btfPdf) {
    try {
      await microsoft.createDraft({
        subject,
        body: buildDealEmailHtml(args.metrics?.revenue_table ?? []),
        attachments: [{ name: `BTF_App_${args.business}.pdf`, contentType: "application/pdf", contentBytes: args.btfPdf.toString("base64") }],
      });
      created.push("BTF application");
    } catch (e) { console.warn("[build-draft] BTF draft failed:", (e as Error).message); }
  }

  if (args.match?.zohoDealId || args.match?.zohoLeadId || args.business) {
    await addNoteResilient({
      zohoLeadId: args.match?.zohoLeadId ?? null,
      businessName: args.business,
      title: `SRT — Drafts built`,
      content: `• Built ${created.join(" + ") || "drafts"}\n• ${args.statements.length} statement(s) analyzed\n• Saved to OneDrive`,
    }).catch(() => {});
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    created.length
      ? `✅ Drafts ready in your Outlook *Drafts* folder (edit + send):\n• ${created.join("\n• ")}\nSubject: \`${subject}\`${args.match?.zohoDealId ? ` · Zoho Deal \`${args.match.zohoDealId}\`` : ""}`
      : `⚠️ Couldn't create drafts. Files saved to OneDrive under *${args.business}*.`
  );
}

/**
 * Thread-triggered rebuild of the Submissions draft (e.g. "3 months" or after a
 * name override): re-download the stored files from Slack and create a NEW draft
 * with the statements trimmed to `monthsLimit`. BTF draft is not re-created.
 */
export async function rebuildSubmissionDraftFromRow(args: {
  channel: string;
  threadTs: string;
  drop: StatementDropRow;
  monthsLimit: number | null;
  overrideAccountHolder?: string;
}): Promise<void> {
  const statements: StatementBuf[] = [];
  for (const s of args.drop.statements_json ?? []) {
    try { statements.push({ name: s.name, buffer: await slack.downloadFile(s.slack_url), month: s.month }); }
    catch (e) { console.warn("[build-draft] rebuild re-download failed:", (e as Error).message); }
  }
  let app: { name: string; buffer: Buffer } | null = null;
  if (args.drop.app_json) {
    try { app = { name: args.drop.app_json.name, buffer: await slack.downloadFile(args.drop.app_json.slack_url) }; }
    catch (e) { console.warn("[build-draft] rebuild app re-download failed:", (e as Error).message); }
  }
  if (statements.length === 0 && !app) {
    await slack.postThreadReply(args.channel, args.threadTs, "⚠️ Couldn't re-download the original files from Slack to rebuild — re-drop them in this thread.");
    return;
  }

  const accountHolder = (args.overrideAccountHolder || args.drop.account_holder || args.drop.business_name || "Merchant").trim();
  const subject = `New Deal - ${accountHolder}`;
  const metrics = (args.drop.metrics_json as unknown as BankMetrics | null) ?? null;

  const sub = await createSubmissionDraft({ subject, metrics, statements, app, monthsLimit: args.monthsLimit });
  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    sub.ok
      ? `✅ New Submissions draft ready — ${sub.statementsAttached} statement(s)${app ? " + application" : ""}\nSubject: \`${subject}\``
      : `⚠️ Couldn't create the new draft.`
  );
}

/**
 * Section 1 behaviour: resolve the lead and post a confirmation in-thread. Sections 3–5 will
 * extend this to gather statements, post the report, and create the two Outlook drafts.
 */
export async function handleBuildCommand(args: {
  channel: string;
  threadTs: string;
  userId: string;
  text: string;
}): Promise<boolean> {
  const business = parseBuildBusiness(args.text);
  if (!business) {
    await slack.postThreadReply(args.channel, args.threadTs, "Reply `build <business name>` so I can find the lead (I couldn't read a name).");
    return true;
  }

  const match = await resolveLead(business);
  if (match.confidence === "none" || !match.mcContactId) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `⚠️ No lead found for *${business}* in Mission Control${match.zohoDealId ? ` (but found a Zoho Deal).` : "."} Check the spelling or create the lead first.`
    );
    return true;
  }

  const lines = [
    `🔎 *Matched lead* (${match.confidence}) — *${match.businessName}*`,
    `• MC contact: \`${match.mcContactId}\`${match.mcDealId ? ` · deal \`${match.mcDealId}\`` : ""}`,
    `• Zoho: ${match.zohoDealId ? `Deal \`${match.zohoDealId}\`` : match.zohoLeadId ? `Lead \`${match.zohoLeadId}\`` : "not found"}`,
  ];
  if (match.confidence === "fuzzy" && match.candidates.length > 1) {
    lines.push(`Other possible matches: ${match.candidates.slice(1, 4).map((c) => c.name).join(", ")}`);
  }
  lines.push("_Building the report + drafts next…_");
  await slack.postThreadReply(args.channel, args.threadTs, lines.join("\n"));
  return true;
}

/** Short, factual Vektor answer about a statement drop, grounded in stored context. */
async function vektorAnswerStatementQuestion(drop: StatementDropRow, question: string): Promise<string> {
  try {
    const context = JSON.stringify({
      account_holder: drop.account_holder,
      business: drop.business_name,
      status: drop.status,
      months_limit: drop.months_limit,
      statement_months: (drop.statements_json ?? []).map((s) => s.month),
      metrics: drop.metrics_json ?? {},
    }).slice(0, 6000);
    const { text } = await callClaudeText({
      model: "claude-sonnet-4-6",
      system:
        "You are Vektor, SRT Agency's submissions assistant, replying in a Slack thread about ONE merchant's bank statements. Answer using ONLY the provided deal context. Be short, direct, factual — no emotion, no filler, no greeting. State the fact and the action. If the context doesn't contain the answer, say so in one line. Useful thread commands you can mention when relevant: `3 months` (rebuild the draft with the most-recent N months), `override` / `use <name>` (resolve a name mismatch), `rebuild` (regenerate the draft).",
      user: `Deal context:\n${context}\n\nQuestion: ${question}`,
      maxTokens: 400,
      temperature: 0.2,
    });
    return text.trim() || "No answer from context.";
  } catch (e) {
    return `⚠️ Couldn't answer: ${(e as Error).message}`;
  }
}

/**
 * Thread reply under a #srt-sub statement drop. Handles, in order:
 *  - name override (`override` / `same business` / `use <name>`) while awaiting confirm
 *  - `N months` → rebuild the Submissions draft with the most-recent N statements
 *  - `rebuild` / `regenerate` → rebuild the current draft
 *  - anything else → conversational Vektor answer
 * Returns false (so the caller can fall through) only when this thread isn't a
 * tracked statement drop.
 */
export async function handleStatementDropThreadReply(args: {
  channel: string;
  threadTs: string;
  userId: string;
  replyText: string;
}): Promise<boolean> {
  const drop = await getStatementDropByThread(args.threadTs);
  if (!drop) return false;

  const text = args.replyText.trim();
  const lower = text.toLowerCase();

  // Name-mismatch resolution (only while held)
  if (drop.status === "awaiting_name_confirm") {
    const useMatch = text.match(/^use\s+(.+)$/i);
    if (useMatch) {
      const name = useMatch[1].trim();
      await updateStatementDrop(args.threadTs, { account_holder: name, business_name: name, subject: `New Deal - ${name}`, status: "built" });
      await rebuildSubmissionDraftFromRow({ channel: args.channel, threadTs: args.threadTs, drop, monthsLimit: drop.months_limit, overrideAccountHolder: name });
      return true;
    }
    if (/\b(override|same business|same|proceed|confirm|go ahead|build it)\b/i.test(lower)) {
      await updateStatementDrop(args.threadTs, { status: "built" });
      await rebuildSubmissionDraftFromRow({ channel: args.channel, threadTs: args.threadTs, drop, monthsLimit: drop.months_limit });
      return true;
    }
    // otherwise fall through to a conversational answer
  }

  // "N months" / "only 3 months" / "use 3 months" → trim + rebuild
  const monthsMatch = lower.match(/(\d+)\s*month/);
  if (monthsMatch) {
    const n = Math.max(1, parseInt(monthsMatch[1], 10));
    await updateStatementDrop(args.threadTs, { months_limit: n });
    await rebuildSubmissionDraftFromRow({ channel: args.channel, threadTs: args.threadTs, drop, monthsLimit: n });
    return true;
  }

  // "rebuild" / "regenerate" → re-create with the current month limit
  if (/\b(rebuild|regenerate|re-?do|recreate)\b/i.test(lower)) {
    await rebuildSubmissionDraftFromRow({ channel: args.channel, threadTs: args.threadTs, drop, monthsLimit: drop.months_limit });
    return true;
  }

  // Conversation
  const reply = await vektorAnswerStatementQuestion(drop, text);
  await slack.postThreadReply(args.channel, args.threadTs, reply);
  return true;
}
