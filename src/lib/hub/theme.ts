// The client's visual theme for the hub and the review tool.
//
// Runner v3 5f and 5g: "THEMED, but only visually. The review tool takes the same theme
// object as the hub — logo, palette, fonts — so it reads as the clinic's page and not an
// agency page. The COPY, the four questions, the flow, the bullet labels, the destination
// links and every rule in the build spec are IDENTICAL for every clinic and are not
// themable. Visual theme per client; wording and structure never."
//
// ‼️ THAT RULE IS ENFORCED BY THE TYPE, NOT BY A COMMENT. HubTheme has four fields and not
// one of them is text. There is no headline, no intro, no button label, no destination. A
// future "just let this one clinic reword the first question" has nowhere to put it without
// a migration and a review, which is exactly the amount of friction that decision deserves.
//
// ‼️ EVERY VALUE IS INJECTED INTO A STYLE ATTRIBUTE, SO EVERY VALUE IS VALIDATED HARD.
// These strings are scraped from a third party's homepage. A colour of
// `red; } .hub-root { display: none } .x {` would break out of the declaration it lands in.
// So: hex colours only, a tight character class for font stacks, and http(s) URLs only.
// Anything that does not match is DROPPED, never "cleaned up and used anyway".

/**
 * Visual only. Four fields. No text.
 *
 * `accent` maps to --hub-accent (links, rules, the review tool's button) and `accentSoft`
 * to --hub-accent-soft. Background and foreground are deliberately NOT themable: the hub is
 * a light document meant to be read and quoted, and a client-chosen background is how it
 * becomes unreadable on somebody's phone.
 */
export interface HubTheme {
  logoUrl: string | null;
  accent: string | null;
  accentSoft: string | null;
  fontFamily: string | null;
}

