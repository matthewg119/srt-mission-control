"use client";

// The clients list, with a search box and two shapes to read it in.
//
// ‼️ IT FILTERS, IT NEVER FETCHES. Every row arrives from the server component beside it, already
// derived, already sorted worst first. This file owns three pieces of state and nothing else: what
// was typed, which shape, which lane. No query, no revalidate, no action. A list view that can
// write is a list view somebody taps by accident.
//
// ‼️ AND IT HOLDS NO RULE. The pill, its reason, the owed sentence and every threshold are computed
// in client-health.ts and arrive as strings. Re-deriving any of it here is how the page and the
// Slack digest start disagreeing about the same client, which is the thing that definition exists
// to prevent.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { HealthLevel } from "@/lib/clients/client-health";
import type { ClientOverviewRow, Lane } from "@/lib/clients/clients-overview";

type View = "cards" | "list";
type LaneFilter = "all" | Lane;

/** The demo's palette, which is the one that was picked. Meaning is carried by colour here. */
const PILL: Record<HealthLevel, string> = {
  risk: "bg-rose-400/15 text-rose-300",
  watch: "bg-amber-400/15 text-amber-300",
  good: "bg-emerald-400/15 text-emerald-300",
  closed: "bg-white/10 text-[rgba(255,255,255,0.5)]",
};

/** The dot, for the list shape, where a full pill on every row would be a wall of colour. */
const DOT: Record<HealthLevel, string> = {
  risk: "bg-rose-400",
  watch: "bg-amber-400",
  good: "bg-emerald-400",
  closed: "bg-[rgba(255,255,255,0.25)]",
};

const VIEWS: ReadonlyArray<{ key: View; label: string }> = [
  { key: "cards", label: "Cards" },
  { key: "list", label: "List" },
];

const LANES: ReadonlyArray<{ key: LaneFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "slack", label: "Slack board" },
  { key: "launch", label: "Launch lane" },
];

/** Remembered per browser, like the sidebar's own order and hide preferences. */
const VIEW_KEY = "srt.clients.view";

const CHIP = "rounded-full px-3 py-1 text-xs transition-colors";
const CHIP_ON = "bg-[#00C9A7] font-semibold text-[#07211c]";
const CHIP_OFF =
  "border border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.6)] hover:text-white";

