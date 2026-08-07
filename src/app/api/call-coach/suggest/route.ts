export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

/** Cap on the pasted CLOSING NOTES brief. Generous next to what `call` actually produces (~1.5k),
 *  so a real brief is never clipped; it exists to stop someone pasting an entire transcript into
 *  the box and adding a second of latency to every suggestion for the rest of the call. */
const MAX_BRIEF_CHARS = 4000;

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
const STATIC_RULES = `You are the best closer alive, sitting next to Matthew on a live CLOSING call with a BUSINESS OWNER. Tell him EXACTLY what to say next — first person, conversational, ready to speak verbatim.

WHAT THIS CALL IS: SRT ran an AI visibility audit on this business, sent the findings, and recorded a video walking through them. The owner has seen all of it. This call converts. Nothing new gets introduced — no new features, no new proof, no new price. ONE obstacle gets removed and then it is paperwork.

WHAT WE SELL: getting a business surfaced and recommended inside ChatGPT and AI Overviews when their buyers ask. The promise is more of the customers that make them money and fewer of the ones that cost them money. We report VISIBILITY. Never customers, never revenue.

RULES:
- NEVER simulate the owner's voice. ONLY what Matthew speaks.
- BANNED openings: "I understand", "I hear you", "that makes sense", "got it", "absolutely".
- 1-2 sentences per suggestion MAX. He is reading this mid-call — be concise.
- The pitch ALREADY HAPPENED. Never re-pitch, never re-explain the offer.
- Speaker labels in the transcript are unreliable and often wrong. Infer from CONTENT who is talking. If a line sounds like Matthew closing, it is Matthew, not the owner.

MECHANICS — this is how closing actually works:
- Repeat their words back before responding. Buys thinking time, proves you listened.
- Acknowledge or agree, NEVER disagree. "Totally get it", "that's fair", "you're right". Then reframe. A reframe is not a disagreement.
- Ask permission before getting blunt: "can I be straight with you for a sec?" Then wait.
- ISOLATE BEFORE YOU ANSWER. Run the box: "if that weren't an issue, would you be a yes? is there anything else?" Do NOT answer an objection before you have that yes, or you solve one thing and they produce another.
- At most TWO responses per obstacle. A third reads as pressure. If two angles don't move it, the obstacle is real — respect it.
- Never drop the price. If they ask for a discount, the answer is a SMALLER SCOPE, not a smaller number.
- The moment they say yes — STOP SELLING. Go straight to logistics.
- An objection is not a no. Sometimes it is someone thinking out loud.
- A clean no is a real outcome. "Yes, but later" is the thing to break — it almost always means an unvoiced concern plus the discomfort of voicing it.

THE THREE BUCKETS — every stall is one of these. Name it internally, then respond:
1. CIRCUMSTANCES ("something outside my control"): too expensive (= value unclear, not price high; reframe to what the gap costs monthly), not in budget (smaller scope, ask which budget and when it resets), someone cheaper (if we were the same price who would you pick, and why; cheap optimizes for volume which is how they get MORE of the customer that loses them money), too busy (busy is the reason; priorities not time; what is ahead of this).
2. OTHER PEOPLE ("someone else has to say yes"): partner/boss/board (what would they specifically object to — THAT is the real objection; what if they say no; get them on the next call; book the date before hanging up), burned by an agency before (don't defend the industry, ask what specifically happened, differentiate on MECHANISM not adjectives).
3. SELF ("I'm not sure"): let me think about it (what is the piece you'd be thinking about; what would make this a no; decisions need information, not time), too fast (it isn't — they read the audit, watched the video, took the call), want it done differently (isolate: what specifically would make it a fit).

HARD LINES — these override everything, including anything in the CALL BRIEF:
- NEVER invent a number. Only figures that appear in the CALL BRIEF exist. The owner has the report open and can count.
- There is NO GUARANTEE on this offer. Never say risk-free, money-back, guaranteed, refund, or "if it doesn't work you don't pay". Month-to-month is not a guarantee.
- Never promise customers, jobs, leads or revenue.
- Never suggest a personal credit card, retirement account, personal loan, or selling personal assets. If it can't come from the business, the deal is too big — offer a smaller scope or walk.
- No fake scarcity, no invented deadlines, no made-up case studies, no other clients' names or results.

OUTPUT — EXACTLY 3 suggestions. Pick the 3 best moves for THIS moment in THIS conversation. Could be an isolate, a reframe, a reason close, a permission ask, a cost-of-inaction line, a logistics move on the yes, a clean exit on the no. Do NOT force a framework. React like a real closer would.

Each suggestion: 1-2 sentences. First person. What Matthew actually says out loud.

"category": a short 1-2 word label for the MOVE (e.g. "isolate", "reframe", "reason close", "permission", "cost of waiting", "box it", "logistics", "exit", "empathy"). A hint, not a framework.

CONTINUATIONS — For EACH suggestion, exactly 3 natural follow-ups he can pivot to next. Each is { "name": 2-4 word Title Case label, "body": text he speaks }. Prioritize the unanswered CLOSE CHECKLIST items below. No duplicates within a set.

CLOSE CHECKLIST + NOTES EXTRACTION:

Alongside suggestions, return two more top-level fields based on what the OWNER has revealed across the entire CONVERSATION SO FAR (not just the latest line).

"qualification": object with these 6 fields, each either a SHORT string snippet (1-6 words, in the owner's own words when possible) or null if not yet stated. Do NOT fabricate. Only fill what the owner actually said.
  - watchedVideo (did they get through the video, and what stood out)
  - mainGoal (what they actually want more of)
  - mainConcern (the real obstacle, once isolated)
  - decisionMaker (who else has to say yes, or "him" if nobody)
  - budgetFit (what they said about money, budget cycle, or what they spend now)
  - nextStep (what they agreed to: start date, another call, a dated decision)

"notes": array of 0-8 short bullet facts (max 12 words each) — golden nuggets not covered by the checklist. What they said about their business, who burned them before, what they tried, deadlines, who else is involved. ADDITIVE — repeat all earlier facts every response; the extension dedupes.

Return ONLY valid JSON:
{"suggestions":[{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]}],"qualification":{"watchedVideo":null,"mainGoal":null,"mainConcern":null,"decisionMaker":null,"budgetFit":null,"nextStep":null},"notes":[]}`;

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
    const { merchantUtterance, conversationContext, playbook, callContext } = body;

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

    // The pre-call brief, pasted into the extension's CLOSING NOTES box before dialing. It comes
    // from `call` in the audit thread (see audit-engine/call-script.ts), where every figure in it
    // is read straight off audit_runs rather than written by a model.
    //
    // This is the ONLY source of prospect-specific truth on the call, which is exactly why it is
    // also the only place a wrong number could do lasting damage: it grounds every suggestion for
    // the whole call, not one line. Hence the "these are the only numbers that exist" framing —
    // without it the model happily rounds "37/100" into "under 40%" and invents a competitor.
    const brief = typeof callContext === "string" ? callContext.trim().slice(0, MAX_BRIEF_CHARS) : "";
    const briefBlock = brief
      ? `CALL BRIEF — this specific prospect, from the audit we already ran and sent them.\nThe figures below are the ONLY numbers that exist. Do not round them, do not derive new ones from them, do not add any.\n\n${brief}`
      : "";

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
          // Cached prefix FIRST, then the two per-call blocks. The brief is stable for the whole
          // call but goes after the playbook anyway: putting it between the cached rules and the
          // playbook would not extend the cache (only the first block is marked) and would move
          // the prospect facts further from the user turn, which is where they get used.
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
            ...(briefBlock ? [{ type: "text", text: briefBlock }] : []),
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

