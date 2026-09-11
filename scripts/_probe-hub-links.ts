// The hub's pillar and support links, proved offline.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-hub-links.ts
//
// ‼️ NO WRITES, NO NETWORK, NO DATABASE READ. plan-links.ts is pure and breadcrumbJsonLd is a
// builder, so every check here is a function call on a fixture. The live half is a published
// pillar on a real hub, which this cannot do.
//
// WHAT IT PROVES
//  1. A pillar links only its PUBLISHED supports, in rank order, on their working titles.
//  2. A support gets its published pillar and at most 2 published siblings, same theme first.
//  3. A support whose pillar is unpublished gets no pillar link.
//  4. A page not on the plan, or on it without a role, gets nothing.
//  5. orderIndexPages puts the pillar first and keeps the rest in order.
//  6. breadcrumbJsonLd has the shape an engine reads.

import { planLinksFor, orderIndexPages, RELATED_COUNT, type PlanLinkRow, type PublishedPageRef } from "@/lib/hub/plan-links";
import { breadcrumbJsonLd } from "@/lib/hub/jsonld";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── The fixture ──────────────────────────────────────────────────────────────
//
// Pillar P with five supports: S1, S3, S4 on Price, S2 and S5 on Safety, and S4 is a draft. S6 and
// S7 hang off a SECOND pillar (Q, unpublished), which is how a client with two offers looks.
const row = (
  planId: string,
  rank: number,
  role: PlanLinkRow["role"],
  pillarId: string | null,
  theme: string | null,
  pageId: string | null
): PlanLinkRow => ({ planId, rank, role, pillarId, theme, pageId, workingTitle: `Working title ${planId}` });

const ROWS: PlanLinkRow[] = [
  row("P", 1, "pillar", null, "Offer", "page-p"),
  row("S1", 2, "support", "P", "Price", "page-s1"),
  row("S2", 3, "support", "P", "Safety", "page-s2"),
  row("S3", 4, "support", "P", "Price", "page-s3"),
  row("S4", 5, "support", "P", "Price", "page-s4"), // draft, see PUBLISHED
  row("S5", 6, "support", "P", "Safety", "page-s5"),
  row("Q", 7, "pillar", null, "Offer two", "page-q"), // unpublished pillar
  row("S6", 8, "support", "Q", "Price", "page-s6"),
  row("S7", 9, "support", "Q", "Price", "page-s7"),
  row("N", 10, null, null, "Price", "page-n"), // a studio row from before roles existed
];

const pub = (id: string): PublishedPageRef => ({ id, slug: id.replace("page-", "slug-"), title: `Title ${id}` });
const PUBLISHED: PublishedPageRef[] = ["page-p", "page-s1", "page-s2", "page-s3", "page-s5", "page-s6", "page-s7", "page-n", "page-x"].map(pub);

// ── 1. The pillar ────────────────────────────────────────────────────────────
console.log("\n1. A pillar links only its published supports");

const pillar = planLinksFor("page-p", ROWS, PUBLISHED);
check("the pillar knows it is one", pillar.isPillar);
check(
  "every published support, in rank order",
  pillar.supports.map((s) => s.slug).join(",") === "slug-s1,slug-s2,slug-s3,slug-s5",
  pillar.supports.map((s) => s.slug).join(",")
);
check("the draft support is absent", !pillar.supports.some((s) => s.slug === "slug-s4"));
check("another pillar's supports are absent", !pillar.supports.some((s) => s.slug === "slug-s6"));
check("anchor text is the working title", pillar.supports[0]?.title === "Working title S1", pillar.supports[0]?.title);
check("a pillar has no pillar and no related", pillar.pillar === null && pillar.related.length === 0);

// ── 2. A support ─────────────────────────────────────────────────────────────
console.log("\n2. A support gets its pillar and its nearest published siblings");

