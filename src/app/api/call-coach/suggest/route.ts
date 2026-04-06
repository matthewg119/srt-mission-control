import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

/**
 * POST /api/call-coach/suggest
 *
 * Takes the merchant's utterance + conversation context, calls Claude,
 * and returns 3 suggested responses for the rep.
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Authorization header required" },
        { status: 401 }
      );
    }

    const user = await validateCallCoachKey(apiKey);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or inactive API key" },
        { status: 401 }
      );
    }

    if (!anthropicApiKey) {
      return NextResponse.json(
        { error: "AI not configured" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { merchantUtterance, conversationContext, playbook } = body;

    if (!merchantUtterance) {
      return NextResponse.json(
        { error: "merchantUtterance is required" },
        { status: 400 }
      );
    }

    // Build conversation history string
    const contextStr = Array.isArray(conversationContext)
      ? conversationContext
          .slice(-5)
          .map(
            (t: { speaker: string; text: string }) =>
              `[${t.speaker.toUpperCase()}]: ${t.text}`
          )
          .join("\n")
      : "";

    // Filter playbook to relevant entries to reduce tokens
    const relevantPlaybook = filterRelevantPlaybook(
      Array.isArray(playbook) ? playbook : [],
      merchantUtterance
    );
    const playbookStr =
      relevantPlaybook.length > 0
        ? JSON.stringify(relevantPlaybook, null, 0)
        : "No matching playbook entries.";

    const systemPrompt = `You are a real-time sales coach for SRT Agency. You are listening to a live call between an SRT rep and a business owner (merchant).

YOUR JOB: Suggest what the REP should say next. Every word you output must be something the REP speaks out loud TO the merchant.

CRITICAL — DO NOT VIOLATE:
- NEVER generate dialogue from the merchant's perspective
- NEVER simulate what the merchant might say or example merchant answers
- NEVER role-play as the merchant
- ONLY output what the SRT Agency sales rep should say
- If unsure, default to a qualifying question the REP asks the merchant

ABOUT SRT AGENCY:
- Business financing brokerage — we match businesses with funders (NOT a direct lender)
- Products: MCA, Revolving LOC, Hybrid LOC, Equipment Financing, Working Capital, SBA loans, Term loans
- Amounts: $1K to $2M | Funding: 24-48hrs | Bilingual (English/Spanish)
- The rep's goal is to become the merchant's long-term BUSINESS FINANCE PARTNER — not just close one deal

CALL TRACKING — Analyze the conversation to determine:
- What qualifying info has already been gathered (DO NOT re-ask what's been answered)
- What's the NEXT piece of info needed from the list below
- Current call phase: OPENING → QUALIFYING → OBJECTION HANDLING → CLOSING

PRE-QUALIFICATION ORDER (ask in this exact sequence, skip what's already answered):
1. Reason for funding — why do they need capital? What's the purpose?
2. Time in business — how long have they been operating?
3. Monthly revenue — what are their monthly deposits/revenue?
4. Confirm funding amount — verify the dollar amount they need
5. Credit score — what's their credit range? (650+ = conventional/SBA, below = bridge)
6. Timeline — how soon do they need funding?

PLAYBOOK (proven rep responses — adapt when the merchant's words match a trigger):
${playbookStr}

RESPONSE FORMAT — Return EXACTLY 3 suggestions using the ACQ framework:

Suggestion 1 (category: "acknowledge"):
- MAX 2 short lines. Validate what the merchant just said. Be genuine and brief.
- Example tone: "Fifty K, got it — that's definitely in our wheelhouse."

Suggestion 2 (category: "compliment"):
- Exactly 3 bullet points (use the • character, one per line) complimenting their business, thinking, or situation.
- Example format:
• You've built something real with [their business]
• The fact that you know your numbers tells me you run a tight operation
• Most owners I talk to don't have that kind of clarity

Suggestion 3 (category: "question"):
- Start with a 1-2 sentence credibility story, analogy, or industry insight that educates the merchant and positions the rep as an expert.
- Then ask the NEXT qualifying question from the pre-qualification order above.
- Example: "I had a contractor last week — similar situation, needed 75K for equipment. Got him funded in 48 hours with terms he could actually live with. Quick question — how long have you been running [business]?"

RULES:
- Natural spoken language — confident, educational, not pushy
- When a playbook trigger matches, adapt those proven responses
- The rep wants to EDUCATE the merchant throughout the call — share industry knowledge, explain how funding works, position as an expert partner
- Never start with "I understand" (overused)
- DO NOT ask the same qualifying question twice — check conversation history first
- Use \\n for line breaks in the compliment bullet points`;

    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nMerchant just said: "${merchantUtterance}"\n\nWhat should the REP say next? Return ONLY valid JSON: { "suggestions": [{ "text": "...", "category": "..." }, { "text": "...", "category": "..." }, { "text": "...", "category": "..." }] }`
      : `Merchant just said: "${merchantUtterance}"\n\nWhat should the REP say next? Return ONLY valid JSON: { "suggestions": [{ "text": "...", "category": "..." }, { "text": "...", "category": "..." }, { "text": "...", "category": "..." }] }`;

    // Call Claude API — Haiku 4.5 for speed + cost (≈10x cheaper than Sonnet)
    const claudeResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      }
    );

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errText);
      return NextResponse.json({
        suggestions: getFallbackSuggestions(),
        fallback: true,
      });
    }

    const claudeData = await claudeResponse.json();
    const responseText =
      claudeData.content?.[0]?.text || "";

    // Parse JSON from Claude's response
    try {
      // Extract JSON from response (Claude sometimes wraps in markdown)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (
          parsed.suggestions &&
          Array.isArray(parsed.suggestions) &&
          parsed.suggestions.length >= 3
        ) {
          // Increment suggestion count for the user
          try {
            await supabaseAdmin.rpc("increment_call_coach_suggestions", {
              user_uuid: user.id,
            });
          } catch {
            // Non-critical — don't fail the request
          }

          return NextResponse.json({
            suggestions: parsed.suggestions.slice(0, 3),
          });
        }
      }
    } catch (parseError) {
      console.error("Failed to parse Claude response:", parseError, responseText);
    }

    // If parsing failed, return fallback
    return NextResponse.json({
      suggestions: getFallbackSuggestions(),
      fallback: true,
    });
  } catch (error) {
    console.error("Suggest error:", error);
    return NextResponse.json({
      suggestions: getFallbackSuggestions(),
      fallback: true,
    });
  }
}

/**
 * Filter playbook to entries most relevant to the merchant's utterance.
 * Reduces token count by only sending matching entries instead of all 30.
 */
