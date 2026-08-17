/**
 * SRT Call Coach — the objection playbook, as a pre-rendered prompt block.
 *
 * ‼️ THIS FILE IS PART OF THE CACHED PROMPT PREFIX. Every byte of PLAYBOOK_BLOCK is
 * concatenated into the `cache_control` block in `suggest/route.ts`, so it must be
 * IDENTICAL on every request or the cache never reads. That is why it is a module
 * constant rendered at build time rather than fetched, scored, or JSON.stringify'd
 * per request: an object key order change or a one-entry difference silently costs
 * a full re-prefill on every single suggestion.
 *
 * ## Why the playbook is no longer filtered per utterance
 *
 * The old path scored all entries against the merchant's words and sent the top 10.
 * It scored on STOPWORDS, so "I got plenty of customers I don't need that right now"
 * retrieved, in order: "i need to talk to my partner" (0.57), "too busy right now"
 * (0.50), "that's a lot of money" (0.40), "i need to run it by my boss" (0.375),
 * "how do i know this works", "i want to think it over", and "let's do it" (0.33).
 * The model was handed PRICE-objection and CLOSING-ON-THE-YES material for a prospect
 * who had just said he was satisfied, and it answered with three discovery questions.
 *
 * Sending all of them costs nothing now that they live inside the cached prefix, and
 * it removes the retrieval failure entirely. It also closes the Spanish gap: the
 * trigger words were English, so a Spanish utterance matched nothing and fell through
 * to a handful of general entries.
 *
 * ## Source of truth
 *
 * This file is authoritative FOR THE PROMPT. `srt_playbook` in Supabase and
 * `playbook.json` in the extension repo still exist and still round-trip through
 * `/api/call-coach/playbook`, but `/suggest` no longer reads what the client sends.
 * Edit the entries HERE, next to the prompt they are part of. Keep the extension's
 * `playbook.json` in step so its offline fallback does not drift.
 */

export interface PlaybookEntry {
  trigger: string;
  category: string;
  suggestions: string[];
  context: string;
  source: string;
}

