// Headline swipe — the "speak the customer's language" reference for on-screen titles/hooks.
//
// Distilled from classic direct-response swipe files the operator supplied: Gary Halbert's
// "349 Great Headlines" + "152 Attention Grabber Words", "100 Greatest Headlines Ever Used",
// and "Powerful Headline Starters". This is PRINCIPLES + PROVEN PATTERNS, not a raw dump, so
// it fits in a system prompt cheaply. Injected into the hook step (captions.ts) and the
// creative-director pitch so titles are curiosity/benefit/proof driven, not generic.
//
// House rule: NO em dashes or en dashes anywhere in generated copy (use commas/periods/hyphens).

export const HEADLINE_SWIPE = `
HEADLINE PRINCIPLES (direct-response swipe, distilled):

1) The headline is 80 percent of the job. On a short video the on-screen title in the first
   1-3 seconds IS the headline. It must stop the scroll and promise a reason to keep watching.
2) Enter the conversation already happening in the viewer's head. Lead with THEIR situation,
   fear, or desire, not with you or your company. Never open with "We".
3) Curiosity + specificity beat cleverness. A concrete number, a named place, a weird detail,
   or an open loop ("what was hiding behind this wall") outperforms a clever pun almost always.
4) The strongest angles: fear of loss, a shocking discovery, "you are doing X wrong",
   forbidden/insider knowledge, fast/easy results, and social proof.

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

ATTENTION-GRABBER WORDS to lean on (not force):
Warning, Secret, Revealed, Hidden, Finally, Proven, Free, New, This, Now, Stop, Never,
Shocking, Watch, Look, Truth, Mistake, Careful, Actually, Before, Behind, Inside.

VISUAL/VERBAL/WRITTEN HOOK: the same idea should hit three ways in the first seconds:
- visual: something is about to happen and the viewer waits for the payoff (spray about to hit,
  hand reaching for the nest, wall about to open).
- verbal (voiceover): a spoken line that names the stakes.
- written (on-screen title): the headline, held on screen the first few seconds for context.

HARD RULES: never invent guarantees, numbers, rates, or terms; keep titles specific and
customer-language; no em dashes or en dashes.
`.trim();

/** The headline swipe, as a module constant (cache-friendly, offline). */
export function loadHeadlineSwipe(): string {
  return HEADLINE_SWIPE;
}
