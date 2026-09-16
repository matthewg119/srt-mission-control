// Reading a design reference screenshot into a SKIN.
//
// Paste a picture of a page whose look you want, and this returns the template it is closest
// to plus the tokens to move: the ground colours, the accent, the KIND of face used for the
// headline, the subheadings, the labels and the body, the corner radius, the measure and the
// text size. It is the second of the two ways into `hub_skin`; the first is naming one of the
// four templates, which costs nothing and is meant to be the common path.
//
// ‼️ IT RETURNS TOKENS. IT CANNOT RETURN MARKUP, COPY OR A LAYOUT, AND THE SCHEMA IS WHY.
// `SkinRead` has no field for HTML, no field for a headline, no field for a section order, no
// field for a CSS rule, and no field for a URL or an asset. This is the same enforcement
// `HubTheme` uses — the type, not a sentence in a prompt — and it is load-bearing for the same
// reason: the hub's entire product is being crawled and quoted, and the JSON-LD, the heading
// order and the canonical NAP block in hub-bodies.tsx are what make that true. What is worth
// taking from a reference is how it FEELS, never what it says.
//
// The SHAPE words (nav, hero, surface, heading scale, weight and tracking) are the same kind of
// token: a value from a fixed list in skin.ts's SKIN_TRAITS, each with a rule in hub.css that a
// person wrote. The model picks; it never writes the rule.
//
// ‼️ A FONT IS A KEY FROM faces.ts, NEVER A NAME.
// This asked for a free-text `headingFamily` until 2026-09-11 and got null for srtagency.com,
// whose headings are an obvious system sans, because "which font is that" is a question a model
// rightly declines to guess at. "Which of these ten kinds of face" is one it can answer, and the
// answer cannot carry anything into a style attribute. coerce() drops any headingFamily a model
// sends anyway, so the free-text path is closed from this side.
//
// ‼️ THE ACCENT AND THE BODY FACE ARE READ HERE, AND A PICK APPLIES THEM. (Reversed 2026-09-11.)
// This file used to report the accent and write it nowhere: the accent is the client's brand,
// it lives in theme.ts, and its whole value is that it came off their own homepage. That is
// right for the Theme panel and INVERTED for a reference. Somebody who pastes a screenshot and
// picks one of three rendered previews is not claiming the colour is the client's brand, they
// are saying "make it look like that". Measured 2026-09-11: srtagency.com was read correctly as
// dark with a #2dd4bf accent and came back as three black-and-grey designs, because the one
// colour that made it recognisable was the one colour thrown away.
//
// So they are still not written by this file and still not skin fields. confirmSkinPick() writes
// them INTO THE THEME, the accent's one home, recording where they came from and what they
// replaced under theme.fromReference, and the candidate preview renders them first so that what
// is picked is what was seen.
//
// ‼️ WHOSE PAGE IT IS, AND WHY THAT DOES NOT CHANGE WHAT IS READ HERE.
// A reference can be the client's own site, SRT's own, or a page somebody liked, a competitor's
// included. This file treats all of them the same, on purpose, because everything it can return
// is vocabulary rather than expression: a hex colour, one of ten face categories from our own
// list, a radius, a column width, a type size, and a few coarse shape words. No set of those can
// reproduce another business's page, because the markup, the copy and every CSS rule that
// renders them are ours and are identical for every client.
//
// What IS somebody's expression is their words, their pictures and their logo, and those come
// from the client's OWN site or SRT's and from nowhere else: through the snapshot path that
// records provenance in page_sources (site_replica), with words restated rather than rehosted,
// which is the refusal draft-replica.ts records. This lane cannot carry any of them. SkinRead has
// no URL, no asset and no text field, and readSkin() drops keys it does not know.
//
// A background IMAGE lifted off a page sits between the two, and Matthew deferred it on
// 2026-09-11. When it is built it is own-site only, fetched through the snapshot, and never
// cropped out of a screenshot, because a screenshot cannot prove whose picture it is.
//
// ‼️ EVERY FIELD IS RE-VALIDATED BY readSkin() BEFORE IT IS STORED.
// Nothing here is trusted. A hex that is not a hex, a radius of 200, a template name we do not
// ship, a face we do not list: all dropped by skin.ts, which is the one gate, rather than checked
// twice in two places that can disagree.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";
import {
  HUB_TEMPLATES,
  RADIUS_RANGE,
  MEASURE_RANGE,
  BASE_SIZE_RANGE,
  TEMPLATE_CATALOGUE,
  SKIN_TRAITS,
  type HubTemplate,
  type NavStyle,
  type HeroStyle,
  type Surface,
  type HeadingScale,
  type HeadingWeight,
  type HeadingTracking,
} from "./skin";
import { FACE_CATALOGUE, HUB_FACES, isFace, type HubFace } from "./faces";

