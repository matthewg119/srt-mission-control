// The six presentations of the free-first funnel, as DATA.
//
// ‼️ THE COMPONENT BRANCHES ON THESE FIELDS AND NEVER ON THE KEY. No `if (variant === "3")`
// anywhere in the JSX. Six branches scattered through a render is six places to forget one when a
// seventh variant is added, and it makes the diff between two variants unreadable, which is the
// only thing anybody will actually want to look at once these are live.
//
// ‼️ WHAT VARIES IS PRESENTATION, NOT THE OFFER. Every variant sells the same three things on the
// same terms and calls the same start(offer) with the same three OfferKeys. A variant that changed
// what is being sold would not be a test of presentation, it would be two funnels sharing a route,
// and the winner would tell us nothing about either.
//
// ‼️ NOT ONE FIGURE LIVES IN THIS FILE. Prices come from config/pitch.ts through the UPSELL block
// and PAID_BILLING. What is here is button copy and layout intent.

/** The six, as a closed list. The page's ?v= guard is built from this. */
export const VARIANT_KEYS = ["1", "2", "3", "4", "5", "6"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export function isVariantKey(v: unknown): v is VariantKey {
  return typeof v === "string" && (VARIANT_KEYS as readonly string[]).includes(v);
}

/** What a visitor lands on when ?v= is absent, unknown, or hand-edited. */
export const DEFAULT_VARIANT: VariantKey = "1";

export interface FunnelVariant {
  key: VariantKey;
  /** For the preview index and the Slack card. Never rendered on the funnel itself. */
  name: string;

  /**
   * Where the page title sits.
   *
   * `above` is a header over the card, the shape the existing picker uses. `inside` drops it into
   * the card so the card itself is the first thing on screen. `hero` is a full-bleed band that can
   * name their business off the report params.
   */
  titlePlacement: "above" | "inside" | "hero";
  /** The title itself. Null on `inside`, where the card's own name does the work. */
  title: string | null;
  /** Under the title. Null where the variant wants the title to stand alone. */
  subtitle: string | null;

  /**
   * How the add-on arrives.
   *
   * ‼️ THESE ARE THREE DIFFERENT INTERACTIONS, NOT THREE SKINS, and that is what makes the test
   * worth running. `dialog` is a centred modal. `sheet` slides up from the bottom edge, which is
   * where a thumb is. `inline` overlays nothing at all: it expands under the card, which is the
   * control against the other two.
   */
  presentation: "dialog" | "sheet" | "inline";

  /**
   * The reading order of step one.
   *
   * `guarantee` puts the promise in the largest type. `price` puts the number there instead.
   * `objection` opens on the gap the free tool leaves, and reaches the offer third.
   */
  leadsWith: "guarantee" | "price" | "objection";

  /** Step one shows what they already have, beside what is being added. */
  split: boolean;

  /** The button on the free card. Opens step one; does NOT open a session. */
  freeCta: string;
  /** Step one, yes. Starts on `year_3300`. */
  acceptCta: string;
  /** Step one, no. Opens step two. */
  declineCta: string;
  /** Step two, yes. Starts on whichever side of the toggle is selected. */
  planCta: string;
  /** Step two, the last exit. Starts on `review_free`. */
  refuseCta: string;
}

export const VARIANTS: readonly FunnelVariant[] = [
  {
    key: "1",
    name: "Control, centred",
    titlePlacement: "above",
    title: "Pick how you want to start.",
    subtitle:
      "Set it up for you, book your onboarding call, and take it live with your approval.",
    presentation: "dialog",
    leadsWith: "guarantee",
    split: false,
    // The existing review_free.funnelCta, unchanged, because this is the baseline the other five
    // are measured against and a changed control measures nothing.
    freeCta: "Start with the free tool",
    acceptCta: "Add the 5 appointments",
    declineCta: "No thanks, just the free tool",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
  {
    key: "2",
    name: "Hero, price-forward",
    titlePlacement: "hero",
    // `{business}` is filled from the report param and the whole clause is dropped when it is
    // missing, which it is on cold ad traffic. See heroTitle() in free-first-client.tsx.
    title: "Your free AI Referral Engine is ready{business}.",
    subtitle: "Set up for you this week. No card, and you keep it either way.",
    presentation: "dialog",
    leadsWith: "price",
    split: false,
    freeCta: "Yes, set up my free engine",
    acceptCta: "Yes, add appointments",
    declineCta: "Free is enough for now",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
  {
    key: "3",
    name: "Bottom sheet",
    titlePlacement: "inside",
    title: null,
    subtitle: null,
    presentation: "sheet",
    leadsWith: "guarantee",
    split: false,
    freeCta: "Get my free AI Referral Engine",
    acceptCta: "Add it on",
    declineCta: "Skip the add-on",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
  {
    key: "4",
    name: "Inline expand, no popup",
    titlePlacement: "above",
    title: "Start free.",
    subtitle: "Then decide whether you want the appointments too.",
    presentation: "inline",
    leadsWith: "guarantee",
    split: false,
    freeCta: "Claim the free engine",
    acceptCta: "Add the appointments",
    declineCta: "Just the free engine",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
  {
    key: "5",
    name: "Objection-first",
    titlePlacement: "above",
    title: "Want to be found, or want to be booked?",
    subtitle: "Start with the free half. The other half is a conversation.",
    presentation: "dialog",
    leadsWith: "objection",
    split: false,
    freeCta: "Start free, no card",
    acceptCta: "Fill my calendar too",
    declineCta: "Reviews are enough",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
  {
    key: "6",
    name: "Split, you have this now add this",
    titlePlacement: "inside",
    title: null,
    subtitle: null,
    presentation: "dialog",
    leadsWith: "guarantee",
    // The only variant that shows the free thing and the paid thing in one frame, so the add-on
    // reads as an addition rather than as an interruption.
    split: true,
    freeCta: "Turn it on, free",
    acceptCta: "Add appointments",
    declineCta: "Keep it simple",
    planCta: "Start on this plan",
    refuseCta: "I don't want more appointments",
  },
] as const;

/**
 * The only way to turn a key into a variant.
 *
 * Falls back rather than throwing, which is the opposite of offerFor() in pitch.ts and the
 * difference is deliberate: an unknown OFFER would sign somebody onto terms nobody quoted them, so
 * it must fail loudly. An unknown VARIANT is a hand-edited URL or a stale link, and showing the
 * control is the right answer to both.
 */
export function variantFor(key: VariantKey): FunnelVariant {
  return VARIANTS.find((v) => v.key === key) ?? VARIANTS[0];
}
