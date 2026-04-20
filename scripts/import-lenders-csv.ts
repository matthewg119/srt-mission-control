// CLI script: one-time import of the MCA Funder Reference CSV into the
// lenders table. Adds new lenders; for names that already exist, only
// fills in the new CSV-sourced columns (cc_emails, rep_name, rep_email,
// factor_rate_range, positions_funded, funding_speed, repayment_frequency,
// tier_label) — never overwrites existing numeric matching criteria
// already set by the seed script.
//
// Usage:
//   bun run scripts/import-lenders-csv.ts
//   bun run scripts/import-lenders-csv.ts --dry
//   bun run scripts/import-lenders-csv.ts --file="C:/path/to/csv"
//
// Default file:
//   C:/Users/matth/Downloads/MCA_Funder_Reference_SRT - MCA Funder Reference (3).csv

import { readFileSync } from "node:fs";
import { supabaseAdmin } from "../src/lib/db";

const DEFAULT_FILE =
  "C:/Users/matth/Downloads/MCA_Funder_Reference_SRT - MCA Funder Reference (3).csv";

interface CsvRow {
  tier: string;
  funderName: string;
  minCreditScore: string;
  minMonthlyRevenue: string;
  minTimeInBusiness: string;
  maxFundingAmount: string;
  positionsFunded: string;
  factorRateRange: string;
  repaymentFrequency: string;
  fundingSpeed: string;
  keyNotes: string;
  nameCol: string;
  repCol: string;
  emailSubmissions: string;
}

