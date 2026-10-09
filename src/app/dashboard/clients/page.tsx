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
// ‼️ THE PAGE DERIVES NOTHING AND FILTERS NOTHING. Every number, sentence and pill comes out of
// clientsOverview(); every threshold is written down once in client-health.ts; the search box and
// the two shapes live in clients-view.tsx. A rule that lives in JSX is a rule that gets a second
// copy the first time anything else needs it.
//
// ‼️ THE CARD SURFACE IS THE DASHBOARD'S, NOT THE DEMO'S. The demo painted its own greys
// (bg-[#141416] on bg-[#0b0b0c]) because it was a standalone preview with no shell around it. What
// Matthew picked was the LAYOUT: large cards, relationship first, the board as one bar, a pill with
// room for a reason. Those arrive here on the same panel treatment every other Mission Control page
// uses, so this reads as part of the product rather than as a preview that escaped.

import { clientsOverview } from "@/lib/clients/clients-overview";

import { ClientsView } from "./clients-view";
import { StartPilotForm } from "./start-pilot-form";

export const metadata = { title: "Clients | SRT Mission Control" };
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function ClientsPage() {
  const { rows, error } = await clientsOverview();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-xl font-medium text-white">Clients</h1>

      {/* ‼️ A FAILED READ SAYS SO. Rendering an empty list instead is how somebody opens a second
          client for a business that already has one. */}
      {error && (
        <p className="mb-6 rounded-xl border border-[rgba(245,166,35,0.4)] bg-[rgba(245,166,35,0.08)] px-4 py-3 text-xs text-[#F5A623]">
          {error}. Nothing below is the whole picture, so do not act on it.
        </p>
      )}

      <ClientsView rows={rows} />

      <StartPilotForm />
    </div>
  );
}
