// The plan map: the pillar in the middle, its supports around it, the links between them, and the
// one free offer every page leads to. Built to be screen-shared on the call.
//
// ‼️ INTERNAL, LIKE THE PREVIEW. It names drafts and their unsourced claims, which is a working view
// for us. The client sees it on our screen. See src/lib/clients/plan-map.ts for where every value
// comes from; nothing here is computed that the pages themselves do not do.

import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { stepNumber } from "@/config/delivery-steps";
import {
  MAP,
  layoutPlanMap,
  planMapData,
  relatedPairs,
  wrapLabel,
  type MapNode,
  type MapStatus,
} from "@/lib/clients/plan-map";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STATUS: Record<MapStatus, { label: string; stroke: string }> = {
  proposed: { label: "Proposed", stroke: "rgba(255,255,255,0.28)" },
  approved: { label: "Approved, not drafted", stroke: "#F5A623" },
  drafted: { label: "Drafted", stroke: "#5AC8FA" },
  published: { label: "Live", stroke: "#34C759" },
};

const FONT = "ui-sans-serif, system-ui, -apple-system, sans-serif";

export default async function PlanMapPage({ params }: { params: { id: string } }) {
  const session = await auth().catch(() => null);
  if (!session?.user) notFound();

  const data = await planMapData(params.id);
  const boardHref = `/dashboard/clients/${params.id}`;

  if ("error" in data) {
    return (
      <Shell boardHref={boardHref} title="Plan map">
        <p className="text-sm text-[#F5A623]">{data.error}</p>
      </Shell>
    );
  }

  const pillar = data.nodes.find((n) => n.role === "pillar") ?? null;
  const supports = data.nodes
    .filter((n) => n.role === "support" && (!pillar || n.pillarId === pillar.planId))
    .sort((a, b) => a.rank - b.rank);
  const offer = data.treatment ?? "the offer";

  if (!pillar) {
    return (
      <Shell boardHref={boardHref} title={`${data.clientName}: plan map`}>
        <p className="text-sm text-[rgba(255,255,255,0.6)]">
          There is no plan yet. It is proposed at step {stepNumber("pre_call_pages")}, from the keywords
          approved at step {stepNumber("keyword_set")}, once the offer is locked at step{" "}
          {stepNumber("offer_locked")}.
        </p>
      </Shell>
    );
  }

  const positions = layoutPlanMap(supports.length);
  const at = new Map<string, { x: number; y: number }>([[pillar.planId, { x: MAP.CX, y: MAP.CY }]]);
  supports.forEach((s, i) => at.set(s.planId, positions[i]));
  const byId = new Map(data.nodes.map((n) => [n.planId, n]));
  const pairs = relatedPairs([pillar, ...supports]);
  const previewHref = (slug: string) => `/dashboard/clients/${params.id}/preview/${slug}`;
  const bothLive = (a: MapNode, b: MapNode) => a.status === "published" && b.status === "published";

  return (
    <Shell boardHref={boardHref} title={`${data.clientName}: plan map`}>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgba(255,255,255,0.5)]">
        <span>
          Offer: <span className="text-white">{offer}</span>
        </span>
        {data.terms.length > 0 && <span>Their words for it: {data.terms.join(", ")}</span>}
        <span>
          Every page leads to: <span className="text-white">{data.anchorTitle ?? "no anchor offer set yet"}</span>
        </span>
        {data.keywordCounts && (
          <span>
            Chosen from {data.keywordCounts.approved} approved of {data.keywordCounts.written} ways people say it
          </span>
        )}
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#121214]">
        <svg
          viewBox={`0 0 ${MAP.W} ${MAP.H}`}
          width="100%"
          role="img"
          aria-label={`The page plan for ${data.clientName}: one pillar page and ${supports.length} supporting pages`}
          style={{ minWidth: 720, display: "block", fontFamily: FONT }}
        >
          {/* Sibling links first, underneath everything: each support points at its two nearest neighbours. */}
          {pairs.map(([a, b]) => {
            const p = at.get(a);
            const q = at.get(b);
            const na = byId.get(a);
            const nb = byId.get(b);
            if (!p || !q || !na || !nb) return null;
            const mx = (p.x + q.x) / 2;
            const my = (p.y + q.y) / 2;
            const cx = MAP.CX + (mx - MAP.CX) * 1.35;
            const cy = MAP.CY + (my - MAP.CY) * 1.35;
            const live = bothLive(na, nb);
            return (
              <path
                key={`${a}-${b}`}
                d={`M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`}
                fill="none"
                stroke={live ? "#34C759" : "rgba(245,166,35,0.45)"}
                strokeWidth={1.5}
                strokeDasharray={live ? undefined : "5 6"}
              />
            );
          })}

          {/* Pillar to support: one line, two links (the support says "part of", the pillar lists it). */}
          {supports.map((s) => {
            const p = at.get(s.planId)!;
            const live = bothLive(pillar, s);
            return (
              <line
                key={`spoke-${s.planId}`}
                x1={MAP.CX}
                y1={MAP.CY}
                x2={p.x}
                y2={p.y}
                stroke={live ? "#34C759" : "rgba(255,255,255,0.3)"}
                strokeWidth={live ? 2.5 : 2}
                strokeDasharray={live ? undefined : "8 6"}
              />
            );
          })}

          {supports.map((s) => (
            <Node key={s.planId} node={s} at={at.get(s.planId)!} href={s.slug ? previewHref(s.slug) : null} />
          ))}
          <Node node={pillar} at={{ x: MAP.CX, y: MAP.CY }} href={pillar.slug ? previewHref(pillar.slug) : null} />
        </svg>
      </div>

      <div className="mb-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[rgba(255,255,255,0.55)]">
        {(Object.keys(STATUS) as MapStatus[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: STATUS[k].stroke }} />
            {STATUS[k].label}
          </span>
        ))}
        <span>Solid line: the link is live. Dashed: it goes live when both pages are published.</span>
        <span>Click a page to open its preview.</span>
      </div>

      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <h2 className="mb-3 text-sm font-medium text-white">How this plan works</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[rgba(255,255,255,0.7)]">
          <li>
            <span className="text-white">The pillar is the foundation.</span> It is the one page about {offer}, and
            it is the page we want Google and the AI assistants to point to when somebody asks who to go to for it.
          </li>
          <li>
            <span className="text-white">Each support answers one question</span> that buyers ask on the way to
            buying: what it costs, what worries them, how it compares, how it works. Those questions are where
            people actually start, so every one of them is a way in.
          </li>
          <li>
            <span className="text-white">The links tie them together.</span> Every support links up to the pillar,
            the pillar links down to every support, and each support links across to its two nearest neighbours.
            To a search engine or an assistant, that web reads as a business that covers {offer} in depth, which is
            what earns the pillar its trust. To a reader, it is a path from their question to the pillar.
          </li>
          <li>
            <span className="text-white">Every page leads to the same next step:</span>{" "}
            {data.anchorTitle ?? "the free offer"}, worded for that page&apos;s question. Whatever question brings
            somebody in, it ends at one offer.
          </li>
        </ol>
      </div>

      <div className="mb-8 overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <h2 className="mb-3 text-sm font-medium text-white">The pages</h2>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[rgba(255,255,255,0.4)]">
            <tr>
              <th className="py-1.5 pr-3 font-normal">#</th>
              <th className="py-1.5 pr-3 font-normal">Page</th>
              <th className="py-1.5 pr-3 font-normal">Keyword</th>
              <th className="py-1.5 pr-3 font-normal">Question type</th>
              <th className="py-1.5 pr-3 font-normal">Status</th>
              <th className="py-1.5 pr-3 font-normal">Words</th>
              <th className="py-1.5 font-normal">Claims with no source</th>
            </tr>
          </thead>
          <tbody className="text-[rgba(255,255,255,0.75)]">
            {[pillar, ...supports].map((n) => (
              <tr key={n.planId} className="border-t border-[rgba(255,255,255,0.06)]">
                <td className="py-1.5 pr-3">{n.rank}</td>
                <td className="py-1.5 pr-3">
                  <span className="mr-1.5 text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.4)]">
                    {n.role}
                  </span>
                  {n.slug ? (
                    <a href={previewHref(n.slug)} className="text-white underline decoration-[rgba(255,255,255,0.3)]">
                      {n.title}
                    </a>
                  ) : (
                    <span className="text-white">{n.title}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">{n.keyword}</td>
                <td className="py-1.5 pr-3">{n.category}</td>
                <td className="py-1.5 pr-3" style={{ color: STATUS[n.status].stroke }}>
                  {STATUS[n.status].label}
                </td>
                <td className="py-1.5 pr-3">{n.words ?? ""}</td>
                <td className="py-1.5">{n.unsourced ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.studioRows > 0 && (
          <p className="mt-3 text-xs text-[rgba(255,255,255,0.4)]">
            {data.studioRows} more page{data.studioRows === 1 ? "" : "s"} planned in the page studio are not part of
            this cluster and are not drawn.
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ boardHref, title, children }: { boardHref: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl">
      <Link href={boardHref} className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
        Back to the board
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-medium text-white">{title}</h1>
      {children}
    </div>
  );
}

/** One page as a box: its role, title, keyword, question type, status and the pill it offers. */
function Node({ node, at, href }: { node: MapNode; at: { x: number; y: number }; href: string | null }) {
  const pillar = node.role === "pillar";
  const w = pillar ? MAP.PILLAR_W : MAP.NODE_W;
  const h = pillar ? MAP.PILLAR_H : MAP.NODE_H;
  const x = at.x - w / 2;
  const y = at.y - h / 2;
  const title = wrapLabel(node.title, pillar ? 30 : 26, pillar ? 3 : 2);
  const status = STATUS[node.status];

  const box = (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill={pillar ? "#1f1b12" : "#1a1a1d"}
        stroke={status.stroke}
        strokeWidth={pillar ? 3 : 2}
      />
      <text x={x + 14} y={y + 22} fontSize={11} letterSpacing={1.2} fill={pillar ? "#F5A623" : "rgba(255,255,255,0.45)"}>
        {pillar ? "PILLAR: THE OFFER PAGE" : `SUPPORT ${node.rank}`}
      </text>
      <text x={x + 14} y={y + 42} fontSize={pillar ? 16 : 14} fontWeight={600} fill="#fff">
        {title.map((line, i) => (
          <tspan key={i} x={x + 14} dy={i === 0 ? 0 : pillar ? 19 : 17}>
            {line}
          </tspan>
        ))}
      </text>
      <text x={x + 14} y={y + h - 42} fontSize={11} fill="rgba(255,255,255,0.6)">
        {wrapLabel(`"${node.keyword}"`, pillar ? 40 : 34, 1)[0]}
      </text>
      <text x={x + 14} y={y + h - 26} fontSize={11} fill="rgba(255,255,255,0.4)">
        {wrapLabel(`${node.category} · ${status.label}`, pillar ? 42 : 36, 1)[0]}
      </text>
      {node.pill && (
        <text x={x + 14} y={y + h - 10} fontSize={11} fill="#F5A623">
          {wrapLabel(`CTA: ${node.pill}`, pillar ? 42 : 36, 1)[0]}
        </text>
      )}
    </g>
  );

  return href ? (
    <a href={href}>
      <title>{`Open the preview of "${node.title}"`}</title>
      {box}
    </a>
  ) : (
    box
  );
}
