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
 * Takes the merchant's utterance + conversation context, calls Claude (Haiku 4.5),
 * and returns 3 CSQ suggestions (Compliment / Story / Question) for the rep,
 * each with 3 bundled "continuation" stories the rep can pivot to next.
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

    const systemPrompt = `You are a real-time sales coach for SRT Agency. The rep is on a live call with the BUSINESS OWNER. Write what the REP should say next, first person, to the owner.

RULES:
- NEVER simulate the owner's voice. ONLY what the rep speaks.
- BANNED openings: "I understand", "I hear you", "that makes sense", "got it", "absolutely".
- Don't repeat qualifying questions already answered in history.

SRT AGENCY: Brokerage matching businesses with funders. Products: MCA, LOC, Hybrid LOC, Equipment, Working Capital, SBA, Term, DSCR/CRE. $1K-$2M, 24-48hr funding. Goal = long-term finance partner, not one deal.

DISCOVERY (in order, skip what's answered):
1. Reason for funding — THE NORTH STAR.
2. Use of funds (equipment/payroll/marketing/inventory/RE/buyout/AR). Lender underwrites the USE.
3. Time in business. 4. Monthly revenue + ADB. 5. Amount. 6. Credit (650+ = SBA/conv, below = bridge/MCA). 7. Timeline.
DEEP DIVES — switch when conversation goes there: SBA (2yr returns, YTD P&L, debt schedule, PFS); DSCR/CRE (DSCR or NOI÷DS, occupancy, rent roll); Credit-blocker (collections, charge-offs, utilization, BK/lien).

PLAYBOOK (adapt when merchant words match a trigger):
${playbookStr}

OUTPUT — EXACTLY 3 suggestions, CSQ framework.

Suggestion 1 — "compliment": HARD LIMIT 6 WORDS MAX. Count them. One line. Specific to the owner. No filler ("great point", "love that", "smart move").
Suggestion 2 — "story": Credibility story OR education. Must include a CONCRETE NUMBER ("$50K→$180K", "48 hours", "DSCR 1.25", "650 FICO"). 2-3 sentences max.
Suggestion 3 — "question": One sentence pushing toward reason for funding + use of funds (or next core item). No preamble.

CONTINUATIONS — For EACH of the 3 suggestions, generate exactly 3 follow-up snippets the rep can pivot to. Each is { "name": 2-4 word Title Case label, "body": text the rep speaks }.

Continuation rules by parent category:

- For "compliment" and "question": each continuation MUST be a SHORT PREQUALIFYING QUESTION the rep can fire to redirect the conversation back to discovery. One sentence, conversational, no preamble. The "name" is a topic chip (e.g. "Credit Check", "Use Of Funds", "Time In Biz", "Monthly Revenue", "Amount", "Timeline", "Reason For Funding"). The "body" is the actual question text the rep speaks to the owner.

- For "story": each continuation stays a 1-2 sentence credibility story with a CONCRETE NUMBER (same as before — these pair with the story pivot).

PREQUALIFYING-QUESTION RULES (apply to compliment + question continuations):
* Pull from the DISCOVERY list above. Skip any item already answered in CONVERSATION SO FAR — never re-ask what the owner already told the rep.
* Prioritize unanswered items in DISCOVERY order: reason for funding > use of funds > time in business > monthly revenue/ADB > amount > credit > timeline.
* Pick 3 DIFFERENT discovery items per suggestion — no duplicates within a continuation set.
* Phrase as the REP speaking to the OWNER. First person. Natural. Examples: "What's the money actually going toward — equipment, payroll, marketing?", "How long have you been in business?", "What's a typical month look like for you on revenue?".
* If fewer than 3 discovery items remain unanswered, fill the remaining slots with deep-dive questions from the DEEP DIVES list (SBA / DSCR / credit-blocker), matching whichever path the merchant is on.

Return ONLY valid JSON:
{"suggestions":[{"text":"<compliment ≤6 words>","category":"compliment","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"<story>","category":"story","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"<question>","category":"question","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]}]}`;

    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Generate the CSQ bundle that flows naturally from the owner's last line and keeps pushing toward reason for funding + use of funds. Return ONLY the JSON described in the system prompt — no markdown, no commentary.`
      : `The owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Generate the CSQ bundle and return ONLY the JSON described in the system prompt — no markdown, no commentary.`;

    // Call Claude API — Haiku 4.5 streaming for lowest TTFT
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
          max_tokens: 1200,
          stream: true,
          system: systemPrompt,
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
      text: "You're thinking about this right.",
      category: "compliment",
      continuations: [
        {
          name: "Reason For Funding",
          body: "What's pushing you to look at capital right now?",
        },
        {
          name: "Use Of Funds",
          body: "Where would the money actually go — equipment, payroll, inventory?",
        },
        {
          name: "Time In Biz",
          body: "How long have you been running the business?",
        },
      ],
    },
    {
      text: "The lender underwrites the USE, not just the amount — most owners don't know that. I had a contractor needing $50K who walked away with $180K in 48 hours once we structured around the use of funds.",
      category: "story",
      continuations: [
        {
          name: "DSCR 1.25 Deal",
          body: "On commercial real estate, anything above a 1.25 DSCR opens up the conventional door — most brokers won't even tell you that.",
        },
        {
          name: "650 Pivot",
          body: "If the score is sitting around 650, we pivot from MCA to a hybrid LOC — that's where you get 12-month terms instead of 6.",
        },
        {
          name: "ADB Floor",
          body: "Lenders look at average daily balance more than top-line revenue — a $30K ADB on $200K revenue beats a $5K ADB on $400K every time.",
        },
      ],
    },
    {
      text: "If the money landed in your account on Monday, what's the very first dollar going toward?",
      category: "question",
      continuations: [
        {
          name: "Monthly Revenue",
          body: "What does a typical month look like on the top line?",
        },
        {
          name: "Amount",
          body: "And ballpark — how much capital are we talking about?",
        },
        {
          name: "Credit Check",
          body: "What's your credit sitting at right now, roughly?",
        },
      ],
    },
  ];
}