export const PLAYBOOK: PlaybookEntry[] = [
  {
    "trigger": "too expensive",
    "category": "price_objection",
    "suggestions": [
      "Totally fair. Before I answer that, can I ask, is it expensive against what you expected, or expensive against what it's worth to you?",
      "Got it. So if the money weren't the issue, would you be a yes? Is there anything else?",
      "Here's the thing. Not doing it isn't zero. You're paying for that gap every month already, you're just paying it quietly."
    ],
    "context": "Price objection almost always means value unclear, not price high. Isolate first, then reframe to the cost of the gap continuing. Never drop the price.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "that's a lot of money",
    "category": "price_objection",
    "suggestions": [
      "It's real money, I won't pretend otherwise. Can I be straight with you for a sec?",
      "If this brought you one more of the right customer a month, what's that worth over a year? Just ballpark it out loud.",
      "Compare it to what you already spend to get found. This is smaller and it compounds instead of resetting every month."
    ],
    "context": "Let them do the arithmetic out loud. Anchor against ad spend, a junior hire, a trade show booth. Never against a competitor's price.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "can you do it for less",
    "category": "price_objection",
    "suggestions": [
      "I can't move the price, but I can move the scope. Want me to show you the smaller version?",
      "If I discounted it I'd have to take something out anyway, so let's decide together what comes out instead of guessing.",
      "The number is the number. What I can do is start you narrower and expand once you've seen it work."
    ],
    "context": "NEVER drop price on the spot. Less work for less money, or hold the line and move on. A discount teaches them the price was fake.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "not in the budget",
    "category": "budget_objection",
    "suggestions": [
      "Understood. What budget would this actually come out of, and when does that reset?",
      "If we started with one piece instead of all of it, does that fit inside what you've got right now?",
      "Fair enough. If it's genuinely out of reach today, I'd rather say so and pick a real date to revisit than nag you."
    ],
    "context": "Smaller scope, not lower price. Ask which budget and when it resets. If truly out of reach, say so plainly and set a date. Never suggest personal funds.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "we don't have the money right now",
    "category": "budget_objection",
    "suggestions": [
      "Okay. Is it not there this month, or not there this quarter? Those are different problems.",
      "Would a narrower start get you moving now, and we expand when the cash frees up?",
      "If cash is tight because the good customers aren't coming in, that's the thing this is pointed at."
    ],
    "context": "The reason close: the thing they're blaming is often the reason to act. Never suggest a personal card, a loan or retirement funds.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "someone does it cheaper",
    "category": "competitor_objection",
    "suggestions": [
      "Say we were the same price. Who would you pick, and why? I'm genuinely asking.",
      "Cheap gets optimized for volume, and volume is exactly how you end up with more of the customer that costs you money.",
      "You're not buying traffic here, you're buying targeting. Those price differently for a reason."
    ],
    "context": "Let them list your advantages out loud, then agree you're not the same thing. Never name or knock a specific competitor.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "we already have an seo guy",
    "category": "competitor_objection",
    "suggestions": [
      "Good, keep him. This is a different surface, it's what the AI answers say when nobody clicks a link at all.",
      "What's he told you about how you show up inside ChatGPT? I'd genuinely like to know.",
      "Search rankings and AI answers are two different questions now. Ranking well doesn't mean you get cited."
    ],
    "context": "Do not attack the incumbent. Differentiate on mechanism, position as additive rather than replacement.",
    "source": "closing-brain: circumstances/money"
  },
  {
    "trigger": "too busy right now",
    "category": "time_objection",
    "suggestions": [
      "Busy is the reason, not the reason not to. This is built to cut the noise, not add to it.",
      "What's actually ahead of this on your list right now? Say it out loud and let's see if it holds.",
      "You'll be busy next quarter too. Waiting for a calm month is waiting forever, and you know that better than I do."
    ],
    "context": "Priorities, not time. Let them hear their own answer. Never invent a deadline or a scarcity window.",
    "source": "closing-brain: circumstances/time"
  },
  {
    "trigger": "call me next quarter",
    "category": "stall_tactic",
    "suggestions": [
      "Happy to. But before we do, what's the thing you're not saying? I'd rather hear it now than guess for three months.",
      "What changes between now and then, specifically? If it's a real thing I'll wait, no problem.",
      "Every month of this is a month a competitor becomes the default answer. That part doesn't pause while we wait."
    ],
    "context": "A dated brush-off is a soft maybe. Break it or take a clean no. If they hold, book a specific date, never 'I'll reach out'.",
    "source": "closing-brain: the killer"
  },
  {
    "trigger": "i need to talk to my partner",
    "category": "decision_maker",
    "suggestions": [
      "Makes sense. What specifically would they push back on, the price, the approach, or me?",
      "What if they say no? What happens then?",
      "Easiest thing is I get on with both of you for ten minutes. When are you two in the same room?"
    ],
    "context": "Whatever they name is the REAL objection. Handle that instead. Get the other person on a call, and book the date before hanging up.",
    "source": "closing-brain: other people"
  },
  {
    "trigger": "i need to run it by my boss",
    "category": "decision_maker",
    "suggestions": [
      "Of course. You're not asking permission though, you're bringing a recommendation. Let's build that in one paragraph.",
      "What's the one line that would make it obvious to them? I'll help you say it.",
      "When are you speaking to them? Let's put our next call in right after that, while it's fresh."
    ],
    "context": "Support, not permission. Help them build the case. Always book the follow-up on the calendar before the call ends.",
    "source": "closing-brain: other people"
  },
  {
    "trigger": "we tried an agency before",
    "category": "past_negative",
    "suggestions": [
      "What happened, specifically? I want to know what to avoid, not defend the industry.",
      "One bad vendor shouldn't cost you twice, once when you paid them and again if it stops you fixing this now.",
      "Here's the difference in plain terms, and you can hold me to it."
    ],
    "context": "Never defend the industry. Ask what happened, learn from it, then differentiate on MECHANISM not adjectives. No promises about results.",
    "source": "closing-brain: other people"
  },
  {
    "trigger": "how do i know this works",
    "category": "trust",
    "suggestions": [
      "You can check it yourself. Everything I showed you is something you can go type in right now.",
      "I'm not going to promise you customers, nobody can. What I can show you is whether you're being recommended or not.",
      "That's the whole reason I ran it before I called instead of after."
    ],
    "context": "Verifiability is the pitch. NEVER promise customers, jobs or revenue. NEVER offer a guarantee, there isn't one. No invented case studies.",
    "source": "closing-brain: hard lines"
  },
  {
    "trigger": "let me think about it",
    "category": "stall_tactic",
    "suggestions": [
      "Totally. What's the piece you'd be thinking about? Let's think about it together right now.",
      "Flip it for me. What would make this a no?",
      "Decisions don't need time, they need information. What's missing? I've probably got it in front of me."
    ],
    "context": "Isolate what they'd actually be thinking about, then supply it on the call. 'What would make it a no' is easier to answer than the reverse.",
    "source": "closing-brain: self"
  },
  {
    "trigger": "i want to think it over",
    "category": "stall_tactic",
    "suggestions": [
      "Fair. Where are you right now, one to ten?",
      "What gets that to a ten? That's the actual conversation we should be having.",
      "How long has it been running like this already? What did the last twelve months of it cost you?"
    ],
    "context": "The 1-10 close, then fix the gap. Cost of inaction, using only figures from the CALL BRIEF.",
    "source": "closing-brain: all-purpose"
  },
  {
    "trigger": "send me some information",
    "category": "brush_off",
    "suggestions": [
      "I already did, that's what we're talking about. So what's the part that isn't landing?",
      "Happy to send more, but more paper won't decide this. What's the actual hesitation?",
      "If I send it, what would you be looking for in it? Let me just answer that now."
    ],
    "context": "They already got the audit and the video. More material is a stall, not a request. Get the real concern on the table.",
    "source": "closing-brain: self"
  },
  {
    "trigger": "this is happening too fast",
    "category": "stall_tactic",
    "suggestions": [
      "I hear that. Honestly though, this started weeks ago. You read the audit, you watched the video, you took this call.",
      "What would slowing down actually change for you? If it's a real thing let's build it in.",
      "We can start smaller so it feels like the size it actually is."
    ],
    "context": "It isn't fast. Walk them through their own timeline. If they still want slower, offer a smaller scope rather than a delay.",
    "source": "closing-brain: self"
  },
  {
    "trigger": "i want it done differently",
    "category": "objection_discovery",
    "suggestions": [
      "Tell me exactly what would make it a fit. Usually it's one thing and it's fixable.",
      "Is that a preference or a dealbreaker? I'll treat it differently depending.",
      "If we change that input we change the output. Which one matters more to you?"
    ],
    "context": "Isolate first, it's usually one fixable detail. If it's a core mechanism, say so plainly and let them choose.",
    "source": "closing-brain: self"
  },
  {
    "trigger": "yes but later",
    "category": "stall_tactic",
    "suggestions": [
      "Totally fine. But before we park it, what's the thing you're not saying? I'd rather hear it now than guess.",
      "If it's a yes, what makes later better than now? Genuinely asking.",
      "Let's do one of two things. Start smaller today, or put a real date on the calendar and decide then. Not an open ended check back."
    ],
    "context": "THE MOST DANGEROUS ANSWER ON THE CALL. Almost always an unvoiced concern plus the discomfort of voicing it. Never accept an open ended follow-up.",
    "source": "closing-brain: the killer"
  },
  {
    "trigger": "what's the main concern",
    "category": "objection_discovery",
    "suggestions": [
      "What's the main concern? What are you worried actually happens here?",
      "If this were exactly right, would you do it? Okay, so what's the gap between that and what I've shown you?",
      "Does this move you closer to what you want, or further from it?"
    ],
    "context": "All-purpose isolators. Works on anything that isn't a yes. Always box it before answering.",
    "source": "closing-brain: all-purpose"
  },
  {
    "trigger": "not interested",
    "category": "pattern_interrupt",
    "suggestions": [
      "That's fair. Can I ask one thing before I let you go, so I learn something from this?",
      "No problem. Was it the fit, the timing, or the price? Whichever it is, I'd rather know.",
      "Understood. If it's a no it's a no, I'd just rather it be a real one than a polite one."
    ],
    "context": "A clean no is a real outcome. Take it, learn from it, keep the relationship. Do not stack closes on a second clear no.",
    "source": "closing-brain: rules of engagement"
  },
  {
    "trigger": "i'm not sure",
    "category": "sales_psychology",
    "suggestions": [
      "That's honest, I appreciate it. Not sure about the thing itself, or about me?",
      "Where are you, one to ten? Don't be polite about it.",
      "You want more of the customers worth having. The only question is whether this makes that more likely than doing nothing."
    ],
    "context": "Zoom out. Acknowledge, never disagree. Ask permission before getting blunt.",
    "source": "closing-brain: all-purpose"
  },
  {
    "trigger": "let's do it",
    "category": "on_the_yes",
    "suggestions": [
      "Perfect. Let me grab a couple of details and I'll get you set up right now.",
      "Great. While I fill this in, tell me who else on your side should be looped in on the kickoff.",
      "You'll hear from me within twenty four hours with the kickoff and what I need access to."
    ],
    "context": "STOP SELLING IMMEDIATELY. Go straight to logistics. Fill the silence with useful questions, not more pitching. Set a realistic first-movement expectation.",
    "source": "closing-brain: on the yes"
  },
  {
    "trigger": "when will i see results",
    "category": "on_the_yes",
    "suggestions": [
      "Realistically it's a slow surface. I'd rather set that expectation now than have you surprised in week two.",
      "You'll see the work immediately. The engines take longer to catch up, and that's outside anyone's control.",
      "I'll show you the same measurements we ran today so you can watch it move yourself."
    ],
    "context": "Use ONLY the start window from the CALL BRIEF. Never promise a result, a customer or a revenue figure. There is no guarantee to fall back on.",
    "source": "closing-brain: on the yes"
  },
  {
    "trigger": "i have plenty of customers",
    "category": "status_quo",
    "suggestions": [
      "That's a good problem, and it's actually the reason to look. When you're full the only thing left that moves anything is which customers you take, not how many. Are the ones coming in right now the ones you'd want ten more of?",
      "Then you can afford to be picky. When you're picking, are you choosing the jobs or just taking what shows up?",
      "Fair, and I'm not pitching you more volume. Can I ask one thing and then get out of your hair, when someone asks ChatGPT for what you do, who does it name?"
    ],
    "context": "THE premise objection for this offer, because the promise is more of the RIGHT customers, never more customers. Never argue with 'I'm full' and never imply they need volume. Agree, then move the axis from quantity to composition: margin, job type, the customer they would take ten more of. The checkable AI question is the exit that keeps the call alive when the reframe does not land.",
    "source": "closing-brain: status quo"
  },
  {
    "trigger": "we're doing fine",
    "category": "status_quo",
    "suggestions": [
      "Glad to hear it, most people I call aren't. What's carrying it right now, is it referrals or is something else feeding you?",
      "Then this is a thirty second thing rather than a pitch. Do you know what comes up when someone asks AI for what you do in your area?",
      "Fair, and doing fine is exactly when this is cheap. It gets expensive when it's the thing you actually need. Worth thirty seconds?"
    ],
    "context": "Not an objection yet, it is a door closing politely. Do not pitch into it. Agree, then ask one concrete checkable question. The cheap-now frame works here but only once, and never as a scare line.",
    "source": "closing-brain: status quo"
  },
  {
    "trigger": "i don't need that right now",
    "category": "status_quo",
    "suggestions": [
      "Fair. What would have to change for it to be something you did need?",
      "Is that a timing thing or a not-for-me thing? Those are different and I don't want to waste your time on the wrong one.",
      "Before I let you go, do you actually know what AI tells people about you today, or is that a black box?"
    ],
    "context": "'Not right now' is either timing or a no wearing a polite coat. Separate the two before answering, because the moves are opposite: timing earns a dated callback, a real no earns a clean exit. Never argue with it.",
    "source": "closing-brain: status quo"
  },
  {
    "trigger": "we get all our business from referrals",
    "category": "status_quo",
    "suggestions": [
      "That's the best kind, and it's also the one that's quietly moving. The referral that used to happen in person now happens inside ChatGPT. When it does, does your name come up?",
      "Referrals are earned, so the work is clearly good. The question is what the person they referred finds when they go and check you. What do they find?",
      "So you've never had to go get customers. What's the backup the month referrals slow down?"
    ],
    "context": "Referral-led owners are proud of it and they are right to be. Never frame referrals as weak. Use the mechanism line: the referral moved inside the AI. The strongest follow-up is what the referred person finds when they check, because that is verifiable in ten seconds and it is about THEIR reputation, not our product.",
    "source": "closing-brain: status quo"
  },
  {
    "trigger": "i'm all set",
    "category": "status_quo",
    "suggestions": [
      "No problem. One question before I go and then I'll leave you alone, is that alright?",
      "Is that all set as in you've already looked at this, or all set as in you've got enough on your plate?",
      "Fair. If I could tell you in about a minute whether AI is sending anyone your way, is that worth the minute?"
    ],
    "context": "A reflex, not a decision. Almost nobody saying this has evaluated the thing. Ask permission for ONE question rather than pushing, and split 'already handled' from 'too busy'. Two responses maximum, then take the clean no.",
    "source": "closing-brain: status quo"
  },
  {
    "trigger": "is it really free",
    "category": "trust",
    "suggestions": [
      "It is. We build one section of your own site, you keep it, and there's no card and nothing to sign.",
      "Free because it's faster to show you than to argue about it. You watch whether AI starts naming you and you decide from there.",
      "The only thing I need from you is a yes and about twenty minutes answering questions about the business."
    ],
    "context": "THE OPEN AND THE CLOSE FOR THIS OFFER. The free first build is real: one section of their own site, theirs to keep, no card. Say what it is in plain words, then say what we need back, which is a yes and a short conversation. Do not oversell it and do not attach conditions that are not there. If they ask what happens after, the honest answer is that paid coverage is a separate conversation they can decline.",
    "source": "SRT free-build offer"
  },
  {
    "trigger": "what's the catch",
    "category": "trust",
    "suggestions": [
      "No catch. If it works you'll want the rest of the site done and that's the paid part. If it doesn't, you keep the section and we're done.",
      "The catch, if you want to call it one, is that I think you'll want more after. That's the whole bet.",
      "Nothing changes hands. You don't give me access to anything I don't need and you don't pay for this piece."
    ],
    "context": "Answer it straight and name the commercial logic out loud, because pretending there is no motive is what makes it sound like a scam. The free build is a real deliverable they keep; the upsell is the rest of the site. Never imply the free work expires, never invent scarcity around it.",
    "source": "SRT free-build offer"
  }
];

