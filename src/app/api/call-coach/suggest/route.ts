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

    const systemPrompt = `You are a real-time sales coach for SRT Agency. The rep is on a live call with the BUSINESS OWNER ("the president") who is on the other end of the line. Write what the REP should say next, in first person, addressed directly to the owner.

CRITICAL — DO NOT VIOLATE:
- NEVER generate dialogue from the merchant's perspective. NEVER simulate what the owner might say.
- ONLY output what the SRT rep should speak out loud.
- DO NOT use empty acknowledgment phrases as a standalone move ("I hear you", "I understand", "that makes sense", "I get it", "got it", "absolutely"). They waste pacing. The compliment slot exists instead — make it specific.
- NEVER start with "I understand" (overused, banned).
- DO NOT ask the same qualifying question twice — check the conversation history first.

ABOUT SRT AGENCY:
- Business financing brokerage — we match businesses with funders (NOT a direct lender).
- Products: MCA, Revolving LOC, Hybrid LOC, Equipment Financing, Working Capital, SBA loans, Term loans, DSCR / commercial real estate.
- Amounts: $1K to $2M | Funding: 24-48hrs | Bilingual (English/Spanish).
- The rep's goal is to become the owner's long-term BUSINESS FINANCE PARTNER — not just close one deal.

DISCOVERY PRIORITIES — CORE QUALIFYING (gather in this order, skip what's already answered):
1. Reason for funding — THE #1 NORTH STAR. Why do they need capital?
2. Use of funds — what specifically will the money go toward? (equipment / payroll / marketing / inventory / real estate / partner buyout / bridging AR). The lender underwrites the use, not just the amount.
3. Time in business
4. Monthly revenue + ADB (average daily balance)
5. Confirm funding amount
6. Credit score range (650+ = conventional/SBA, below = bridge/MCA)
7. Timeline — how soon do they need it

CONDITIONAL DEEP DIVES — switch the question slot when conversation goes here:
- SBA / Term Loan track: 2yr business tax returns, YTD P&L + balance sheet, debt schedule, collateral, personal financial statement.
- DSCR / commercial real estate: DSCR score (or NOI ÷ debt service), property type/occupancy, existing debt service, purchase vs refi, rent roll.
- Credit-as-blocker: what's pulling the score down (collections, charge-offs, late pays, utilization, recent inquiries), items in dispute, recent BK/tax lien, score trend.

PLAYBOOK (proven rep responses — adapt when the merchant's words match a trigger):
${playbookStr}

OUTPUT — Return EXACTLY 3 suggestions using the CSQ framework.

Suggestion 1 — category: "compliment"
- EXACTLY ONE LINE. Max ~15 words. NO bullet points. NO line breaks.
- Specific to the owner's business, thinking, or numbers — never generic.
- BANNED: "That's a great point", "great question", "love that", "smart move", any filler.

Suggestion 2 — category: "story"
- EITHER a credibility story (a past client outcome) OR a piece of EDUCATION (how this product actually works, what underwriting looks like, what most owners get wrong).
- Must include at least one CONCRETE NUMBER or timeframe ("$50K → $180K", "48 hours", "DSCR of 1.25", "2 years in business", "650 FICO").
- 2-3 sentences max. Natural spoken language.

Suggestion 3 — category: "question"
- Lead toward REASON FOR FUNDING and USE OF FUNDS unless those are already nailed down. If they are, switch to the next CORE qualifying item or a CONDITIONAL deep-dive question if the conversation went there.
- One sentence. No preamble.

CONTINUATIONS — For EACH of the 3 suggestions above, also generate exactly 3 follow-up "continuations" the rep can pivot to next. Each continuation is a tight 1-2 sentence story or education snippet with a CONCRETE NUMBER. Each continuation has:
- name: a 2-4 word label, Title Case, like "Restaurant 60-day" or "AR Bridge" or "Equipment Refi" or "DSCR 1.25 Deal".
- body: the 1-2 sentence story body the rep would actually speak out loud.

Continuations should give the rep options to keep pushing toward reason-for-funding and use-of-funds.

Return ONLY valid JSON in this exact shape:
{
  "suggestions": [
    {
      "text": "<compliment line>",
      "category": "compliment",
      "continuations": [
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." }
      ]
    },
    {
      "text": "<story or education>",
      "category": "story",
      "continuations": [
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." }
      ]
    },
    {
      "text": "<question>",
      "category": "question",
      "continuations": [
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." },
        { "name": "...", "body": "..." }
      ]
    }
  ]
}`;

    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Generate the CSQ bundle that flows naturally from the owner's last line and keeps pushing toward reason for funding + use of funds. Return ONLY the JSON described in the system prompt — no markdown, no commentary.`
      : `The owner just said: "${merchantUtterance}"\n\nWhat should the REP say next? Generate the CSQ bundle and return ONLY the JSON described in the system prompt — no markdown, no commentary.`;

    // Call Claude API — Haiku 4.5 for speed + cost (~10x cheaper than Sonnet)
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
          max_tokens: 2000,
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
    const responseText = claudeData.content?.[0]?.text || "";

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

          // Sanitize: keep only the first 3 suggestions, ensure each has a
          // valid continuations array (max 3 entries, all with name + body).
          const cleanSuggestions = parsed.suggestions
            .slice(0, 3)
            .map((s: { text: string; category: string; continuations?: Array<{ name: string; body: string }> }) => ({
              text: typeof s.text === "string" ? s.text : "",
              category: typeof s.category === "string" ? s.category : "question",
              continuations: Array.isArray(s.continuations)
                ? s.continuations
                    .filter(
                      (c) =>
                        c &&
                        typeof c.name === "string" &&
                        typeof c.body === "string"
                    )
                    .slice(0, 3)
                : [],
            }));

          return NextResponse.json({
            suggestions: cleanSuggestions,
          });
        }
      }
    } catch (parseError) {
      console.error(
        "Failed to parse Claude response:",
        parseError,
        responseText
      );
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
      text: "You're already further along than most owners I talk to in your space.",
      category: "compliment",
      continuations: [
        {
          name: "Restaurant 60-day",
          body: "I had a restaurant owner last month — same situation, $50K bridge in 60 days, ended up restructuring into a $180K LOC once revenue caught up.",
        },
        {
          name: "Equipment Refi",
          body: "A trucking client refinanced his $90K equipment note into a 36-month working capital line — saved him $2.4K a month in cash flow.",
        },
        {
          name: "AR Bridge",
          body: "An HVAC contractor was waiting on $120K in AR — we bridged him in 48 hours so he could meet payroll without touching his line.",
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
          name: "Use Drilldown",
          body: "Is that for equipment, payroll, inventory, or something time-sensitive like a vendor opportunity?",
        },
        {
          name: "Timeline Tie",
          body: "And how soon does that need to happen — are we talking this week, this month, or sometime in the next quarter?",
        },
        {
          name: "ROI Frame",
          body: "Once that dollar's working for you, what's the return you're expecting on it — and over what timeline?",
        },
      ],
    },
  ];
}
