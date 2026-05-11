export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

/**
 * Static portion of the system prompt — everything that does NOT change
 * between requests. Hoisted to module scope so the same string is reused
 * on every call, which is what lets Anthropic prompt caching land a hit
 * (the cached prefix has to be byte-identical across requests).
 *
 * The dynamic playbook block is sent as a SEPARATE, uncached system block
 * AFTER this one (see the fetch body below). Order matters: cached prefix
 * first, variable suffix second.
 */
const STATIC_RULES = `You are the best closer at SRT Agency, sitting next to a rep on a live call with a BUSINESS OWNER. Tell the rep EXACTLY what to say next — first person, conversational, ready to speak verbatim.

RULES:
- NEVER simulate the owner's voice. ONLY what the rep speaks.
- BANNED openings: "I understand", "I hear you", "that makes sense", "got it", "absolutely".
- Don't repeat qualifying questions already answered in history.
- 1-2 sentences per suggestion MAX. The rep is reading this mid-call — be concise.

SRT AGENCY: Brokerage matching businesses with revenue-based funders. Products: MCA (revenue-based funding), LOC, Hybrid LOC, Equipment Financing, Working Capital. $1K-$2M, 24-48hr funding. Goal = long-term finance partner, not one deal. We do NOT do SBA, term bank loans, or DSCR/CRE — never mention them.

DISCOVERY (in order, skip what's answered):
1. Reason for funding — THE NORTH STAR.
2. Use of funds (equipment/payroll/marketing/inventory/AR). Lender underwrites the USE.
3. Time in business. 4. Monthly revenue + ADB. 5. Amount. 6. Credit (below 600 = still funded, but factor rate higher; 600–700 = better terms). 7. Timeline.
DEEP DIVES — switch when conversation goes there: Equipment (equipment quote, vendor, new vs used); Credit-blocker (collections, charge-offs, utilization, BK/lien — reframe: "your credit doesn't decide this, your revenue does").

OUTPUT — EXACTLY 3 suggestions. Think freely. Pick the 3 best moves for THIS moment in THIS conversation. Could be a redirect, a story with numbers, a qualifying question, an empathy play, a reframe, an objection handler, a close attempt — whatever the situation calls for. Do NOT force a framework. React to what the owner just said like a real closer would.

Each suggestion: 1-2 sentences. First person. What the rep actually says out loud. Include concrete numbers when telling stories ("$50K→$180K", "48 hours", "580 FICO still approved", "1.28 factor rate").

"category": a short 1-2 word label describing the MOVE you're making (e.g. "redirect", "credibility", "qualify", "reframe", "empathy", "story", "close", "urgency", "educate", "discovery"). Pick whatever fits — this is a hint for the rep, not a framework.

CONTINUATIONS — For EACH suggestion, generate exactly 3 natural follow-ups the rep can pivot to next. Each is { "name": 2-4 word Title Case label, "body": text the rep speaks }. These should be a mix of whatever fits: discovery questions, stories with numbers, reframes, pivots. Prioritize unanswered DISCOVERY items. Skip anything already answered. No duplicates within a set.

QUALIFICATION + NOTES EXTRACTION:

Alongside suggestions, return two more top-level fields based on what the OWNER has revealed across the entire CONVERSATION SO FAR (not just the latest line).

"qualification": object with these 6 fields, each either a SHORT string snippet (1-6 words, in the owner's own words when possible) or null if not yet stated. Do NOT fabricate. Only fill what the owner actually said.
  - useOfFunds, amount, monthlyRevenue, timeInBusiness, creditProfile, timeline

"notes": array of 0-8 short bullet facts (max 12 words each) — golden nuggets not covered by qualification fields. Goals, pain points, deal context, lender history, growth plans. ADDITIVE — repeat all earlier facts every response; the extension dedupes.

Return ONLY valid JSON:
{"suggestions":[{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]}],"qualification":{"useOfFunds":null,"amount":null,"monthlyRevenue":null,"timeInBusiness":null,"creditProfile":null,"timeline":null},"notes":[]}`;

