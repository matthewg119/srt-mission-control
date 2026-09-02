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
  headingFamily: string | null;
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
  if (skin.headingFamily) style["--hub-heading-family"] = skin.headingFamily;
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
  if (skin.headingFamily) out.push("heading font");
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
