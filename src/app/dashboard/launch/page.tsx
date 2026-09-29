// The Launch Lane: clients with no website, in any niche, worked on sixteen steps.
//
// A SEPARATE PAGE FROM /dashboard/clients, NOT A FILTER ON IT. The two lanes are worked
// differently and the Slack board's page is built around a board this lane does not have. One
// page showing both would need a branch in every panel on it, which is the coupling this lane
// exists to avoid.

import Link from "next/link";
import { supabaseAdmin } from "@/lib/db";
import { LAUNCH_STEPS } from "@/config/launch-steps";
import { StartLaunchForm } from "./start-launch-form";

export const metadata = { title: "Launch lane | SRT Mission Control" };
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function LaunchLanePage() {
  const { data: clients, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name, city, state, vertical_slug, website, created_at")
    .eq("onboarding_lane", "launch")
    .order("created_at", { ascending: false });

  const rows = clients ?? [];

  // One query for every client's progress, rather than one per client.
  const ids = rows.map((r) => r.id as string);
  const { data: steps } = ids.length
    ? await supabaseAdmin
        .from("client_launch_steps")
        .select("client_id, status")
        .in("client_id", ids)
    : { data: [] as { client_id: string; status: string }[] };

  const done = new Map<string, number>();
  for (const s of steps ?? []) {
    if (s.status === "complete" || s.status === "skipped") {
      done.set(s.client_id as string, (done.get(s.client_id as string) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold text-white">Launch lane</h1>
        <Link href="/dashboard/clients" className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
          Slack board clients
        </Link>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-[rgba(255,255,255,0.5)]">
        For a business with no website, in any niche. {LAUNCH_STEPS.length} steps instead of forty
        one, no Slack, and the whole build driven from four documents. Editing the Slack board does
        not touch this lane and editing this lane does not touch that one.
      </p>

      <div className="mb-8">
        <StartLaunchForm />
      </div>

      {error && (
        <p className="rounded-lg border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.06)] p-4 text-xs text-[#FF6B6B]">
          The client list could not be read: {error.message}
          {/* Said out loud rather than rendering an empty list. An outage that looks like "no
              clients yet" is how somebody opens a second client for a business that already has one. */}
        </p>
      )}

      {!error && rows.length === 0 && (
        <p className="text-sm text-[rgba(255,255,255,0.35)]">No launch clients yet.</p>
      )}

      <ul className="space-y-2">
        {rows.map((c) => {
          const complete = done.get(c.id as string) ?? 0;
          const name = (c.dba_name as string) || (c.legal_name as string) || (c.slug as string);
          const where = [c.city, c.state].filter(Boolean).join(", ");
          return (
            <li key={c.id as string}>
              <Link
                href={`/dashboard/launch/${c.id as string}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] px-5 py-4 hover:border-[rgba(0,201,167,0.4)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{name}</p>
                  <p className="mt-0.5 truncate text-xs text-[rgba(255,255,255,0.4)]">
                    {[(c.vertical_slug as string) || "no vertical set", where].filter(Boolean).join(" · ")}
                    {!c.website && " · no website"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-white">
                    {complete}
                    <span className="text-[rgba(255,255,255,0.35)]"> / {LAUNCH_STEPS.length}</span>
                  </p>
                  <p className="text-[11px] text-[rgba(255,255,255,0.35)]">steps settled</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
