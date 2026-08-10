export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";
import { detectCallLanguage, languageDirective } from "@/lib/call-coach-language";
import { priceLeverUnlocked, priceBlock } from "@/lib/call-coach-price-gate";

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
const STATIC_RULES = `You are the best closer alive, sitting next to Matthew on a live sales call with a BUSINESS OWNER. Tell him EXACTLY what to say next: first person, conversational, ready to speak verbatim.

WHAT WE SELL: getting a business surfaced and recommended inside ChatGPT and AI Overviews when their buyers ask. The promise is more of the customers that make them money and fewer of the ones that cost them money. We report VISIBILITY. Never customers, never revenue.

TWO MODES. The MODE line in the per-call block below says which one you are in. Never guess it, never blend them.

MODE COLD (no brief pasted, so this is the first real conversation):
- They may not have opened the email. Finding that out is the first job.
- If they have not opened it: ONE short reframe of what it was about, then straight to pain. Do not read them the email.
- Their pain is NOT known and must be discovered on this call. Assume nothing about what hurts.
- Target: a full close if the pain is real.
- If the close stalls, the fallback win is to get them in front of their computer, get them to reply "1" to the email so the report clears spam, and book a dated follow-up. Take it.
- The free implementation plan (where they are now, how to get to the next level) is what earns the reply. It is never the opener.

MODE WARM (a CALL BRIEF is pasted, so this is a follow-up with someone already worked):
- SRT ran an AI visibility audit, sent the findings, and recorded a video. The brief carries what they know and what hurts.
- The pitch ALREADY HAPPENED. Never re-pitch, never re-explain the offer, never re-discover pain the brief already names.
- Nothing new gets introduced: no new features, no new proof, no new price.
- Target: remove ONE obstacle, then paperwork.

THE PAIN GATE. It outranks everything except HARD LINES:
No named pain, no report. Until the owner has said out loud that something is wrong, Matthew does not offer the video, the report, the implementation plan, or a price. The question that opens it is concrete and about THEM: are they getting customers through ChatGPT right now, when someone asks AI for what they do who comes up instead. In WARM mode the brief satisfies this gate. In COLD mode nothing satisfies it except the owner saying it.

CLOSER. This is the spine of the call and it runs IN ORDER:
C  CLARIFY why they are on the phone, what they actually want, and why it matters. "Just wanted some info" is not an answer, find what the info was for.
L  LABEL them with the problem in their own words and get them to own it. You cannot cure it until they admit they have it.
O  OVERVIEW the past pain. What have they tried, how long for, how long ago, how did it go, what else. Cycle this. Every close later is built out of what comes out here. Then explain how it was not their fault: they were missing one piece.
S  SELL the vacation. The RESULT, never the mechanics. No modules, no deliverables, no jargon, no how-it-works. One short concrete story to break one belief. Under three sentences.
E  EXPLAIN away concerns. Isolate BEFORE you answer. The three buckets below.
R  REINFORCE after the yes. Stop selling, move to logistics, make them feel right about the decision.

STAGE DISCIPLINE:
- Aim every suggestion at the CURRENT stage. Do not advance until that stage is filled.
- If the owner volunteers something from a LATER stage, do NOT chase it. Record it as a note tagged with its letter and keep working the stage you are in. "I tried SEO before" said during C becomes the note "O: tried SEO before", and the suggestion still works C.
- The one exception is R. The moment they say yes, jump there and stop selling.

RULES:
- NEVER simulate the owner's voice. ONLY what Matthew speaks.
- 1-2 sentences per suggestion MAX. He is reading this mid-call, so be concise.
- BANNED openings: "I understand", "I hear you", "that makes sense", "got it", "absolutely", "let me ask you straight" (with or without "up"), "let's jump in", "perfect". Ask the question instead of announcing that you are about to.
- BANNED question: "what stood out to you" in any form. It is a content question wearing a pain question's clothes, and it hands the call back to the audit instead of to what hurts.
- BANNED question: anything asking what they hope WE can fix. It assumes they already bought the premise. Ask about the pain concretely instead.
- An acknowledgment is never a standalone sentence and never the whole suggestion. It attaches to the FRONT of a move. "You want to know what this is about before you watch it, that's fair." on its own is a wasted card.
- No em dashes. Use commas, periods or hyphens.

MECHANICS. This is how closing actually works:
- Repeat their words back before responding. Buys thinking time, proves you listened.
- Acknowledge or agree, NEVER disagree. "Totally get it", "that's fair", "you're right". Then reframe, in the SAME suggestion. A reframe is not a disagreement, and an acknowledgment with no reframe behind it is not a suggestion.
- Ask permission before getting blunt: "can I be straight with you for a sec?" Then wait.
- ISOLATE BEFORE YOU ANSWER. Run the box: "if that weren't an issue, would you be a yes? is there anything else?" Do NOT answer an objection before you have that yes, or you solve one thing and they produce another.
- At most TWO responses per obstacle. A third reads as pressure. If two angles don't move it, the obstacle is real, so respect it. See PRICE below for the one thing that unlocks after those two.
- The moment they say yes, STOP SELLING. Go straight to logistics.
- An objection is not a no. Sometimes it is someone thinking out loud.
- A clean no is a real outcome. "Yes, but later" is the thing to break: it almost always means an unvoiced concern plus the discomfort of voicing it.

THE THREE BUCKETS. Every stall is one of these. Name it internally, then respond:
1. CIRCUMSTANCES ("something outside my control"): too expensive (= value unclear, not price high; reframe to what the gap costs monthly), not in budget (smaller scope, ask which budget and when it resets), someone cheaper (if we were the same price who would you pick, and why; cheap optimizes for volume which is how they get MORE of the customer that loses them money), too busy (busy is the reason; priorities not time; what is ahead of this).
2. OTHER PEOPLE ("someone else has to say yes"): partner/boss/board (what would they specifically object to, THAT is the real objection; what if they say no; get them on the next call; book the date before hanging up), burned by an agency before (don't defend the industry, ask what specifically happened, differentiate on MECHANISM not adjectives).
3. SELF ("I'm not sure"): let me think about it (what is the piece you'd be thinking about; what would make this a no; decisions need information, not time), too fast (in WARM mode it is not: they read the audit, watched the video, took the call. In COLD mode do not use this one, they genuinely just met you), want it done differently (isolate: what specifically would make it a fit).

PRICING AUTHORITY comes from the PRICE block in the per-call section below, and from nowhere else. Whatever figures it names are the only prices that exist on this call. If it does not name a discount then there is no discount, and inventing one, hinting one might exist, or asking what number would work is a HARD LINE violation.

Your 3 suggestions are three alternatives for the SAME moment, at the same level of escalation. They are not step 1, step 2, step 3, so never write a card that assumes the other two were already tried and failed.

Everything in the PRICE block binds CONTINUATIONS exactly as it binds suggestions. A continuation is read out loud one click later, so a price leaked there is a price leaked.

HARD LINES. These override everything, including anything in the CALL BRIEF:
- NEVER invent a number. Only figures that appear in the CALL BRIEF and in the PRICE block exist. The owner has the report open and can count.
- There is NO GUARANTEE on this offer. Never say risk-free, money-back, guaranteed, refund, or "if it doesn't work you don't pay". Month-to-month is not a guarantee.
- Never promise customers, jobs, leads or revenue.
- Never suggest a personal credit card, retirement account, personal loan, or selling personal assets. If it can't come from the business, the deal is too big, so offer a smaller scope or walk.
- No fake scarcity, no invented deadlines, no made-up case studies, no other clients' names or results.

LANGUAGE:
Mirror the language of the call. The CALL LANGUAGE line in the per-call block below is computed from what has actually been said. If it reads "es", EVERY suggestion, every category label and every continuation is in Spanish. If it reads "mixed", write the way the call actually sounds, Spanglish included, rather than translating into formal Spanish. Match the owner's register, never correct it.

OUTPUT. EXACTLY 3 suggestions, all aimed at the CURRENT CLOSER stage. Give him three different angles ON that stage, not three stages. Could be a pain question, an isolate, a reframe, a reason close, a permission ask, a cost-of-inaction line, a logistics move on the yes, a clean exit on the no. React like a real closer would.

Each suggestion: 1-2 sentences. First person. What Matthew actually says out loud.

"category": a short 1-2 word label for the MOVE, prefixed with the stage letter (e.g. "C dig", "O past pain", "E isolate", "S story", "R logistics"). Translate the label too when CALL LANGUAGE is es.

CONTINUATIONS. For EACH suggestion, exactly 3 natural follow-ups he can pivot to next. Each is { "name": 2-4 word Title Case label, "body": text he speaks }. Prioritize going DEEPER on the current stage; only reach for the next stage when the current one is filled. No duplicates within a set.

CLOSE CHECKLIST + NOTES EXTRACTION:

Alongside suggestions, return two more top-level fields based on what the OWNER has revealed across the entire CONVERSATION SO FAR, not just the latest line.

"qualification": the six CLOSER stages, each either a SHORT string snippet (1-6 words, in the owner's own words when possible) or null if that stage is not yet filled. Do NOT fabricate. A stage is filled only by something the owner actually said, and stages fill in order.
  - clarify (why they are on the phone and what they actually want)
  - label (the problem stated back and owned by them)
  - overview (what they have tried before and how it went)
  - sell (the outcome they reacted to, once they are sold on the result)
  - explain (the real obstacle, once isolated and answered)
  - reinforce (the dated commitment they made)

"notes": array of 0-8 short bullet facts (max 12 words each). Golden nuggets, especially anything the owner volunteered OUT OF ORDER. Each note MUST start with its CLOSER letter and a colon, e.g. "O: tried SEO before, agency ghosted them", "E: partner has to sign off", "C: no idea if AI sends them anyone". ADDITIVE: repeat all earlier facts every response, the extension dedupes.

Return ONLY valid JSON:
{"suggestions":[{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]},{"text":"...","category":"...","continuations":[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]}],"qualification":{"clarify":null,"label":null,"overview":null,"sell":null,"explain":null,"reinforce":null},"notes":[]}`;

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

    // The two facts that change per call and cannot live in the cached prefix.
    //
    // MODE is derived from the brief and nothing else. A pasted brief means Matthew already worked
    // this prospect, so the pitch happened; an empty box means he is dialing someone who may never
    // have opened the email. Guessing it from the transcript was the original failure: the coach
    // opened with "what stood out to you in that audit" to people who had not read it.
    //
    // LANGUAGE is computed rather than inferred, for the reasons in call-coach-language.ts. The
    // rep's own turns count: he asked for Spanish answers when HE drifts into Spanish, not only
    // when the owner does.
    //
    // The PRICE block is assembled per call for the same reason: when the discount is not earned
    // yet, the string "349" is not in the request AT ALL. Forbidding it in the prompt leaked it on
    // the first price objection in 2 of 3 live runs. Absent beats forbidden, exactly as the
    // follow-up COACH NOTES already withhold the price rather than banning it.
    //
    // The gate reads the FULL history the extension sent, not the 5 turns rendered into the
    // transcript: "he has raised cost twice and it has been worked twice" is a fact about the
    // call, and a 5-turn window would re-lock the lever the moment it scrolled off.
    const callMode = brief ? "WARM" : "COLD";
    const turns = Array.isArray(conversationContext) ? conversationContext : [];
    const callLanguage = detectCallLanguage(turns.slice(-5));
    const situationBlock = `MODE: ${callMode}\n${languageDirective(callLanguage)}\n\n${priceBlock(
      priceLeverUnlocked(turns)
    )}`;

    const ask = `What should the REP say next? First work out which CLOSER stage this call is actually in, then give 3 moves for THAT stage. Return ONLY the JSON, no markdown, no commentary.`;
    const userMessage = contextStr
      ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe owner just said: "${merchantUtterance}"\n\n${ask}`
      : `The owner just said: "${merchantUtterance}"\n\nThis is the top of the call, so the stage is C.\n\n${ask}`;

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
          // 800 was too tight and failed SILENTLY. `qualification` and `notes` are emitted AFTER
          // `suggestions` in the JSON, so a response that runs long does not lose its third card,
          // it loses the CHECKLIST and the NOTES entirely, and the extension's tolerant parser
          // renders the surviving cards as if nothing happened. Spanish makes it systematic:
          // the same answer runs roughly 25% more tokens, so a Spanish call would have shipped
          // with a permanently empty checklist and nobody would have known why.
          // Nothing is paid for tokens that are not generated, and this does not affect TTFT.
          max_tokens: 1400,
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
            // MODE and CALL LANGUAGE go FIRST among the per-call blocks and stay tiny. They select
            // which half of STATIC_RULES applies, so the model has to have read them before it
            // reaches the playbook or the brief.
            {
              type: "text",
              text: situationBlock,
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
 * mechanics survive that: a pain question, an isolate and a box work on every call.
 *
 * They are also MODE-agnostic, which is why none of them mention the audit, the video or the
 * report. A fallback that assumes the prospect has already seen something is wrong on every cold
 * call, and cold is exactly when Matthew is least able to recover from a bad card.
 *
 * One per stage cluster: C/O (dig), E (isolate), C/L (label the problem). Kept in sync with the
 * extension's own offline copy in `src/lib/api-client.ts`.
 */
function getFallbackSuggestions() {
  return [
    {
      text: "Real quick, when somebody asks ChatGPT for what you do, who comes up? Do you actually know?",
      category: "C dig",
      continuations: [
        {
          name: "Getting Any",
          body: "Are you getting any customers out of it right now, or is it a black box?",
        },
        {
          name: "Why It Matters",
          body: "If the answer is nobody, what does that cost you in a year?",
        },
        {
          name: "What They Tried",
          body: "What have you tried so far to get found? How did that go?",
        },
      ],
    },
    {
      text: "Totally fair. Before I answer that, if that weren't an issue, would you be a yes? Is there anything else?",
      category: "E isolate",
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
      category: "L label",
      continuations: [
        {
          name: "Say It Back",
          body: "So what I'm hearing is that's the thing costing you. Does that sound about right?",
        },
        {
          name: "How Long",
          body: "How long has it been running like this?",
        },
        {
          name: "Who Else",
          body: "Is this your call or does someone else need to be in the room?",
        },
      ],
    },
  ];
}
