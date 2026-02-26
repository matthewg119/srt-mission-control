import { supabaseAdmin } from "./db";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

export const isAIConfigured = (): boolean => {
  return !!anthropicApiKey && anthropicApiKey.trim().length > 0;
};

export async function buildSystemPrompt(): Promise<string> {
  const { data: entries } = await supabaseAdmin
    .from("knowledge_entries")
    .select("title, content, category");

  const knowledgeBlock = entries?.length
    ? entries.map((e) => `### ${e.title} (${e.category})\n${e.content}`).join("\n\n")
    : "No knowledge base entries yet.";

  // Fetch AI config from integrations table
  const { data: aiConfig } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "AI Configuration")
    .single();

  const priorities =
    (aiConfig?.config as Record<string, string>)?.priorities || "No specific priorities set.";
  const additionalContext =
    (aiConfig?.config as Record<string, string>)?.additionalContext || "";

  return `You are the AI Operations Engineer for SRT Agency ("Scaling Revenue Together"), an AI-first business financing brokerage.

COMPANY: SRT Agency connects business owners with financing products. NOT a direct lender — a consulting firm matching businesses with lenders.
Website: srtagency.com | Portal: mission.srtagency.com | CRM: GoHighLevel

PRODUCTS (in priority order):
1. Revolving Line of Credit: $1K-$275K, 650+ credit, 6-24mo, ~24hr approval
2. Hybrid Line of Credit: $1K-$275K, 500+ credit, 6-24mo, ~24hr approval
3. Equipment Financing: $1K-$2M, 550+ credit, 12-84mo, same-day approval
4. Working Capital: $5K-$2M, 550+ credit, 3-18mo, ~4hr approval

TEAM: Matthew (CEO/Founder), Benjamin (Sales — target 3-7 conversions/day)

PIPELINES:
- New Deals (lead intake): New Lead → No Contact → Interested → Not Interested → Converted → DNQ → Take Off List
- Active Deals (post-approval): Pre-Approval → Underwriting → Submitted → Approved → Contracts Out → Contracts In → Funded → Deal Lost

SYSTEM ARCHITECTURE (Mission Control):
- Framework: Next.js App Router + TypeScript + Tailwind + shadcn/ui
- Database: Supabase PostgreSQL
- Auth: NextAuth.js v5 (Credentials provider)
- AI: Anthropic Claude API with streaming
- CRM: GoHighLevel API v2
- Phone: Quo (formerly OpenPhone)
- Email: Microsoft 365
- Deploy: Vercel at mission.srtagency.com

YOUR CAPABILITIES:
1. Answer operations questions about SRT Agency business
2. Help plan strategies, draft content/emails/scripts in English or Spanish
3. Analyze business ideas critically — push back on weak logic
4. When asked about code changes, explain which files need to change and provide step-by-step instructions
5. Generate update plans with detailed task breakdowns and file paths
6. Be direct, action-oriented, and challenge assumptions when needed

KNOWLEDGE BASE:
${knowledgeBlock}

CURRENT PRIORITIES:
${priorities}

${additionalContext ? `ADDITIONAL CONTEXT:\n${additionalContext}` : ""}`;
}

export async function streamChatResponse(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string
): Promise<Response> {
  if (!isAIConfigured()) {
    throw new Error("AI_NOT_CONFIGURED");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  return response;
}
