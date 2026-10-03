"use client";

// The pipeline board. Eight columns, left to right, drag a card to move a lead.
//
// ‼️ HTML5 DRAG AND DROP, NO LIBRARY. The board moves one card between columns; that is the whole
// interaction. dnd-kit and react-beautiful-dnd both exist to solve sortable lists with keyboard
// affordances and virtualised reordering, none of which this needs, and both are a dependency in
// a repo whose bundle already carries the hub, the studio and three funnels.
//
// ‼️ THE MOVE IS OPTIMISTIC AND THE REVERT IS THE POINT. A board that waits for the server before
// the card lands feels broken on a 400ms round trip, and a board that never reverts quietly lies
// when the write fails. The card moves at once, and goes back with the error visible if the API
// refuses.
//
// ‼️ IT WRITES THROUGH /api/crm/leads/[id]/status AND NOWHERE ELSE. That route calls
// setLeadStatus, which is what writes lead_status_history and normalises the value. A direct
// contacts UPDATE from here would be a second definition of what moving a lead means.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical, Phone, Mail, Clock, CheckSquare, Ban } from "lucide-react";
import { ALL_STAGES } from "@/config/stage-display";
import { formatRelativeTime } from "@/lib/utils";

export interface BoardCard {
  id: string;
  name: string;
  business: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  lastActivityAt: string | null;
  openTasks: number;
  doNotContact: boolean;
}

export interface BoardColumn {
  stage: string;
  color: string;
  blurb: string;
  /** Every lead on this stage, which is usually more than `cards` holds. */
  total: number;
  cards: BoardCard[];
}

export function PipelineBoard({ columns: initial }: { columns: BoardColumn[] }) {
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function cardById(id: string): { card: BoardCard; from: string } | null {
    for (const col of columns) {
      const card = col.cards.find((c) => c.id === id);
      if (card) return { card, from: col.stage };
    }
    return null;
  }

  async function move(id: string, to: string) {
    const found = cardById(id);
    if (!found || found.from === to) return;
    const { card, from } = found;

    // Optimistic: lift it out of one column and drop it in the other, and fix the two counts so
    // the column headers do not disagree with what is under them.
    setColumns((cols) =>
      cols.map((c) => {
        if (c.stage === from) {
          return { ...c, total: Math.max(0, c.total - 1), cards: c.cards.filter((x) => x.id !== id) };
        }
        if (c.stage === to) {
          return { ...c, total: c.total + 1, cards: [{ ...card, stage: to }, ...c.cards] };
        }
        return c;
      })
    );
    setError(null);

    try {
      const res = await fetch(`/api/crm/leads/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "That move did not save.");
      // The counts above are arithmetic on what was on screen. Re-reading is what makes them the
      // database's answer again, including anything somebody else moved meanwhile.
      start(() => router.refresh());
    } catch (e) {
      setColumns(initial);
      setError(`${card.business || card.name}: ${(e as Error).message}`);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg border border-[rgba(231,76,60,0.35)] bg-[rgba(231,76,60,0.08)] px-3 py-2 text-xs text-[#E74C3C]">
          {error} The card has been put back.
        </p>
      )}

      {/* ‼️ THE BOARD SCROLLS, THE PAGE DOES NOT. Eight columns do not fit on a laptop and the
          alternative to a horizontal scroller is columns too narrow to read a business name in.
          overflow-x here rather than on the page body, so the sidebar and header stay put. */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section
            key={col.stage}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== col.stage) setOver(col.stage);
            }}
            onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) void move(id, col.stage);
            }}
            className={`flex max-h-[calc(100vh-230px)] w-[270px] shrink-0 flex-col rounded-xl border bg-[rgba(255,255,255,0.02)] transition-colors ${
              over === col.stage
                ? "border-[rgba(0,201,167,0.6)] bg-[rgba(0,201,167,0.05)]"
                : "border-[rgba(255,255,255,0.08)]"
            }`}
          >
            <header className="shrink-0 border-b border-[rgba(255,255,255,0.08)] p-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: col.color }}
                />
                <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-white">
                  {col.stage}
                </h2>
                <span className="ml-auto shrink-0 rounded-full bg-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[11px] tabular-nums text-[rgba(255,255,255,0.65)]">
                  {col.total.toLocaleString()}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-[rgba(255,255,255,0.35)]">{col.blurb}</p>
            </header>

            <div className="min-h-[60px] flex-1 space-y-2 overflow-y-auto p-2">
              {col.cards.map((card) => (
                <article
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", card.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(card.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`group rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#141416] p-2.5 ${
                    dragging === card.id ? "opacity-40" : "hover:border-[rgba(255,255,255,0.2)]"
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical
                      size={13}
                      className="mt-0.5 shrink-0 cursor-grab text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.45)]"
                    />
                    <div className="min-w-0 flex-1">
                      {/* The link is inside a draggable card on purpose: dragging never starts
                          from a click that does not move, so a plain click still opens the lead. */}
                      <Link
                        href={`/dashboard/leads/${card.id}`}
                        className="block truncate text-[13px] font-medium text-white hover:text-[#00C9A7]"
                      >
                        {card.business || card.name}
                      </Link>
                      {card.business && card.name !== card.business && (
                        <p className="truncate text-[11px] text-[rgba(255,255,255,0.45)]">
                          {card.name}
                        </p>
                      )}
                    </div>
                    {card.doNotContact && (
                      <Ban size={13} className="mt-0.5 shrink-0 text-[#C0392B]" aria-label="Do not contact" />
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[19px] text-[10.5px] text-[rgba(255,255,255,0.4)]">
                    {card.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={10} />
                        {card.phone}
                      </span>
                    )}
                    {card.email && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Mail size={10} />
                        <span className="truncate">{card.email}</span>
                      </span>
                    )}
                  </div>

                  {(card.lastActivityAt || card.openTasks > 0) && (
                    <div className="mt-1.5 flex items-center gap-2.5 pl-[19px] text-[10.5px]">
                      {card.lastActivityAt && (
                        <span className="inline-flex items-center gap-1 text-[rgba(255,255,255,0.35)]">
                          <Clock size={10} />
                          {formatRelativeTime(card.lastActivityAt)}
                        </span>
                      )}
                      {card.openTasks > 0 && (
                        <span className="inline-flex items-center gap-1 text-[#F5A623]">
                          <CheckSquare size={10} />
                          {card.openTasks}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              ))}

              {col.cards.length === 0 && (
                <p className="px-1 py-6 text-center text-[11px] text-[rgba(255,255,255,0.25)]">
                  Nothing here
                </p>
              )}

              {/* ‼️ SAID WHEN IT IS TRUE, BECAUSE A COLUMN HEADED 2,431 SHOWING 50 CARDS LOOKS
                  BROKEN. The board loads a slice per column; the book itself is on /dashboard/leads
                  and this links straight to it, already filtered. */}
              {col.total > col.cards.length && (
                <Link
                  href={`/dashboard/leads?status=${encodeURIComponent(col.stage)}`}
                  className="block rounded-lg border border-dashed border-[rgba(255,255,255,0.12)] px-2 py-2 text-center text-[11px] text-[rgba(255,255,255,0.45)] hover:border-[rgba(255,255,255,0.25)] hover:text-white"
                >
                  {(col.total - col.cards.length).toLocaleString()} more in the list
                </Link>
              )}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.3)]">
        Drag a card to move a lead. {ALL_STAGES.length} stages.
      </p>
    </div>
  );
}
