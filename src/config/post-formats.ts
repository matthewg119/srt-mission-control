// The WRITTEN-POST format axis: the shape a page takes, declared once, as data.
//
// Matthew, 2026-09-18: "for those posts that are more like lists comparision (and other divergent
// angles, make sure you always give me a list of new angles before making the actual post) those
// also need to have a lead magnet for each post ... make sure we craft the path for systemizing
// that type of post by extracting the neccesary dataset from that specific angle, post, type of
// content."
//
// The angle lane, the magnet lane and the divergence rule were all already built. This is the one
// axis that was missing: an angle had no SHAPE, so "give me three comparison angles" was not a
// thing the system could be asked, and every page was drafted from one outline.
//
// ‼️ THIS IS NOT src/config/format-registry.ts AND THE TWO MUST NEVER MERGE. That file is the REELS
// axis: its FormatKind is single_shot | reference_remake | script_render | multi_shot_render, its
// two rows are pest-control POV scene pools, and it keys content_jobs.format_id. It is imported
// nowhere under src/lib/clients or src/lib/hub. A page has no scenePool and a reel has no
// divergence floor, so one registry serving both would hand each of them the other's fields.
//
// ‼️ AND IT IS NOT page_candidates.quotable_format, which is DEAD: added by
// docs/2026-08-31-colony-and-fanout.sql, no reader, no writer, null on all of its rows. The column
// this registry keys is post_format, on page_plan, page_angles and page_dataset.
//
// ‼️ IT IMPORTS NOTHING, the discipline hub/readability.ts and hub/review-assemble.ts keep. It is
// read by the angle generator, the outline writer, the magnet rail and a probe. Pulling supabase in
// here would make the probe need a database to prove a table of constants.
//
// ‼️ EVERY STRING IN THIS FILE IS DIGIT-FREE, AND THE PROBE ASSERTS IT. These strings are printed
// into the angle prompt and the outline prompt, and BOTH refuse a number that appears nowhere in
// what the model was given (angleFaults' orphan-number rule, outlineFaults' equivalent). A digit in
// an askedAs line is a number the model is invited to echo and is then refused for echoing. Say
// "an N", never a numeral.

export type PostFormatId =
  | "answer_first"
  | "list"
  | "comparison"
  | "decision_guide"
  | "teardown";

export const POST_FORMAT_IDS: readonly PostFormatId[] = [
  "answer_first",
  "list",
  "comparison",
  "decision_guide",
  "teardown",
] as const;

export function isPostFormatId(v: unknown): v is PostFormatId {
  return typeof v === "string" && (POST_FORMAT_IDS as readonly string[]).includes(v);
}

/**
 * One field this shape has to extract. This is the systemizing half of the ask: it is what makes a
 * format a repeatable path rather than a label.
 *
 * ‼️ `prompt` IS SECOND PERSON, because these become the outline's GAPS verbatim. The outline prompt
 * already demands that voice ("What do you charge for ..."), and a field whose prompt is written in
 * the third person produces a gap nobody can answer out loud.
 */
export interface FormatField {
  key: string;
  label: string;
  kind: "string" | "number" | "string[]" | "pair[]" | "row[]";
  /** A required field with no answer is recorded as MISSING on page_dataset, never invented. */
  required: boolean;
  prompt: string;
}

/**
 * Per-format overrides for OUTLINE_LIMITS. Anything absent keeps the answer_first baseline, so a
 * row declaring {} resolves byte-identically to what shipped before this axis existed.
 */
export interface OutlineOverrides {
  minSections?: number;
  maxSections?: number;
  minBullets?: number;
  maxBullets?: number;
  minGaps?: number;
  maxGaps?: number;
  minDivergent?: number;
  /**
   * The convergent subjects this shape IS about, which therefore stop counting against the
   * divergence floor.
   *
   * ‼️ THIS IS WHY A COMPARISON PAGE CAN PASS WITHOUT WEAKENING THE FLOOR. minDivergent stays put
   * for every format; what changes is which of the four subjects the page is allowed to be about.
   * Lowering the number instead would also license a comparison page that is four pricing sections
   * and two fear sections, which is exactly the page the floor exists to refuse.
   */
  exemptSubjects?: readonly string[];
  /** Question words at least one heading must START with. Read off the first word only. */
  mandatoryShapes?: readonly string[];
  /**
   * Rule one of the outline prompt, specialised.
   *
   * ‼️ ANSWER FIRST IS NEVER DROPPED, IT IS SPECIALISED. A comparison page that buries its verdict
   * under six axes is precisely the page rule one exists to prevent. What changes is what the
   * answer IS for that shape.
   */
  openingRule?: string;
}

