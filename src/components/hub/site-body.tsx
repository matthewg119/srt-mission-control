// A pasted marketing page, rendered as the HTML it is.
//
// ‼️ dangerouslySetInnerHTML, AND THE SAFETY IS AT THE WRITE END, NOT HERE.
// sanitizeSiteHtml() in lib/hub/site-pages.ts is the single door: it runs on every write, the
// column stores what it returned, and scripts/_probe-site-sanitize.ts holds it to that. Doing it
// again at render time is the thing this codebase already argues against in page-evidence.ts's
// isFirstParty() note: a second copy of a rule is how two surfaces quietly start disagreeing,
// and the copy that runs on the hot path of every request is the one that gets loosened "just
// for this case".
//
// So the rule is: nothing may write to client_site_pages.html except storeSitePage(). If a
// second writer ever appears, it sanitises or this file becomes a hole.
//
// ‼️ NO WRAPPER, NO CLASSES, NO THEME. The pasted markup is the page. Anything added around it
// competes with a layout somebody already designed. The <div lang> from SiteShell is the whole
// of the chrome.

import type { SitePage } from "@/lib/hub/site-pages";

export function SitePageBody({
  page,
  nav,
  href = (path) => path,
  answersHref = "/answers",
}: {
  page: SitePage;
  nav: SitePage[];
  /**
   * Where a nav entry points. Defaults to the stored path, which is what a real host serves.
   *
   * ‼️ IT EXISTS FOR THE TOKEN PREVIEW AND FOR NOTHING ELSE, AND THE DEFAULT IS THE LIVE
   * BEHAVIOUR ON PURPOSE. A Launch Lane client has no hostname until a domain is bought and
   * attached, so the only way to look at their site before that is /preview/{token}, where every
   * page hangs off one path segment. Absolute hrefs like /about would leave that preview and land
   * on Mission Control's own 404. Same shape as HubIndexBody's `linkBase`, for the same reason.
   */
  href?: (path: string) => string;
  /** Where "Questions and answers" points. Defaults to /answers, which is the live URL. */
  answersHref?: string;
}) {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: page.html }} />
      {/*
        ‼️ A CRAWLABLE PATH TO EVERY OTHER PAGE, AND IT IS NOT DECORATION.
        A pasted design carries its own navigation, and that navigation was written against
        whatever URLs the page was mocked up with. If it points at /about.html or at a preview
        host, the rest of the site is published and unreachable: an answer engine that cannot
        walk to a page cannot quote it, which is the entire product. This is the fallback that
        makes the set reachable regardless of what the design's own links say.
      */}
      <nav aria-label="Site" className="srt-site-nav">
        <ul>
          {nav
            .filter((p) => p.path !== page.path)
            .map((p) => (
              <li key={p.path}>
                <a href={href(p.path)}>{p.navLabel || p.title}</a>
              </li>
            ))}
          <li>
            <a href={answersHref}>Questions and answers</a>
          </li>
        </ul>
      </nav>
    </>
  );
}
