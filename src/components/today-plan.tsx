"use client";

import { useState } from "react";
import Link from "next/link";
import type { DayItem, DayPlan } from "@/lib/today/item";

// The day, as a page. Lanes by role, a pin you can drag, and a reason on every row.
//
// ‼️ THE DRAG IS OPTIMISTIC. The server write is one row, but a drag that snaps back while a round
// trip completes reads as "it did not save", which is exactly the doubt this surface exists to
// remove. invalidateWorklistCache's docstring makes the same argument about its own cache.
//
// ‼️ EVERY ROW LINKS BACK TO WHERE THE WORK IS DONE. This page never ticks a step, publishes a page
// or sends anything. It says what and where; the Slack card and the studio are where it happens.

const TONE: Record<string, string> = {
  urgent: "#E74C3C",
  high: "#F5A623",
  medium: "#00C9A7",
  low: "rgba(255,255,255,0.35)",
};

function minutes(n: number): string {
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function Row({
  item,
  canOrder,
  onDragStart,
  onDrop,
  onDefer,
}: {
  item: DayItem;
  canOrder: boolean;
  onDragStart: (key: string) => void;
  onDrop: (key: string) => void;
  onDefer: (item: DayItem) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <li
      draggable={canOrder}
      onDragStart={() => onDragStart(item.key)}
      onDragOver={(e) => {
        if (!canOrder) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canOrder) return;
        e.preventDefault();
        setOver(false);
        onDrop(item.key);
      }}
      className={`rounded-xl border px-3 py-2.5 ${
        over ? "border-[#00C9A7]" : "border-[rgba(255,255,255,0.07)]"
      } bg-[rgba(255,255,255,0.02)]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
              style={{ color: TONE[item.priority] ?? TONE.medium, background: "rgba(255,255,255,0.04)" }}
            >
              {item.typeLabel}
            </span>
            {item.pinnedRank !== null && (
              <span className="text-[10px] text-[rgba(255,255,255,0.35)]">pinned</span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-white">{item.title}</p>
          {/* The reasons are printed verbatim. A score that cannot explain itself is not trusted. */}
          <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.4)]">{item.reasons.join(" · ")}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-[rgba(255,255,255,0.3)]">~{minutes(item.effortMinutes)} est.</span>
          {item.slackPermalink ? (
            <a
              href={item.slackPermalink}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.6)] hover:text-white"
            >
              Slack
            </a>
          ) : item.href ? (
            <Link
              href={item.href}
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.6)] hover:text-white"
            >
              Open
            </Link>
          ) : null}
          {canOrder && (
            <button
              onClick={() => onDefer(item)}
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.45)] hover:text-white"
            >
              Not today
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function TodayPlan({ plan }: { plan: DayPlan }) {
  const [groups, setGroups] = useState(plan.groups);
  const [later, setLater] = useState(plan.later);
  const [dragging, setDragging] = useState<string | null>(null);
  const canOrder = !plan.orderingUnavailable;

  async function move(targetKey: string) {
    const sourceKey = dragging;
    setDragging(null);
    if (!sourceKey || sourceKey === targetKey) return;

    const lane = groups.find((g) => g.items.some((i) => i.key === targetKey));
    if (!lane) return;
    const idx = lane.items.findIndex((i) => i.key === targetKey);
    const above = lane.items[idx - 1]?.key;

    // Optimistic: move it locally first, then tell the server about one row.
    setGroups((prev) =>
      prev.map((g) => {
        const without = g.items.filter((i) => i.key !== sourceKey);
        if (g.role !== lane.role) return { ...g, items: without };
        const moved = groups.flatMap((x) => x.items).find((i) => i.key === sourceKey);
        if (!moved) return { ...g, items: without };
        const at = without.findIndex((i) => i.key === targetKey);
        const next = [...without];
        next.splice(at < 0 ? next.length : at, 0, { ...moved, role: lane.role, pinnedRank: 0 });
        return { ...g, items: next };
      })
    );

    const moved = groups.flatMap((g) => g.items).find((i) => i.key === sourceKey);
    await fetch("/api/today/order", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemKey: sourceKey,
        role: lane.role,
        afterKey: above,
        beforeKey: targetKey,
        clientId: moved?.clientId ?? null,
      }),
    }).catch(() => {});
  }

  async function defer(item: DayItem) {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setGroups((prev) => prev.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== item.key) })));
    setLater((prev) => [...prev, { ...item, deferredUntil: until }]);
    await fetch("/api/today/order", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemKey: item.key, role: item.role, deferUntil: until, clientId: item.clientId }),
    }).catch(() => {});
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div>
      {plan.orderingUnavailable && (
        <p className="mb-4 rounded-xl border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.06)] px-3 py-2 text-[11px] text-[#F5A623]">
          Drag is off until <code>docs/2026-09-26-day-plan.sql</code> is run. Everything below is in computed order.
        </p>
      )}
      {plan.unreadable.length > 0 && (
        <p className="mb-4 rounded-xl border border-[rgba(231,76,60,0.3)] bg-[rgba(231,76,60,0.06)] px-3 py-2 text-[11px] text-[#E74C3C]">
          {plan.unreadable.join(" and ")} could not be read, so this day is incomplete rather than clear.
        </p>
      )}

      {total === 0 ? (
        <p className="text-sm text-[rgba(255,255,255,0.4)]">
          Nothing is waiting on you. Every board is either running itself or finished.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.role} className="mb-7">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-white">{g.label}</h2>
              <span className="text-[11px] text-[rgba(255,255,255,0.3)]">
                {g.items.length} · ~{minutes(g.estMinutes)} est.
              </span>
            </div>
            <ul className="space-y-2">
              {g.items.map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  canOrder={canOrder}
                  onDragStart={setDragging}
                  onDrop={move}
                  onDefer={defer}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {later.length > 0 && (
        <section className="mt-8 border-t border-[rgba(255,255,255,0.07)] pt-5">
          <h2 className="mb-2 text-sm font-medium text-[rgba(255,255,255,0.45)]">Not today ({later.length})</h2>
          <ul className="space-y-1">
            {later.map((i) => (
              <li key={i.key} className="text-[11px] text-[rgba(255,255,255,0.35)]">
                {i.typeLabel} · {i.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
