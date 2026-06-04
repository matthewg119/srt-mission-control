// "find lead & build draft" — Section 1: resolve a dropped deal to a lead in Mission Control
// + Zoho CRM (fuzzy on misspellings), and post a confirmation in #srt-sub. Later sections
// extend handleBuildCommand to also produce the report + the two Outlook drafts.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { findDealByName, addNoteResilient } from "@/lib/zoho";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { callClaudeJSON } from "@/lib/claude-calls";
import { fillBtfApplication, type BtfValues } from "@/lib/btf/overlay";

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
{"account_holder":string|null,"avg_monthly_deposits":number|null,"avg_daily_balance":number|null,"total_nsfs":number|null,"existing_mca_positions":number|null,"existing_mca_monthly_burden":number|null,"revenue_trend":"growing"|"stable"|"declining"|null,"top_mca_lenders":string[],"red_flags":string[],"qualification_signal":"strong"|"moderate"|"weak"|null,"statement_months_covered":string[],"revenue_table":Array<{"month":string,"deposits":number|null,"avg_daily_ledger":number|null,"deposit_count":number|null,"nsf_count":number|null}>}
Rules: dollar values as plain numbers; statement_months_covered in YYYY-MM; revenue_table one row per month with the report's short month label; daily/weekly MCA paybacks → existing_mca_positions + top_mca_lenders; null when absent.`;

