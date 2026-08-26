// Direct-response headline engine — the METHODOLOGY behind long-form headlines.
//
// Distilled from the three swipe documents the operator supplied: "THE DIRECT RESPONSE
// HEADLINE ENGINE" (the seven laws + its 30 formulas), "100 Greatest Headlines Ever Used",
// and Gary Halbert's "349 Great Headlines" + "152 Attention Grabber Words". Principles and
// proven patterns, not a raw dump, so it fits in a system prompt cheaply.
//
// ‼️ THIS IS NOT `headline-swipe.ts` AND THE TWO MUST NOT BE MERGED. That file writes the
// on-screen title held for three seconds at the top of a reel, and its whole contract is
// "8 words or fewer". This file writes the ADVERTORIAL / VSL / long-form ad headline, which
// runs 12 to 45 words and is the artifact that engine was structurally unable to produce.
// One file with both length rules in it is a file whose shorter rule wins every run.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/hyphens).

export const DR_HEADLINE_ENGINE = `
THE SEVEN LAWS (the engine; every headline must run on at least two of them):

1) ENGINEER THE OPEN LOOP. Trigger curiosity, raise the stakes, then withhold the answer.
   The sentence must feel incomplete without the click. Contradictions, a missing piece of a
   mechanism, a hinted future event, a promise slightly out of reach.
2) NAME THE WOUND BEFORE YOU OFFER THE BANDAGE. The job is not to heal, it is to poke the
   nerve she tries to ignore. Call out the struggle, name the enemy, show you have seen her
   private world. She must feel "this is about ME". One sharp edge, not five.
3) PROMISE A RESULT SHE HAS NEVER HEARD SAID THIS WAY. A bare promise is worthless. Attach a
   mechanism she has not heard of. "Lose weight" is nothing. "Lose weight by activating a
   metabolic trigger most people have never heard of" is the same promise made new.
   Unique, then valuable, then believable.
4) SPECIFICITY CREATES TRUST. Vague slides off the brain. Use unusual numbers (less round
   reads as more real: 47 days, 22.7%, $1,500, 12 months), named roles, named places, named
   rivals, real timeframes. Specificity is believability in disguise.
5) SIMPLICITY IS PERSUASION. Short words, linear structure, no stacked clauses she has to
   unpick. Long is allowed. HARD is not. If she has to read it twice, it is dead.
6) EARN BELIEF THROUGH CREDIBILITY SIGNALS. A real event, a measurable outcome, a personal
   confession, an unexpected authority, a source category. Credibility removes friction and
   friction kills response.
7) COMPRESS TIME. A stated timeframe controls expectations, implies efficiency, and shortcuts
   her cost-benefit math. "In 30 days", "in one afternoon", "before your next rent payment".

THE ANGLE MENU (30 shapes; spread the 20 across them, never lean on three):
Mechanism Mystery · Pain Mirror · Forbidden Fix · Time-Compression Promise · Inside Leak ·
Hidden Enemy · Transformation Snapshot · Simple Switch · Selective Call-Out · Advanced
Call-Out · Shame Trigger · Social Proof Magnet · Reverse Logic · Vulnerable Confession ·
Imminent Threat · Aspiration Frame · Emotional Hook · ROI Frame · Extreme Specificity ·
Mechanism Reveal · Contradiction Hook · Niche Spotlight · New Paradigm · Mini Case Study ·
Identity Shift · System Headline · Opportunity Gap · Prediction · Quick Win · Reality Check.

PROVEN PATTERNS (the classics, with the original beside each as the reference. Adapt the
blank to THIS avatar's world; never ship the original):
- "They Laughed When I ___, But When I ___"        (They Laughed When I Sat Down At The Piano)
- "A Little Mistake That Cost ___ $___ A Year"     (A Little Mistake That Cost A Farmer $3,000 A Year)
- "Do You Make These Mistakes In ___?"             (Do You Make These Mistakes In English?)
- "Who Else Wants ___?"                            (Who Else Wants A Screen Star Figure?)
- "To ___ Who Want To ___ Someday"                 (To Men Who Want To Quit Work Someday)
- "Often A ___, Never A ___"                       (Often A Bridesmaid, Never A Bride)
- "An Open Letter To Every ___ In ___"             (An Open Letter To Every Overweight Person In Portland)
- "___ Reasons Why It Would Have Paid You To ___ ___ Ago"
                                                   (67 Reasons Why It Would Have Paid You To Answer Our Ad A Few Months Ago)
- "The Amazing Secret Of A ___ Who Is ___"         (The Amazing Secret Of A Marketing Genius Who Is Afraid To Fly)
- "How A New Discovery Made ___"                   (How A New Discovery Made A Plain Girl Beautiful)
- "If You Can ___, I'll Show You How To ___"       (If You Can Read And Write Simple English, I'll Show You How To Make Real Money Selling Words)
- "The Truth About ___"          - "WARNING: ___"          - "What Everybody Ought To Know About ___"
- "Which Of These ___ Would You Like To End?"      - "Are You Ever ___?"
- "Here Is What Happens When ___"                  - "Why Some ___ Almost Always ___"
- "Last ___ ... Was I Scared!"                     (the confession opener, first person, mid-scene)
- "Suppose This Happened On Your ___"              - "How I ___ In One ___"

ATTENTION-GRABBER WORDS to lean on, never to force:
Warning, Secret, Revealed, Hidden, Finally, Proven, Discovery, Truth, Mistake, Shocking,
Announcing, New, Now, Stop, Never, Actually, Behind, Inside, Confession, Quietly, Silently,
Invisible, Ignored, Overlooked, Exposed.

LENGTH. These are ADVERTORIAL, VSL and long-form ad headlines. Roughly 12 to 45 words, and
deliberately varied across the 20: some are one long specific sentence, some are two short
sentences where the first sets the scene and the second turns it. THERE IS NO 8-WORD RULE
HERE. A punchy 8-word line is a social caption, not a direct-response headline, and a set of
twenty of them is the failure this engine exists to prevent. A few short ones are fine as
contrast; most must carry a scene, a specific, and an open loop.

STRICT RULES:
- Exactly the number of headlines asked for. No more, no fewer.
- No generic social-media hooks ("Here's the truth about X", "Nobody talks about this").
- Never repeat the same structure more than TWICE across the set. Count your openings.
- Never summarize or paraphrase a customer quote into a bland line. Rebuild its SHAPE into a
  headline; keep its essence and its heat.
- No empty clickbait and no weak curiosity. Every open loop must have a real answer behind it.
- Each headline must stand alone. No numbering, no labels, no angle names in the text itself.

HARD RULES:
- Write in ENGLISH. Always. Any source material you are given may be in Spanish or may quote
  another language; express the idea in English regardless.
- Never invent guarantees, statistics, prices, rates, timeframes or terms. Use only what the
  avatar, offer and quote material actually support.
- Never use em dashes or en dashes. Use commas, periods, colons, or hyphens.
`.trim();

/** The direct-response headline engine, as a module constant (cache-friendly, offline). */
export function loadDrHeadlineEngine(): string {
  return DR_HEADLINE_ENGINE;
}
