"use client";

// The traffic view. One chart, one page table, one agent table.
//
// ‼️ THE FOUR SERIES ARE NOT INTERCHANGEABLE AND THE COLOURS ARE NOT DECORATION.
// "An engine that answers people fetched this page" is what the client is paying for.
// "An AI company took a copy for a future model" is not, and neither is Googlebot, which
// was already crawling them before SRT existed. Adding those three into one headline
// number would sell a result that has not happened -- the same failure robots-check.ts
// exists to prevent on the outbound side, where blocking GPTBot is a TRAINING opt-out and
// does not remove you from today's answers.
//
// The palette is validated, not chosen by eye: OKLCH lightness band for a dark surface,
// chroma floor, protan/deutan separation and WCAG contrast against #0a0a0a all pass. Do
// not "brighten" a series -- the reef #00C9A7 used everywhere else in this app sits above
// the dark-mode lightness band and fails. Re-run the validator if these ever change.
//
// Colour follows the ENTITY, never the rank: the map is keyed by bot class, so hiding a
// series cannot repaint the survivors.

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { DayRow, PageRow, AgentRow, HubTotals } from "@/lib/hub/analytics";

type SeriesKey = "ai_answer" | "human" | "search" | "ai_training";

const SERIES: ReadonlyArray<{ key: SeriesKey; label: string; color: string }> = [
  { key: "ai_answer", label: "AI answers", color: "#00A98C" },
  { key: "human", label: "People", color: "#4A86E8" },
  { key: "search", label: "Search", color: "#D2662F" },
  { key: "ai_training", label: "AI training", color: "#9B6BD6" },
];

const INK = "rgba(255,255,255,0.3)";
const INK_2 = "rgba(255,255,255,0.5)";