export interface PostFormat {
  id: PostFormatId;
  label: string;
  /**
   * Which page_plan.theme values this shape honestly serves. Null means any.
   *
   * ‼️ THIS IS WHAT STOPS A COMPARISON ANGLE BEING OFFERED FOR A BOOKING KEYWORD. The spread is
   * drawn from the formats that fit the row's theme, never from all of them.
   */
  fitsThemes: readonly string[] | null;
  /**
   * The lead_magnets.category this SHAPE implies, or null when the shape implies none.
   *
   * ‼️ NULL IS A REAL ANSWER AND IT IS HOW FIVE FORMATS FIT INTO FOUR CATEGORIES. Only four
   * categorised rows exist (Comparison, Guide, Neighbourhood, Objection, measured 2026-09-18) and
   * they are TWO magnets in four placements. So the map is many-to-one and partial: three formats
   * name a category, answer_first defers, and categoryFor() falls back to the page's own theme,
   * which already carries every value the lead_magnets check allows.
   *
   * ‼️ NOTHING CLAIMS Neighbourhood. It is a property of the KEYWORD ("near me"), not of the shape.
   * A comparison written about two neighbourhoods and a comparison written about two treatments are
   * the same shape, and only the theme can tell them apart.
   */
  magnetCategory: string | null;
  /** How an angle of this shape is asked of the model. */
  askedAs: {
    /** One sentence, printed under the option number in the angle prompt. */
    shape: string;
    /** What the angle must NAME to count as this shape. */
    requires: readonly string[];
    /** The anti-patterns, stated because a model told only what to do writes the near miss. */
    refuse: readonly string[];
  };
  dataset: readonly FormatField[];
  outline: OutlineOverrides;
}