/**
 * POST /api/call-coach/suggest
 *
 * Takes the merchant's utterance + conversation context, calls Claude (Haiku 4.5),
 * and returns 3 free-form suggestions for the rep — whatever the best move is
 * for this moment — each with 3 natural follow-up continuations.
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

    // Dynamic system block — appended AFTER the cached STATIC_RULES.
    // Keeping this separate is what lets the static prefix get a cache hit.
    const playbookBlock = `PLAYBOOK (adapt when merchant words match a trigger):\n${playbookStr}`;

    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Pick the 3 best moves for this exact moment. Return ONLY the JSON — no markdown, no commentary.`
      : `The owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Pick the 3 best moves for this exact moment. Return ONLY the JSON — no markdown, no commentary.`;

    // Call Claude API — Haiku 4.5 streaming for lowest TTFT.
    //
    // The system field is split into TWO blocks so the first one (the
    // static rules — easily >1024 tokens) gets cached by Anthropic. On
    // every subsequent call within the 5-minute ephemeral window we pay
    // ~10% of the input cost on that block and TTFT drops noticeably.
    // The dynamic playbook block sits AFTER the cached block so it can
    // change per-utterance without invalidating the cache.
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
          max_tokens: 800,
          temperature: 0.5,
          stream: true,
          system: [
            {
              type: "text",
              text: STATIC_RULES,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: playbookBlock,
            },
          ],
          messages: [{ role: "user", content: userMessage }],
        }),
      }
    );

    if (!claudeResponse.ok || !claudeResponse.body) {
      const errText = await claudeResponse.text().catch(() => "");
      console.error("Claude API error:", claudeResponse.status, errText);
      return NextResponse.json({
        suggestions: getFallbackSuggestions(),
        fallback: true,
      });
    }

    // Increment usage counter optimistically (fire and forget)
    void (async () => {
      try {
        await supabaseAdmin.rpc("increment_call_coach_suggestions", {
          user_uuid: user.id,
        });
      } catch {
        // Non-critical
      }
    })();

    // Proxy the SSE stream straight through to the extension.
    // The extension parses Anthropic SSE events incrementally and
    // renders complete suggestions as they arrive.
    return new Response(claudeResponse.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
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
 * Reduces token count by only sending matching entries instead of all 30+.
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
      text: "Listen, I'm not one of those guys calling to jam a deal — I want to be your long-term finance partner. We sit between you and 50+ funders so we can match you with the right product. What was the original reason you were looking at capital?",
      category: "redirect",
      continuations: [
        {
          name: "Use Of Funds",
          body: "Where would the money actually go — equipment, payroll, inventory?",
        },
        {
          name: "Time In Biz",
          body: "How long have you been running the business?",
        },
        {
          name: "Monthly Revenue",
          body: "What does a typical month look like on the top line?",
        },
      ],
    },
    {
      text: "I had a contractor come in needing $50K — once we structured around the use of funds, he walked out with $180K in 48 hours. The lender underwrites the USE, not just the amount.",
      category: "credibility",
      continuations: [
        {
          name: "650 Pivot",
          body: "If the score is around 650, we pivot from MCA to a hybrid LOC — 12-month terms instead of 6.",
        },
        {
          name: "ADB Floor",
          body: "Lenders look at average daily balance more than top-line revenue — a $30K ADB on $200K beats a $5K ADB on $400K every time.",
        },
        {
          name: "Credit Check",
          body: "What's your credit sitting at right now, roughly?",
        },
      ],
    },
    {
      text: "If the money landed in your account on Monday, what's the very first dollar going toward?",
      category: "discovery",
      continuations: [
        {
          name: "Amount",
          body: "And ballpark — how much capital are we talking about?",
        },
        {
          name: "Timeline",
          body: "What's your timeline on this — are you looking to move in the next week or two?",
        },
        {
          name: "Reason For Funding",
          body: "What's pushing you to look at capital right now?",
        },
      ],
    },
  ];
}