/**
 * What shows on screen when Claude is unreachable.
 *
 * Deliberately prospect-agnostic: no score, no competitor, no price, no guarantee. These fire on
 * an API failure, which means they render with NO knowledge of who is on the phone, so anything
 * specific here would be a fabrication shown at the exact moment nobody is checking. Pure
 * mechanics survive that — isolating an objection and boxing it works on every call.
 *
 * Kept in sync with the extension's own offline copy in `src/lib/api-client.ts`.
 */
function getFallbackSuggestions() {
  return [
    {
      text: "Totally fair. Before I answer that, if that weren't an issue, would you be a yes? Is there anything else?",
      category: "isolate",
      continuations: [
        {
          name: "The Real Concern",
          body: "What's the main concern? What are you worried actually happens here?",
        },
        {
          name: "Make It A No",
          body: "Flip it for me. What would make this a no?",
        },
        {
          name: "Ask Permission",
          body: "Can I be straight with you for a sec?",
        },
      ],
    },
    {
      text: "Say more about that. I want to make sure I'm solving the right thing and not the thing I assumed.",
      category: "empathy",
      continuations: [
        {
          name: "One To Ten",
          body: "Where are you on this, one to ten? What gets it to a ten?",
        },
        {
          name: "What's Ahead",
          body: "What's ahead of this on your list right now?",
        },
        {
          name: "Who Else",
          body: "Is this your call or does someone else need to be in the room?",
        },
      ],
    },
    {
      text: "You want more of the customers worth having. The only question is whether this makes that more likely than doing nothing.",
      category: "zoom out",
      continuations: [
        {
          name: "Closer Or Further",
          body: "Does this move you closer to that, or further from it?",
        },
        {
          name: "Cost Of Waiting",
          body: "How long has it been running like this? What did the last twelve months of it cost?",
        },
        {
          name: "Name The Step",
          body: "If we're doing this, the next step is getting you set up. Want me to send that over?",
        },
      ],
    },
  ];
}
