export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";
import { detectCallLanguage, languageDirective } from "@/lib/call-coach-language";
import { priceBlock, type CoachCallType } from "@/lib/call-coach-price-gate";
import { scriptBlock } from "@/lib/call-coach-script-gate";
import { PLAYBOOK_BLOCK } from "@/lib/call-coach-playbook";
import { NEPQ_BLOCK } from "@/lib/call-coach-nepq";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

const CALL_TYPES: CoachCallType[] = ["cold", "followup", "close"];

/**
 * ‼️ One constant, used by BOTH the warm-up and the real request.
 *
 * Prompt caches are scoped per model, so a warm-up that names a different model than the
 * suggestion writes an entry nothing ever reads: no error, no warning, just a permanent 0%
 * hit rate. Two string literals is exactly how that drift happens.
 */
const MODEL = "claude-haiku-4-5-20251001";

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
 * ‼️ THIS ALONE IS NOT LONG ENOUGH TO CACHE, which is why `CACHED_PREFIX`
 * below concatenates the playbook onto it. Measured with `count_tokens`:
 * STATIC_RULES is 3,952 tokens and **Haiku 4.5's minimum cacheable prefix
 * is 4,096**, so for months the `cache_control` marker did nothing at all.
 * A prefix under the minimum does not error, it silently reports
 * `cache_creation_input_tokens: 0` and re-prefills at full price and full
 * latency on every single suggestion of every call.
 *
 * The minimum is NOT monotonic across model generations, which is the trap:
 * Opus 5 / Fable 5 = 512, Opus 4.8 / Sonnet 5 / Sonnet 4.6 = 1024,
 * Opus 4.7 = 2048, **Opus 4.6 / Opus 4.5 / Haiku 4.5 = 4096**. An earlier
 * comment here asserted 1024, which is Sonnet's number, not this model's.
 *
 * If STATIC_RULES is ever trimmed, re-measure. `CACHED_PREFIX` currently
 * lands at 7,857 tokens, so there is ~2x headroom, but the failure is
 * invisible without checking `usage`.
 */