export const POST_FORMATS: readonly PostFormat[] = [
  {
    id: "answer_first",
    label: "Answer first",
    // The default shape. It serves every theme, which is what makes it the pad when a keyword fits
    // fewer shapes than there are options to fill.
    fitsThemes: null,
    // ‼️ NULL, NOT "Guide". This shape makes no claim about what kind of offer belongs beside it, so
    // the page's own theme supplies the category. A Price page and a Booking page are both written
    // answer first and want completely different offers.
    magnetCategory: null,
    askedAs: {
      shape: "A direct answer to one question, then everything the reader needs to act on it.",
      requires: [
        "the question, phrased the way she would type it",
        "the answer in one sentence, before any qualification",
      ],
      refuse: [
        "an idea that is really a comparison of two things",
        "an idea that is really a ranked list",
      ],
    },
    dataset: [
      {
        key: "theAnswer",
        label: "The answer",
        kind: "string",
        required: true,
        prompt: "In one sentence, what is your answer to this question?",
      },
      {
        key: "qualifiers",
        label: "When the answer changes",
        kind: "string[]",
        required: true,
        prompt: "When is that answer different, and different how?",
      },
      {
        key: "proof",
        label: "What it rests on",
        kind: "string[]",
        required: true,
        prompt: "What have you got that backs it up? Your own numbers, your own cases, your policy.",
      },
    ],
    // ‼️ EMPTY ON PURPOSE. answer_first IS the baseline, so every value it resolves to is exactly
    // what OUTLINE_LIMITS carried before this axis existed. The probe asserts deep equality against
    // limitsFor(null), which is what proves this change was additive.
    outline: {},
  },

  {
    id: "list",
    label: "Ranked list",
    fitsThemes: ["Tool", "Comparison", "Guide", "Neighbourhood", "General"],
    // A ranked list of N is a comparison of N, and the library's own Comparison magnet is a ranked
    // list of who gets named.
    magnetCategory: "Comparison",
    askedAs: {
      shape:
        "A ranked list of N things, where the page says what ranked them before it names any of them.",
      requires: [
        "an N, stated as a number the page will really carry",
        "the basis the items are ranked on, in her words",
        "what was deliberately left off the list, and why",
      ],
      refuse: [
        "a list with no stated ranking basis, which is a list nobody can argue with",
        "an N large enough that the items get a sentence each",
        "naming a competing business as an item",
      ],
    },
    dataset: [
      {
        key: "n",
        label: "How many",
        kind: "number",
        required: true,
        prompt: "How many items are on this list?",
      },
      {
        key: "rankingBasis",
        label: "What ranked them",
        kind: "string",
        required: true,
        prompt: "What puts one above another? Price, how long it lasts, results, something else?",
      },
      {
        key: "items",
        label: "The items",
        kind: "row[]",
        required: true,
        prompt: "Name each item and the one line that says why it is on the list.",
      },
      {
        key: "excluded",
        label: "What was left off",
        kind: "string[]",
        required: false,
        prompt: "What did you leave off, and why?",
      },
    ],
    outline: {
      // The item sections plus the two frame sections. Capped at the same ceiling the BODY prompt
      // carries, or the outline and the body prompt disagree about how long a page may be.
      minSections: 8,
      maxSections: 14,
      minGaps: 4,
      // An item heading named after its item is divergent already, so the floor is unchanged and
      // still bites: it refuses a list whose items are all about price.
      minDivergent: 5,
      exemptSubjects: [],
      // ‼️ TWO, AND THE MISSING ONE IS "why". shapesCovered reads the FIRST word of a heading, and a
      // list's item headings are the items. Demanding three shape words would force three non-item
      // sections onto a page whose whole job is the items. Two is the frame: what is on the list,
      // and how it was ranked.
      mandatoryShapes: ["what", "how"],
      openingRule:
        "ANSWER FIRST MEANS GIVE THE LIST. The first section names every item and says what ranked " +
        "them, before any item gets a section of its own. A list that makes the reader scroll to " +
        "find out what is on it has buried its own answer.",
    },
  },

  {
    id: "comparison",
    label: "Head to head",
    fitsThemes: ["Comparison", "Price", "Tool", "General"],
    magnetCategory: "Comparison",
    askedAs: {
      shape: "Exactly two subjects, compared on named axes, with a verdict per axis and one overall.",
      requires: [
        "exactly two subjects, named",
        "the axes they are compared on",
        "who should pick the one that loses overall",
      ],
      refuse: [
        "three or more subjects, which is a list and not a comparison",
        "a comparison with no verdict, which is a table pretending to be an argument",
        "naming a competing business as either subject",
      ],
    },
    dataset: [
      {
        key: "subjectA",
        label: "Subject A",
        kind: "string",
        required: true,
        prompt: "What is the first of the two things being compared?",
      },
      {
        key: "subjectB",
        label: "Subject B",
        kind: "string",
        required: true,
        prompt: "And the second?",
      },
      {
        key: "axes",
        label: "The axes",
        kind: "string[]",
        required: true,
        prompt: "What do you compare them on when a customer asks you this in person?",
      },
      {
        key: "verdictPerAxis",
        label: "Verdict per axis",
        kind: "pair[]",
        required: true,
        prompt: "On each of those, which one wins, and why?",
      },
      {
        key: "overallVerdict",
        label: "The verdict",
        kind: "string",
        required: true,
        prompt: "Which would you pick, and for whom?",
      },
      {
        key: "whenTheOtherWins",
        label: "When the other wins",
        kind: "string",
        required: true,
        prompt: "Who should pick the other one instead?",
      },
    ],
    outline: {
      // Past a dozen axes a two-subject comparison is padding.
      maxSections: 12,
      // Both subjects need their facts on file, so the gap floor is above the baseline.
      minGaps: 4,
      minDivergent: 5,
      // ‼️ THIS ONE LINE IS WHY A COMPARISON PAGE CAN PASS AT ALL. Every heading of the shape
      // "X vs Y", "which is better", "the difference between" is classified as the comparison
      // subject, so under the baseline a comparison page fails BY CONSTRUCTION: it cannot reach the
      // divergence floor without ceasing to be a comparison. Exempting its own subject leaves the
      // other three still counted, so the floor still refuses a comparison page that is really four
      // pricing sections.
      exemptSubjects: ["comparison"],
      // "Why" is a weak question on a comparison page, and "which" is the one the reader typed.
      mandatoryShapes: ["what", "which", "how"],
      openingRule:
        "ANSWER FIRST MEANS NAME THE VERDICT. The first section says which of the two you would " +
        "pick and who should pick the other, before any axis is compared. A comparison that saves " +
        "its verdict for the end has buried its own answer.",
    },
  },

  {
    id: "decision_guide",
    label: "Decision guide",
    fitsThemes: ["Guide", "Booking", "Price", "Tool", "General"],
    magnetCategory: "Guide",
    askedAs: {
      shape:
        "One decision the reader is standing in front of, the options, and what tells her which way to go.",
      requires: [
        "the decision, stated as the reader would state it",
        "the options, named",
        "who should not do this at all",
      ],
      refuse: [
        "a guide with no disqualifier, which is a brochure",
        "steps that are really a booking funnel",
      ],
    },
    dataset: [
      {
        key: "decision",
        label: "The decision",
        kind: "string",
        required: true,
        prompt: "What is the decision she is actually making here?",
      },
      {
        key: "options",
        label: "The options",
        kind: "string[]",
        required: true,
        prompt: "What are her real options, including doing nothing?",
      },
      {
        key: "criteria",
        label: "What decides it",
        kind: "pair[]",
        required: true,
        prompt: "What tells you which way somebody should go? Give the signal and what it points to.",
      },
      {
        key: "steps",
        label: "The steps",
        kind: "string[]",
        required: true,
        prompt: "Walk me through it in order, the way you would say it on the phone.",
      },
      {
        key: "disqualifiers",
        label: "Who should not",
        kind: "string[]",
        required: true,
        prompt: "Who should not do this at all, and what do you tell them instead?",
      },
    ],
    outline: {
      minGaps: 4,
      minDivergent: 5,
      // A decision guide is legitimately about the process. Price, fear and comparison stay counted.
      exemptSubjects: ["process"],
      mandatoryShapes: ["what", "how", "when"],
      openingRule:
        "ANSWER FIRST MEANS NAME THE DECISION AND WHO IT IS FOR. The first section says what is " +
        "being decided and who this page is written for, before any step is described.",
    },
  },

  {
    id: "teardown",
    label: "Teardown",
    fitsThemes: ["Objection", "Price", "Comparison", "General"],
    magnetCategory: "Objection",
    askedAs: {
      shape:
        "One claim the market repeats, taken apart: what is true in it, what is not, and what to do instead.",
      requires: [
        "the claim in the words people actually say it",
        "the part of it that IS true, stated first and without hedging",
        "what she should do instead",
      ],
      refuse: [
        "a teardown that concedes nothing, which reads as defensive and nobody believes",
        "attributing the claim to a named business",
        "fear language doing the work an argument should do",
      ],
    },
    dataset: [
      {
        key: "claim",
        label: "The claim",
        kind: "string",
        required: true,
        prompt: "What claim are you taking apart? Say it the way your customers say it.",
      },
      {
        key: "whoSaysIt",
        label: "Who says it",
        kind: "string",
        required: true,
        prompt: "Where does she hear it? Not a business name, the kind of place.",
      },
      {
        key: "whatIsTrue",
        label: "What is true in it",
        kind: "string",
        required: true,
        prompt: "What part of it is genuinely true?",
      },
      {
        key: "whatIsNot",
        label: "What is not",
        kind: "string",
        required: true,
        prompt: "And what part does not hold? What have you seen that says so?",
      },
      {
        key: "verdict",
        label: "The verdict",
        kind: "string",
        required: true,
        prompt: "So what is the honest answer?",
      },
      {
        key: "whatToDoInstead",
        label: "What to do instead",
        kind: "string",
        required: true,
        prompt: "What should she do instead?",
      },
    ],
    outline: {
      minGaps: 4,
      minDivergent: 5,
      // ‼️ "comparison" ONLY. A teardown legitimately sets the claim against what is true, which is
      // comparison vocabulary. "fear" stays COUNTED on purpose: a teardown that reaches the floor
      // only by talking about risk, danger and pain is scaremongering, and the divergence floor is
      // the one thing standing between this shape and that page.
      exemptSubjects: ["comparison"],
      mandatoryShapes: ["what", "why"],
      openingRule:
        "ANSWER FIRST MEANS STATE THE CLAIM AND YOUR VERDICT ON IT. The first section quotes the " +
        "claim and says plainly what is true in it and what is not, before any of it is unpacked.",
    },
  },
] as const;

