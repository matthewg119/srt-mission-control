// Clients: the pilot and paying clinics we deliver for.
//
// NOT /dashboard/onboarding. That route already exists and is OUR OWN team-member setup
// checklist (src/config/onboarding.ts, localStorage backed). Two different things called
// onboarding is exactly the confusion this name avoids.
//
// NO SEAT COUNTER. The cap is six and it is enforced in startPilot(), server side. It is
// not rendered as "2 of 6 seats" anywhere, because scarcity framing is a selling device
// and this page is delivery.

import Link from "next/link";
import { supabaseAdmin } from "@/lib/db";
import { StartPilotForm } from "./start-pilot-form";

export const metadata = { title: "Clients | SRT Mission Control" };
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const STAGE_LABEL: Record<string, string> = {
  invited: "Invited",
  intake_started: "Filling out intake",
  intake_complete: "Intake done",
  call_booked: "Call booked",
  active: "Active",
  complete: "Closed out",
};

function daysLeft(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400_000);
  if (days < 0) return "Pilot ended";
  if (days === 0) return "Last day";
  return `${days} days left`;
}

export default async function ClientsPage() {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select(
      "id, slug, legal_name, dba_name, website, city, state, billing_status, onboarding_status, pilot_ends_at, intake_step, market_conflict, slack_channel_name"
    )
    .order("created_at", { ascending: false });

  const rows = clients ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-white">Clients</h1>
        <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
          {rows.length === 0
            ? "No clients yet. Start the first pilot below."
            : `${rows.length} on the books.`}
        </p>
      </div>

      <div className="mb-10 space-y-2">
        {rows.map((c) => {
          const remaining = daysLeft(c.pilot_ends_at as string | null);
          return (
            <Link
              key={c.id as string}
              href={`/dashboard/clients/${c.id as string}`}
              className="block rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-4 py-3 hover:border-[rgba(255,255,255,0.18)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-white">
                  {(c.dba_name as string) || (c.legal_name as string)}
                </span>
                <span className="text-xs text-[rgba(255,255,255,0.4)]">
                  {STAGE_LABEL[c.onboarding_status as string] ?? (c.onboarding_status as string)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[rgba(255,255,255,0.35)]">
                <span>{c.website as string}</span>
                {c.city && (
                  <span>
                    {c.city as string}
                    {c.state ? `, ${c.state as string}` : ""}
                  </span>
                )}
                {c.slack_channel_name && <span>#{c.slack_channel_name as string}</span>}
                {remaining && <span>{remaining}</span>}
                {c.market_conflict === true && (
                  <span className="text-[#F5A623]">market overlap, needs a decision</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <StartPilotForm />
    </div>
  );
}
