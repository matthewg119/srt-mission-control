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

    // Build playbook string
    const playbookStr = Array.isArray(playbook) && playbook.length > 0
      ? JSON.stringify(playbook.slice(0, 30), null, 0)
      : "No playbook loaded yet.";

    const systemPrompt = `You are an expert MCA (Merchant Cash Advance) sales coach for SRT Agency.
You are listening to a live sales call between an SRT Agency rep and a business owner (merchant).
Your job: suggest what the rep should say next.

ABOUT SRT AGENCY:
- AI-powered business financing brokerage (NOT a direct lender — we match businesses with funders)
- Bilingual (English/Spanish), fast funding (24-48hrs)
- Products: Revolving Line of Credit, Hybrid Line of Credit, Equipment Financing, Working Capital
- Amounts: $1K to $2M depending on product
- We focus on healthcare, restaurants, contractors, retail

PLAYBOOK (objection/rebuttal knowledge base):
${playbookStr}

RULES FOR YOUR SUGGESTIONS:
- Return EXACTLY 3 suggestions, each 1-3 sentences max
- Suggestion 1 (rebuttal): Direct answer — handle the objection head-on
- Suggestion 2 (empathy): Acknowledge their concern, then pivot to value
- Suggestion 3 (question): Ask a question to dig deeper behind the stated objection
- Use natural spoken language, not scripted-sounding
- Never start with "I understand" (overused)
- Be confident but not pushy
- If the merchant sounds ready to close, suggest closing language instead
- Reference specific financing details when relevant`;

    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe merchant just said: "${merchantUtterance}"\n\nReturn ONLY valid JSON: { "suggestions": [{ "text": "...", "category": "rebuttal" }, { "text": "...", "category": "empathy" }, { "text": "...", "category": "question" }] }`
      : `The merchant just said: "${merchantUtterance}"\n\nReturn ONLY valid JSON: { "suggestions": [{ "text": "...", "category": "rebuttal" }, { "text": "...", "category": "empathy" }, { "text": "...", "category": "question" }] }`;

    // Call Claude API directly (matching existing Mission Control pattern)
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
          model: "claude-sonnet-4-20250514",
          max_tokens: 512,
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

function getFallbackSuggestions() {
  return [
    {
      text: "That's a great point — let me ask you this: what would getting fast access to working capital mean for your business right now?",
      category: "rebuttal",
    },
    {
      text: "I hear you. A lot of our clients felt the same way before they saw how quick and easy the process is.",
      category: "empathy",
    },
    {
      text: "Just curious — what's your biggest challenge with cash flow right now?",
      category: "question",
    },
  ];
}