/** Pre-rendered. See the byte-identical warning at the top of this file. */
export const PLAYBOOK_BLOCK = "PLAYBOOK. Objection to response map, all entries. Adapt the wording, never read one verbatim, and never use one whose trigger does not match what the owner actually said.\n\n[price_objection] \"too expensive\"\n    - Totally fair. Before I answer that, can I ask, is it expensive against what you expected, or expensive against what it's worth to you?\n    - Got it. So if the money weren't the issue, would you be a yes? Is there anything else?\n    - Here's the thing. Not doing it isn't zero. You're paying for that gap every month already, you're just paying it quietly.\n    WHY: Price objection almost always means value unclear, not price high. Isolate first, then reframe to the cost of the gap continuing. Never drop the price.\n\n[price_objection] \"that's a lot of money\"\n    - It's real money, I won't pretend otherwise. Can I be straight with you for a sec?\n    - If this brought you one more of the right customer a month, what's that worth over a year? Just ballpark it out loud.\n    - Compare it to what you already spend to get found. This is smaller and it compounds instead of resetting every month.\n    WHY: Let them do the arithmetic out loud. Anchor against ad spend, a junior hire, a trade show booth. Never against a competitor's price.\n\n[price_objection] \"can you do it for less\"\n    - I can't move the price, but I can move the scope. Want me to show you the smaller version?\n    - If I discounted it I'd have to take something out anyway, so let's decide together what comes out instead of guessing.\n    - The number is the number. What I can do is start you narrower and expand once you've seen it work.\n    WHY: NEVER drop price on the spot. Less work for less money, or hold the line and move on. A discount teaches them the price was fake.\n\n[budget_objection] \"not in the budget\"\n    - Understood. What budget would this actually come out of, and when does that reset?\n    - If we started with one piece instead of all of it, does that fit inside what you've got right now?\n    - Fair enough. If it's genuinely out of reach today, I'd rather say so and pick a real date to revisit than nag you.\n    WHY: Smaller scope, not lower price. Ask which budget and when it resets. If truly out of reach, say so plainly and set a date. Never suggest personal funds.\n\n[budget_objection] \"we don't have the money right now\"\n    - Okay. Is it not there this month, or not there this quarter? Those are different problems.\n    - Would a narrower start get you moving now, and we expand when the cash frees up?\n    - If cash is tight because the good customers aren't coming in, that's the thing this is pointed at.\n    WHY: The reason close: the thing they're blaming is often the reason to act. Never suggest a personal card, a loan or retirement funds.\n\n[competitor_objection] \"someone does it cheaper\"\n    - Say we were the same price. Who would you pick, and why? I'm genuinely asking.\n    - Cheap gets optimized for volume, and volume is exactly how you end up with more of the customer that costs you money.\n    - You're not buying traffic here, you're buying targeting. Those price differently for a reason.\n    WHY: Let them list your advantages out loud, then agree you're not the same thing. Never name or knock a specific competitor.\n\n[competitor_objection] \"we already have an seo guy\"\n    - Good, keep him. This is a different surface, it's what the AI answers say when nobody clicks a link at all.\n    - What's he told you about how you show up inside ChatGPT? I'd genuinely like to know.\n    - Search rankings and AI answers are two different questions now. Ranking well doesn't mean you get cited.\n    WHY: Do not attack the incumbent. Differentiate on mechanism, position as additive rather than replacement.\n\n[time_objection] \"too busy right now\"\n    - Busy is the reason, not the reason not to. This is built to cut the noise, not add to it.\n    - What's actually ahead of this on your list right now? Say it out loud and let's see if it holds.\n    - You'll be busy next quarter too. Waiting for a calm month is waiting forever, and you know that better than I do.\n    WHY: Priorities, not time. Let them hear their own answer. Never invent a deadline or a scarcity window.\n\n[stall_tactic] \"call me next quarter\"\n    - Happy to. But before we do, what's the thing you're not saying? I'd rather hear it now than guess for three months.\n    - What changes between now and then, specifically? If it's a real thing I'll wait, no problem.\n    - Every month of this is a month a competitor becomes the default answer. That part doesn't pause while we wait.\n    WHY: A dated brush-off is a soft maybe. Break it or take a clean no. If they hold, book a specific date, never 'I'll reach out'.\n\n[decision_maker] \"i need to talk to my partner\"\n    - Makes sense. What specifically would they push back on, the price, the approach, or me?\n    - What if they say no? What happens then?\n    - Easiest thing is I get on with both of you for ten minutes. When are you two in the same room?\n    WHY: Whatever they name is the REAL objection. Handle that instead. Get the other person on a call, and book the date before hanging up.\n\n[decision_maker] \"i need to run it by my boss\"\n    - Of course. You're not asking permission though, you're bringing a recommendation. Let's build that in one paragraph.\n    - What's the one line that would make it obvious to them? I'll help you say it.\n    - When are you speaking to them? Let's put our next call in right after that, while it's fresh.\n    WHY: Support, not permission. Help them build the case. Always book the follow-up on the calendar before the call ends.\n\n[past_negative] \"we tried an agency before\"\n    - What happened, specifically? I want to know what to avoid, not defend the industry.\n    - One bad vendor shouldn't cost you twice, once when you paid them and again if it stops you fixing this now.\n    - Here's the difference in plain terms, and you can hold me to it.\n    WHY: Never defend the industry. Ask what happened, learn from it, then differentiate on MECHANISM not adjectives. No promises about results.\n\n[trust] \"how do i know this works\"\n    - You can check it yourself. Everything I showed you is something you can go type in right now.\n    - I'm not going to promise you customers, nobody can. What I can show you is whether you're being recommended or not.\n    - That's the whole reason I ran it before I called instead of after.\n    WHY: Verifiability is the pitch. NEVER promise customers, jobs or revenue. NEVER offer a guarantee, there isn't one. No invented case studies.\n\n[stall_tactic] \"let me think about it\"\n    - Totally. What's the piece you'd be thinking about? Let's think about it together right now.\n    - Flip it for me. What would make this a no?\n    - Decisions don't need time, they need information. What's missing? I've probably got it in front of me.\n    WHY: Isolate what they'd actually be thinking about, then supply it on the call. 'What would make it a no' is easier to answer than the reverse.\n\n[stall_tactic] \"i want to think it over\"\n    - Fair. Where are you right now, one to ten?\n    - What gets that to a ten? That's the actual conversation we should be having.\n    - How long has it been running like this already? What did the last twelve months of it cost you?\n    WHY: The 1-10 close, then fix the gap. Cost of inaction, using only figures from the CALL BRIEF.\n\n[brush_off] \"send me some information\"\n    - I already did, that's what we're talking about. So what's the part that isn't landing?\n    - Happy to send more, but more paper won't decide this. What's the actual hesitation?\n    - If I send it, what would you be looking for in it? Let me just answer that now.\n    WHY: They already got the audit and the video. More material is a stall, not a request. Get the real concern on the table.\n\n[stall_tactic] \"this is happening too fast\"\n    - I hear that. Honestly though, this started weeks ago. You read the audit, you watched the video, you took this call.\n    - What would slowing down actually change for you? If it's a real thing let's build it in.\n    - We can start smaller so it feels like the size it actually is.\n    WHY: It isn't fast. Walk them through their own timeline. If they still want slower, offer a smaller scope rather than a delay.\n\n[objection_discovery] \"i want it done differently\"\n    - Tell me exactly what would make it a fit. Usually it's one thing and it's fixable.\n    - Is that a preference or a dealbreaker? I'll treat it differently depending.\n    - If we change that input we change the output. Which one matters more to you?\n    WHY: Isolate first, it's usually one fixable detail. If it's a core mechanism, say so plainly and let them choose.\n\n[stall_tactic] \"yes but later\"\n    - Totally fine. But before we park it, what's the thing you're not saying? I'd rather hear it now than guess.\n    - If it's a yes, what makes later better than now? Genuinely asking.\n    - Let's do one of two things. Start smaller today, or put a real date on the calendar and decide then. Not an open ended check back.\n    WHY: THE MOST DANGEROUS ANSWER ON THE CALL. Almost always an unvoiced concern plus the discomfort of voicing it. Never accept an open ended follow-up.\n\n[objection_discovery] \"what's the main concern\"\n    - What's the main concern? What are you worried actually happens here?\n    - If this were exactly right, would you do it? Okay, so what's the gap between that and what I've shown you?\n    - Does this move you closer to what you want, or further from it?\n    WHY: All-purpose isolators. Works on anything that isn't a yes. Always box it before answering.\n\n[pattern_interrupt] \"not interested\"\n    - That's fair. Can I ask one thing before I let you go, so I learn something from this?\n    - No problem. Was it the fit, the timing, or the price? Whichever it is, I'd rather know.\n    - Understood. If it's a no it's a no, I'd just rather it be a real one than a polite one.\n    WHY: A clean no is a real outcome. Take it, learn from it, keep the relationship. Do not stack closes on a second clear no.\n\n[sales_psychology] \"i'm not sure\"\n    - That's honest, I appreciate it. Not sure about the thing itself, or about me?\n    - Where are you, one to ten? Don't be polite about it.\n    - You want more of the customers worth having. The only question is whether this makes that more likely than doing nothing.\n    WHY: Zoom out. Acknowledge, never disagree. Ask permission before getting blunt.\n\n[on_the_yes] \"let's do it\"\n    - Perfect. Let me grab a couple of details and I'll get you set up right now.\n    - Great. While I fill this in, tell me who else on your side should be looped in on the kickoff.\n    - You'll hear from me within twenty four hours with the kickoff and what I need access to.\n    WHY: STOP SELLING IMMEDIATELY. Go straight to logistics. Fill the silence with useful questions, not more pitching. Set a realistic first-movement expectation.\n\n[on_the_yes] \"when will i see results\"\n    - Realistically it's a slow surface. I'd rather set that expectation now than have you surprised in week two.\n    - You'll see the work immediately. The engines take longer to catch up, and that's outside anyone's control.\n    - I'll show you the same measurements we ran today so you can watch it move yourself.\n    WHY: Use ONLY the start window from the CALL BRIEF. Never promise a result, a customer or a revenue figure. There is no guarantee to fall back on.\n\n[status_quo] \"i have plenty of customers\"\n    - That's a good problem, and it's actually the reason to look. When you're full the only thing left that moves anything is which customers you take, not how many. Are the ones coming in right now the ones you'd want ten more of?\n    - Then you can afford to be picky. When you're picking, are you choosing the jobs or just taking what shows up?\n    - Fair, and I'm not pitching you more volume. Can I ask one thing and then get out of your hair, when someone asks ChatGPT for what you do, who does it name?\n    WHY: THE premise objection for this offer, because the promise is more of the RIGHT customers, never more customers. Never argue with 'I'm full' and never imply they need volume. Agree, then move the axis from quantity to composition: margin, job type, the customer they would take ten more of. The checkable AI question is the exit that keeps the call alive when the reframe does not land.\n\n[status_quo] \"we're doing fine\"\n    - Glad to hear it, most people I call aren't. What's carrying it right now, is it referrals or is something else feeding you?\n    - Then this is a thirty second thing rather than a pitch. Do you know what comes up when someone asks AI for what you do in your area?\n    - Fair, and doing fine is exactly when this is cheap. It gets expensive when it's the thing you actually need. Worth thirty seconds?\n    WHY: Not an objection yet, it is a door closing politely. Do not pitch into it. Agree, then ask one concrete checkable question. The cheap-now frame works here but only once, and never as a scare line.\n\n[status_quo] \"i don't need that right now\"\n    - Fair. What would have to change for it to be something you did need?\n    - Is that a timing thing or a not-for-me thing? Those are different and I don't want to waste your time on the wrong one.\n    - Before I let you go, do you actually know what AI tells people about you today, or is that a black box?\n    WHY: 'Not right now' is either timing or a no wearing a polite coat. Separate the two before answering, because the moves are opposite: timing earns a dated callback, a real no earns a clean exit. Never argue with it.\n\n[status_quo] \"we get all our business from referrals\"\n    - That's the best kind, and it's also the one that's quietly moving. The referral that used to happen in person now happens inside ChatGPT. When it does, does your name come up?\n    - Referrals are earned, so the work is clearly good. The question is what the person they referred finds when they go and check you. What do they find?\n    - So you've never had to go get customers. What's the backup the month referrals slow down?\n    WHY: Referral-led owners are proud of it and they are right to be. Never frame referrals as weak. Use the mechanism line: the referral moved inside the AI. The strongest follow-up is what the referred person finds when they check, because that is verifiable in ten seconds and it is about THEIR reputation, not our product.\n\n[status_quo] \"i'm all set\"\n    - No problem. One question before I go and then I'll leave you alone, is that alright?\n    - Is that all set as in you've already looked at this, or all set as in you've got enough on your plate?\n    - Fair. If I could tell you in about a minute whether AI is sending anyone your way, is that worth the minute?\n    WHY: A reflex, not a decision. Almost nobody saying this has evaluated the thing. Ask permission for ONE question rather than pushing, and split 'already handled' from 'too busy'. Two responses maximum, then take the clean no.\n\n[trust] \"is it really free\"\n    - It is. We build one section of your own site, you keep it, and there's no card and nothing to sign.\n    - Free because it's faster to show you than to argue about it. You watch whether AI starts naming you and you decide from there.\n    - The only thing I need from you is a yes and about twenty minutes answering questions about the business.\n    WHY: THE OPEN AND THE CLOSE FOR THIS OFFER. The free first build is real: one section of their own site, theirs to keep, no card. Say what it is in plain words, then say what we need back, which is a yes and a short conversation. Do not oversell it and do not attach conditions that are not there. If they ask what happens after, the honest answer is that paid coverage is a separate conversation they can decline.\n\n[trust] \"what's the catch\"\n    - No catch. If it works you'll want the rest of the site done and that's the paid part. If it doesn't, you keep the section and we're done.\n    - The catch, if you want to call it one, is that I think you'll want more after. That's the whole bet.\n    - Nothing changes hands. You don't give me access to anything I don't need and you don't pay for this piece.\n    WHY: Answer it straight and name the commercial logic out loud, because pretending there is no motive is what makes it sound like a scam. The free build is a real deliverable they keep; the upsell is the rest of the site. Never imply the free work expires, never invent scarcity around it.";
