// The hub's visual shell, lifted out of the layout so a `site` host can opt out of it.
//
// ‼️ WHY THIS EXISTS. hub/[host]/layout.tsx wraps EVERY child of a hub host, and until the
// Launch Lane that was exactly right: every page under a hub hostname is one of our answer
// pages and wants our chrome. A `site` host serves two different things on one domain. Its
// answer pages want this shell. Its pasted marketing pages emphatically do not: they arrive with
// their own header, footer, grid and <style> block, and dropping them inside .hub-root and
// .hub-wrap would put our measure, our padding and our ground colour underneath a design that
// already has all three.
//
// ‼️ OPTING OUT OF THE CLASS IS ENOUGH, AND THAT IS NOT LUCK. hub.css touches the document only
// through `body:has(.hub-root)` (and the per-template variants of it), and every other selector
// in the file is a `.hub-*` or `.rev-*` class. There is not one bare element selector. So a page
// that does not render .hub-root gets no hub styling at all, and the stylesheet can stay
// imported in the layout for the pages that do want it.
//
// The markup here is byte-identical to what the layout rendered before it moved, so hub and
// reviews hosts are unchanged.

import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, hubRootClass } from "@/lib/hub/skin";
import { universeFontClass } from "@/components/hub/universe-fonts";
import { UniverseBand, UniverseTop } from "@/components/hub/universe-chrome";
import type { HubClient } from "@/lib/hub/resolve";

export function HubShell({
  client,
  children,
}: {
  client: HubClient;
  children: React.ReactNode;
}) {
  return (
    // The theme is four CSS custom properties overriding what hub.css already declares on
    // .hub-root, so a themed hub and an unthemed one are the same markup. themeStyle returns {}
    // when there is no confirmed theme.
    // ‼️ SKIN FIRST, THEME SECOND, IN THE SPREAD AND IN EVERY OTHER RENDERER.
    // They write disjoint variables today, so the order is invisible — and the day one of them
    // grows an accent, the CLIENT's brand has to beat a colour read off a reference image.
    <div
      className={`${hubRootClass(client.skin)} ${universeFontClass(client.skin?.universe)}`.trim()}
      lang={client.language}
      style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
    >
      {/* A universe's decoration, aria-hidden and outside .hub-wrap. Nothing when the skin has no universe. */}
      <UniverseTop
        universe={client.skin?.universe}
        name={client.displayName}
        where={[client.city, client.state].filter(Boolean).join(", ") || null}
        pages={-1}
      />
      <div className="hub-wrap">{children}</div>
      <UniverseBand universe={client.skin?.universe} name={client.displayName} where={null} pages={-1} />
    </div>
  );
}

/**
 * The wrapper a pasted marketing page gets: the language, and nothing else.
 *
 * ‼️ NO .hub-root, NO .hub-wrap, NO SKIN AND NO THEME, DELIBERATELY. The theme is OUR reading of
 * the client's brand, inferred from a screenshot or a homepage; a pasted page IS their brand,
 * decided by whoever designed it. Applying our inference over their decision would be a
 * colour-of-the-accent fight that our guess wins, on their own domain.
 */
export function SiteShell({ lang, children }: { lang: string; children: React.ReactNode }) {
  return <div lang={lang}>{children}</div>;
}