function filterRelevantPlaybook(
  playbook: Array<{
    trigger: string;
    category: string;
    suggestions: string[];
    context: string;
    source: string;
  }>,
  utterance: string
) {
  if (playbook.length === 0) return [];

  const lower = utterance.toLowerCase();
  const words = new Set(lower.split(/\s+/).filter((w) => w.length > 2));

  const scored = playbook.map((entry) => {
    const trigger = entry.trigger.toLowerCase();
    const triggerWords = trigger.split(/\s+/);

    // Direct trigger match — highest priority
    if (lower.includes(trigger)) return { entry, score: 10 };

    // Word overlap scoring
    const matchCount = triggerWords.filter(
      (tw) => words.has(tw) || lower.includes(tw)
    ).length;
    const score = triggerWords.length > 0 ? matchCount / triggerWords.length : 0;

    return { entry, score };
  });

  // Return top 10 matches with minimum relevance threshold
  const relevant = scored
    .filter((s) => s.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => s.entry);

  // If no good matches, send a few general-purpose entries
  if (relevant.length === 0) {
    const generalCategories = [
      "pattern_interrupt",
      "objection_discovery",
      "sales_psychology",
    ];
    return playbook
      .filter((e) => generalCategories.includes(e.category))
      .slice(0, 5);
  }

  return relevant;
}

function getFallbackSuggestions() {
  return [
    {
      text: "That's a really good point, and I appreciate you being upfront about that. It tells me you're someone who does their homework before making decisions. Let me ask you — what's your monthly revenue looking like right now?",
      category: "acknowledge",
    },
    {
      text: "You know, the fact that you're even exploring options shows you're serious about growing your business — a lot of owners don't even take that step. How long have you been running things?",
      category: "compliment",
    },
    {
      text: "What would fast access to working capital mean for your business right now — is there a specific project or opportunity you're trying to jump on?",
      category: "question",
    },
  ];
}