export function getPostFormat(id: string | null | undefined): PostFormat | null {
  if (!id) return null;
  return POST_FORMATS.find((f) => f.id === id) ?? null;
}

export function listPostFormats(): readonly PostFormat[] {
  return POST_FORMATS;
}

/** The shapes that honestly serve this page_plan.theme. answer_first is always among them. */
export function formatsForTheme(theme: string | null): readonly PostFormat[] {
  const t = (theme ?? "").trim();
  return POST_FORMATS.filter((f) => f.fitsThemes === null || (t !== "" && f.fitsThemes.includes(t)));
}

/**
 * The lead_magnets.category a page carries, from its shape and then from its theme.
 *
 * ‼️ THE SHAPE WINS AND THE THEME IS THE FALLBACK, AND THAT IS THE FIVE-INTO-FOUR RESOLUTION.
 *
 * ‼️ A CATEGORY NO ROW CARRIES IS HARMLESS AND IS NOT THE SAME AS A GUESS. rungOf drops a named row
 * whose category does not match exactly as it drops one for a null query, so an unmatched string
 * resolves identically to no string. What it is not is invented: it is the theme themeOf() already
 * wrote onto the plan row.
 */
export function categoryFor(args: { postFormat: string | null; theme: string | null }): string | null {
  const shape = getPostFormat(args.postFormat)?.magnetCategory ?? null;
  if (shape) return shape;
  const theme = (args.theme ?? "").trim();
  return theme || null;
}