/**
 * Sonnet, since 2026-09-11. It was Haiku while this read eight colours and four numbers.
 *
 * Measured on a real srtagency.com screenshot with scripts/_probe-skin-vision.ts: Haiku read the
 * colours, the accent, the faces, the centred masthead and the display headline correctly, and
 * called the navigation "inline" twice, even with the prompt spelling out that one pill chip is
 * enough, on a page whose most recognisable detail IS a teal pill chip above the headline. The
 * shape words are judgement about a design, which is the part Haiku is weakest at. One read per
 * pasted screenshot, so the cost difference is nothing next to a design that misses the point.
 */
const MODEL = "claude-sonnet-4-6" as const;

export interface SkinRead {
  /** Which of the four shipped templates the reference is closest to. */
  template: HubTemplate;
  /** One short sentence naming what it took from the image. Printed in Slack, never on a page. */
  reading: string;
  bg: string | null;
  fg: string | null;
  muted: string | null;
  faint: string | null;
  rule: string | null;
  card: string | null;
  band: string | null;
  bandFg: string | null;
  /** Always null from this lane: coerce() drops it. Kept for the shape rows already stored. */
  headingFamily: string | null;
  radius: number | null;
  measure: number | null;
  baseSize: number | null;
  /**
   * The reference's accent: buttons, links, a logo mark.
   *
   * Applied on a PICK, into the theme, with its provenance recorded. See the header.
   */
  accentSuggestion: string | null;
  /**
   * The faces, as keys.
   *
   * ‼️ OPTIONAL IN THE TYPE AND NOT IN THE PROMPT. `scripts/` is typechecked by `next build`, and
   * the artifacts test builds a SkinRead by hand from before faces existed. Absent reads as null
   * everywhere downstream, which is what a face nobody read should mean.
   */
  headingFace?: HubFace | null;
  subheadingFace?: HubFace | null;
  labelFace?: HubFace | null;
  /** The body face. Goes to the theme on a pick, like the accent, because body text is brand. */
  bodyFace?: HubFace | null;
  /** Shape words. Optional in the type for the same reason as the faces. See SKIN_TRAITS. */
  nav?: NavStyle | null;
  hero?: HeroStyle | null;
  surface?: Surface | null;
  headingScale?: HeadingScale | null;
  headingWeight?: HeadingWeight | null;
  headingTracking?: HeadingTracking | null;
}

function isTraitOrNull(values: readonly string[], v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && values.includes(v));
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isHexOrNull(v: unknown): boolean {
  return v === null || (typeof v === "string" && HEX.test(v));
}

