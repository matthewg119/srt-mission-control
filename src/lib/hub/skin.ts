// The hub's SKIN: which of our layouts a client's pages are built on, and the ground
// colours that layout stands on.
//
// ‼️ SKIN AND THEME ARE TWO DIFFERENT FACTS AND THEY DO NOT OVERLAP.
//
//   theme.ts  = the CLIENT's brand. Logo, accent, font. Extracted from their own homepage,
//               so its provenance is "their site says so".
//   skin.ts   = OUR format. Which template, how wide the measure, how round the corners,
//               what the page stands on. Its provenance is "somebody chose this".
//
// They are deliberately disjoint sets of CSS variables. There is no accent here and no body
// font here, because those already have a home, and a value with two homes is a precedence
// puzzle that gets resolved differently in three renderers. If you want to change a client's
// accent, that is the Theme panel, and it stays that way.
//
// ‼️ ONE THING WRITES A REFERENCE'S ACCENT AND BODY FACE, AND IT WRITES THEM INTO THE THEME.
// confirmSkinPick() (clients/hub-skin.ts), since 2026-09-11. The skin still has no accent and no
// body font; a pick puts them in their one home and records it as theme.fromReference. Why a pick
// is allowed to, and where the line sits on whose page a reference may be, is the header of
// skin-vision.ts. Short version: tokens from any page, assets and words from the client's own.
//
// ‼️ FONTS ARE KEYS. headingFace, subheadingFace and labelFace name one of the ten faces in
// faces.ts, and skinStyle() looks the stack up. `headingFamily` is the older free-text field,
// still honoured for rows that have one, and no longer written by the screenshot lane.
//
// ‼️ THE MARKUP IS NOT THEMABLE AND MUST NEVER BECOME THEMABLE.
// Every field below lands in a CSS custom property or a class name. Nothing here is markup,
// nothing here is copy, and there is nowhere to put either. That is not squeamishness: the
// hub's whole product is being crawled and quoted, and the JSON-LD, the heading order and the
// canonical NAP block in hub-bodies.tsx are what make that true. A skin that could carry its
// own HTML would be a skin that could silently delete the thing we sell, on a client's own
// domain, with nothing on the board able to notice.
//
// ‼️ SAME VALIDATION POSTURE AS theme.ts: DROP, NEVER REPAIR.
// Values reach this file from a model reading a screenshot. Every one of them is interpolated
// into a style attribute, so every one is gated on a tight pattern or a numeric range, and
// anything that does not match is discarded rather than cleaned up and used anyway.

import { safeFontFamily } from "./theme";
import { safeFace, faceStack, type HubFace } from "./faces";

/** The templates that exist. Adding one is a code change, on purpose. */
export const HUB_TEMPLATES = ["document", "clinic", "editorial", "bold"] as const;
export type HubTemplate = (typeof HUB_TEMPLATES)[number];

export const DEFAULT_TEMPLATE: HubTemplate = "document";

export interface TemplateInfo {
  key: HubTemplate;
  /** What it is called in Slack and in the dashboard. */
  name: string;
  /** One line, written to be read next to the other three. */
  blurb: string;
}

/**
 * The catalogue, which is also the fallback set the whole feature rests on.
 *
 * A named template is the cheap path and it is meant to be the common one: no model call,
 * nothing to validate, nothing that can come back wrong. The screenshot lane exists for the
 * times none of these four is close enough.
 */
export const TEMPLATE_CATALOGUE: TemplateInfo[] = [
  {
    key: "document",
    name: "Document",
    blurb: "Plain white, one narrow column, hairline rules. Reads like a reference page.",
  },
  {
    key: "clinic",
    name: "Clinic",
    blurb: "Warm off-white, answers as cards, contact details in a panel. Softer and busier.",
  },
  {
    key: "editorial",
    name: "Editorial",
    blurb: "Serif headings, a large lede, hairline rules. Looks written rather than generated.",
  },
  {
    key: "bold",
    name: "Bold",
    blurb: "Dark header band behind the name, oversized title, white body underneath.",
  },
];

export function isTemplate(v: unknown): v is HubTemplate {
  return typeof v === "string" && (HUB_TEMPLATES as readonly string[]).includes(v);
}