/** How many shapes are offered for one planned page. Matches ANGLES_PER_PAGE in page-angles.ts. */
export const SHAPES_PER_PAGE = 3;

export interface FormatSpread {
  formats: PostFormatId[];
  /** True when the theme fitted fewer shapes than there are options, so answer_first filled in. */
  padded: boolean;
}

/**
 * The shapes offered for one planned page.
 *
 * ‼️ CHOSEN IN CODE, NEVER BY THE MODEL, and that is the whole reason a spread happens at all. Asked
 * to "offer three different shapes" a model returns list, comparison and guide for every page, so
 * seven pages get the same three options and nothing is spread across the plan. A deterministic
 * rotation seeded by the page's RANK covers every shape within a handful of supports, and being
 * deterministic means `angles auto` and a later `angle N more` offer the same shapes for page N.
 *
 * ‼️ THE PILLAR IS ALWAYS OFFERED answer_first FIRST. page-plan.ts calls the pillar "the plainest
 * statement of the anchor"; a pillar drafted as a teardown argues with the market instead of
 * stating the offer.
 *
 * ‼️ A KEYWORD THAT FITS FEWER SHAPES THAN THERE ARE OPTIONS IS PADDED WITH answer_first AND THE
 * CARD SAYS SO. A silent pad looks like a bug, and "this keyword only fits two shapes" is more
 * useful to read than a third option nobody would pick.
 */
export function spreadFor(args: {
  rank: number;
  role: "pillar" | "support" | null;
  theme: string | null;
}): FormatSpread {
  const fitting = formatsForTheme(args.theme).map((f) => f.id);
  const pool: PostFormatId[] = fitting.length ? fitting : ["answer_first"];

  if (args.role === "pillar") {
    const rest = pool.filter((f) => f !== "answer_first");
    return pad(["answer_first", ...rest.slice(0, SHAPES_PER_PAGE - 1)]);
  }

  // A stride coprime with the pool size visits every entry rather than cycling a subset.
  const stride = pool.length % SHAPES_PER_PAGE === 0 ? 1 : SHAPES_PER_PAGE;
  const start = ((Math.max(0, Math.trunc(args.rank)) * stride) % pool.length + pool.length) % pool.length;

  const out: PostFormatId[] = [];
  for (let i = 0; i < SHAPES_PER_PAGE && i < pool.length; i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return pad(out);
}

function pad(out: PostFormatId[]): FormatSpread {
  const formats = [...out];
  let padded = false;
  while (formats.length < SHAPES_PER_PAGE) {
    formats.push("answer_first");
    padded = true;
  }
  return { formats, padded };
}