function isNumOrNull(v: unknown, min: number, max: number): boolean {
  if (v === null) return true;
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function isFaceOrNull(v: unknown): boolean {
  return v === undefined || v === null || isFace(v);
}

const COLOR_FIELDS = ["bg", "fg", "muted", "faint", "rule", "card", "band", "bandFg"] as const;
const FACE_FIELDS = ["headingFace", "subheadingFace", "labelFace", "bodyFace"] as const;

function isSkinRead(parsed: unknown): parsed is SkinRead {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  if (!HUB_TEMPLATES.includes(p.template as HubTemplate)) return false;
  if (typeof p.reading !== "string" || !p.reading.trim()) return false;
  for (const f of COLOR_FIELDS) if (!isHexOrNull(p[f])) return false;
  if (!isHexOrNull(p.accentSuggestion)) return false;
  if (p.headingFamily !== null && typeof p.headingFamily !== "string") return false;
  for (const f of FACE_FIELDS) if (!isFaceOrNull(p[f])) return false;
  for (const t of SKIN_TRAITS) if (!isTraitOrNull(t.values, p[t.field])) return false;
  if (!isNumOrNull(p.radius, RADIUS_RANGE[0], RADIUS_RANGE[1])) return false;
  if (!isNumOrNull(p.measure, MEASURE_RANGE[0], MEASURE_RANGE[1])) return false;
  if (!isNumOrNull(p.baseSize, BASE_SIZE_RANGE[0], BASE_SIZE_RANGE[1])) return false;
  return true;
}

/**
 * Name the field that failed, so the correction retry gets a reason rather than "invalid".
 *
 * The lesson `booking-script.ts` records: a describeInvalid that only covers the shape returns
 * "shape looked right" for every value failure, and the model is then asked to fix an error it
 * has not been told about.
 */
function describeInvalid(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "not an object";
  const p = parsed as Record<string, unknown>;
  if (!HUB_TEMPLATES.includes(p.template as HubTemplate)) {
    return `template was ${JSON.stringify(p.template)}; it must be one of ${HUB_TEMPLATES.join(", ")}`;
  }
  if (typeof p.reading !== "string" || !p.reading.trim()) return "reading was empty";
  for (const f of COLOR_FIELDS) {
    if (!isHexOrNull(p[f])) return `${f} was ${JSON.stringify(p[f])}; it must be a #rrggbb hex or null`;
  }
  if (!isHexOrNull(p.accentSuggestion)) {
    return `accentSuggestion was ${JSON.stringify(p.accentSuggestion)}; it must be a #rrggbb hex or null`;
  }
  for (const f of FACE_FIELDS) {
    if (!isFaceOrNull(p[f])) {
      return `${f} was ${JSON.stringify(p[f])}; it must be one of ${HUB_FACES.join(", ")}, or null`;
    }
  }
  for (const t of SKIN_TRAITS) {
    if (!isTraitOrNull(t.values, p[t.field])) {
      return `${t.field} was ${JSON.stringify(p[t.field])}; it must be one of ${t.values.join(", ")}, or null`;
    }
  }
  if (!isNumOrNull(p.radius, RADIUS_RANGE[0], RADIUS_RANGE[1])) {
    return `radius was ${JSON.stringify(p.radius)}; it must be null or ${RADIUS_RANGE[0]} to ${RADIUS_RANGE[1]} (px)`;
  }
  if (!isNumOrNull(p.measure, MEASURE_RANGE[0], MEASURE_RANGE[1])) {
    return `measure was ${JSON.stringify(p.measure)}; it must be null or ${MEASURE_RANGE[0]} to ${MEASURE_RANGE[1]} (rem, NOT pixels)`;
  }
  if (!isNumOrNull(p.baseSize, BASE_SIZE_RANGE[0], BASE_SIZE_RANGE[1])) {
    return `baseSize was ${JSON.stringify(p.baseSize)}; it must be null or ${BASE_SIZE_RANGE[0]} to ${BASE_SIZE_RANGE[1]} (px)`;
  }
  return "shape looked right";
}

const TEMPLATE_LINES = TEMPLATE_CATALOGUE.map((t) => `  ${t.key}: ${t.blurb}`).join("\n");
const FACE_LINES = FACE_CATALOGUE.map((f) => `  ${f.key.padEnd(10)} ${f.looks}`).join("\n");
const FACE_UNION = HUB_FACES.map((f) => `"${f}"`).join(" | ");

const SYSTEM = [
  "You are looking at a screenshot of a web page somebody likes the look of. You are extracting",
  "a small set of DESIGN TOKENS from it so a different page, with completely different content,",
  "can be given the same feel.",
  "",
  "WHAT YOU ARE NOT DOING:",
  "  You are not copying the page. You are not reading its words, its pictures, its logo or its",
  "  section order. None of that has anywhere to go. Report only the values named in the schema.",
  "",
  "PICK THE CLOSEST TEMPLATE. These are the only four that exist:",
  TEMPLATE_LINES,
  "",
  "THE GROUND COLOURS:",
  "  bg      the page background",
  "  fg      the main body text colour",
  "  muted   secondary text: a standfirst, a caption",
  "  faint   the quietest text: labels, timestamps",
  "  rule    hairlines and borders",
  "  card    the surface a card or panel sits on, if the reference uses them",
  "  band    a header band's background behind the masthead, if the reference has one",
  "  bandFg  the text colour ON that band",
  "",
  "THE ACCENT:",
  "  accentSuggestion is the page's brand colour: its buttons, its links, a highlighted word, its",
  "  logo mark. It goes here and in NONE of the ground colours above. Most pages have one; a page",
  "  that is genuinely all greys has none, and then it is null.",
  "",
  "THE FACES. Every headline, subheading, label and paragraph on a web page is set in SOME kind",
  "of face. Your job is to name the KIND, not the font. Pick the closest of these ten:",
  FACE_LINES,
  "",
  "  headingFace     the main headline, the biggest text on the page",
  "  subheadingFace  the section headings under it; the same key as headingFace if they match",
  "  labelFace       small labels, eyebrows above a headline, navigation links, captions. Pages",
  "                  that set these in monospace or small capitals are recognisable by it.",
  "  bodyFace        paragraphs",
  "",
  "  ‼️ A FACE IS ALMOST NEVER null. Not knowing the exact font is NOT a reason for null: that is",
  "  exactly why you are choosing between ten kinds instead of naming one. A clean modern sans you",
  "  cannot identify is \"system\". Return null for a face only when the screenshot has no text in",
  "  that role at all.",
  "",
  "THE SHAPE. A few coarse words for how the page is arranged. Pick the closest value; null only",
  "when the screenshot does not show that part of the page.",
  "  nav              how the small text around the top is drawn: the navigation links and any",
  "                   short label above the headline.",
  "                     inline    plain text links and plain labels, with no pill shapes at all",
  "                     pill      ANY pill shape near the top: a rounded chip holding a label",
  "                               above the headline, or a pill-shaped button in the navigation.",
  "                               One is enough; a page with a pill chip is recognisable by it.",
  "                     band      a full-width bar or strip",
  "  hero             how the headline block sits:",
  "                     left      headline and text aligned left",
  "                     centered  headline and text centred on the page",
  "                     split     headline on one side, supporting text or a picture beside it",
  "  surface          what the page stands on:",
  "                     flat      a plain colour",
  "                     glow      a soft coloured glow behind the top of the page",
  "                     gradient  the colour shifts gradually down or across the page",
  "                     dots      a regular pattern of dots",
  "                     grid      a grid of fine lines",
  "                     noise     a grainy, paper or film texture",
  "  headingScale     compact (headline barely bigger than the text), standard, display (very large)",
  "  headingWeight    regular, medium, semibold, bold, heavy",
  "  headingTracking  tight (letters pulled close together), normal, wide (spaced apart)",
  "",
  "THE NUMBERS:",
  `  radius    corner radius in PIXELS, ${RADIUS_RANGE[0]} to ${RADIUS_RANGE[1]}. 0 for hard corners.`,
  `  measure   how wide the text column runs, in REM, ${MEASURE_RANGE[0]} to ${MEASURE_RANGE[1]}. A typical`,
  "            article column is about 40. This is NOT the width of the screenshot.",
  `  baseSize  body text size in PIXELS, ${BASE_SIZE_RANGE[0]} to ${BASE_SIZE_RANGE[1]}.`,
  "",
  "‼️ A COLOUR OR NUMBER YOU CANNOT READ IS null. NEVER A GUESS.",
  "  A null renders the template's own value, which is a considered default. A guessed hex is a",
  "  colour nobody chose, on a real business's website, and it looks like a decision.",
  "  A screenshot that is not a web page at all: return the closest template, a reading that says",
  "  so, and null for every other field.",
  "",
  "reading is ONE short sentence, plain, saying what you took from the image. No adjectives about",
  "how nice it looks.",
].join("\n");

const SCHEMA_HINT = [
  "Return ONE JSON object, no prose around it:",
  "{",
  '  "template": "document" | "clinic" | "editorial" | "bold",',
  '  "reading": "one short sentence",',
  '  "bg": "#rrggbb" | null,',
  '  "fg": "#rrggbb" | null,',
  '  "muted": "#rrggbb" | null,',
  '  "faint": "#rrggbb" | null,',
  '  "rule": "#rrggbb" | null,',
  '  "card": "#rrggbb" | null,',
  '  "band": "#rrggbb" | null,',
  '  "bandFg": "#rrggbb" | null,',
  '  "accentSuggestion": "#rrggbb" | null,',
  `  "headingFace": ${FACE_UNION} | null,`,
  `  "subheadingFace": ${FACE_UNION} | null,`,
  `  "labelFace": ${FACE_UNION} | null,`,
  `  "bodyFace": ${FACE_UNION} | null,`,
  ...SKIN_TRAITS.map((t) => `  "${t.field}": ${t.values.map((v) => `"${v}"`).join(" | ")} | null,`),
  '  "radius": number | null,',
  '  "measure": number | null,',
  '  "baseSize": number | null',
  "}",
].join("\n");

const NOTHING = new Set(["", "null", "none", "n/a"]);

/**
 * Coerce the near-misses worth repairing, and nothing else.
 *
 * A three-digit hex is correct CSS that the validator would reject, and a hex written without
 * its `#` is the single most common way a model returns a colour. A face written "System" or
 * " mono " is the same key in a different case. All unambiguous. A radius of 200 is NOT
 * repaired: that is a misunderstood unit, and clamping it would hide the misunderstanding behind
 * a page that looks merely a bit round. A face we do not list is NOT mapped to a nearby one.
 *
 * ‼️ AND IT DROPS headingFamily, WHATEVER IT SAYS. The free-text font path is closed from this
 * side: a stack a model wrote is exactly the untrusted string faces.ts exists to keep out of CSS.
 */
function coerce(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const p = { ...(parsed as Record<string, unknown>) };
  for (const f of [...COLOR_FIELDS, "accentSuggestion"] as const) {
    const v = p[f];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (NOTHING.has(t.toLowerCase())) {
      p[f] = null;
      continue;
    }
    p[f] = HEX.test(t) ? t : HEX.test(`#${t}`) ? `#${t}` : t;
  }
  for (const f of FACE_FIELDS) {
    const v = p[f];
    if (v === undefined) {
      p[f] = null;
      continue;
    }
    if (typeof v !== "string") continue;
    const t = v.trim().toLowerCase();
    p[f] = NOTHING.has(t) ? null : t;
  }
  for (const { field } of SKIN_TRAITS) {
    const v = p[field];
    if (v === undefined) {
      p[field] = null;
      continue;
    }
    if (typeof v !== "string") continue;
    const t = v.trim().toLowerCase();
    p[field] = NOTHING.has(t) ? null : (SPELLINGS[t] ?? t);
  }
  p.headingFamily = null;
  return p;
}

/**
 * Other spellings of ONE value, and nothing that is a judgement. "centre" means "centered"; there
 * is no entry mapping "middle-ish" anywhere, because that would be this file deciding.
 */
const SPELLINGS: Record<string, string> = {
  center: "centered",
  centre: "centered",
  centred: "centered",
  "left-aligned": "left",
};

/**
 * Read one or more reference images into a skin.
 *
 * Throws only what `callClaudeJSON` throws after its own retries; the caller turns that into a
 * thread note. There is no "best guess" fallback here on purpose — a skin nobody can read off
 * the picture should leave the client on the template they already have, not on one this
 * invented.
 */
export async function readSkinFromImages(
  images: ClaudeImageInput[],
  note?: string
): Promise<SkinRead> {
  const { data } = await callClaudeJSON<SkinRead>({
    model: MODEL,
    system: SYSTEM,
    user: note?.trim()
      ? `Read the design tokens out of this reference. The person who sent it added: ${note.trim()}`
      : "Read the design tokens out of this reference.",
    images,
    maxTokens: 1400,
    temperature: 0,
    schemaHint: SCHEMA_HINT,
    coerce: (p) => coerce(camelizeKeys(p)),
    validate: isSkinRead,
    describeInvalid,
  });

  return data;
}

/** Exported for the artifacts test, which has to prove the free-text font path is closed. */
export const _coerceForTest = coerce;
