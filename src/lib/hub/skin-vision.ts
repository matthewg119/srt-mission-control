// Reading a design reference screenshot into a SKIN.
//
// Paste a picture of a page whose look you want, and this returns the template it is closest
// to plus the ground colours, corner radius, measure and text size to move. It is the second
// of the two ways into `hub_skin`; the first is naming one of the four templates, which costs
// nothing and is meant to be the common path.
//
// ‼️ IT RETURNS TOKENS. IT CANNOT RETURN MARKUP, COPY OR A LAYOUT, AND THE SCHEMA IS WHY.
// `SkinRead` has no field for HTML, no field for a headline, no field for a section order and
// no field for a CSS rule. This is the same enforcement `HubTheme` uses — the type, not a
// sentence in a prompt — and it is load-bearing for the same reason: the hub's entire product
// is being crawled and quoted, and the JSON-LD, the heading order and the canonical NAP block
// in hub-bodies.tsx are what make that true. A reference image is somebody else's page. What
// is worth taking from it is how it FEELS, never what it says.
//
// ‼️ IT DOES NOT READ AN ACCENT, DELIBERATELY.
// The accent and the body font are the CLIENT's brand and live in theme.ts, extracted from
// their own homepage. A colour lifted off a reference screenshot has no claim to be a
// business's brand colour, and writing one there would silently overwrite a value whose whole
// value is its provenance. It is REPORTED as a suggestion in `accentSuggestion` so a person
// can type it into the Theme panel, and it is never written anywhere by this file.
//
// ‼️ EVERY FIELD IS RE-VALIDATED BY readSkin() BEFORE IT IS STORED.
// Nothing here is trusted. A hex that is not a hex, a radius of 200, a template name we do not
// ship: all dropped by skin.ts, which is the one gate, rather than checked twice in two places
// that can disagree.

import { callClaudeJSON, camelizeKeys, type ClaudeImageInput } from "@/lib/claude-calls";
import {
  HUB_TEMPLATES,
  RADIUS_RANGE,
  MEASURE_RANGE,
  BASE_SIZE_RANGE,
  TEMPLATE_CATALOGUE,
  type HubTemplate,
} from "./skin";

/** Haiku. This is reading colours off a picture, not judging a design. */
const MODEL = "claude-haiku-4-5-20251001" as const;

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
  headingFamily: string | null;
  radius: number | null;
  measure: number | null;
  baseSize: number | null;
  /**
   * A brand colour the image seems to use, for a HUMAN to type into the Theme panel.
   *
   * Reported and never written. See the header: the accent's value is its provenance.
   */
  accentSuggestion: string | null;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isHexOrNull(v: unknown): boolean {
  return v === null || (typeof v === "string" && HEX.test(v));
}

function isNumOrNull(v: unknown, min: number, max: number): boolean {
  if (v === null) return true;
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

const COLOR_FIELDS = ["bg", "fg", "muted", "faint", "rule", "card", "band", "bandFg"] as const;

function isSkinRead(parsed: unknown): parsed is SkinRead {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;
  if (!HUB_TEMPLATES.includes(p.template as HubTemplate)) return false;
  if (typeof p.reading !== "string" || !p.reading.trim()) return false;
  for (const f of COLOR_FIELDS) if (!isHexOrNull(p[f])) return false;
  if (!isHexOrNull(p.accentSuggestion)) return false;
  if (p.headingFamily !== null && typeof p.headingFamily !== "string") return false;
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
  if (p.headingFamily !== null && typeof p.headingFamily !== "string") {
    return "headingFamily must be a font stack string or null";
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

const SYSTEM = [
  "You are looking at a screenshot of a web page somebody likes the look of. You are extracting",
  "a small set of DESIGN TOKENS from it so a different page, with completely different content,",
  "can be given a similar feel.",
  "",
  "WHAT YOU ARE NOT DOING:",
  "  You are not copying the page. You are not reading its words, its headings, its sections or",
  "  its navigation. You are not describing its layout. None of that has anywhere to go.",
  "  Report only the values named in the schema.",
  "",
  "PICK THE CLOSEST TEMPLATE. These are the only four that exist:",
  TEMPLATE_LINES,
  "",
  "THE COLOURS ARE GROUND COLOURS, NOT BRAND COLOURS:",
  "  bg      the page background",
  "  fg      the main body text colour",
  "  muted   secondary text: a standfirst, a caption",
  "  faint   the quietest text: labels, timestamps",
  "  rule    hairlines and borders",
  "  card    the surface a card or panel sits on, if the reference uses them",
  "  band    a header band's background behind the masthead, if the reference has one",
  "  bandFg  the text colour ON that band",
  "",
  "  Do NOT report the brand or accent colour in any of those fields. If the page has an obvious",
  "  accent (buttons, links, a logo mark), put it in accentSuggestion and nowhere else.",
  "",
  "THE NUMBERS:",
  `  radius    corner radius in PIXELS, ${RADIUS_RANGE[0]} to ${RADIUS_RANGE[1]}. 0 for hard corners.`,
  `  measure   how wide the text column runs, in REM, ${MEASURE_RANGE[0]} to ${MEASURE_RANGE[1]}. A typical`,
  "            article column is about 40. This is NOT the width of the screenshot.",
  `  baseSize  body text size in PIXELS, ${BASE_SIZE_RANGE[0]} to ${BASE_SIZE_RANGE[1]}.`,
  "",
  "  headingFamily is a CSS font stack for the headings only, and only when the reference clearly",
  "  uses a different kind of face for them (a serif over a sans, say). Letters, digits, spaces,",
  "  commas, dots, hyphens and quotes only. Otherwise null.",
  "",
  "‼️ A VALUE YOU CANNOT READ IS null. NEVER A GUESS.",
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
  '  "headingFamily": "font stack" | null,',
  '  "radius": number | null,',
  '  "measure": number | null,',
  '  "baseSize": number | null,',
  '  "accentSuggestion": "#rrggbb" | null',
  "}",
].join("\n");

/**
 * Coerce the two near-misses worth repairing, and nothing else.
 *
 * A three-digit hex is correct CSS that the validator would reject, and a hex written without
 * its `#` is the single most common way a model returns a colour. Both are unambiguous. A
 * radius of 200 is NOT repaired: that is a misunderstood unit, and clamping it would hide the
 * misunderstanding behind a page that looks merely a bit round.
 */
function coerce(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const p = { ...(parsed as Record<string, unknown>) };
  for (const f of [...COLOR_FIELDS, "accentSuggestion"] as const) {
    const v = p[f];
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.toLowerCase() === "null" || t.toLowerCase() === "none") {
      p[f] = null;
      continue;
    }
    p[f] = HEX.test(t) ? t : HEX.test(`#${t}`) ? `#${t}` : t;
  }
  return p;
}

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
    maxTokens: 900,
    temperature: 0,
    schemaHint: SCHEMA_HINT,
    coerce: (p) => coerce(camelizeKeys(p)),
    validate: isSkinRead,
    describeInvalid,
  });

  return data;
}