const s3 = planLinksFor("page-s3", ROWS, PUBLISHED);
check("S3 links its published pillar", s3.pillar?.slug === "slug-p", JSON.stringify(s3.pillar));
check("the pillar link uses the pillar page's title", s3.pillar?.title === "Title page-p");
check(`at most ${RELATED_COUNT} related`, s3.related.length === RELATED_COUNT, `got ${s3.related.length}`);
check(
  "same theme first (S1 is Price, S4 is Price but a draft), then nearest by rank (S2)",
  s3.related.map((r) => r.slug).join(",") === "slug-s1,slug-s2",
  s3.related.map((r) => r.slug).join(",")
);
check("a support never lists itself", !s3.related.some((r) => r.slug === "slug-s3"));
check("the draft sibling is never related", !s3.related.some((r) => r.slug === "slug-s4"));
check("a support is not a pillar", !s3.isPillar && s3.supports.length === 0);

const s2 = planLinksFor("page-s2", ROWS, PUBLISHED);
check(
  "S2 (Safety) takes S5 (Safety) before the nearer Price rows",
  s2.related[0]?.slug === "slug-s5",
  s2.related.map((r) => r.slug).join(",")
);
check("related never crosses to another pillar", !s2.related.some((r) => r.slug === "slug-s6" || r.slug === "slug-s7"));

// ── 3. Unpublished pillar ────────────────────────────────────────────────────
console.log("\n3. A support whose pillar is unpublished gets no pillar link");

const s6 = planLinksFor("page-s6", ROWS, PUBLISHED);
check("no pillar link to a draft pillar", s6.pillar === null, JSON.stringify(s6.pillar));
check("its published sibling is still related", s6.related.map((r) => r.slug).join(",") === "slug-s7");

// ── 4. Off the plan ──────────────────────────────────────────────────────────
console.log("\n4. A page not on the plan, or without a role, gets nothing");

const empty = (l: ReturnType<typeof planLinksFor>) =>
  l.pillar === null && l.supports.length === 0 && l.related.length === 0 && !l.isPillar;
check("a page not on the plan", empty(planLinksFor("page-x", ROWS, PUBLISHED)));
check("a plan row with no role", empty(planLinksFor("page-n", ROWS, PUBLISHED)));
check("no plan at all", empty(planLinksFor("page-p", [], PUBLISHED)));
check("no published pages at all links nothing", planLinksFor("page-s3", ROWS, []).pillar === null);

// ── 5. The index ─────────────────────────────────────────────────────────────
console.log("\n5. orderIndexPages leads with the pillar");

const indexPages = ["page-s5", "page-x", "page-p", "page-s1"].map(pub);
const ordered = orderIndexPages(indexPages, ROWS);
check("the pillar is first", ordered[0]?.id === "page-p", ordered.map((p) => p.id).join(","));
check(
  "the rest keep their order",
  ordered.slice(1).map((p) => p.id).join(",") === "page-s5,page-x,page-s1",
  ordered.map((p) => p.id).join(",")
);
check("nothing dropped or added", ordered.length === indexPages.length);
check("no plan leaves the order alone", orderIndexPages(indexPages, []).map((p) => p.id).join(",") === "page-s5,page-x,page-p,page-s1");

// ── 6. The breadcrumb ────────────────────────────────────────────────────────
console.log("\n6. breadcrumbJsonLd has the BreadcrumbList shape");

const crumbs = breadcrumbJsonLd([
  { name: "A Clinic", url: "https://learn.aclinic.com/" },
  { name: "Title page-p", url: "https://learn.aclinic.com/slug-p" },
  { name: "Title page-s3", url: "https://learn.aclinic.com/slug-s3" },
]) as { "@context": string; "@type": string; itemListElement: Array<Record<string, unknown>> };

check("@type BreadcrumbList", crumbs["@type"] === "BreadcrumbList");
check("schema.org context", crumbs["@context"] === "https://schema.org");
check("3 ListItems", crumbs.itemListElement.length === 3 && crumbs.itemListElement.every((i) => i["@type"] === "ListItem"));
check("positions 1..3", crumbs.itemListElement.map((i) => i.position).join(",") === "1,2,3");
check(
  "every item is an absolute URL",
  crumbs.itemListElement.every((i) => typeof i.item === "string" && /^https:\/\/[^/]+\//.test(i.item as string))
);
check("names carried through", crumbs.itemListElement[2]?.name === "Title page-s3");

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