function shortDay(v: string): string {
  return v.slice(5); // MM-DD
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export interface MetricsViewProps {
  daily: DayRow[];
  pages: PageRow[];
  agents: AgentRow[];
  perPageDaily: Record<string, DayRow[]>;
  totals: HubTotals;
  lastHitAt: string | null;
  days: number;
  /** Every page on the board, so a page with zero traffic still gets a row. */
  known: { slug: string; title: string; status: string }[];
  hubBase: string | null;
}

export function MetricsView(props: MetricsViewProps) {
  // The drill-down is a client-side pivot over data already on the page. No fetch, so a
  // page click is instant and cannot half-load.
  const [slug, setSlug] = useState<string | null>(null);

  const series = slug === null ? props.daily : (props.perPageDaily[slug] ?? []);
  const hasAny = props.totals.hits > 0;

  // Left merge: every known page appears, including ones nothing has ever fetched. A page
  // that was published and has never been crawled is the most useful row on this table,
  // and an inner join would delete it.
  const bySlug = new Map(props.pages.map((p) => [p.slug, p]));
  const blank = (s: string): PageRow => ({
    slug: s,
    hits: 0,
    human: 0,
    aiAnswer: 0,
    aiTraining: 0,
    search: 0,
    lastAiAnswerAt: null,
  });

  const rows: { row: PageRow; label: string; status: string }[] = [
    { row: bySlug.get("") ?? blank(""), label: "Index", status: "published" },
    ...props.known.map((k) => ({
      row: bySlug.get(k.slug) ?? blank(k.slug),
      label: k.title || k.slug,
      status: k.status,
    })),
    ...["robots.txt", "sitemap.xml", "llms.txt"].map((f) => ({
      row: bySlug.get(f) ?? blank(f),
      label: f,
      status: "generated",
    })),
  ];

  return (
    <div>
      {/* ── Stat tiles. The headline is ONE number, not eight hues. ── */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="AI answer fetches"
          value={props.totals.aiAnswer}
          accent="#00A98C"
          note="engines that cite"
        />
        <Tile label="People" value={props.totals.human} accent="#4A86E8" note="requests" />
        <Tile label="Search crawls" value={props.totals.search} accent="#D2662F" note="requests" />
        <Tile
          label="AI training"
          value={props.totals.aiTraining}
          accent="#9B6BD6"
          note="corpus, not answers"
        />
      </div>

      {/* ── The series ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">
            {slug === null ? "All pages" : `/${slug}`}
          </h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {props.days} days, UTC · last recorded {ago(props.lastHitAt)}
          </span>
        </div>

        {slug !== null && (
          <button
            type="button"
            onClick={() => setSlug(null)}
            className="mb-3 text-xs text-[#00C9A7] hover:underline"
          >
            Back to all pages
          </button>
        )}

        {hasAny ? (
          // The container is sized to include the x-axis band, so the card never grows a
          // tiny nested scrollbar to reach the date labels.
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={series} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
              {/* Solid hairline, one shade off the surface. Never dashed: dashing reads as
                  "projection" or "threshold" when it is only a grid. */}
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tick={{ fill: INK, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: INK, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#fff" }}
                // Text wears text tokens; the colour chip beside it carries identity.
                itemStyle={{ color: INK_2 }}
                cursor={{ stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 }}
                labelFormatter={(v) => `${String(v)} UTC`}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconType="plainline"
                wrapperStyle={{ fontSize: 11, color: INK_2 }}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: s.color, stroke: "#0a0a0a", strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          // Explicit empty state at the same height, and it says which of the two things
          // this is. "Nothing has arrived" and "nothing is being recorded" look identical
          // on a flat zero line, and only one of them is a finding about the client.
          <div className="flex h-[260px] flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-[rgba(255,255,255,0.3)]">No requests recorded yet.</p>
            <p className="max-w-sm text-xs text-[rgba(255,255,255,0.25)]">
              Traffic is only counted once the hub is deployed and the client host resolves.
              Nothing is backfilled, so this starts the day the DNS goes live.
            </p>
          </div>
        )}
      </div>

      {/* ── Every page, including the ones nothing has fetched ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-white">Pages</h2>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            click a row for its own series
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                <th className="pb-2 font-normal">Page</th>
                <th className="pb-2 text-right font-normal">AI answers</th>
                <th className="pb-2 text-right font-normal">People</th>
                <th className="pb-2 text-right font-normal">Search</th>
                <th className="pb-2 text-right font-normal">Last AI fetch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, label, status }) => (
                <tr
                  key={row.slug || "__index"}
                  onClick={() => setSlug(row.slug)}
                  className="cursor-pointer border-b border-white/5 hover:bg-[rgba(255,255,255,0.03)]"
                >
                  <td className="py-2 pr-3">
                    <span className="text-[rgba(255,255,255,0.7)]">{label}</span>
                    {status !== "published" && status !== "generated" && (
                      <span className="ml-2 text-[10px] uppercase text-[#F5A623]">{status}</span>
                    )}
                    {props.hubBase && status === "published" && row.slug && (
                      <span className="ml-2 text-[rgba(255,255,255,0.25)]">/{row.slug}</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-[rgba(255,255,255,0.7)]">{row.aiAnswer}</td>
                  <td className="py-2 text-right text-[rgba(255,255,255,0.5)]">{row.human}</td>
                  <td className="py-2 text-right text-[rgba(255,255,255,0.5)]">{row.search}</td>
                  <td className="py-2 text-right text-[rgba(255,255,255,0.35)]">
                    {ago(row.lastAiAnswerAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[rgba(255,255,255,0.3)]">
          A published page with no AI fetch is a finding, not a gap in the data.
        </p>
      </div>

      {/* ── Who, by name ── */}
      <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
        <h2 className="mb-3 text-sm font-medium text-white">Agents seen</h2>

        {props.agents.length === 0 ? (
          <p className="text-xs text-[rgba(255,255,255,0.3)]">No automated agent yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {props.agents.map((a, i) => (
              <li key={`${a.botClass}:${a.botName ?? i}`} className="flex justify-between gap-3 text-xs">
                <span className="text-[rgba(255,255,255,0.6)]">
                  <span
                    aria-hidden
                    className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{
                      background:
                        SERIES.find((s) => s.key === (a.botClass as SeriesKey))?.color ??
                        "rgba(255,255,255,0.3)",
                    }}
                  />
                  {a.botName ?? "unnamed bot"}
                  <span className="ml-2 text-[rgba(255,255,255,0.3)]">
                    {SERIES.find((s) => s.key === (a.botClass as SeriesKey))?.label ?? "Other bots"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-[rgba(255,255,255,0.35)]">
                  {a.hits} over {a.daysSeen}d · {ago(a.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[11px] text-[rgba(255,255,255,0.3)]">
          An agent name is a claim off a User-Agent header, not a verified identity.
          Google-Extended and Applebot-Extended are robots.txt directives and never appear
          here, so their absence says nothing either way.
        </p>
      </div>
    </div>
  );
}

/** A stat tile. Proportional figures: tabular-nums makes a large standalone number loose. */
function Tile({
  label,
  value,
  accent,
  note,
}: {
  label: string;
  value: number;
  accent: string;
  note: string;
}) {
  return (
    <div
      className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <p className="text-2xl font-medium text-white">{value}</p>
      <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.5)]">{label}</p>
      <p className="text-[10px] text-[rgba(255,255,255,0.3)]">{note}</p>
    </div>
  );
}