async function extractMetrics(report: string): Promise<BankMetrics> {
  const empty: BankMetrics = { account_holder: null, avg_monthly_deposits: null, avg_daily_balance: null, total_nsfs: null, existing_mca_positions: null, existing_mca_monthly_burden: null, revenue_trend: null, top_mca_lenders: [], red_flags: [], qualification_signal: null, statement_months_covered: [], revenue_table: [] };
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

// ── §5 deal email (Matthew's template, deposit table pre-filled) ──────────────
function buildDealEmailHtml(business: string, m: BankMetrics | null): string {
  const rows = (m?.revenue_table ?? []).map((r) =>
    `<tr><td style="border:1px solid #ccc;padding:4px 8px">${r.month ?? ""}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${fmtUsd(r.deposits)}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${fmtUsd(r.avg_daily_ledger)}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${r.deposit_count ?? ""}</td>` +
    `<td style="border:1px solid #ccc;padding:4px 8px;text-align:right">${r.nsf_count ?? ""}</td></tr>`
  ).join("");
  const table = rows
    ? `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
<tr><th style="border:1px solid #ccc;padding:4px 8px"></th><th style="border:1px solid #ccc;padding:4px 8px">Deposits</th><th style="border:1px solid #ccc;padding:4px 8px">AVG daily ledger</th><th style="border:1px solid #ccc;padding:4px 8px"># of deposits</th><th style="border:1px solid #ccc;padding:4px 8px">NSF</th></tr>${rows}</table>`
    : "";
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<p>Hello Team,</p>
${table}
<p><i>Merchant is looking for $[AMOUNT] for [use of funds]. [Add notes here]</i></p>
<p>Best regards,</p>
<p style="color:#e07a2f;font-weight:bold;font-size:16px">SRT Submissions</p>
</div>`;
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
  if (pdfs.length === 0) return;

  const downloaded: Array<{ name: string; buffer: Buffer }> = [];
  for (const f of pdfs) {
    if (!f.url_private_download) continue;
    try { downloaded.push({ name: f.name ?? `doc-${Date.now()}.pdf`, buffer: await slack.downloadFile(f.url_private_download) }); }
    catch (e) { console.warn("[build-draft] download failed:", (e as Error).message); }
  }
  if (downloaded.length === 0) return;

  const appDoc = downloaded.find((d) => isAppFile(d.name));
  const statements = downloaded.filter((d) => !isAppFile(d.name));
  await slack.postThreadReply(args.channel, args.threadTs, `📥 Got ${downloaded.length} file(s)${appDoc ? " (incl. application)" : ""} — analyzing ${statements.length} statement(s)…`);

  // §3 analyze
  let metrics: BankMetrics | null = null;
  if (statements.length > 0) {
    try {
      const analysis = await analyzeBankStatements(statements.map((s) => ({ name: s.name, buffer: s.buffer })));
      metrics = await extractMetrics(analysis.report);
    } catch (e) {
      await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Statement analysis failed: ${(e as Error).message}`);
    }
  }

  // §1 resolve business (explicit "build X" text → else account holder from analysis)
  const guess = parseBuildBusiness(args.text ?? "") || metrics?.account_holder || "";
  const match = guess ? await resolveLead(guess) : null;
  const business = (match?.businessName || guess || "Unknown Merchant").trim();

  // §2 OneDrive routing → the deal's folder
  try {
    await microsoft.createDriveFolder("Bank Statements", `Deals/${business}`).catch(() => {});
    for (const s of statements) await microsoft.uploadDriveFile(`Deals/${business}/Bank Statements`, s.name, s.buffer, "application/pdf");
    if (appDoc) {
      await microsoft.createDriveFolder("Completed Package", `Deals/${business}`).catch(() => {});
      await microsoft.uploadDriveFile(`Deals/${business}/Completed Package`, appDoc.name, appDoc.buffer, "application/pdf");
    }
  } catch (e) {
    console.warn("[build-draft] OneDrive upload failed:", (e as Error).message);
  }

  // §3 report
  if (metrics) await slack.postThreadReply(args.channel, args.threadTs, formatReport(business, metrics));

  // §4 BTF fill
  let btfPdf: Buffer | null = null;
  if (appDoc) {
    try {
      const vals = await extractBtfValues(appDoc.buffer);
      if (!vals.legal_business_name && business !== "Unknown Merchant") vals.legal_business_name = business;
      btfPdf = await fillBtfApplication(vals);
      await microsoft.uploadDriveFile(`Deals/${business}/Completed Package`, `BTF_App_${business}.pdf`, btfPdf, "application/pdf").catch(() => {});
    } catch (e) {
      console.warn("[build-draft] BTF fill failed:", (e as Error).message);
    }
  }

  // §5 two Outlook drafts in matthew@ (the connected mailbox → /me)
  const emailHtml = buildDealEmailHtml(business, metrics);
  const subject = `New Deal — ${business}`;
  const created: string[] = [];
  try {
    await microsoft.createDraft({
      subject,
      body: emailHtml,
      attachments: appDoc ? [{ name: appDoc.name, contentType: "application/pdf", contentBytes: appDoc.buffer.toString("base64") }] : [],
    });
    created.push("Submissions (father email)" + (appDoc ? " + application" : ""));
  } catch (e) { console.warn("[build-draft] submissions draft failed:", (e as Error).message); }
  if (btfPdf) {
    try {
      await microsoft.createDraft({
        subject,
        body: emailHtml,
        attachments: [{ name: `BTF_App_${business}.pdf`, contentType: "application/pdf", contentBytes: btfPdf.toString("base64") }],
      });
      created.push("BTF application");
    } catch (e) { console.warn("[build-draft] BTF draft failed:", (e as Error).message); }
  }

  // §6 track: note on the Zoho deal that drafts were built
  if (match?.zohoDealId || match?.zohoLeadId || business) {
    await addNoteResilient({ zohoLeadId: match?.zohoLeadId ?? null, businessName: business, title: `SRT — Drafts built`, content: `• Built ${created.join(" + ") || "drafts"}\n• ${statements.length} statement(s) analyzed\n• Saved to OneDrive` }).catch(() => {});
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    created.length
      ? `✅ Drafts ready in your Outlook *Drafts* folder (edit + send):\n• ${created.join("\n• ")}\nMatched: *${business}*${match?.zohoDealId ? ` · Zoho Deal \`${match.zohoDealId}\`` : ""}`
      : `⚠️ Couldn't create drafts. Files saved to OneDrive under *${business}*.`
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
