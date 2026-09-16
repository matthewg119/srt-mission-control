// The links between hub pages, computed from the page plan. Pure: no database, no Next, no React.
//
// ‼️ THE LINKS COME FROM THE TEMPLATE, NEVER FROM THE BODY. draft-page.ts bans links inside
// answer_md on purpose (a model inventing a citation as a link) and that ban stays. The plan
// already says which page is the pillar and which supports hang off it, so the template can draw
// every link a crawler needs without a single one being typed into a page.
//
// ‼️ URLS STAY FLAT. HUB_SLUG in src/middleware.ts forbids a slash, which is a security rule on a
// hostname the client's DNS controls, so hierarchy is links and BreadcrumbList, never nested paths.
//
// ‼️ ONLY PUBLISHED PAGES ARE EVER RETURNED. A link to a draft is a 404 on a live client domain,
// which is a broken link a crawler records against the client, so a plan row whose page is not in
// `publishedPages` does not exist as far as this file is concerned.

export type PlanLinkRole = "pillar" | "support";

/** One page_plan row, reduced to the columns the links need. */
export interface PlanLinkRow {
  planId: string;
  pageId: string | null;
  role: PlanLinkRole | null;
  /** Which pillar a support belongs to, by page_plan.id. A client may have more than one pillar. */
  pillarId: string | null;
  theme: string | null;
  workingTitle: string;
  rank: number;
}

/** A page that is live on the hub. Anything not in this list is never linked. */
export interface PublishedPageRef {
  id: string;
  slug: string;
  title: string;
}

export interface HubLink {
  slug: string;
  title: string;
}

export interface PlanLinks {
  /** A support's pillar, when that pillar is published. */
  pillar: HubLink | null;
  /** A pillar's published supports, in rank order, anchored on their working titles. */
  supports: HubLink[];
  /** A support's published siblings under the same pillar. */
  related: HubLink[];
  isPillar: boolean;
}

export const NO_PLAN_LINKS: PlanLinks = { pillar: null, supports: [], related: [], isPillar: false };

/** How many siblings a support links at the bottom. Two, per Workstream C. */
export const RELATED_COUNT = 2;

/**
 * The plan row that describes a page, when it has a role.
 *
 * Lowest rank wins when two rows point at the same page (a re-plan that kept the page), which is
 * the row the plan itself would list first.
 */
function rowForPage(pageId: string, rows: PlanLinkRow[]): PlanLinkRow | null {
  return (
    rows
      .filter((r) => r.pageId === pageId && r.role !== null)
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  );
}

function sameTheme(a: string | null, b: string | null): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

/**
 * The published supports under one pillar row, deduped by page, each paired with its row.
 * `excludePageId` keeps a support out of its own related list.
 */
function publishedSupports(
  pillarPlanId: string,
  rows: PlanLinkRow[],
  byId: Map<string, PublishedPageRef>,
  excludePageId: string | null
): Array<{ row: PlanLinkRow; page: PublishedPageRef }> {
  const seen = new Set<string>();
  const out: Array<{ row: PlanLinkRow; page: PublishedPageRef }> = [];
  for (const row of [...rows].sort((a, b) => a.rank - b.rank)) {
    if (row.role !== "support" || row.pillarId !== pillarPlanId || !row.pageId) continue;
    if (row.pageId === excludePageId || seen.has(row.pageId)) continue;
    const page = byId.get(row.pageId);
    if (!page) continue;
    seen.add(row.pageId);
    out.push({ row, page });
  }
  return out;
}

/** The working title is the anchor text: it was written to carry the keyword. */
function anchorFor(row: PlanLinkRow, page: PublishedPageRef): HubLink {
  return { slug: page.slug, title: row.workingTitle.trim() || page.title };
}

/**
 * Every link one page carries.
 *
 * Pillar: every published support under it. Support: its pillar if published, and the
 * RELATED_COUNT nearest published siblings, same theme first, then nearest by rank. A page not on
 * the plan, or on it without a role (a studio row from before roles existed), carries nothing.
 */
export function planLinksFor(
  pageId: string,
  planRows: PlanLinkRow[],
  publishedPages: PublishedPageRef[]
): PlanLinks {
  const byId = new Map(publishedPages.map((p) => [p.id, p]));
  const row = rowForPage(pageId, planRows);
  if (!row) return NO_PLAN_LINKS;

  if (row.role === "pillar") {
    return {
      ...NO_PLAN_LINKS,
      isPillar: true,
      supports: publishedSupports(row.planId, planRows, byId, pageId).map((s) => anchorFor(s.row, s.page)),
    };
  }

  // A support with no pillar_id has no family: no pillar to point at and no siblings to share.
  if (!row.pillarId) return NO_PLAN_LINKS;

  const pillarRow = planRows.find((r) => r.planId === row.pillarId && r.role === "pillar") ?? null;
  const pillarPage = pillarRow?.pageId ? byId.get(pillarRow.pageId) ?? null : null;

  const related = publishedSupports(row.pillarId, planRows, byId, pageId)
    .sort((a, b) => {
      const ta = sameTheme(a.row.theme, row.theme) ? 0 : 1;
      const tb = sameTheme(b.row.theme, row.theme) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      const da = Math.abs(a.row.rank - row.rank);
      const db = Math.abs(b.row.rank - row.rank);
      return da !== db ? da - db : a.row.rank - b.row.rank;
    })
    .slice(0, RELATED_COUNT)
    .map((s) => anchorFor(s.row, s.page));

  return {
    pillar: pillarPage ? { slug: pillarPage.slug, title: pillarPage.title } : null,
    supports: [],
    related,
    isPillar: false,
  };
}

/**
 * The hub index, pillar first.
 *
 * Pillars lead in plan rank order; every other page keeps the order it arrived in (newest first,
 * from listPublished). Nothing is dropped and nothing is added: this only reorders what the
 * caller already decided to show.
 */
export function orderIndexPages<T extends { id: string }>(pages: T[], planRows: PlanLinkRow[]): T[] {
  const pillarRank = new Map<string, number>();
  for (const r of planRows) {
    if (r.role !== "pillar" || !r.pageId) continue;
    const prev = pillarRank.get(r.pageId);
    if (prev === undefined || r.rank < prev) pillarRank.set(r.pageId, r.rank);
  }
  if (pillarRank.size === 0) return pages;

  const pillars = pages
    .filter((p) => pillarRank.has(p.id))
    .sort((a, b) => (pillarRank.get(a.id) ?? 0) - (pillarRank.get(b.id) ?? 0));
  return [...pillars, ...pages.filter((p) => !pillarRank.has(p.id))];
}
