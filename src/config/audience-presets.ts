// The presets a client audience is seeded FROM, once, at seed time.
//
// ‼️ READ EXACTLY ONCE AND THEN WRITTEN TO A ROW. Nothing in a request path may read this file.
// seedClientAudience() in src/lib/clients/audiences.ts is the only legitimate reader, and it stamps
// client_audiences.seeded_from so the row records which preset produced it.
//
// That single rule is what separates this from mergeRowOverSeed() in src/config/verticals.ts, which
// is the same idea done at READ time and is the worst function in the 2026-09-14 probe:
// loadVertical('aeo-agency-med-spa') recomputes a Spanish termite kit on every call, and no row
// anywhere records that it did. If a read-time fallback to this file is ever added, client_audiences
// IS verticals.ts with a nicer table name. That is the one invariant to defend in review.
//
// The second consequence is deliberate: changing a preset next month does NOT change existing
// clients. That is correct for copy already live on somebody's domain, and it is the same reason
// question_set_versions is frozen and never edited in place.
//
// ‼️ DEFINITIONS ARE CODE, RUNS ARE ROWS. Same doctrine as CLIENT_WORKFLOWS in
// clients/workflows/registry.ts: a preset decides the words that go out under a client's name, so
// it is reviewed and deployed rather than typed into Slack.

import type { Audience } from "@/lib/concierge/magnets";

export interface AudiencePreset {
  /**
   * Structural: does this buyer buy from the CLIENT or from the SELLER.
   *
   * ‼️ NULL MEANS THE PRESET REFUSES TO DECIDE. It is not a third stance. GENERIC carries null so
   * that an unrecognised vertical produces a proposal a person must answer, rather than a silent
   * 'patient' that reads as a decision nobody made.
   */
  stance: Audience | null;
  /** singular, plural. "patient/patients", "diner/diners", "med spa owner/med spa owners". */
  buyer: readonly [string, string];
  /** singular, plural. "treatment/treatments", "dish/dishes", "service/services". */
  offer: readonly [string, string];
  /** "clinic", "restaurant", "agency". This is what stops engine.ts hardcoding "clinic". */
  business: string;
  /** "consultation", "table", "call". What patientPrompt currently calls booking. */
  visit: string;
  laneName: string;
  launcher: string;
  /**
   * The guards that are NOT universal and NOT structural.
   *
   * ‼️ p3 IS A MED-SPA BUSINESS RULE WEARING A SAFETY RULE'S CLOTHES. "Never quote a price for a
   * treatment" is correct for a clinic and has been silently forbidding every other kind of client
   * from answering their customer's single most common question. The universal guards (no invented
   * numbers, one question per message, no em dash, no self-written URL) stay in code and apply to
   * everybody; only these move onto the row.
   */
  hardLines: readonly string[];
  /** RealSelf and the NPI Registry are not facts about a restaurant. */
  presence: readonly string[];
  /**
   * The market this audience is ABOUT, as a slug matching market_mentions.service.
   *
   * ‼️ NOT THE CLIENT'S OWN MARKET. For an owner audience it is the market the BUYER'S
   * business competes in: SRT is an agency and its buyer_market is med-spa. Conflating the two
   * is how an agency's pages get aimed at other agencies. serviceKey() normalises it and
   * marketKeys() expands it to its synonym cluster, so the spelling need only be recognisable.
   */
  buyerMarket: string | null;
  /** Matched instead of `vertical === "med_spa"`, which classify.ts is told never to emit. */
  questionSet: string | null;
}

/** The three clinical guards, lifted verbatim from PATIENT_HARD_LINES in concierge/tools.ts. */
const NOT_A_DOCTOR =
  "You are not a doctor and this is not medical advice. Never diagnose, never name a condition, and never say a treatment will work for them.";
const NO_TREATMENT_PRICE =
  "Never quote a price for a treatment. Pricing is something the clinic confirms.";
const NO_OTHER_CLINIC = "Never name another clinic, and never compare this clinic to one.";

/** A restaurant has exactly one guard this shape, and it is not any of the three above. */
const NO_ALLERGEN_PROMISE =
  "Never promise a dish is free of an allergen. Tell them to ask the kitchen when they order.";

export const AUDIENCE_PRESETS: Readonly<Record<string, AudiencePreset>> = {
  // SRT itself, and anybody else selling AEO to clinics.
  aeo_agency_owner: {
    stance: "owner",
    buyer: ["med spa owner", "med spa owners"],
    offer: ["service", "services"],
    // ‼️ "agency", NOT "clinic". SRT sells TO clinics and is not one, and this noun is what keeps
    // that straight in copy written in SRT's own voice.
    business: "agency",
    visit: "call",
    laneName: "AI Visibility Concierge",
    launcher: "Check my visibility",
    hardLines: [],
    presence: ["google", "facebook", "bbb", "trustpilot"],
    // SRT is an agency; its BUYERS run med spas, and that is the market its content is about.
    buyerMarket: "med-spa",
    questionSet: null,
  },

  // ‼️ THE INTENDED MAJORITY, AND UNTIL NOW IT HAD NO PRESET AT ALL. CLIENT_VERTICAL_AVATARS maps
  // three AGENCY slugs and nothing else, so a real med spa classified 'med-spa' resolved to null
  // and read zero shared quotes and zero approved numbers. The clinics are the book.
  med_spa_patient: {
    stance: "patient",
    buyer: ["patient", "patients"],
    offer: ["treatment", "treatments"],
    business: "clinic",
    visit: "consultation",
    laneName: "AI Skin Concierge",
    launcher: "Start my free scan",
    hardLines: [NOT_A_DOCTOR, NO_TREATMENT_PRICE, NO_OTHER_CLINIC],
    presence: ["google", "apple", "bing", "yelp", "realself", "facebook"],
    buyerMarket: "med-spa",
    questionSet: "universal_v1_med_spa",
  },

  // la-casita-tacos-pupusas, when somebody onboards it. A diner and a patient are the SAME stance:
  // both buy from the client, the widget speaks for the client, the booking is the client's.
  restaurant_diner: {
    stance: "patient",
    buyer: ["diner", "diners"],
    offer: ["dish", "dishes"],
    business: "restaurant",
    visit: "table",
    laneName: "AI Menu Concierge",
    launcher: "See tonight's menu",
    hardLines: [NO_ALLERGEN_PROMISE],
    presence: ["google", "apple", "bing", "yelp", "facebook", "foursquare"],
    // A diner shops the restaurant market. market_mentions already holds mexican-restaurant.
    buyerMarket: "restaurant",
    questionSet: null,
  },
};