export function templateInfo(key: HubTemplate): TemplateInfo {
  return TEMPLATE_CATALOGUE.find((t) => t.key === key) ?? TEMPLATE_CATALOGUE[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape. Bounded words, never CSS.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a page is arranged, as a handful of words that each have a fixed set of values.
 *
 * ‼️ MORE ENUMS, NOT MORE FREEDOM. Matthew asked for a screenshot to carry a reference's
 * navigation look, its masthead and its background. The version of that which survives review is
 * a model choosing from a union and hub.css holding a rule a person wrote for each value. The
 * model never emits CSS, readSkin() REFUSES a value outside the union rather than mapping it to a
 * nearby one, and the class written for it can only be one this file lists.
 *
 * ‼️ NOTHING HERE MOVES MEANING. Every value's rule sits below the TEMPLATES banner in hub.css,
 * where _probe-hub-skin.ts forbids display:none, visibility:hidden, generated content and
 * `order:`. A split masthead is a grid that places the children in DOM order; nothing is hidden,
 * inserted or reordered, and hub-bodies.tsx is not touched by any of it. A layout these words
 * cannot reach is a fifth TEMPLATE, which is a code change on purpose.
 */
export const NAV_STYLES = ["inline", "pill", "band"] as const;
export const HERO_STYLES = ["left", "centered", "split"] as const;
/** The CSS half of a background: every value is generated from the colour tokens. No asset. */
export const SURFACES = ["flat", "glow", "gradient", "dots", "grid", "noise"] as const;
export const HEADING_SCALES = ["compact", "standard", "display"] as const;
export const HEADING_WEIGHTS = ["regular", "medium", "semibold", "bold", "heavy"] as const;
export const HEADING_TRACKINGS = ["tight", "normal", "wide"] as const;

export type NavStyle = (typeof NAV_STYLES)[number];
export type HeroStyle = (typeof HERO_STYLES)[number];
export type Surface = (typeof SURFACES)[number];
export type HeadingScale = (typeof HEADING_SCALES)[number];
export type HeadingWeight = (typeof HEADING_WEIGHTS)[number];
export type HeadingTracking = (typeof HEADING_TRACKINGS)[number];

/**
 * Every trait in one table: the field, the class prefix hub.css uses, and the values.
 *
 * One table so the vision prompt, readSkin()'s gate, the class writer and the probe that checks
 * hub.css has a rule for every value cannot disagree about what exists.
 */
export const SKIN_TRAITS = [
  { field: "nav", prefix: "hub-nav", values: NAV_STYLES },
  { field: "hero", prefix: "hub-hero", values: HERO_STYLES },
  { field: "surface", prefix: "hub-surface", values: SURFACES },
  { field: "headingScale", prefix: "hub-hs", values: HEADING_SCALES },
  { field: "headingWeight", prefix: "hub-hw", values: HEADING_WEIGHTS },
  { field: "headingTracking", prefix: "hub-ht", values: HEADING_TRACKINGS },
] as const;

export type SkinTraitField = (typeof SKIN_TRAITS)[number]["field"];

/** A value from the list, or null. Refused, never matched: "centre" is not "centered" here. */
export function oneOf<T extends string>(values: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The object
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visual, and only the parts of visual that theme.ts does not already own.
 *
 * Every colour here is a GROUND colour: what the page sits on, what text that is not the
 * headline is set in, what a rule looks like. The accent is not here. Neither is the body
 * font, which is the client's. `headingFamily` IS here, because "our headings are a serif in
 * this template" is a format decision and not a brand one.
 */
export interface HubSkin {
  template: HubTemplate;
  bg: string | null;
  fg: string | null;
  muted: string | null;
  faint: string | null;
  rule: string | null;
  /** The surface a card sits on, where a template uses cards. */
  card: string | null;
  /** The header band, where a template has one. */
  band: string | null;
  bandFg: string | null;
  /** Legacy free-text stack. A headingFace, when set, wins over it. */
  headingFamily: string | null;
  /** The h1's face, by key. See faces.ts: a model supplies the key, never the stack. */
  headingFace: HubFace | null;
  /** h2 and h3. Null means "the same as the heading", which hub.css declares as the default. */
  subheadingFace: HubFace | null;
  /** The eyebrow, the NAP labels and the footer line. Where a mono or small-caps label lives. */
  labelFace: HubFace | null;
  /** Shape words. Each is a class hub.css has a rule for, or null. See SKIN_TRAITS. */
  nav: NavStyle | null;
  hero: HeroStyle | null;
  surface: Surface | null;
  headingScale: HeadingScale | null;
  headingWeight: HeadingWeight | null;
  headingTracking: HeadingTracking | null;
  /** px. Corner radius for cards, inputs and buttons across the hub AND the review tool. */
  radius: number | null;
  /** rem. The measure: how wide the column is allowed to get. */
  measure: number | null;
  /** px. Body size. The whole type scale is relative to it. */
  baseSize: number | null;
}

export interface StoredSkin extends HubSkin {
  /**
   * How this skin got here. `default` means nobody has chosen, `template` means somebody
   * named one in Slack or the dashboard, `screenshot` means a model read a reference image.
   *
   * Kept because a colour that turns out wrong is a colour somebody has to trace, and "a
   * model read it off a picture" and "a person typed it" fail in completely different ways.
   */
  source: "default" | "template" | "screenshot";
  /** Free text for the card only: which reference, read by whom. Never rendered on a page. */
  sourceNote: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const EMPTY_SKIN: StoredSkin = {
  template: DEFAULT_TEMPLATE,
  bg: null,
  fg: null,
  muted: null,
  faint: null,
  rule: null,
  card: null,
  band: null,
  bandFg: null,
  headingFamily: null,
  headingFace: null,
  subheadingFace: null,
  labelFace: null,
  nav: null,
  hero: null,
  surface: null,
  headingScale: null,
  headingWeight: null,
  headingTracking: null,
  radius: null,
  measure: null,
  baseSize: null,
  source: "default",
  sourceNote: null,
  updatedAt: null,
  updatedBy: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation. Gates, not transforms.
// ─────────────────────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hex only, for the same reason safeColor() in theme.ts is hex only: parens open a door. */
export function safeSkinColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

/**
 * A number inside a range, or null.
 *
 * ‼️ IT REFUSES OUT-OF-RANGE RATHER THAN CLAMPING. A model that returns `measure: 200` has
 * misunderstood the unit, and clamping to 64 would hide that behind a page that looks merely
 * a bit wide. Dropping it renders the template's own value, which is correct, and leaves the
 * field visibly empty on the board where somebody can see the model got it wrong.
 */
export function safeNumber(input: unknown, min: number, max: number): number | null {
  const n = typeof input === "number" ? input : typeof input === "string" ? Number(input) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 100) / 100;
  return r >= min && r <= max ? r : null;
}

export const RADIUS_RANGE: readonly [number, number] = [0, 28];
export const MEASURE_RANGE: readonly [number, number] = [30, 64];
export const BASE_SIZE_RANGE: readonly [number, number] = [15, 20];

/** Read whatever is in the jsonb column and return something a renderer can trust. */
export function readSkin(raw: unknown): StoredSkin {
  if (!raw || typeof raw !== "object") return EMPTY_SKIN;
  const s = raw as Record<string, unknown>;
  const source = s.source;

  return {
    // ‼️ An unknown template becomes the default, never a class name we do not ship.
    // `hub-tpl-${x}` with an unvalidated x is a class attribute somebody else gets to choose.
    template: isTemplate(s.template) ? s.template : DEFAULT_TEMPLATE,
    bg: safeSkinColor(s.bg),
    fg: safeSkinColor(s.fg),
    muted: safeSkinColor(s.muted),
    faint: safeSkinColor(s.faint),
    rule: safeSkinColor(s.rule),
    card: safeSkinColor(s.card),
    band: safeSkinColor(s.band),
    bandFg: safeSkinColor(s.bandFg),
    headingFamily: safeFontFamily(s.headingFamily),
    // A face is a key or nothing. An unknown name is refused rather than matched to a nearby one,
    // for the reason safeNumber gives: a repaired value hides that the reader got it wrong.
    headingFace: safeFace(s.headingFace),
    subheadingFace: safeFace(s.subheadingFace),
    labelFace: safeFace(s.labelFace),
    // ‼️ A CLASS NAME SOMEBODY ELSE WOULD GET TO CHOOSE, if these were not gated: each becomes
    // `hub-<trait>-<value>` in a class attribute. Same reason the template is gated above.
    nav: oneOf(NAV_STYLES, s.nav),
    hero: oneOf(HERO_STYLES, s.hero),
    surface: oneOf(SURFACES, s.surface),
    headingScale: oneOf(HEADING_SCALES, s.headingScale),
    headingWeight: oneOf(HEADING_WEIGHTS, s.headingWeight),
    headingTracking: oneOf(HEADING_TRACKINGS, s.headingTracking),
    radius: safeNumber(s.radius, RADIUS_RANGE[0], RADIUS_RANGE[1]),
    measure: safeNumber(s.measure, MEASURE_RANGE[0], MEASURE_RANGE[1]),
    baseSize: safeNumber(s.baseSize, BASE_SIZE_RANGE[0], BASE_SIZE_RANGE[1]),
    source:
      source === "template" || source === "screenshot" || source === "default"
        ? source
        : "default",
    sourceNote: typeof s.sourceNote === "string" ? s.sourceNote.slice(0, 300) : null,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : null,
    updatedBy: typeof s.updatedBy === "string" ? s.updatedBy : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The class that selects the template's rules in hub.css.
 *
 * Always returns a class, including for `document`, so the live page and both previews carry
 * the same attribute and a difference between them is a real difference rather than a class
 * one renderer forgot to add.
 */
export function skinClass(skin: StoredSkin | null): string {
  return `hub-tpl-${skin?.template ?? DEFAULT_TEMPLATE}`;
}

/**
 * The trait classes, from values re-checked against the table here, so a class is always one
 * hub.css has a rule for even if a caller hands over an object that skipped readSkin().
 *
 * Separate from skinClass() on purpose: that function's exact output is asserted by
 * _probe-hub-skin.ts, and a template and a trait are different kinds of thing.
 */
export function skinTraits(skin: StoredSkin | null): string {
  if (!skin) return "";
  const out: string[] = [];
  for (const t of SKIN_TRAITS) {
    const v = oneOf(t.values as readonly string[], skin[t.field]);
    if (v) out.push(`${t.prefix}-${v}`);
  }
  return out.join(" ");
}

/**
 * .hub-root's whole class attribute, written once for all five renderers.
 *
 * ‼️ ONE FUNCTION BECAUSE FIVE HAND-WRITTEN CLASS STRINGS IS HOW A PREVIEW STARTS LYING. The live
 * layout, both previews and the standalone preview file each spelled `hub-root ${skinClass(...)}`
 * themselves; a trait added to four of them would render on a call and not on the client's domain.
 */
export function hubRootClass(skin: StoredSkin | null): string {
  return ["hub-root", skinClass(skin), skinTraits(skin)].filter(Boolean).join(" ");
}

const TRAIT_WORDS: Record<SkinTraitField, Record<string, string>> = {
  nav: { inline: "navigation as plain links", pill: "labels and links as pills", band: "navigation in a band" },
  hero: { left: "masthead left-aligned", centered: "masthead centred", split: "masthead split in two" },
  surface: {
    flat: "a flat ground",
    glow: "a soft glow behind the top",
    gradient: "a gradient ground",
    dots: "a dot-grid ground",
    grid: "a line-grid ground",
    noise: "a grain texture",
  },
  headingScale: { compact: "compact headlines", standard: "standard-size headlines", display: "display-size headlines" },
  headingWeight: {
    regular: "regular weight",
    medium: "medium weight",
    semibold: "semibold weight",
    bold: "bold weight",
    heavy: "heavy weight",
  },
  headingTracking: { tight: "tight tracking", normal: "normal tracking", wide: "wide tracking" },
};

/** The traits in words, for a card. Only set values, in table order. */
export function traitWords(skin: StoredSkin): string[] {
  const out: string[] = [];
  for (const t of SKIN_TRAITS) {
    const v = oneOf(t.values as readonly string[], skin[t.field]);
    if (v) out.push(TRAIT_WORDS[t.field][v]);
  }
  return out;
}

/**
 * The custom-property overrides for .hub-root.
 *
 * ‼️ IT MUST BE SPREAD BEFORE themeStyle(), NOT AFTER. The two write disjoint variables
 * today, so order is invisible — but the day somebody adds an accent here, the CLIENT's brand
 * has to win over a colour read off a reference image, and the only thing that will make that
 * true is that themeStyle() is applied second. Every renderer spreads them in that order.
 */
export function skinStyle(skin: StoredSkin | null): React.CSSProperties {
  if (!skin) return {};
  const style: Record<string, string> = {};
  if (skin.bg) style["--hub-bg"] = skin.bg;
  if (skin.fg) style["--hub-fg"] = skin.fg;
  if (skin.muted) style["--hub-muted"] = skin.muted;
  if (skin.faint) style["--hub-faint"] = skin.faint;
  if (skin.rule) style["--hub-rule"] = skin.rule;
  if (skin.card) style["--hub-card"] = skin.card;
  if (skin.band) style["--hub-band"] = skin.band;
  if (skin.bandFg) style["--hub-band-fg"] = skin.bandFg;
  // The stacks come from faces.ts, keyed by a validated face. Nothing a model wrote is in them.
  const heading = faceStack(skin.headingFace) ?? skin.headingFamily;
  if (heading) style["--hub-heading-family"] = heading;
  const subheading = faceStack(skin.subheadingFace);
  if (subheading) style["--hub-subheading-family"] = subheading;
  const label = faceStack(skin.labelFace);
  if (label) style["--hub-label-family"] = label;
  if (skin.radius !== null) style["--hub-radius"] = `${skin.radius}px`;
  if (skin.measure !== null) style["--hub-measure"] = `${skin.measure}rem`;
  if (skin.baseSize !== null) style["--hub-base"] = `${skin.baseSize}px`;
  return style as React.CSSProperties;
}

/**
 * The skin a LIVE page may use.
 *
 * Gated on the same confirmation the theme is gated on, because they are one decision: "the
 * look is signed off". A skin chosen in a thread and never confirmed renders as the default
 * template on the client's own domain, which is the same promise activeTheme() already makes
 * about a scraped colour.
 */
export function activeSkin(stored: StoredSkin, confirmedAt: string | null): StoredSkin | null {
  return confirmedAt ? stored : null;
}

/** Which fields are actually overridden, in words, for a card that has to say. */
export function skinOverrides(skin: StoredSkin): string[] {
  const out: string[] = [];
  if (skin.bg || skin.fg || skin.card || skin.band) out.push("colours");
  if (skin.rule || skin.muted || skin.faint) out.push("greys");
  if (skin.headingFamily || skin.headingFace || skin.subheadingFace || skin.labelFace) {
    out.push("fonts");
  }
  if (skin.hero) out.push("masthead");
  if (skin.nav) out.push("navigation");
  if (skin.surface) out.push("background");
  if (skin.headingScale || skin.headingWeight || skin.headingTracking) out.push("headline type");
  if (skin.radius !== null) out.push("corners");
  if (skin.measure !== null) out.push("width");
  if (skin.baseSize !== null) out.push("text size");
  return out;
}

/** The one sentence every card uses to describe a skin, so the wording cannot drift. */
export function skinLine(skin: StoredSkin): string {
  const info = templateInfo(skin.template);
  const over = skinOverrides(skin);
  const tail =
    skin.source === "screenshot"
      ? ` Tuned from a reference image${skin.sourceNote ? ` (${skin.sourceNote})` : ""}.`
      : over.length
        ? ` Adjusted: ${over.join(", ")}.`
        : "";
  return `*Template:* ${info.name}. ${info.blurb}${tail}`;
}

/** The four templates as one Slack block, so the list is written once. */
export function templateMenu(): string {
  return TEMPLATE_CATALOGUE.map((t) => `  • \`template ${t.key}\` — *${t.name}*: ${t.blurb}`).join(
    "\n"
  );
}
