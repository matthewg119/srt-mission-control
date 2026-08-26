// Headline swipe — the "speak the customer's language" reference for on-screen titles/hooks.
//
// Distilled from classic direct-response swipe files the operator supplied: Gary Halbert's
// "349 Great Headlines" + "152 Attention Grabber Words", "100 Greatest Headlines Ever Used",
// and "Powerful Headline Starters". This is PRINCIPLES + PROVEN PATTERNS, not a raw dump, so
// it fits in a system prompt cheaply. Injected into the hook step (captions.ts) and the
// creative-director pitch so titles are curiosity/benefit/proof driven, not generic.
//
// ‼️ THE EXAMPLES ARE VERTICAL-SPECIFIC AND USED TO BE PEST-ONLY. Every example in the
// original was termites, roaches and mud tubes, and it was injected verbatim into the med
// spa runs of generateHooks / generateHeadlineOptions / generateHookSet. A swipe file that
// hands a clinic avatar "How to kill the colony without spraying inside" is teaching the
// wrong world, not just the wrong words. `headlineSwipeFor(vertical)` resolves it now, the
// same shape `salesLetterSwipeFor()` uses one file over.
//
// ‼️ THIS IS THE 8-WORD ON-SCREEN TITLE. The long-form advertorial headline lives in
// `dr-headline-engine.ts` and the two must not be merged: in one prompt the shorter length
// rule wins every run, which is exactly how the drop lane ended up unable to write a
// direct-response headline at all.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/hyphens).

const SHARED_PRINCIPLES = `
HEADLINE PRINCIPLES (direct-response swipe, distilled):

1) The headline is 80 percent of the job. On a short video the on-screen title in the first
   1-3 seconds IS the headline. It must stop the scroll and promise a reason to keep watching.
2) Enter the conversation already happening in the viewer's head. Lead with THEIR situation,
   fear, or desire, not with you or your company. Never open with "We".
3) Curiosity + specificity beat cleverness. A concrete number, a named place, a weird detail,
   or an open loop ("what was hiding behind this wall") outperforms a clever pun almost always.
4) The strongest angles: fear of loss, a shocking discovery, "you are doing X wrong",
   forbidden/insider knowledge, fast/easy results, and social proof.
`.trim();

const SHARED_TAIL = `
ATTENTION-GRABBER WORDS to lean on (not force):
Warning, Secret, Revealed, Hidden, Finally, Proven, Free, New, This, Now, Stop, Never,
Shocking, Watch, Look, Truth, Mistake, Careful, Actually, Before, Behind, Inside.

VISUAL/VERBAL/WRITTEN HOOK: the same idea should hit three ways in the first seconds:
- visual: something is about to happen and the viewer waits for the payoff.
- verbal (voiceover): a spoken line that names the stakes.
- written (on-screen title): the headline, held on screen the first few seconds for context.

HARD RULES: write in ENGLISH (source material you are given may be in Spanish; express the
idea in English); never invent guarantees, numbers, rates, or terms; keep titles specific and
customer-language; no em dashes or en dashes.
`.trim();

export const HEADLINE_SWIPE_PEST = `
${SHARED_PRINCIPLES}

PROVEN PATTERNS (adapt the blank to the pest-control moment; keep it 8 words or fewer):
- "How to ___ without ___"            e.g. How to kill the colony without spraying inside
- "Warning: ___"                       e.g. Warning: this is what termite damage really looks like
- "Do you make these ___ mistakes?"    e.g. Do you make these pest control mistakes
- "The truth about ___"                e.g. The truth about "free" termite inspections
- "___ that ___ do not want you to see" (use sparingly, avoid conspiracy framing)
- "Here is what happens when ___"       e.g. Here is what happens when you ignore mud tubes
- "Why ___"                             e.g. Why store spray never fixes a real infestation
- "This is why ___"                     e.g. This is why the roaches always come back
- "___ in ___ (city/zip)"               localize: name the town so it feels real and near
- "POV: ___"                            first-person framing (our default option 1)
- "What was hiding ___"                 the reveal/open-loop hook (behind the wall, in the attic)
- Numbered proof: "3 signs ___", "The 1 thing ___"

${SHARED_TAIL}
`.trim();

export const HEADLINE_SWIPE_GENERIC = `
${SHARED_PRINCIPLES}

PROVEN PATTERNS (fill the blank from THIS avatar's own world, using the words the customer
uses for it; keep it 8 words or fewer):
- "How to ___ without ___"              the benefit, minus the thing they dread
- "Warning: ___"                        the cost of doing nothing, made concrete
- "Do you make these ___ mistakes?"     the self-check hook
- "The truth about ___"                 the thing everyone in the trade says that is wrong
- "Here is what happens when ___"        consequence, shown not argued
- "Why ___"                              the mechanism nobody explained to them
- "This is why ___"                      the answer to a frustration they already have
- "___ in ___ (city/zip)"                localize: name the place so it feels real and near
- "POV: ___"                             first-person framing (our default option 1)
- "What was hiding ___"                  the reveal/open-loop hook
- Numbered proof: "3 signs ___", "The 1 thing ___"

${SHARED_TAIL}
`.trim();

/** Back-compat alias. Prefer headlineSwipeFor(vertical) so examples match the avatar. */
export const HEADLINE_SWIPE = HEADLINE_SWIPE_PEST;

/**
 * The on-screen headline swipe for a given avatar: the pest examples for the pest ids
 * (today's behavior, unchanged), the example-free skeleton for everyone else. Mirrors
 * `salesLetterSwipeFor()` in sales-letter-swipe.ts.
 */
export function headlineSwipeFor(vertical: { id: string }): string {
  if (vertical.id === "pest_owner_ai" || vertical.id === "pest_control") return HEADLINE_SWIPE_PEST;
  return HEADLINE_SWIPE_GENERIC;
}
