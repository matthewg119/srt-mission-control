// Three token sets from one reading of a screenshot.
//
// Matthew: upload an image of the ideal page, get three variations back, pick one, and that pick
// becomes the design every later page for that client is drafted against.
//
// ‼️ THREE TOKEN SETS. NEVER THREE LAYOUTS, AND skin-vision.ts's HEADER IS THE REASON.
//
//   "IT RETURNS TOKENS. IT CANNOT RETURN MARKUP, COPY OR A LAYOUT, AND THE SCHEMA IS WHY.
//    SkinRead has no field for HTML, no field for a headline, no field for a section order and
//    no field for a CSS rule."
//
// So a "variation" here can only be: a different template, different ground colours, a different
// corner radius, a different column width, a different type scale. hub-bodies.tsx, the heading
// order, the JSON-LD and the canonical NAP block are byte-identical across all three, because a
// skin is CSS custom properties and the markup is not themable. If a variation ever needed to
// move a section, that is a fourth template, which is a code change on purpose.
//
// ‼️ ONE MODEL CALL, NOT THREE, AND THE OTHER TWO ARE ARITHMETIC.
//
// The obvious build asks the model three times at a higher temperature. That spends three vision
// calls to get three answers that are each individually unverifiable, and "the model felt
// different about it the second time" is not a design rationale anybody can act on. Here the
// read is asked for once and taken literally; the siblings are DERIVED from it by rules written
// down below, so each one can be described in a sentence: "the same colours on a warmer ground
// with softer corners", "the same colours set narrower and larger".
//
// Two of the three therefore cost nothing and cannot come back wrong.
//
// ‼️ EVERY ONE OF THE THREE STILL GOES THROUGH readSkin() BEFORE IT IS STORED. One gate, not
// two: the arithmetic below is written to stay inside RADIUS_RANGE, MEASURE_RANGE and
// BASE_SIZE_RANGE, and readSkin() is what makes that a fact rather than an intention. It REFUSES
// an out-of-range number rather than clamping it, so a bad derivation drops the field instead of
// quietly storing a value nobody chose.

import {
  DEFAULT_TEMPLATE,
  HUB_TEMPLATES,
  readSkin,
  type HubSkin,
  type HubTemplate,
  type StoredSkin,
} from "./skin";
import type { SkinRead } from "./skin-vision";
import { faceStack, safeFace, type HubFace } from "./faces";
import {
  mixHex,
  safeColor,
  type HubTheme,
  type ReferenceProvenance,
  type StoredTheme,
} from "./theme";

/** How many go on the card. Three is Matthew's number and also as many as anyone compares. */
export const VARIANT_COUNT = 3;

export interface SkinCandidate extends StoredSkin {
  /** 1, 2 or 3. What he types to pick it. */
  slot: number;
  /** One line saying what this one IS, so the three can be told apart without opening them. */
  blurb: string;
}

/** What is stored on the client between a screenshot and a pick. */
export interface SkinCandidateSet {
  generatedAt: string;
  generatedBy: string;
  /** The model's one-line reading of the reference, carried once rather than per candidate. */
  reading: string | null;
  /**
   * The accent the reference uses. Shown in all three previews and written INTO THE THEME by the
   * pick, with its provenance. See the header of skin-vision.ts for why a pick may and nothing
   * else here does. The name predates that and is kept so stored sets still read.
   */
  accentSuggestion: string | null;
  /**
   * The reference's body face. Carried once rather than per candidate, like the accent, because
   * it goes to the theme and not the skin: body text is brand, and the skin has no body font.
   */
  bodyFace: HubFace | null;
  candidates: SkinCandidate[];
}

/** Ranges restated from skin.ts so the arithmetic below can stay inside them without importing
 *  private constants. readSkin() is still the authority; these only stop it having to refuse. */
const RADIUS = { min: 0, max: 28 } as const;
const MEASURE = { min: 30, max: 64 } as const;
const BASE = { min: 15, max: 20 } as const;

/**
 * What the page actually renders at when a token is absent, from hub.css's .hub-root block.
 *
 * ‼️ NOT ZERO, AND NOT A GUESS. A null radius does not mean "no corners", it means "nobody set
 * one, so the stylesheet's 8px stands". Deriving "rounder" from 0 would produce a variation that
 * is SQUARER than the thing it varies, which is the shape of bug that looks like a design
 * opinion. These three numbers are the literals hub.css:50-52 declares, and if they move there
 * they move here.
 */
const RENDERED_DEFAULT = { radius: 8, measure: 44, baseSize: 17 } as const;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * A second template that is genuinely a different answer to the same reference.
 *
 * Not "the next one in the list": Document and Editorial are both quiet and pairing them gives
 * two variations that look like a rendering bug rather than a choice. Each template's partner is
 * the one that reads most differently while still being a plausible answer to the same page.
 */
