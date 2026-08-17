import { callClaudeJSON } from "@/lib/claude-calls";
import type { LeadContext } from "./lead-context";

// ── Custom-Intro Director ────────────────────────────────────────────────
// Drafts ONE short, personalized line for the dialer's intro email. The line is
// suggested into the dialer's editable box; Matthew reviews/edits it, then it's
// substituted into the {{customLine}} token of the intro full-HTML template at
// send time.
//
// It must be a single sentence — no greeting, no signature, no markdown — that
// gets specific about THIS business and points at the free AEO build.

const SYSTEM_PROMPT = `You are Matthew Garcia at SRT Agency. SRT is an AEO agency: we build the part of a business's own website that AI assistants can actually read and cite, so that when someone asks an assistant for a business like theirs, they get named and sent customers. We lead with a free first build, one section of their site, no charge and no card, and all they have to do is say yes.

Write ONE short, friendly, specific sentence to a local business owner.

SRT DOES NOT DO BUSINESS FUNDING. Never mention financing, loans, lenders, capital, revenue requirements or credit. Many of these contacts were funding leads years ago and their old notes may say so. Ignore that.

Hard rules:
- Exactly ONE sentence. No greeting, no sign-off, no signature, no markdown, no quotes around it.
- NEVER use em dashes ("—") or en dashes ("–"). Use commas, periods, or a plain hyphen ("-") instead.
- Make it specific to THIS lead using their business name, industry, city, or website when known.
- If they have no website on file, do not imply you looked at one.
- If you know little, ask one warm question about how customers find them today.
- Conversational and human, never salesy or generic. Under 25 words.`;

export interface CustomIntroDraft {
  line: string;
}

export async function draftCustomIntroLine(ctx: LeadContext): Promise<string | null> {
  const c = ctx.contact;
  const notesBlock =
    ctx.crm.notes
      .slice(0, 6)
      .map((n) => `• [${n.modified_at.slice(0, 10)}] ${n.title}: ${n.content.slice(0, 200)}`)
      .join("\n") || "(no notes on file)";

  const user = [
    `Business: ${c.business_name ?? "unknown"}`,
    `Contact: ${[c.first_name, c.last_name].filter(Boolean).join(" ") || "unknown"}`,
    `Industry: ${c.industry ?? "(unknown)"}`,
    `Location: ${[c.biz_city, c.biz_state].filter(Boolean).join(", ") || "(unknown)"}`,
    `Website: ${c.website ?? "(none on file)"}`,
    `Stage: ${ctx.crm.lead_status ?? "(unknown)"}`,
    ``,
    `Recent notes (may be stale funding-era history — use only for who they are):`,
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
