// AI funder matcher for the email-driven "ready to shop" flow.
//
// Given the bank-statement analyzer's report text for a New-Deal email, rank which
// of our signed-up funders to shop the deal to. Each funder carries a free-text
// `underwriting_box` ("what this funder wants") plus a few structured columns; the
// model decides fit and gives a one-line reason per pick. Only funders with a real
// submission path (seeded emails or a portal) are considered.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";

export interface FunderSuggestion {
  id: string;
  name: string;
  reason: string;
}

export interface SuggestFundersResult {
  suggested: FunderSuggestion[];
  avoid: Array<{ name: string; reason: string }>;
}

interface LenderForMatch {
  id: string;
  name: string;
  tier_label: string | null;
  tier: number | null;
  submission_method: string | null;
  submission_email: string | null;
  to_emails: string[] | null;
  underwriting_box: string | null;
  factor_rate_range: string | null;
  positions_funded: string | null;
  blocked_industries: string[] | null;
  min_monthly_revenue: number | null;
  max_amount: number | null;
}

/** A funder is shoppable if it has a seeded To-list / submission email, or is portal-based. */
function hasSubmissionPath(l: LenderForMatch): boolean {
  if ((l.to_emails ?? []).some((e) => e?.trim())) return true;
  if (l.submission_email?.trim()) return true;
  return (l.submission_method ?? "").toLowerCase() === "portal";
}

function rosterLine(l: LenderForMatch): string {
  const parts: string[] = [`[${l.id}] ${l.name}`];
  if (l.tier_label) parts.push(`tier ${l.tier_label}`);
  parts.push(`via ${(l.submission_method ?? "email").toLowerCase()}`);
  if (l.underwriting_box) parts.push(`UW: ${l.underwriting_box}`);
  else {
    // No box yet — surface what structured columns we have so it isn't invisible.
    const struct: string[] = [];
    if (l.min_monthly_revenue) struct.push(`min $${Math.round(l.min_monthly_revenue / 1000)}k/mo`);
    if (l.max_amount) struct.push(`max $${Math.round(l.max_amount / 1000)}k`);
    if (l.positions_funded) struct.push(`positions ${l.positions_funded}`);
    if (l.factor_rate_range) struct.push(`factor ${l.factor_rate_range}`);
    if ((l.blocked_industries ?? []).length) struct.push(`blocks ${l.blocked_industries!.join("/")}`);
    parts.push(struct.length ? `UW(partial): ${struct.join(", ")}` : "UW: (none on file)");
  }
  return parts.join(" · ");
}

const SCHEMA_HINT = `{
  "suggested": [{ "id": string, "name": string, "reason": string }],
  "avoid": [{ "name": string, "reason": string }]
}`;

const SYSTEM_PROMPT = `You are an MCA submissions analyst at SRT Agency. Given a merchant's bank-statement
underwriting summary and a roster of funders we are signed up with (each with an underwriting box of
what they want), decide which funders to shop this deal to.

Rules:
- Only suggest funders whose underwriting box the deal plausibly fits. Match on monthly deposits/revenue,
  time in business, existing positions/MCA stacking, NSF/negative-day tolerance, industry restrictions,
  requested amount, and rate appetite.
- A weak or high-risk deal (heavy NSFs, negative balances, many existing positions, thin deposits) should
  lean toward higher-tier (B/C) funders; do NOT suggest A-paper funders it clearly won't fit.
- If a funder's box is "(none on file)", you may still suggest it if nothing disqualifies it, but say so.
- "reason" is ONE short line citing the deciding factor (e.g. "fits: $33k/mo, 3 positions OK, NSFs under cap").
- "avoid" lists funders worth calling out as a clear no-fit, with a one-line reason. Keep it short (0-5).
- Rank "suggested" best-fit first. Use ONLY the funder ids from the roster; never invent ids or names.`;

export async function suggestFundersForDeal(report: string, business: string): Promise<SuggestFundersResult> {
  const { data } = await supabaseAdmin
    .from("lenders")
    .select(
      "id, name, tier_label, tier, submission_method, submission_email, to_emails, underwriting_box, factor_rate_range, positions_funded, blocked_industries, min_monthly_revenue, max_amount",
    )
    .eq("is_active", true)
    .order("tier")
    .order("name");

  const lenders = ((data ?? []) as LenderForMatch[]).filter(hasSubmissionPath);
  if (lenders.length === 0) return { suggested: [], avoid: [] };

  const byId = new Map(lenders.map((l) => [l.id, l]));
  const roster = lenders.map(rosterLine).join("\n");

  const user = `Merchant: ${business}

Underwriting summary (from bank statements):
${report}

Funder roster (id, name, underwriting box):
${roster}`;

  const result = await callClaudeJSON<SuggestFundersResult>({
    model: "claude-sonnet-4-6",
    system: SYSTEM_PROMPT,
    user,
    schemaHint: SCHEMA_HINT,
    maxTokens: 1500,
    temperature: 0.2,
    validate: (v): v is SuggestFundersResult =>
      !!v && typeof v === "object" && Array.isArray((v as SuggestFundersResult).suggested),
  });

  // Keep only real funders (guard against hallucinated ids/names); dedupe by id.
  const seen = new Set<string>();
  const suggested: FunderSuggestion[] = [];
  for (const s of result.data.suggested ?? []) {
    const match = byId.get(s.id) ?? lenders.find((l) => l.name.toLowerCase() === (s.name ?? "").toLowerCase());
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    suggested.push({ id: match.id, name: match.name, reason: (s.reason ?? "").trim() || "fits underwriting box" });
  }

  const avoid = (result.data.avoid ?? [])
    .filter((a) => a?.name)
    .slice(0, 5)
    .map((a) => ({ name: a.name, reason: (a.reason ?? "").trim() }));

  return { suggested, avoid };
}