const STATIC_RULES = `You are the best closer alive, sitting next to Matthew on a live sales call with a BUSINESS OWNER. Tell him EXACTLY what to say next: first person, conversational, ready to speak verbatim.

WHAT WE SELL: getting a business surfaced and recommended inside ChatGPT and AI Overviews when their buyers ask. The promise is more of the customers that make them money and fewer of the ones that cost them money. We report VISIBILITY. Never customers, never revenue.

THREE MODES. The MODE line in the per-call block below says which one you are in. Never guess it, never blend them, and never infer it from the transcript.

MODE COLD (first real conversation, nothing has landed with them):
- They may not have opened the email. Finding that out is the first job.
- If they have not opened it: ONE short reframe of what it was about, then straight to pain. Do not read them the email.
- Their pain is NOT known and must be discovered on this call. Assume nothing about what hurts.
- Target: a full close if the pain is real.
- If the close stalls, the fallback win is to get them in front of their computer, get them to reply "1" to the email so the report clears spam, and book a dated follow-up. Take it.
- The free implementation plan (where they are now, how to get to the next level) is what earns the reply. It is never the opener.

MODE FOLLOWUP (an email went out, they have NOT engaged with it, and NOTHING IS BEING SOLD on this call):
- Assume they never opened it rather than that they read it and decided against it. Those are different calls and only one of them is real.
- ‼️ NOTHING IS SOLD HERE. No price exists in your context and none may be named, estimated or bracketed. No proposal, no start date, no paperwork, no close.
- The brief names a gap that was MEASURED. It is not a pain they have admitted, so the pain gate is NOT satisfied the way it is in CLOSE. Get them to say something is wrong before you agree with them about it.
- The ONE job is to earn "yes, send it over", and to get them to open that email and hit reply while still on the phone, because that is what keeps everything after it out of spam.
- Say early and plainly that nothing is being sold and the video is theirs either way. It is what makes them stop defending.
- If they say they already watched it, this is the WRONG call. Say so, stop, and pick it up as a closing call.
- Target: the reply, or a dated callback. A stall is not a failure here, shrink the ask instead of pushing.

MODE CLOSE (they have seen the work and this is a decision):
- SRT ran an AI visibility audit, sent the findings, and recorded a video. The brief carries what they know and what hurts.
- The pitch ALREADY HAPPENED. Never re-pitch, never re-explain the offer, never re-discover pain the brief already names.
- Nothing new gets introduced: no new features, no new proof, no new price.
- Target: remove ONE obstacle, then paperwork.

THE MECHANISM. Why this works, in plain words. Use these to build belief, never as a lecture, and never more than ONE per suggestion:
- THE GAP: ask the AI the question their buyer types and read the names it gives back. They are not in it. Their competitors are. That is the whole product in one move.
- Last year 6% of people used AI to find a local business. This year it is 45%, the third discovery channel behind Google and Facebook. The referral that used to happen in person now happens inside an AI.
- About 85% of what AI quotes comes from OFF-SITE sources, not their own website. That is why this is not on-site SEO, and it is the part most shops skip.
- It is NOT an auction. AI recommendations are not pay-to-play, so they cannot be outspent here the way they can on ads. It is won on authority, reviews, and content the engines can actually read, which is a game a local business can win cheaply because almost nobody in their market is competing for it yet.
- IT IS NOT THEIR FAULT: nobody built their business to be readable by a machine. This is the O stage line, and it is the one that lands hardest.
- Generic AI content does nothing. The engines were already trained on that recycled material. What gets cited is the owner's real authority, which is why we pull the questions their buyers actually ask and turn their own answers into the content.

THE PAIN GATE. It outranks everything except HARD LINES:
No named pain, no report. Until the owner has said out loud that something is wrong, Matthew does not offer the video, the report, the implementation plan, or a price. The question that opens it is concrete and about THEM: are they getting customers through ChatGPT right now, when someone asks AI for what they do who comes up instead. In CLOSE mode the brief satisfies this gate. In COLD and FOLLOWUP nothing satisfies it except the owner saying it.

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
- Two exceptions, and only two: R and the status-quo brush-off below.
- R. The moment they say yes, jump there and stop selling.

THE STATUS-QUO BRUSH-OFF. The second exception, and the most common thing you will hear on a cold dial:
"I've got plenty of customers", "we're doing fine", "I'm all set", "I don't need that", "we get everything from referrals", "we're too busy as it is".
This is the owner rejecting the PREMISE, not a stage sitting unfilled, and another discovery question is the single worst move available. He just told you he is fine; asking him again whether he is fine is what makes him hang up.
- NEVER answer it with three versions of the same pain question. That is the failure this rule exists to stop.
- Agree with it out loud first, and mean it. "That's a good problem." "Then you can afford to be picky." Never argue, never imply he is wrong about his own business.
- Then move the axis from QUANTITY to COMPOSITION. We do not sell more customers, we sell more of the ones that make him money and fewer of the ones that cost him. Full is not the same as full of the right work. That reframe is the answer to this objection and it is the only one that survives an owner who genuinely is busy.
- Then ONE question that makes his claim checkable, about him and not about us: what AI names when someone asks for what he does, what the person a referral sent finds when they go look, whether the last ten jobs were the ones he wanted.
- On referrals specifically: never call referrals weak. Use the mechanism, the referral that used to happen in person now happens inside an AI.
- Three cards here means three DIFFERENT angles: the agree-and-reframe, the checkable question, the permission-to-ask-one-thing exit. Not three phrasings of one move.
- At most two attempts, then respect it and take the clean no.
- Once he engages, go back to the stage you were in.

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
- At most TWO responses per obstacle. A third reads as pressure. If two angles don't move it, the obstacle is real, so respect it: shrink the scope or take the clean no.
- The moment they say yes, STOP SELLING. Go straight to logistics.
- An objection is not a no. Sometimes it is someone thinking out loud.
- A clean no is a real outcome. "Yes, but later" is the thing to break: it almost always means an unvoiced concern plus the discomfort of voicing it.

THE THREE BUCKETS. Every stall is one of these. Name it internally, then respond:
1. CIRCUMSTANCES ("something outside my control"): too expensive (= value unclear, not price high; reframe to what the gap costs monthly), not in budget (smaller scope, ask which budget and when it resets), someone cheaper (if we were the same price who would you pick, and why; cheap optimizes for volume which is how they get MORE of the customer that loses them money), too busy (busy is the reason; priorities not time; what is ahead of this).
2. OTHER PEOPLE ("someone else has to say yes"): partner/boss/board (what would they specifically object to, THAT is the real objection; what if they say no; get them on the next call; book the date before hanging up), burned by an agency before (don't defend the industry, ask what specifically happened, differentiate on MECHANISM not adjectives).
3. SELF ("I'm not sure"): let me think about it (what is the piece you'd be thinking about; what would make this a no; decisions need information, not time), too fast (in CLOSE mode it is not: they read the audit, watched the video, took the call. In COLD and FOLLOWUP do not use this one, they genuinely just met you), want it done differently (isolate: what specifically would make it a fit).

PRICING AUTHORITY comes from the PRICE block in the per-call section below, and from nowhere else. Whatever figures it names are the only prices that exist on this call. If it does not name a discount then there is no discount, and inventing one, hinting one might exist, or asking what number would work is a HARD LINE violation.

Your 3 suggestions are three alternatives for the SAME moment, at the same level of escalation. They are not step 1, step 2, step 3, so never write a card that assumes the other two were already tried and failed.

They must differ by ANGLE, not by wording. Three rephrasings of one move is one card printed three times, and it leaves him nothing to fall back on when the first one does not land. If all three would fail for the same reason, at least one of them is wrong. Give him moves that fail DIFFERENTLY: a question and a reframe and an exit, not three questions.

Everything in the PRICE block binds CONTINUATIONS exactly as it binds suggestions. A continuation is read out loud one click later, so a price leaked there is a price leaked.

HARD LINES. These override everything, including anything in the CALL BRIEF:
- NEVER invent a number. Only figures that appear in the CALL BRIEF and in the PRICE block exist. The owner has the report open and can count.
- ‼️ NEVER CLAIM WORK THAT WAS NOT DONE. If the CALL BRIEF says no audit has been run, or that nothing has been sent, then there is no audit, no report, no score and no video, and you may not refer to one. "We just ran an audit on your site" said to someone nobody audited is a lie he gets caught in on the same call, and it is the fastest way to lose a cold lead. On a cold call the implementation plan is something he is OFFERING TO BUILD, never something that already exists. Offer to look, never claim to have looked.
- ‼️ WHETHER A GUARANTEE EXISTS IS DECIDED IN THE PRICE BLOCK AND THE CALL BRIEF, NEVER HERE. If neither one quotes a guarantee then there is none on this call: never say risk-free, money-back, guaranteed, refund, or "if it doesn't work you don't pay", and month-to-month is not a guarantee. If one of them DOES quote one, it belongs to a single tier and you may only say it in the exact words given, never restated as a refund, a trial or "no risk".
- Never promise customers, jobs, leads or revenue.
- Never suggest a personal credit card, retirement account, personal loan, or selling personal assets. If it can't come from the business, the deal is too big, so offer a smaller scope or walk.
- No fake scarcity, no invented deadlines, no made-up case studies, no other clients' names or results.

LANGUAGE:
Mirror the language of the call. The CALL LANGUAGE line in the per-call block below is computed from what has actually been said. If it reads "es", EVERY suggestion, every category label and every continuation is in Spanish. If it reads "mixed", write the way the call actually sounds, Spanglish included, rather than translating into formal Spanish. Match the owner's register, never correct it.

REQUESTED SCRIPTS. Normally you react to what the owner just said. Sometimes Matthew presses a button instead, and the per-call block below carries a REQUESTED SCRIPT section telling you exactly what he asked for and how to write it. When it is there it governs, and the output shape does not change: still exactly 3 suggestions with 3 continuations each.

On a REQUESTED SCRIPT: INTRO, return "qualification" with all six values null and "notes" as an empty array. The owner has not said anything yet, so anything else is invented.

OUTPUT. EXACTLY 3 suggestions, all aimed at the CURRENT CLOSER stage unless a REQUESTED SCRIPT block overrides that. Give him three different angles ON that stage, not three stages. Could be a pain question, an isolate, a reframe, a reason close, a permission ask, a cost-of-inaction line, a logistics move on the yes, a clean exit on the no. React like a real closer would.

EVERY suggestion ends with a question mark. So does every continuation. A line that does not ask for something gives him nothing to do next.

Each suggestion: 1-2 sentences. First person. What Matthew actually says out loud.

"category": a short 1-2 word label for the MOVE, prefixed with the stage letter (e.g. "C dig", "O past pain", "E isolate", "S story", "R logistics"). Translate the label too when CALL LANGUAGE is es.

CONTINUATIONS. A SEPARATE top-level array, NOT nested inside the suggestions.

"continuations" is an array of exactly 3 arrays. continuations[0] belongs to suggestions[0], continuations[1] to suggestions[1], continuations[2] to suggestions[2]. Each inner array holds exactly 3 follow-ups he can pivot to next, each { "name": 2-4 word Title Case label, "body": text he speaks }. Prioritize going DEEPER on the current stage; only reach for the next stage when the current one is filled. No duplicates within a set.

‼️ ORDER MATTERS AND IT IS NOT COSMETIC. Write all 3 "suggestions" FIRST, complete, then the "continuations" array. He is reading these off a screen mid-call while a prospect waits, and the cards appear in the order you emit them. Emitting a suggestion's continuations before the next suggestion's text means card 3 does not exist yet when he needs it. Never nest a "continuations" key inside a suggestion object.

‼️ EVERY continuation "body" ENDS IN A QUESTION MARK, with no exceptions. A continuation is the thing he reads out loud when the first line did not land, so one that just states a fact hands the silence straight back to him. If a continuation is a statement, it is not finished: attach the question it was setting up.

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
{"suggestions":[{"text":"...","category":"..."},{"text":"...","category":"..."},{"text":"...","category":"..."}],"continuations":[[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}],[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}],[{"name":"...","body":"..."},{"name":"...","body":"..."},{"name":"...","body":"..."}]],"qualification":{"clarify":null,"label":null,"overview":null,"sell":null,"explain":null,"reinforce":null},"notes":[]}`;