export interface StoredTheme extends HubTheme {
  /** Where the extraction read from, so a wrong colour is traceable to a page. */
  extractedFrom: string | null;
  extractedAt: string | null;
  /** 5f: "Theme confirmed by me in the dashboard before the preview is shown." */
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export const EMPTY_THEME: StoredTheme = {
  logoUrl: null,
  accent: null,
  accentSoft: null,
  fontFamily: null,
  extractedFrom: null,
  extractedAt: null,
  confirmedAt: null,
  confirmedBy: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation. Everything below is a gate, not a transform.
// ─────────────────────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hex only. Named colours, rgb(), hsl() and var() are all rejected: the first two are
 *  fine in principle but the parens open a door this does not need to open. */
export function safeColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  return HEX.test(v) ? v.toLowerCase() : null;
}

/** Letters, digits, spaces, hyphens, commas, dots and quotes. No braces, semicolons,
 *  parens, backslashes or url(). Capped, because a style attribute is not a stylesheet. */
export function safeFontFamily(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().replace(/\s+/g, " ");
  if (!v || v.length > 120) return null;
  if (!/^[A-Za-z0-9 ,.'"_-]+$/.test(v)) return null;
  return v;
}

/**
 * http(s) only, absolute, resolved against the client's site when relative.
 *
 * NOT data: — a data URI logo would be megabytes of base64 in a jsonb column and on every
 * page render. NOT javascript:, obviously. The logo stays hosted on the client's own site,
 * which is also the honest place for it: if they change their logo, the hub follows.
 */
export function safeUrl(input: unknown, base?: string | null): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v) return null;
  try {
    const u = base ? new URL(v, base) : new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Read whatever is in the jsonb column and return something the renderer can trust. */
export function readTheme(raw: unknown): StoredTheme {
  if (!raw || typeof raw !== "object") return EMPTY_THEME;
  const t = raw as Record<string, unknown>;
  return {
    logoUrl: safeUrl(t.logoUrl),
    accent: safeColor(t.accent),
    accentSoft: safeColor(t.accentSoft),
    fontFamily: safeFontFamily(t.fontFamily),
    extractedFrom: typeof t.extractedFrom === "string" ? t.extractedFrom : null,
    extractedAt: typeof t.extractedAt === "string" ? t.extractedAt : null,
    confirmedAt: typeof t.confirmedAt === "string" ? t.confirmedAt : null,
    confirmedBy: typeof t.confirmedBy === "string" ? t.confirmedBy : null,
  };
}

/**
 * The theme the PAGE is allowed to use.
 *
 * 5f says the theme is confirmed by a human before the client is shown anything. So an
 * extracted-but-unconfirmed theme renders as the default: a scraped colour that turns out
 * to be a cookie banner's brand red is a thing to look at on the board, never a thing a
 * client discovers on a call.
 */
export function activeTheme(stored: StoredTheme): HubTheme | null {
  if (!stored.confirmedAt) return null;
  const { logoUrl, accent, accentSoft, fontFamily } = stored;
  if (!logoUrl && !accent && !accentSoft && !fontFamily) return null;
  return { logoUrl, accent, accentSoft, fontFamily };
}

/**
 * The custom-property overrides for the .hub-root element.
 *
 * hub.css already declares --hub-accent and friends on .hub-root, so theming is an
 * override of four variables rather than a second stylesheet. Returns {} for no theme,
 * which is the same object shape, so the caller never branches on it.
 */
export function themeStyle(theme: HubTheme | null): React.CSSProperties {
  if (!theme) return {};
  const style: Record<string, string> = {};
  if (theme.accent) style["--hub-accent"] = theme.accent;
  if (theme.accentSoft) style["--hub-accent-soft"] = theme.accentSoft;
  if (theme.fontFamily) style["fontFamily"] = theme.fontFamily;
  return style as React.CSSProperties;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction. A PURE function over homepage HTML.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull a plausible logo, accent colour and font stack out of a homepage.
 *
 * Pure, over HTML that site-research.ts already fetched — the same shape as
 * site-signals.ts, and for the same reason: no extra request, nothing here can fail
 * anything, and a value we cannot compute is simply absent.
 *
 * NO GUESSING. Every field comes from markup that literally states it. There is no
 * "dominant colour" pass and no image sampling, because a wrong brand colour presented as
 * extracted is worse than an empty field somebody fills in: the empty field gets noticed.
 */
export function extractThemeFromHtml(
  html: string,
  siteUrl: string
): Pick<HubTheme, "logoUrl" | "accent" | "fontFamily"> {
  return {
    logoUrl: findLogo(html, siteUrl),
    accent: findAccent(html),
    fontFamily: findFont(html),
  };
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m?.[1]?.trim() || null;
}

function tags(html: string, tagName: string): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}

/**
 * Preference order is deliberate and is about what a LOGO actually is:
 *   1. an <img> the site itself calls a logo — the real mark, usually transparent
 *   2. apple-touch-icon — square, high resolution, almost always the mark
 *   3. og:image — often a photo of the building or a hero shot, so it is last
 * A favicon is not in the list: 32px upscaled into a page header looks broken.
 */
function findLogo(html: string, siteUrl: string): string | null {
  for (const tag of tags(html, "img")) {
    const hay = `${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "src") ?? ""}`;
    if (/logo|brand|wordmark/i.test(hay)) {
      const src = safeUrl(attr(tag, "src"), siteUrl);
      if (src) return src;
    }
  }

  for (const tag of tags(html, "link")) {
    if (/apple-touch-icon/i.test(attr(tag, "rel") ?? "")) {
      const href = safeUrl(attr(tag, "href"), siteUrl);
      if (href) return href;
    }
  }

  for (const tag of tags(html, "meta")) {
    if ((attr(tag, "property") ?? attr(tag, "name")) === "og:image") {
      const c = safeUrl(attr(tag, "content"), siteUrl);
      if (c) return c;
    }
  }

  return null;
}

/**
 * <meta name="theme-color"> first — it is the one place a site STATES a brand colour
 * rather than merely using one. Then a CSS custom property whose name says brand or
 * accent, which is how most modern themes declare it.
 */
function findAccent(html: string): string | null {
  for (const tag of tags(html, "meta")) {
    if ((attr(tag, "name") ?? "").toLowerCase() === "theme-color") {
      const c = safeColor(attr(tag, "content"));
      if (c) return c;
    }
  }

  const varMatch = html.match(
    /--(?:[a-z0-9-]*(?:brand|primary|accent)[a-z0-9-]*)\s*:\s*(#[0-9a-fA-F]{3,6})\s*[;}]/
  );
  return safeColor(varMatch?.[1]);
}

/** A Google Fonts family, or a CSS font-family declaration. Name only; nothing loads a
 *  webfont on the client's behalf, so it renders only if the visitor already has it or it
 *  falls through the stack. Loading a third-party font from the hub would be a request to
 *  Google on a page whose whole point is being cheap and fast to crawl. */
function findFont(html: string): string | null {
  for (const tag of tags(html, "link")) {
    const href = attr(tag, "href") ?? "";
    if (/fonts\.googleapis\.com/i.test(href)) {
      const fam = href.match(/family=([^&:;]+)/)?.[1];
      if (fam) {
        const name = safeFontFamily(decodeURIComponent(fam).replace(/\+/g, " "));
        if (name) return `"${name}", ui-sans-serif, system-ui, sans-serif`;
      }
    }
  }

  const decl = html.match(/font-family\s*:\s*([^;}"']{3,110})[;}]/i)?.[1];
  const safe = safeFontFamily(decl);
  return safe ? `${safe}, ui-sans-serif, system-ui, sans-serif` : null;
}
