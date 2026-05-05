import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface LenderDb {
  id: string;
  name: string;
  tier: number;
  tier_label: string | null;
  is_active: boolean;
  min_credit_score: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business_months: number | null;
  max_amount: number | null;
  max_negative_days: number | null;
  factor_rate_range: string | null;
  positions_funded: string | null;
  blocked_industries: string[] | null;
  submission_email: string | null;
  cc_emails: string[] | null;
  rep_name: string | null;
  notes: string | null;
}

interface ClaudeTop3Item {
  lender_id: string;
  match_score: number;
  reasons: string[];
  warnings: string[];
  factor_rate_used: number;
  term_months: number;
}

interface ClaudeResponse {
  deal_summary: {
    business: string | null;
    amount: number;
    credit_score: number | null;
    monthly_revenue: number | null;
    tib_months: number | null;
    position: string;
    industry: string | null;
    use_of_funds: string | null;
  };
  top3: ClaudeTop3Item[];
}

function parseMidRate(range: string | null): number {
  if (!range) return 1.35;
  const nums = range.match(/\d+\.\d+/g);
  if (!nums || nums.length === 0) return 1.35;
  const values = nums.map(Number);
  return parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json() as { message: string };
    if (!message?.trim()) return NextResponse.json({ error: "Message required" }, { status: 400 });

    const { data: lenders, error: lErr } = await supabaseAdmin
      .from("lenders")
      .select("id,name,tier,tier_label,is_active,min_credit_score,min_monthly_revenue,min_time_in_business_months,max_amount,max_negative_days,factor_rate_range,positions_funded,blocked_industries,submission_email,cc_emails,rep_name,notes")
      .eq("is_active", true)
      .order("tier");
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

    const lenderList = (lenders as LenderDb[]).map((l) => ({
      id: l.id,
      name: l.name,
      tier: l.tier,
      min_credit_score: l.min_credit_score,
      min_monthly_revenue: l.min_monthly_revenue,
      min_time_in_business_months: l.min_time_in_business_months,
      max_amount: l.max_amount,
      max_negative_days: l.max_negative_days,
      factor_rate_range: l.factor_rate_range,
      positions_funded: l.positions_funded,
      blocked_industries: l.blocked_industries ?? [],
      notes: l.notes ? l.notes.slice(0, 250) : null,
    }));

    const systemPrompt = `You are Vektor, an MCA deal routing expert for SRT Agency. Match deals to lenders based on criteria.

ACTIVE LENDERS:
${JSON.stringify(lenderList, null, 2)}

MATCHING RULES:
- Hard disqualify if stated credit_score < lender's min_credit_score
- Hard disqualify if stated monthly_revenue < lender's min_monthly_revenue
- Hard disqualify if stated tib_months < lender's min_time_in_business_months
- Check blocked_industries — if deal industry matches a blocked one, disqualify
- For position: "1st" deals prefer lenders with 1st position; "2nd+" prefer lenders listing 2nd or higher
- factor_rate_used: parse the range string and use the midpoint
- term_months: use 4 for amounts < $30K, 6 for $30K–$75K, 8 for $75K–$150K, 12 for $150K+
- match_score: 90+ = perfect fit, 70–89 = good, 50–69 = acceptable
- Return exactly 3 lenders (or all that qualify if fewer than 3 pass hard filters)
- reasons: 2–3 concise bullet strings explaining the match
- warnings: any notable concerns (can be empty array)

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "deal_summary": {
    "business": string | null,
    "amount": number,
    "credit_score": number | null,
    "monthly_revenue": number | null,
    "tib_months": number | null,
    "position": string,
    "industry": string | null,
    "use_of_funds": string | null
  },
  "top3": [
    {
      "lender_id": string,
      "match_score": number,
      "reasons": [string],
      "warnings": [string],
      "factor_rate_used": number,
      "term_months": number
    }
  ]
}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: message }],
    });

    const raw = (response.content[0] as { type: string; text: string }).text.trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as ClaudeResponse;

    // Build result with server-side calculator
    const lenderMap = new Map((lenders as LenderDb[]).map((l) => [l.id, l]));
    const top3 = parsed.top3.map((item) => {
      const lender = lenderMap.get(item.lender_id);
      const factorRate = item.factor_rate_used || parseMidRate(lender?.factor_rate_range ?? null);
      const amount = parsed.deal_summary.amount || 0;
      const paybackAmount = Math.round(amount * factorRate);
      const termDays = (item.term_months || 6) * 30;
      const dailyPayment = termDays > 0 ? parseFloat((paybackAmount / termDays).toFixed(2)) : 0;
      const weeklyPayment = parseFloat((dailyPayment * 5).toFixed(2));

      return {
        lender_id: item.lender_id,
        name: lender?.name ?? "Unknown",
        tier_label: lender?.tier_label ?? "",
        match_score: item.match_score,
        reasons: item.reasons,
        warnings: item.warnings,
        factor_rate_used: factorRate,
        payback_amount: paybackAmount,
        term_months: item.term_months || 6,
        daily_payment: dailyPayment,
        weekly_payment: weeklyPayment,
        submission_email: lender?.submission_email ?? null,
        cc_emails: lender?.cc_emails ?? [],
        rep_name: lender?.rep_name ?? null,
      };
    });

    return NextResponse.json({ deal_summary: parsed.deal_summary, top3 });
  } catch (err) {
    console.error("[route-deal]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Routing failed" }, { status: 500 });
  }
}