const SIBLING: Record<HubTemplate, HubTemplate> = {
  document: "clinic",
  clinic: "editorial",
  editorial: "clinic",
  bold: "clinic",
};

/**
 * The third: whichever of the four is furthest from the first two.
 *
 * Bold unless the read already chose it, in which case Document, because those two are the
 * extremes of the set and one of them is always available.
 */
function contrastTemplate(primary: HubTemplate, sibling: HubTemplate): HubTemplate {
  if (primary !== "bold" && sibling !== "bold") return "bold";
  if (primary !== "document" && sibling !== "document") return "document";
  return HUB_TEMPLATES.find((t) => t !== primary && t !== sibling) ?? DEFAULT_TEMPLATE;
}

/** The tokens the read produced, before any variation is applied. */
function baseSkinFrom(read: SkinRead): HubSkin {
  return {
    template: read.template,
    bg: read.bg,
    fg: read.fg,
    muted: read.muted,
    faint: read.faint,
    rule: read.rule,
    card: read.card,
    band: read.band,
    bandFg: read.bandFg,
    headingFamily: read.headingFamily,
    headingFace: read.headingFace ?? null,
    subheadingFace: read.subheadingFace ?? null,
    labelFace: read.labelFace ?? null,
    radius: read.radius,
    measure: read.measure,
    baseSize: read.baseSize,
  };
}

/**
 * Three candidates from one read.
 *
 * 1. THE READ, taken literally. Whatever the reference actually says, with nothing adjusted.
 *    It has to be first because it is the only one with evidence behind it.
 * 2. SOFTER. Same colours, its sibling template, rounder corners and a slightly wider column.
 *    The version a clinic usually asks for after seeing the first one.
 * 3. SHARPER. Same colours, the contrast template, square corners, a narrower column and a
 *    larger base size. The version that reads as more deliberate on a phone.
 *
 * ‼️ THE COLOURS ARE NOT INVENTED IN ANY OF THE THREE. Every candidate carries the grounds read
 * off the reference, or null where the model could not read one. Making up a palette for a
 * variation would be the one thing skin-vision.ts refuses, arriving by the back door: a colour
 * with no provenance, on a client's own domain, that somebody would then have to defend.
 *
 * ‼️ NOR ARE THE FACES. All three carry the faces as read, for the same reason: they are the
 * evidence, and a variation that swapped the type would be a different reference, not a
 * different answer to this one. The three differ in shape, never in what was read.
 */
export function skinVariants(read: SkinRead, by: string): SkinCandidate[] {
  const base = baseSkinFrom(read);
  const now = new Date().toISOString();

  const sibling = SIBLING[read.template] ?? DEFAULT_TEMPLATE;
  const contrast = contrastTemplate(read.template, sibling);

  const radius = base.radius ?? RENDERED_DEFAULT.radius;
  const measure = base.measure ?? RENDERED_DEFAULT.measure;
  const baseSize = base.baseSize ?? RENDERED_DEFAULT.baseSize;

  const raw: Array<{ skin: HubSkin; blurb: string }> = [
    {
      skin: base,
      blurb: "the reference as read, nothing adjusted",
    },
    {
      skin: {
        ...base,
        template: sibling,
        radius: clamp(Math.round(radius + 8), RADIUS.min, RADIUS.max),
        measure: clamp(Math.round(measure + 4), MEASURE.min, MEASURE.max),
      },
      blurb: "softer: same colours and type, rounder corners, a wider column",
    },
    {
      skin: {
        ...base,
        template: contrast,
        radius: 0,
        measure: clamp(Math.round(measure - 6), MEASURE.min, MEASURE.max),
        baseSize: clamp(Math.round(baseSize + 1), BASE.min, BASE.max),
      },
      blurb: "sharper: same colours and type, square corners, narrower and larger",
    },
  ];

  return raw.map((entry, i) => {
    // ‼️ THROUGH readSkin(), EVERY ONE. The arithmetic above is written to stay in range and
    // this is what makes that true rather than intended.
    const validated = readSkin({
      ...entry.skin,
      source: "screenshot",
      sourceNote: read.reading,
      updatedAt: now,
      updatedBy: by,
    });
    return { ...validated, slot: i + 1, blurb: entry.blurb };
  });
}

/**
 * The stored set, or null.
 *
 * Anything malformed is nothing. A half-read candidate set is the same answer as no candidate
 * set: it sends you back to the screenshot, which is where you would have to go anyway.
 */