export function ClientsView({ rows }: { rows: ClientOverviewRow[] }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("cards");
  const [lane, setLane] = useState<LaneFilter>("all");

  // ‼️ READ IN AN EFFECT, NOT DURING RENDER. localStorage does not exist on the server, so reading
  // it inline would hydrate one shape over markup drawn in the other. The default paints first and
  // the preference arrives a frame later, which is exactly what sidebar.tsx does with nav order.
  // Wrapped because a browser set to block site data throws on the accessor itself.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "cards" || saved === "list") setView(saved);
    } catch {
      /* no preference is a working page, so a refusal here is not worth surfacing */
    }
  }, []);

  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the toggle still works for this visit */
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (lane === "all" || r.lane === lane) && (q === "" || r.haystack.includes(q))
    );
  }, [rows, query, lane]);

  const laneCounts = useMemo(
    () => ({
      all: rows.length,
      slack: rows.filter((r) => r.lane === "slack").length,
      launch: rows.filter((r) => r.lane === "launch").length,
    }),
    [rows]
  );

  const needing = shown.filter(
    (r) => r.health.level === "risk" || r.health.level === "watch"
  ).length;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, town, website, stage, what is owed"
          aria-label="Search clients"
          className="min-w-0 flex-1 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(255,255,255,0.25)] focus:outline-none"
        />
        <div className="flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => chooseView(v.key)}
              aria-pressed={view === v.key}
              className={`${CHIP} ${view === v.key ? CHIP_ON : CHIP_OFF}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ‼️ THE LANE CHIPS CARRY COUNTS, because a filter that can empty the page has to say what it
          is hiding. A clients page that silently omits clients is the bug this view replaced. */}
      {laneCounts.launch > 0 && (
        <div className="mb-5 flex flex-wrap gap-1">
          {LANES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLane(l.key)}
              aria-pressed={lane === l.key}
              className={`${CHIP} ${lane === l.key ? CHIP_ON : CHIP_OFF}`}
            >
              {l.label} {laneCounts[l.key]}
            </button>
          ))}
        </div>
      )}

      <p className="mb-4 text-xs text-[rgba(255,255,255,0.4)]">{summary(shown.length, needing, query)}</p>

      {shown.length === 0 ? (
        <p className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-4 py-6 text-center text-sm text-[rgba(255,255,255,0.4)]">
          {query.trim() ? `Nothing matches "${query.trim()}".` : "Nothing on this lane."}
        </p>
      ) : view === "cards" ? (
        <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <Card key={r.id} row={r} />
          ))}
        </div>
      ) : (
        <div className="mb-8 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
          {shown.map((r, i) => (
            <Row key={r.id} row={r} first={i === 0} />
          ))}
        </div>
      )}
    </>
  );
}

function summary(count: number, needing: number, query: string): string {
  const what = query.trim() ? `${count} matching` : `${count} on the books`;
  if (count === 0) return query.trim() ? "Nothing matches." : "No clients yet.";
  if (needing === 0) return `${what}, and none of them need you today.`;
  return `${what}. ${needing} ${needing === 1 ? "needs" : "need"} a look, worst first.`;
}

function LaneTag({ lane }: { lane: Lane }) {
  if (lane !== "launch") return null;
  // Only the exception is labelled. Tagging every Slack-board client would be a word on every row
  // that means "normal".
  return (
    <span className="rounded-full bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[rgba(255,255,255,0.45)]">
      launch
    </span>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]">
      <div className="h-full rounded-full bg-[#00C9A7]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** How far along, in the client's OWN lane's terms. Never the config's length. */
function progressLabel(row: ClientOverviewRow): string {
  return row.total === 0 ? "No board yet" : `${row.settled} of ${row.total} settled`;
}

function Card({ row: r }: { row: ClientOverviewRow }) {
  return (
    <Link
      href={r.href}
      className="block rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4 hover:border-[rgba(255,255,255,0.18)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{r.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[rgba(255,255,255,0.4)]">
            <span>
              {r.stage} &middot; {r.money}
            </span>
            <LaneTag lane={r.lane} />
          </p>
        </div>
        {/* ‼️ THE PILL AND ITS REASON ARE ONE UNIT, because they came out of one branch. A client is
            never red here without the card naming what made it red. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[r.health.level]}`}>
            {r.health.label}
          </span>
          <span className="text-right text-[11px] text-[rgba(255,255,255,0.35)]">
            {r.health.reason}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm text-[rgba(255,255,255,0.8)]">{r.owed}</p>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-[rgba(255,255,255,0.4)]">
          {/* ‼️ COUNTED, NEVER WRITTEN DOWN. The denominator is this client's own rows, and its
              lane's length today is in the hover. The Slack board has been 43, then 41, then 37. */}
          <span title={`${r.boardLength} steps on this board today`}>{progressLabel(r)}</span>
          <span>{r.quiet}</span>
        </div>
        <div className="mt-1.5">
          <Bar percent={r.percent} />
        </div>
      </div>

      {r.meta.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-3 text-xs text-[rgba(255,255,255,0.3)]">
          {r.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </p>
      )}
    </Link>
  );
}

/** The same facts on one line, for when there are more clients than fit as cards. */
function Row({ row: r, first }: { row: ClientOverviewRow; first: boolean }) {
  return (
    <Link
      href={r.href}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-[rgba(255,255,255,0.03)] ${
        first ? "" : "border-t border-[rgba(255,255,255,0.07)]"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.health.level]}`}
        title={`${r.health.label}: ${r.health.reason}`}
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
          <span className="truncate">{r.name}</span>
          <LaneTag lane={r.lane} />
        </p>
        <p className="truncate text-xs text-[rgba(255,255,255,0.5)]">{r.owed}</p>
      </div>
      <span className="hidden w-28 shrink-0 text-right text-xs text-[rgba(255,255,255,0.4)] sm:block">
        {r.stage}
      </span>
      <span className="hidden w-32 shrink-0 lg:block" title={progressLabel(r)}>
        <Bar percent={r.percent} />
      </span>
      <span className="w-28 shrink-0 text-right text-xs text-[rgba(255,255,255,0.4)]">
        {r.quiet}
      </span>
      <span className="hidden w-32 shrink-0 text-right text-xs text-[rgba(255,255,255,0.35)] md:block">
        {r.health.reason}
      </span>
    </Link>
  );
}