/** The preset returned when nobody has said what this vertical is. It decides nothing. */
export const GENERIC_PRESET_KEY = "GENERIC";

/**
 * Vertical slug to preset. A CLOSED ALLOWLIST, never a substring match.
 *
 * ‼️ EXACTLY THE SHAPE OWNER_VERTICALS ALREADY USES, AND FOR THE REASON ITS OWN HEADER GIVES:
 * "matching 'agency' loosely would silently claim every marketing client that ever onboards."
 * A miss is answered with GENERIC and `unambiguous: false`, never with a guess.
 *
 * Keys are what verticalFor() returns: clients.vertical_slug, then clients.business_type behind it.
 * Both are kebab-case free text written by classify.ts, so callers lowercase and trim first.
 */
export const PRESET_BY_VERTICAL: Readonly<Record<string, string>> = {
  "aeo-agency": "aeo_agency_owner",
  "aeo-agency-med-spa": "aeo_agency_owner",
  "aeo-marketing-agency": "aeo_agency_owner",

  // ‼️ EVERY SPELLING classify.ts HAS ACTUALLY PRODUCED. question-sets.ts tests
  // `vertical === "med_spa"`, a snake_case literal classify.ts:58 is instructed never to emit, so
  // a real med spa has been missing all three of its branches. Listing the spellings is the cheap
  // half of that fix; normalising at adoptAuditClassification, the single writer, is the real one
  // and is owed separately.
  "med-spa": "med_spa_patient",
  medspa: "med_spa_patient",
  "med-spa-clinic": "med_spa_patient",
  "medical-spa": "med_spa_patient",
  "aesthetics-clinic": "med_spa_patient",
};

/**
 * A regex ladder for business_type, consulted ONLY when vertical_slug missed.
 *
 * Same shape dream-lead.ts's BOOKING_ALERT rule already runs, and its restaurant pattern already
 * resolves la-casita correctly today. Kept narrow on purpose: this proposes, a person confirms.
 */
const BUSINESS_TYPE_LADDER: ReadonlyArray<readonly [RegExp, string]> = [
  [/restaurant|taqueria|cater|venue|bakery|food truck|pupuser/i, "restaurant_diner"],
  [/med ?spa|medical spa|aesthetic|injectable|dermatolog/i, "med_spa_patient"],
];

export interface PresetProposal {
  presetKey: string;
  preset: AudiencePreset | null;
  /**
   * True only when the vertical is named in PRESET_BY_VERTICAL.
   *
   * ‼️ FALSE IS NOT A WEAK YES. It means nobody has said what this vertical is, and the card must
   * make a person press a button rather than letting the proposal stand.
   */
  unambiguous: boolean;
  /** Written for the step card, so a refusal names its own repair. */
  reason: string;
}

/**
 * Propose a preset for a client. It proposes. It does not decide.
 *
 * ‼️ NEVER CALL THIS AT READ TIME. It exists to fill a card that a person confirms, after which
 * the answer lives on a client_audiences row. See the header.
 */
export function proposePreset(
  verticalSlug: string | null | undefined,
  businessType?: string | null
): PresetProposal {
  const v = (verticalSlug ?? "").trim().toLowerCase();
  const named = v ? PRESET_BY_VERTICAL[v] : undefined;

  if (named) {
    return {
      presetKey: named,
      preset: AUDIENCE_PRESETS[named],
      unambiguous: true,
      reason: `"${v}" is on the allowlist and maps to ${named}.`,
    };
  }

  const bt = (businessType ?? "").trim();
  for (const [pattern, key] of BUSINESS_TYPE_LADDER) {
    if (bt && pattern.test(bt)) {
      return {
        presetKey: key,
        preset: AUDIENCE_PRESETS[key],
        unambiguous: false,
        reason:
          `No preset is mapped to the vertical "${v || "(none)"}", but the business type ` +
          `"${bt}" reads as ${key}. Confirm it or say which buyer this client sells to.`,
      };
    }
  }

  return {
    presetKey: GENERIC_PRESET_KEY,
    preset: null,
    unambiguous: false,
    reason: v
      ? `Nothing is mapped to the vertical "${v}". Say which buyer this client sells to, and ` +
        `whether they buy from the client or from us.`
      : "This client has no vertical_slug and no business_type, so nothing has classified it yet. " +
        "Run the baseline scan first, or say which buyer this client sells to.",
  };
}