export function readCandidateSet(raw: unknown): SkinCandidateSet | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const list = Array.isArray(bag.candidates) ? bag.candidates : null;
  if (!list || list.length === 0) return null;

  const candidates: SkinCandidate[] = [];
  for (let i = 0; i < list.length && i < VARIANT_COUNT; i += 1) {
    const entry = list[i] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") continue;
    const validated = readSkin(entry);
    candidates.push({
      ...validated,
      slot: typeof entry.slot === "number" ? entry.slot : i + 1,
      blurb: typeof entry.blurb === "string" ? entry.blurb : "",
    });
  }
  if (candidates.length === 0) return null;

  return {
    generatedAt: typeof bag.generatedAt === "string" ? bag.generatedAt : "",
    generatedBy: typeof bag.generatedBy === "string" ? bag.generatedBy : "",
    reading: typeof bag.reading === "string" ? bag.reading : null,
    accentSuggestion: typeof bag.accentSuggestion === "string" ? bag.accentSuggestion : null,
    // A set stored before faces existed has none, and reads as "no body face read", which is
    // what it is. It stays pickable: see the stale-set note in docs/prompts or the brief.
    bodyFace: safeFace(bag.bodyFace),
    candidates,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The brand half of a reference: what a pick writes into the THEME
// ─────────────────────────────────────────────────────────────────────────────

/** The accent, its soft tint and the body stack a reference would put in the theme. */
export interface ReferenceBrand {
  accent: string | null;
  accentSoft: string | null;
  fontFamily: string | null;
}

/**
 * How much of the accent goes into accentSoft, over the page's own ground.
 *
 * Low, because the soft tint sits behind reading text (a note, a highlighted sentence), and on
 * srtagency.com's near-black ground anything stronger turns a highlight into a slab of teal.
 */
const SOFT_WEIGHT = 0.16;

/**
 * What a reference would write into the theme, derived from the set and the candidate's ground.
 *
 * ‼️ ONE FUNCTION, CALLED BY THE PREVIEW AND BY THE PICK, AND THAT IS THE WHOLE POINT OF IT.
 * The candidate preview renders these values and confirmSkinPick() stores them. If the two
 * computed them separately, the design somebody picked would not be the design they saw.
 *
 * Every value is re-gated here (safeColor, a face key to a code-owned stack) because the set is
 * read back out of a jsonb column, and a colour does not become trustworthy by having been stored.
 */
export function brandFromReference(
  set: Pick<SkinCandidateSet, "accentSuggestion" | "bodyFace">,
  skin: Pick<HubSkin, "bg">
): ReferenceBrand {
  const accent = safeColor(set.accentSuggestion);
  return {
    accent,
    // A null ground means the template's own, which for every template is white or near it.
    accentSoft: accent ? mixHex(accent, skin.bg ?? "#ffffff", SOFT_WEIGHT) : null,
    fontFamily: faceStack(safeFace(set.bodyFace)),
  };
}

/**
 * A theme with a reference's brand laid over it. Only what was READ moves; the logo never does.
 *
 * Generic so the preview can apply it to the HubTheme it renders and the pick to the StoredTheme
 * it writes, with one precedence rule between them.
 */
export function withReferenceBrand<T extends HubTheme>(theme: T, brand: ReferenceBrand): T {
  return {
    ...theme,
    accent: brand.accent ?? theme.accent,
    // The soft tint belongs to the accent it was mixed from. A new accent brings its own; no new
    // accent leaves the old pair together.
    accentSoft: brand.accent ? brand.accentSoft : theme.accentSoft,
    fontFamily: brand.fontFamily ?? theme.fontFamily,
  };
}

/**
 * The theme a pick stores: the brand laid over it, and a record of exactly what changed.
 *
 * Returns the theme UNCHANGED, provenance and all, when the reference read no accent and no body
 * face. A pick that wrote nothing must not claim to have written something.
 */
export function themeFromPick(
  stored: StoredTheme,
  brand: ReferenceBrand,
  slot: number,
  by: string,
  at: string
): StoredTheme {
  if (!brand.accent && !brand.fontFamily) return stored;

  const provenance: ReferenceProvenance = {
    from: `a reference screenshot, design ${slot}`,
    at,
    by,
    accent: brand.accent,
    fontFamily: brand.fontFamily,
    replacedAccent: brand.accent && stored.accent !== brand.accent ? stored.accent : null,
    replacedFontFamily:
      brand.fontFamily && stored.fontFamily !== brand.fontFamily ? stored.fontFamily : null,
  };

  return { ...withReferenceBrand(stored, brand), fromReference: provenance };
}

/** The candidate a person typed, or null. Out of range and "not a number" are one answer. */
export function candidateAt(set: SkinCandidateSet | null, slot: number): SkinCandidate | null {
  if (!set) return null;
  return set.candidates.find((c) => c.slot === slot) ?? null;
}
