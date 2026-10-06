// Clients: the pilot and paying clinics we deliver for. One card each, relationship first.
//
// NOT /dashboard/onboarding. That route already exists and is OUR OWN team-member setup
// checklist (src/config/onboarding.ts, localStorage backed). Two different things called
// onboarding is exactly the confusion this name avoids.
//
// NO SEAT COUNTER. The cap is six and it is enforced in startPilot(), server side. It is
// not rendered as "2 of 6 seats" anywhere, because scarcity framing is a selling device
// and this page is delivery.
//
// ‼️ THIS IS /demo/crm's VARIANT 3, PICKED AND WIRED. Matthew, 2026-10-06: "since we have the chat
// agent i'm sure we are no longer going to use this clients tab only the chatbot so lets make it
// something more simple and minimalistic to see customer relationship and deal status." The chat
// agent answers questions about a client now, so what is left to want from a list is how the
// relationship is doing, at a glance, with room to say why. The demo's two sibling layouts and the
// demo route itself are deleted rather than left beside this one.
//
// ‼️ THE PAGE DERIVES NOTHING. Every number, sentence and pill comes out of clientsOverview(), and
// every threshold is written down once in client-health.ts. A rule that lives in JSX is a rule that
// gets a second copy the first time anything else needs it.
//
// ‼️ THE CARD SURFACE IS THE DASHBOARD'S, NOT THE DEMO'S. The demo painted its own greys
// (bg-[#141416] on bg-[#0b0b0c]) because it was a standalone preview with no shell around it. What
// Matthew picked was the LAYOUT: large cards, relationship first, the board as one bar, a pill with
// room for a reason. Those arrive here on the same panel treatment every other Mission Control page
// uses, so this reads as part of the product rather than as a preview that escaped.

import Link from "next/link";

import { clientsOverview, type ClientOverviewRow } from "@/lib/clients/clients-overview";
import type { HealthLevel } from "@/lib/clients/client-health";

import { StartPilotForm } from "./start-pilot-form";

export const metadata = { title: "Clients | SRT Mission Control" };
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** The demo's palette, which is the one that was picked. Meaning is carried by colour here. */
const PILL: Record<HealthLevel, string> = {
  risk: "bg-rose-400/15 text-rose-300",
  watch: "bg-amber-400/15 text-amber-300",
  good: "bg-emerald-400/15 text-emerald-300",
  closed: "bg-white/10 text-[rgba(255,255,255,0.5)]",
};

export default async function ClientsPage() {
  const { rows, launchCount, error } = await clientsOverview();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-white">Clients</h1>
        <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">{summary(rows, error)}</p>
      </div>

      {/* ‼️ A FAILED READ SAYS SO. Rendering an empty list instead is how somebody opens a second
          client for a business that already has one. */}
      {error && (
        <p className="mb-6 rounded-xl border border-[rgba(245,166,35,0.4)] bg-[rgba(245,166,35,0.08)] px-4 py-3 text-xs text-[#F5A623]">
          {error}. Nothing below is the whole picture, so do not act on it.
        </p>
      )}

      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <ClientCard key={r.id} row={r} />
        ))}
      </div>

      {/* ‼️ THE OTHER LANE IS COUNTED AND LINKED, NEVER MIXED IN. /dashboard/launch's own header:
          "A SEPARATE PAGE FROM /dashboard/clients, NOT A FILTER ON IT." Saying how many are over
          there is what stops a launch-lane client being a client nobody can find. */}
      {launchCount > 0 && (
        <p className="mb-10 text-xs text-[rgba(255,255,255,0.35)]">
          {launchCount === 1 ? "One more client is" : `${launchCount} more clients are`} on the{" "}
          <Link href="/dashboard/launch" className="underline hover:text-white">
            launch lane
          </Link>
          , which has its own board and its own page.
        </p>
      )}

      <StartPilotForm />
    </div>
  );
}

function summary(rows: ClientOverviewRow[], error: string | null): string {
  if (error) return "The list is incomplete.";
  if (rows.length === 0) return "No clients yet. Start the first pilot below.";
  const needing = rows.filter((r) => r.health.level === "risk" || r.health.level === "watch").length;
  if (needing === 0) return `${rows.length} on the books, and none of them need you today.`;
  return `${rows.length} on the books. ${needing} ${needing === 1 ? "needs" : "need"} a look, worst first.`;
}

function ClientCard({ row: r }: { row: ClientOverviewRow }) {
  return (
    <Link
      href={r.href}
      className="block rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4 hover:border-[rgba(255,255,255,0.18)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{r.name}</h2>
          <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.4)]">
            {r.stage} &middot; {r.money}
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

      {/* The delivery board as one bar. Nobody holds thirty seven steps in their head. */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-[rgba(255,255,255,0.4)]">
          {/* ‼️ COUNTED, NEVER WRITTEN DOWN. The denominator is this client's own rows, and the
              board's length today is in the hover only. It has been 43, then 41, then 37. */}
          <span title={`${r.boardLength} steps on the board today`}>
            {r.total === 0 ? "No board yet" : `${r.settled} of ${r.total} settled`}
          </span>
          <span>{r.quiet}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]">
          <div className="h-full rounded-full bg-[#00C9A7]" style={{ width: `${r.percent}%` }} />
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
