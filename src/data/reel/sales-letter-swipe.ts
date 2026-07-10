// Sales-letter swipe — the style anchor for the post-render sales-letter caption.
//
// Distilled from 5 long-form reference letters the operator wrote for the pest-control
// OWNER avatar (the B2B buyer of SRT's done-for-you content service): Confession,
// Invisible Stranger, Off-Season, Underdog, Multiplier. This is the FORMAT + the 5
// lead-type archetypes + the objection order + the verbatim avatar language, distilled
// so it fits cheaply in a system prompt. Injected into generateSalesLetterCaption()
// (captions.ts) so every rendered reel gets one condensed (150-220 word) sales-letter
// caption engineered to install ONE avatar belief.
//
// House rule: NO em dashes or en dashes anywhere (use commas, periods, or hyphens).

export const SALES_LETTER_SWIPE = `
SALES-LETTER CAPTION FORMAT (condensed direct-response, 150-220 words):

Write ONE caption as a tight sales letter that installs a single belief. Keep it to
150-220 words. Use this skeleton, each part short:

1) HEADLINE: one bold, ALL-CAPS or strong line. Enter the conversation in the owner's
   head. Lead with THEIR situation, fear, or desire, never with "we" or the company.
2) SUBHEAD: one italic-style line naming the promise or the reframe.
3) BODY: 4 to 7 very short paragraphs (1-3 sentences each). Open a loop, name the real
   problem, reframe it, then land the mechanism (30 done-for-you videos a month, an owned
   asset, familiarity built before the emergency). Speak the owner's language.
4) PROOF: one line of proof. Use ONLY a real fact from the avatar/offer material given to
   you (e.g. the 19-second nest-removal reel that drove 4 bookings in 48 hours; summer
   lead volume ~5x winter; 78% buy from the first business to respond; leads contacted
   within 5 minutes are 21x more likely to qualify). If none fits, write the literal token
   [PROOF] as a placeholder. NEVER invent a stat, price, rate, or guarantee.
5) CTA: one bold call to action line (book a fit call, claim your zip code, get the plan).
6) P.S.: one line that adds urgency (the off-season is coming, the zip code gets claimed
   once, every video your competitor posts makes your next job harder to win).

THE 5 LEAD-TYPE ARCHETYPES (pick the one that best fits the belief + the video):
- confession (direct-attack): validate the skepticism head-on. For the owner burned by
  agencies and lead-sellers. Opens by naming the burn ("You paid an agency $2,000 a month
  and got cold leads, no-shows, and one-off jobs").
- discovery (story): the reveal of the real reason the phone is not ringing. Educational,
  for colder readers. "Your real problem was never a lead problem."
- proclamation (fear): seasonal urgency. "In about 90 days your phone goes quiet." For the
  owner who dreads winter ("the phone stops ringing, the leads dry up").
- underdog (us-vs-them): David vs Orkin, local pride. "You can't out-spend Orkin, but you
  can out-show-up in your own backyard. Orkin is from nowhere."
- multiplier (mechanism): for the owner who already runs ads. "Your ads are working at
  half power. Content warms them up, ads close them, they feed each other."

OBJECTION ORDER (handle in this order across letters, one focus per caption):
burned by agencies -> my customers aren't on there -> I don't have time / can't be on
camera -> AI content looks fake or generic -> I already run ads (why is this different).

VERBATIM AVATAR LANGUAGE to weave in where it fits (use their exact words):
"I feel robbed", "cold leads, no-shows, and one-off jobs", "the phone stops ringing, the
leads dry up", "you can't out-content Orkin", "stuck in the truck", "happy Tuesday posts
that do nothing", a good truck wrap outperforms almost any paid ad in your neighborhood.
Core reframes: leads are RENT (you pay forever and own nothing), content is EQUITY (an
asset you own that works 12 months a year); familiarity is built BEFORE the emergency;
you only need to be familiar to your zip code, not to America.

HARD RULES:
- Write in ENGLISH, in the US pest-control owner's voice (the belief text you are given may
  be in Spanish; express the belief in English).
- Never invent guarantees, numbers, prices, rates, or terms. Only use proof present in the
  avatar/offer material; otherwise use the literal [PROOF] token.
- Never use em dashes or en dashes. Use commas, periods, or hyphens.
- Direct, confident, tradesman-respecting tone. No fluff, no hype words, no emojis.
`.trim();

/** The sales-letter swipe, as a module constant (cache-friendly, offline). */
export function loadSalesLetterSwipe(): string {
  return SALES_LETTER_SWIPE;
}
