import { callClaudeJSON } from "@/lib/claude-calls";
import type { MerchantContext } from "./merchant-context";

// ── Custom-Intro Director ────────────────────────────────────────────────
// Drafts ONE short, personalized line for the dialer's "Scaling Revenue
// Together" intro email. The line is suggested into the dialer's editable box;
// Matthew reviews/edits it, then it's substituted into the {{customLine}} token
// of the "scaling-intro" full-HTML template at send time.
//
// It must be a single sentence — no greeting, no signature, no markdown — that
// references the lead's funding goal/amount/use of funds to move them toward
// booking (e.g. "How soon are you looking to get the $100k for the business?").

const SYSTEM_PROMPT = `You are Matthew Garcia, a Senior Capital Strategist at SRT Agency (a business-funding brokerage). Write ONE short, friendly, specific sentence to a prospect who just inquired about funding.

Hard rules:
- Exactly ONE sentence. No greeting, no sign-off, no signature, no markdown, no quotes around it.
- NEVER use em dashes ("—") or en dashes ("–"). Use commas, periods, or a plain hyphen ("-") instead.
- Make it specific to THIS lead using their funding amount, use of funds, industry, or revenue when known.
- If you know the amount they want, ask about urgency/timeline (e.g. "How soon are you looking to get the $100k for the business?").
- If you know the use of funds, reference it naturally.
- If you know little, ask one warm qualifying question about what they're looking to fund.
- Conversational and human, never salesy or generic. Under 25 words.`;

export interface CustomIntroDraft {
  line: string;
}

function fmtMoney(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  return `$${Math.round(n).toLocaleString()}`;
}

export async function draftCustomIntroLine(ctx: MerchantContext): Promise<string | null> {
  const c = ctx.contact;
  const amount = fmtMoney(c.amount_needed);
  const revenue = fmtMoney(c.monthly_revenue);
  const notesBlock =
    ctx.zoho?.notes
      .slice(0, 6)
      .map((n) => `• [${n.modified_at.slice(0, 10)}] ${n.title}: ${n.content.slice(0, 200)}`)
      .join("\n") || "(no Zoho notes)";

  const user = [
    `Business: ${c.business_name ?? "unknown"}`,
    `Contact: ${[c.first_name, c.last_name].filter(Boolean).join(" ") || "unknown"}`,
    `Industry: ${c.industry ?? "(unknown)"}`,
    `Amount needed: ${amount ?? "(unknown)"}`,
    `Monthly revenue: ${revenue ?? "(unknown)"}`,
    `Use of funds: ${c.use_of_funds ?? "(unknown)"}`,
    `Credit score: ${c.credit_score ?? "(unknown)"}`,
    `Lead status: ${ctx.zoho?.lead_status ?? "(unknown)"}`,
    ``,
    `Recent Zoho notes:`,
    notesBlock,
  ].join("\n");

  try {
    const result = await callClaudeJSON<CustomIntroDraft>({
      model: "claude-sonnet-4-6",
      system: SYSTEM_PROMPT,
      user,
      schemaHint: `{ "line": string }`,
      maxTokens: 160,
      temperature: 0.6,
    });
    const line = (result.data?.line ?? "").trim();
    return line || null;
  } catch (e) {
    console.error("[custom-intro-director] Claude draft error:", (e as Error).message);
    return null;
  }
}