interface LenderUpsert {
  name: string;
  tier_label: string | null;
  tier: number | null;
  min_credit_score: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business_months: number | null;
  max_amount: number | null;
  positions_funded: string | null;
  factor_rate_range: string | null;
  repayment_frequency: string | null;
  funding_speed: string | null;
  notes: string | null;
  submission_email: string | null;
  cc_emails: string[];
  rep_name: string | null;
  rep_email: string | null;
  submission_method: "email" | "portal";
  is_active: boolean;
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

/** Minimal RFC-4180 parser: handles quoted fields with commas and embedded
 *  newlines, and doubled "" as a literal quote. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function toRow(cells: string[]): CsvRow {
  const get = (i: number) => (cells[i] ?? "").trim();
  return {
    tier: get(0),
    funderName: get(1),
    minCreditScore: get(2),
    minMonthlyRevenue: get(3),
    minTimeInBusiness: get(4),
    maxFundingAmount: get(5),
    positionsFunded: get(6),
    factorRateRange: get(7),
    repaymentFrequency: get(8),
    fundingSpeed: get(9),
    keyNotes: get(10),
    nameCol: get(11),
    repCol: get(12),
    emailSubmissions: get(13),
  };
}

// ─── Field coercion ──────────────────────────────────────────────────────────

function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\$,\s]/g, "").toLowerCase();
  if (!cleaned) return null;
  const m = cleaned.match(/^([\d.]+)\s*(k|m)?\+?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return Math.round(n * mult);
}

function parseCreditScore(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{3})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseMonthlyRevenue(raw: string): number | null {
  if (!raw) return null;
  // CSV uses things like "$10K+/mo", "$15K+/mo", "$100K+/yr ($8.3K/mo)",
  // "$250K+/yr", "$150K+/mo".
  const moMatch = raw.match(/\$?([\d.]+)\s*k\+?\s*\/?\s*mo/i);
  if (moMatch) return Math.round(parseFloat(moMatch[1]) * 1000);
  const yrMatch = raw.match(/\$?([\d.]+)\s*k\+?\s*\/?\s*yr/i);
  if (yrMatch) return Math.round((parseFloat(yrMatch[1]) * 1000) / 12);
  return parseMoney(raw);
}

function parseTibMonths(raw: string): number | null {
  if (!raw) return null;
  const yrMatch = raw.match(/(\d+(?:\.\d+)?)\s*\+?\s*year/i);
  if (yrMatch) return Math.round(parseFloat(yrMatch[1]) * 12);
  const moMatch = raw.match(/(\d+)\s*\+?\s*month/i);
  if (moMatch) return parseInt(moMatch[1], 10);
  return null;
}

function parseTierLabel(raw: string): { label: string | null; tier: number | null } {
  if (!raw) return { label: null, tier: null };
  const up = raw.toUpperCase().trim();
  if (up === "A+") return { label: "A+", tier: 1 };
  if (up === "A") return { label: "A", tier: 1 };
  if (up === "B") return { label: "B", tier: 2 };
  if (up === "C") return { label: "C", tier: 3 };
  return { label: null, tier: null };
}

function splitEmails(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .map((s) => s.replace(/^[<]|[>]$/g, ""))
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function firstEmail(raw: string): string | null {
  const list = splitEmails(raw);
  return list[0] ?? null;
}

// ─── Row → upsert ────────────────────────────────────────────────────────────

function buildUpsert(row: CsvRow): LenderUpsert | null {
  const name = row.funderName.trim();
  if (!name) return null;

  // Tier-section header rows like "TIER A — Premium Lenders" → skip.
  if (!row.funderName && /^tier\s/i.test(row.tier)) return null;
  if (/^tier\s/i.test(row.funderName)) return null;

  const { label: tierLabel, tier } = parseTierLabel(row.tier);

  // The CSV has two "email" columns: `Email` (column L/12, usually rep_email)
  // and `Email submissions` (column M/13). Some rows use only one.
  const repEmail = firstEmail(row.repCol);
  const subEmails = splitEmails(row.emailSubmissions);

  // Rep column is noisy: sometimes a person's name, sometimes a URL,
  // sometimes industry exclusions. Only accept short human-ish strings.
  const repCol = row.repCol.trim();
  const looksLikePersonName =
    !!repCol &&
    !repEmail &&
    !repCol.includes("@") &&
    !/https?:\/\//i.test(repCol) &&
    !repCol.includes(",") &&
    repCol.length <= 60 &&
    /[A-Za-z]/.test(repCol);
  const repName = looksLikePersonName ? repCol : null;

  // Primary submission = first of subEmails, else repEmail.
  const submissionEmail = subEmails[0] ?? repEmail ?? null;
  const ccEmails = subEmails.slice(1);

  return {
    name,
    tier_label: tierLabel,
    tier,
    min_credit_score: parseCreditScore(row.minCreditScore),
    min_monthly_revenue: parseMonthlyRevenue(row.minMonthlyRevenue),
    min_time_in_business_months: parseTibMonths(row.minTimeInBusiness),
    max_amount: parseMoney(row.maxFundingAmount),
    positions_funded: row.positionsFunded || null,
    factor_rate_range: row.factorRateRange || null,
    repayment_frequency: row.repaymentFrequency || null,
    funding_speed: row.fundingSpeed || null,
    notes: row.keyNotes || null,
    submission_email: submissionEmail,
    cc_emails: ccEmails,
    rep_name: repName,
    rep_email: repEmail,
    submission_method: submissionEmail ? "email" : "portal",
    is_active: true,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry") || args.includes("--dry-run");
  const fileArg = args.find((a) => a.startsWith("--file="));
  const file = fileArg ? fileArg.split("=").slice(1).join("=") : DEFAULT_FILE;

  console.log("Lender CSV import");
  console.log("─────────────────");
  console.log(`File: ${file}`);
  console.log(`Dry run: ${dry}`);
  console.log("");

  const text = readFileSync(file, "utf-8");
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  console.log(`Header: ${header.join(" | ")}`);
  console.log(`Data rows: ${data.length}`);

  const upserts: LenderUpsert[] = [];
  for (const r of data) {
    const csvRow = toRow(r);
    const up = buildUpsert(csvRow);
    if (!up) continue;
    upserts.push(up);
  }

  console.log(`Parsed ${upserts.length} lender rows:`);
  for (const u of upserts) {
    console.log(
      `  [${u.tier_label ?? "?"}] ${u.name} — ${u.submission_email ?? "(no email)"}` +
      (u.cc_emails.length > 0 ? ` cc:${u.cc_emails.length}` : "") +
      (u.rep_name ? ` rep:${u.rep_name}` : "")
    );
  }

  if (dry) {
    console.log("\nDRY RUN — no database writes.");
    return;
  }

  // Upsert strategy:
  //   - Case-insensitive name match against existing lenders.
  //   - If exists: only set columns that the existing row has as NULL, plus
  //     always refresh cc_emails / rep_name / rep_email / tier_label / notes
  //     (these are the CSV-authoritative fields).
  //   - If missing: full insert.

  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from("lenders")
    .select("id, name, min_credit_score, min_monthly_revenue, min_time_in_business_months, max_amount, submission_email, submission_method");
  if (existingErr) {
    console.error("Failed to read existing lenders:", existingErr.message);
    process.exit(1);
  }
  const byNameLower = new Map<string, typeof existingRows[number]>();
  for (const row of existingRows || []) {
    byNameLower.set(row.name.toLowerCase(), row);
  }

  let inserted = 0;
  let updated = 0;

  for (const u of upserts) {
    const existing = byNameLower.get(u.name.toLowerCase());
    if (existing) {
      const patch: Record<string, unknown> = {
        // Always overwrite CSV-authoritative fields:
        tier_label: u.tier_label,
        positions_funded: u.positions_funded,
        factor_rate_range: u.factor_rate_range,
        repayment_frequency: u.repayment_frequency,
        funding_speed: u.funding_speed,
        cc_emails: u.cc_emails,
        rep_name: u.rep_name,
        rep_email: u.rep_email,
        notes: u.notes,
      };
      // Only fill numeric fields if currently null (don't regress seeded data):
      if (existing.min_credit_score == null && u.min_credit_score != null)
        patch.min_credit_score = u.min_credit_score;
      if (existing.min_monthly_revenue == null && u.min_monthly_revenue != null)
        patch.min_monthly_revenue = u.min_monthly_revenue;
      if (existing.min_time_in_business_months == null && u.min_time_in_business_months != null)
        patch.min_time_in_business_months = u.min_time_in_business_months;
      if (existing.max_amount == null && u.max_amount != null)
        patch.max_amount = u.max_amount;
      if (!existing.submission_email && u.submission_email)
        patch.submission_email = u.submission_email;
      if (!existing.submission_method && u.submission_method)
        patch.submission_method = u.submission_method;

      const { error } = await supabaseAdmin
        .from("lenders")
        .update(patch)
        .eq("id", existing.id);
      if (error) {
        console.error(`UPDATE failed for ${u.name}:`, error.message);
        continue;
      }
      updated++;
    } else {
      const { error } = await supabaseAdmin
        .from("lenders")
        .insert({
          name: u.name,
          tier: u.tier,
          tier_label: u.tier_label,
          min_credit_score: u.min_credit_score,
          min_monthly_revenue: u.min_monthly_revenue,
          min_time_in_business_months: u.min_time_in_business_months,
          max_amount: u.max_amount,
          positions_funded: u.positions_funded,
          factor_rate_range: u.factor_rate_range,
          repayment_frequency: u.repayment_frequency,
          funding_speed: u.funding_speed,
          notes: u.notes,
          submission_email: u.submission_email,
          cc_emails: u.cc_emails,
          rep_name: u.rep_name,
          rep_email: u.rep_email,
          submission_method: u.submission_method,
          is_active: u.is_active,
          blocked_industries: [],
          products: ["Working Capital"],
        });
      if (error) {
        console.error(`INSERT failed for ${u.name}:`, error.message);
        continue;
      }
      inserted++;
    }
  }

  console.log("");
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated:  ${updated}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