/**
 * What actually carries `cache_control`. Rules first, then the full playbook.
 *
 * The playbook USED to be a separate uncached block holding the top 10 entries scored
 * against the merchant's utterance. That did two bad things at once: it put ~1,400
 * changing tokens in front of the model on every request (so they were re-prefilled
 * every time), and the scorer matched on STOPWORDS. See the header of
 * `call-coach-playbook.ts` for the measured retrieval failure that cost a live call.
 *
 * Folding it in fixes both. It is the same bytes every request, so it rides the cache,
 * and every objection is always present instead of being retrieved by a broken scorer.
 */
// Rules, then HOW to word them, then the objection map. NEPQ sits between the two on purpose: it
// modifies every line the CLOSER rules produce, so it has to be read before the playbook's example
// responses rather than after them.
const CACHED_PREFIX = `${STATIC_RULES}\n\n${NEPQ_BLOCK}\n\n${PLAYBOOK_BLOCK}`;

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
    const { merchantUtterance, conversationContext, playbook, callContext, callType, requestKind } = body;

    // ── Warm-up ───────────────────────────────────────────────────────────────
    //
    // `{ warm: true }` from the extension when Matthew presses Start Listening or a brief loads.
    // Two cold starts get paid on the first suggestion of a call otherwise, and that first
    // suggestion is the one he is waiting on with the phone already ringing:
    //
    //   1. The Vercel lambda itself, which has been idle since the last call.
    //   2. The prompt cache write for CACHED_PREFIX.
    //
    // `max_tokens: 0` runs prefill and returns immediately with an empty `content` and
    // `stop_reason: "max_tokens"`. No output tokens are generated or billed; the only charge is
    // the cache write that the first real request would have paid anyway.
    //
    // ‼️ It must NOT stream — the API rejects `max_tokens: 0` together with `stream: true`.
    // The system blocks below have to stay byte-identical to the real request's cached block or
    // this warms an entry nothing will ever read.
    if (body?.warm === true) {
      try {
        const warmRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 0,
            system: [
              {
                type: "text",
                text: CACHED_PREFIX,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            messages: [{ role: "user", content: "warmup" }],
          }),
        });
        const warmJson = await warmRes.json().catch(() => null);
        const usage = warmJson?.usage ?? null;
        console.log("[call-coach] warm", warmRes.status, JSON.stringify(usage));
        return NextResponse.json({ warmed: warmRes.ok, usage });
      } catch (err) {
        // Never fatal. A failed warm just means the first real suggestion pays what it used to.
        console.error("[call-coach] warm failed:", err);
        return NextResponse.json({ warmed: false });
      }
    }

    // A REQUESTED SCRIPT: Matthew pressed Intro or Close instead of the prospect saying something.
    //
    // ‼️ This is a SEPARATE AXIS from callType, deliberately. A close on a cold lead is
    // callType "cold" + requestKind "close", and collapsing the two into one enum would force a
    // fourth CoachCallType, a fourth priceBlock() branch, and would lose the distinction that
    // actually decides the words: WHERE the relationship is vs WHAT he is asking for right now.
    //
    // The response shape is unchanged (3 suggestions x 3 continuations + qualification + notes),
    // which is the whole reason this rides on /suggest rather than a new route: the extension's
    // incremental SSE parser is shape-driven, so it needs no changes, and auth, streaming and the
    // cached prompt prefix all come for free.
    const kind = requestKind === "intro" || requestKind === "close" ? requestKind : null;

    // Only a reactive request needs something to react to. Intro fires before anyone has spoken.
    if (!kind && !merchantUtterance) {
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

    // `playbook` is still accepted off the request body and deliberately IGNORED. The extension
    // fetches it, caches it for an hour and ships it on every call; older builds in the wild still
    // do. Reading it would put client-controlled bytes inside the cached prefix, so one stale
    // extension would silently re-write the cache on every request. The server's own copy is
    // authoritative — see `call-coach-playbook.ts`. Once every client is updated this field can
    // come out of the contract entirely.
    void playbook;

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
    // The extension now sends an explicit callType, resolved server-side from the audit, Outlook
    // and the CRM when the lead was identified. The old derivation stays as the fallback and is
    // byte-identical in behaviour: a pasted brief WAS "the pitch already happened", which is
    // exactly `close`. So an old extension, a hand-pasted brief, and a deploy skew in either
    // direction all keep working. Same tolerance as the extension's own mergeQualification.
    const requested = typeof callType === "string" ? callType.toLowerCase() : "";
    const mode: CoachCallType = CALL_TYPES.includes(requested as CoachCallType)
      ? (requested as CoachCallType)
      : brief
        ? "close"
        : "cold";

    const turns = Array.isArray(conversationContext) ? conversationContext : [];
    const callLanguage = detectCallLanguage(turns.slice(-5));
    // The requested-script wording is assembled per call for the same reason the price is: the
    // mode-specific parts USED to be conditionals inside the cached rules ("on COLD use this stem,
    // on CLOSE never use it") and the conditional lost. Measured over three runs each, the cold
    // stem leaked into a close-stage intro 1 time in 3, and adding emphasis to the conditional
    // took it to 3 in 3, because the same paragraph also carried a verbatim order. Absent beats
    // forbidden: the stem is simply not in the request unless the call is cold.
    const scripting = scriptBlock(kind, mode);
    const situationBlock = [
      `MODE: ${mode.toUpperCase()}`,
      languageDirective(callLanguage),
      "",
      priceBlock(mode),
      ...(scripting ? ["", scripting] : []),
    ].join("\n");

    const tail = `Return ONLY the JSON, no markdown, no commentary.`;
    let userMessage: string;

    if (kind === "intro") {
      // No transcript is sent even when one exists. An intro is the way IN, and handing the model
      // the conversation invites it to answer the last thing said instead of opening.
      userMessage = `Matthew pressed INTRO. He is about to dial this lead, or they just picked up, and nothing has been said yet.\n\nWrite them per the REQUESTED SCRIPT: INTRO block above. ${tail}`;
    } else if (kind === "close") {
      userMessage = contextStr
        ? `CONVERSATION SO FAR:\n${contextStr}\n\nMatthew pressed CLOSE. He wants to move this forward now.\n\nWrite them per the REQUESTED SCRIPT: CLOSE block above. ${tail}`
        : `Matthew pressed CLOSE before anything was transcribed, so work from the CALL BRIEF and the MODE alone.\n\nWrite them per the REQUESTED SCRIPT: CLOSE block above. ${tail}`;
    } else {
      const ask = `What should the REP say next? First work out which CLOSER stage this call is actually in, then give 3 moves for THAT stage. ${tail}`;
      userMessage = contextStr
        ? `CONVERSATION SO FAR:\n${contextStr}\n\nThe owner just said: "${merchantUtterance}"\n\n${ask}`
        : `The owner just said: "${merchantUtterance}"\n\nThis is the top of the call, so the stage is C.\n\n${ask}`;
    }

    // Call Claude API — Haiku 4.5 streaming for lowest TTFT.
    //
    // `CACHED_PREFIX` (rules + full playbook, 8,550 tokens) is block one and carries the
    // breakpoint. Everything that varies per call comes after it. See the threshold warning on
    // STATIC_RULES: this used to be STATIC_RULES alone at 3,952 tokens, under Haiku's 4,096
    // minimum, so the marker did nothing and every request re-prefilled at full cost.
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
          model: MODEL,
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
          // Cached prefix FIRST (rules + playbook), then the per-call blocks.
          //
          // `ttl: "1h"` rather than the 5-minute default. Within one call the requests are seconds
          // apart and either TTL would hold, but there are minutes of gap between prospects and a
          // 5-minute entry expires in every one of them, paying a fresh 1.25x write on the first
          // suggestion of every call. The 1h write costs 2x once and then reads all day.
          system: [
            {
              type: "text",
              text: CACHED_PREFIX,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
            // MODE and CALL LANGUAGE go FIRST among the per-call blocks and stay tiny. They select
            // which half of the cached rules applies, so the model has to have read them before it
            // reaches the brief.
            {
              type: "text",
              text: situationBlock,
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
