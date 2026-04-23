import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";

// ── Content Brief Generator ──────────────────────────────────────────────
// Produces short viral-video briefs for the daily-content-ideas cron.
// Each brief is consumed downstream by /api/agent/viral-decoder which
// turns it into a full 9-slide production package (voiceover, image
// prompts, animation prompts, assembly timeline, music/SFX).
//
// Dedupe: pulls the last 14 days of briefs from content_packages and
// passes them to Claude with instructions to produce something different.

export interface ContentBrief {
  vertical: string;
  persona: string;
  pain_point: string;
  funding_amount_usd: number;
  use_of_funds: string;
  hook_angle: string;
  emotional_beat: string;
  cta_keyword: string;
  brief_line: string;
}

const BRIEF_SYSTEM_PROMPT = `You generate short viral-video briefs for SRT Agency, a business-funding brokerage.

SRT AGENCY POSITIONING:
- We fund real-revenue businesses whose credit score has been a dealbreaker at banks
- Flagship campaign: "Below 600, Still Funded" — targeting operators with 500–650 FICO
- Products: revenue-based funding (MCA), equipment financing, lines of credit, working capital
- Funding amounts: $5K–$500K for MCA, up to $2M for equipment
- Speed: 24–48 hour funding
- We do NOT do SBA, term bank loans, or DSCR/CRE — never mention them

YOUR JOB:
Produce ONE brief describing a story-driven video concept. The video will be AI-generated (9 photorealistic slides + voiceover + sticky caption). Each brief should feel like a real operator's story: specific numbers, specific vertical, specific pain, specific win.

VERTICALS TO ROTATE (do NOT repeat one already used in the "recent" list below — pick a fresh one):
- Blue-collar services: pest control, HVAC, landscaping, plumbing, electrical, cleaning, auto repair, roofing, painting, junk removal, tree service, mobile detail
- Trucking: owner-operators, box-truck couriers, hot-shot haulers, tow operators
- Medical: dental, chiro, med spa, PT, primary care, optometry, veterinary
- Hospitality: restaurants, food trucks, bars, catering, coffee shops
- Retail/e-commerce: Amazon FBA sellers, Shopify brands, bodegas, boutique owners
- Construction: GC's, framing crews, concrete, electrical, drywall
- Personal care: barbershops, nail salons, med spa, hair salons

HOOK ANGLES TO ROTATE:
- "Credit doesn't define you, revenue does" (low-credit hero story)
- "Bank said no, we said yes in 48 hours"
- "$X/month in revenue but 550 credit — here's what happened"
- "Skip your own paycheck to cover payroll? Never again"
- "The day I stopped waiting on banks"
- "Equipment broke / truck broke — funded a new one before the weekend"

RULES:
- The persona should be specific: age, ethnicity, gender, business name, years operating, monthly revenue
- The pain point should be concrete: not "needed money" but "$18K Mack truck clutch replacement the day before a big job"
- Funding amount must be realistic for the vertical and fit our product range ($5K–$500K)
- Use of funds should be clear: trucks, equipment, hires, marketing, payroll, inventory
- Pick ONE product to highlight: revenue-based funding / equipment financing / line of credit / working capital
- Emotional beat: frustration → discovery → approval → reinvestment
- CTA keyword: one word like FUND, CASH, APPROVED, TRUCK (matches the story)
- brief_line: a single 1-2 sentence prompt that the viral decoder will use to build the full video package`;

const SCHEMA_HINT = `{
  "vertical": "string — specific sub-vertical (e.g. 'mobile auto detailing', not 'services')",
  "persona": "string — one line: age/ethnicity/gender/role + business name + monthly revenue",
  "pain_point": "string — concrete blocker with a dollar amount",
  "funding_amount_usd": number,
  "use_of_funds": "string",
  "hook_angle": "string — short pattern-interrupt angle",
  "emotional_beat": "string — frustration → discovery → approval → reinvestment arc",
  "cta_keyword": "string — single uppercase word",
  "brief_line": "string — 1-2 sentence brief for the viral decoder to consume"
}`;

function isContentBrief(x: unknown): x is ContentBrief {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b.vertical === "string" &&
    typeof b.persona === "string" &&
    typeof b.pain_point === "string" &&
    typeof b.funding_amount_usd === "number" &&
    typeof b.use_of_funds === "string" &&
    typeof b.hook_angle === "string" &&
    typeof b.emotional_beat === "string" &&
    typeof b.cta_keyword === "string" &&
    typeof b.brief_line === "string"
  );
}

export async function generateContentBrief(): Promise<ContentBrief> {
  const { data: recent } = await supabaseAdmin
    .from("content_packages")
    .select("brief, package_json, created_at")
    .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(40);

  const recentList = (recent ?? [])
    .map((row) => {
      const pkg = row.package_json as { target_persona?: string; concept_summary?: string } | null;
      const persona = pkg?.target_persona ?? "";
      const summary = pkg?.concept_summary ?? (row.brief as string) ?? "";
      return `- ${persona ? `[${persona}] ` : ""}${summary.slice(0, 160)}`;
    })
    .slice(0, 20)
    .join("\n");

  const userPrompt = recentList
    ? `Last 14 days of briefs (do NOT repeat these verticals or hook angles):\n${recentList}\n\nProduce one new brief in the JSON schema above.`
    : `No recent briefs. Produce one new brief in the JSON schema above.`;

  const { data } = await callClaudeJSON<ContentBrief>({
    model: "claude-sonnet-4-6",
    system: BRIEF_SYSTEM_PROMPT,
    user: userPrompt,
    schemaHint: SCHEMA_HINT,
    temperature: 0.9,
    maxTokens: 600,
    validate: isContentBrief,
  });

  return data;
}
