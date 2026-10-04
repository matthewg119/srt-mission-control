// What this person did to their own sidebar: what is hidden, and in what order.
//
// ‼️ localStorage, NOT A TABLE, AND THAT IS THE RIGHT TRADE HERE.
// This is a per-viewer convenience exactly like a remembered filter: it affects nothing anybody
// else sees, nothing the server decides, and nothing that has to be read back weeks later. A table
// would cost a migration, a row per user, and a column every reader has to justify to the
// dead-wires probe, in exchange for carrying a nav order between browsers. Say so out loud rather
// than letting the next person assume it was an oversight.
//
// ‼️ EVERY READ AND WRITE IS WRAPPED. A private window, cleared site data, or a browser set to
// block storage makes the accessor itself throw, and a sidebar that fails to render because
// somebody blocked cookies is far worse than a sidebar in its default order.
//
// ‼️ KEYED BY href, NOT BY LABEL OR INDEX. A label is copy and gets reworded; an index shifts the
// moment a nav item is added above it, which would silently reorder somebody's sidebar. An href is
// the one stable identity a nav item has.

const KEY = "srt.nav.v1";

export interface NavPrefs {
  /** hrefs the person has switched off. */
  hidden: string[];
  /** Per section label, the hrefs in the order they chose. Partial: unlisted items keep their place. */
  order: Record<string, string[]>;
}

export const EMPTY_PREFS: NavPrefs = { hidden: [], order: {} };

export function readNavPrefs(): NavPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_PREFS;
    const v = JSON.parse(raw) as Partial<NavPrefs>;
    return {
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((h) => typeof h === "string") : [],
      order:
        v.order && typeof v.order === "object"
          ? Object.fromEntries(
              Object.entries(v.order).filter(
                ([, list]) => Array.isArray(list) && list.every((h) => typeof h === "string")
              ) as [string, string[]][]
            )
          : {},
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function writeNavPrefs(prefs: NavPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage is full or blocked. The sidebar keeps working on whatever is in memory.
  }
}

export function clearNavPrefs(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* see writeNavPrefs */
  }
}

/**
 * Apply a stored order to one section's items.
 *
 * ‼️ AN ITEM THE STORED ORDER HAS NEVER SEEN KEEPS ITS DEFAULT POSITION rather than being appended.
 * A nav item added next month would otherwise land at the bottom of the section for everybody who
 * has ever opened the customise panel, which is how a new feature ships invisible to exactly the
 * people who use the product most.
 */
export function applyOrder<T extends { href: string }>(items: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return [...items];
  const rank = new Map(order.map((href, i) => [href, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.href);
    const rb = rank.get(b.href);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    // A known item sorts before an unknown one only if it was ranked above where the unknown sits,
    // which is unknowable, so unknowns hold their relative order and fall after ranked ones.
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });
}
