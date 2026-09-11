// The page plan as a picture: one pillar in the middle, its supports around it, the links between
// them, and what every page hands over.
//
// Matthew, 2026-09-11: "I want to be able to see like a mind map or something with the actual plan
// mapped out so we can show it visually to our clients ... this way we know X page is the
// foundation and all of X pages are built around it."
//
// ‼️ IT DRAWS THE PLAN, IT DOES NOT MAKE ONE. Everything here is read from page_plan, client_pages
// and client_keywords. The related links come from the same planLinksFor the live hub renders, so
// the map cannot show a link the pages do not have. The layout and the helpers are pure, so the
// probe proves that no two boxes overlap without a browser.

import { supabaseAdmin } from "@/lib/db";
import { planLinksFor, type PlanLinkRow } from "@/lib/hub/plan-links";

export type MapStatus = "proposed" | "approved" | "drafted" | "published";

export interface MapNode {
  planId: string;
  rank: number;
  role: "pillar" | "support";
  pillarId: string | null;
  title: string;
  keyword: string;
  category: string;
  status: MapStatus;
  slug: string | null;
  words: number | null;
  /** Claims on the draft with no source behind them. Null when there is no draft or no map. */
  unsourced: number | null;
  /** The pill: how this page words the anchor offer. */
  pill: string | null;
}

export interface PlanMapData {
  clientName: string;
  treatment: string | null;
  terms: string[];
  anchorTitle: string | null;
  nodes: MapNode[];
  /** Approved and written query counts from the keyword step, or null before it has run. */
  keywordCounts: { written: number; approved: number } | null;
  /** Plan rows from the studio that are not part of the pre-call cluster. */
  studioRows: number;
}

/** The drawing's coordinate system. The SVG scales to its container through the viewBox. */
export const MAP = {
  W: 1200,
  H: 860,
  CX: 600,
  CY: 430,
  RX: 410,
  RY: 300,
  NODE_W: 240,
  NODE_H: 132,
  PILLAR_W: 300,
  PILLAR_H: 156,
} as const;

/** The supports' centres, evenly spaced on an ellipse around the pillar, the first at the top. */
export function layoutPlanMap(count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(count, 1);
    return { x: Math.round(MAP.CX + MAP.RX * Math.cos(a)), y: Math.round(MAP.CY + MAP.RY * Math.sin(a)) };
  });
}

/** Greedy word wrap for SVG text, which does not wrap itself. The last line ends in "…" if cut. */
export function wrapLabel(text: string, width: number, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = w.length > width ? `${w.slice(0, width - 1)}…` : w;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length >= width ? `${last.slice(0, width - 1)}…` : `${last}…`;
  return kept;
}

/**
 * Which supports link to each other, as pairs of plan ids.
 *
 * ‼️ planLinksFor, NOT A COPY OF ITS RULES. Every row is handed in as though its page existed, keyed
 * by plan id, so the map shows the links the plan WILL produce. Whether each one is live yet is the
 * map's colouring, decided by the caller from the real page statuses.
 */
export function relatedPairs(nodes: readonly MapNode[]): Array<[string, string]> {
  const rows: PlanLinkRow[] = nodes.map((n) => ({
    planId: n.planId,
    pageId: n.planId,
    role: n.role,
    pillarId: n.pillarId,
    theme: n.category,
    workingTitle: n.title,
    rank: n.rank,
  }));
  const refs = nodes.map((n) => ({ id: n.planId, slug: n.planId, title: n.title }));

  const seen = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const n of nodes) {
    if (n.role !== "support") continue;
    for (const r of planLinksFor(n.planId, rows, refs).related) {
      const key = [n.planId, r.slug].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([n.planId, r.slug]);
    }
  }
  return out;
}

function words(md: string): number {
  return md.split(/\s+/).filter(Boolean).length;
}

export async function planMapData(clientId: string): Promise<PlanMapData | { error: string }> {
  const { loadPlan } = await import("./page-plan");
  const plan = await loadPlan(clientId);
  if ("error" in plan) return { error: plan.error };

  const rows = plan.rows.filter((r) => r.role);
  const pageIds = rows.map((r) => r.pageId).filter((id): id is string => Boolean(id));

  const { loadOffer } = await import("./offers");
  const { conciergeTenant } = await import("@/lib/concierge/for-client");
  const { anchorFor } = await import("@/lib/concierge/magnet-drafts");
  const { loadKeywords } = await import("./client-keywords");

  const [clientRes, pagesRes, offer, tenant, keywords] = await Promise.all([
    supabaseAdmin.from("clients").select("legal_name, dba_name").eq("id", clientId).maybeSingle(),
    pageIds.length
      ? supabaseAdmin.from("client_pages").select("id, slug, status, answer_md, evidence_map").in("id", pageIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    loadOffer(clientId),
    conciergeTenant(clientId),
    loadKeywords(clientId),
  ]);
  const anchor = tenant ? await anchorFor(clientId, tenant.audience) : null;

  const pages = new Map(
    (((pagesRes as { data?: unknown }).data ?? []) as Array<Record<string, unknown>>).map((p) => [String(p.id), p])
  );

  const nodes: MapNode[] = rows.map((r) => {
    const page = r.pageId ? pages.get(r.pageId) : undefined;
    const body = String(page?.answer_md ?? "").trim();
    const map = Array.isArray(page?.evidence_map) ? (page?.evidence_map as Array<{ sourceRef?: unknown }>) : null;
    const status: MapStatus =
      page?.status === "published"
        ? "published"
        : body
          ? "drafted"
          : r.status === "approved" || r.status === "claimed"
            ? "approved"
            : "proposed";
    return {
      planId: r.id,
      rank: r.rank,
      role: r.role === "pillar" ? "pillar" : "support",
      pillarId: r.pillarId,
      title: r.workingTitle,
      keyword: r.targetKeyword,
      category: r.theme,
      status,
      slug: page ? String(page.slug) : null,
      words: body ? words(body) : null,
      unsourced: map ? map.filter((c) => c?.sourceRef == null).length : null,
      pill: r.frame?.ctaLabel ?? null,
    };
  });

  const live = "error" in keywords ? [] : keywords.rows.filter((k) => !k.dropped && k.use === "query");
  const client = (clientRes.data ?? {}) as Record<string, unknown>;

  return {
    clientName: ((client.dba_name as string | null) || (client.legal_name as string | null)) ?? "this client",
    treatment: offer.treatment ?? offer.proposedTreatment,
    terms: offer.terms,
    anchorTitle: anchor?.title ?? null,
    nodes,
    keywordCounts: live.length ? { written: live.length, approved: live.filter((k) => k.approved).length } : null,
    studioRows: plan.rows.length - rows.length,
  };
}
