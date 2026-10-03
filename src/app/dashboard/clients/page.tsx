// Clients: the pilot and paying businesses we deliver for.
//
// NOT /dashboard/onboarding. That route already exists and is OUR OWN team-member setup checklist
// (src/config/onboarding.ts, localStorage backed). Two different things called onboarding is
// exactly the confusion this name avoids.
//
// NO SEAT COUNTER. The cap is six and it is enforced in startPilot(), server side. It is not
// rendered as "2 of 6 seats" anywhere, because scarcity framing is a selling device and this page
// is delivery.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ REBUILT 2026-10-03 AS THE THIRD OF THREE VIEWS, and the question it answers is the one the
// old page could not: HOW FAR ALONG IS EVERY CLIENT. It listed a name, a website and an
// onboarding_status word, which says whether the paperwork is done and nothing about the work.
// Progress lives in two separate tables, and which one depends on the lane.
//
// ‼️ TWO LANES, TWO STEP TABLES, AND THE DENOMINATOR DIFFERS. A launch client's progress is
// client_launch_steps out of LAUNCH_STEPS.length (17); a slack client's is client_delivery_steps
// out of DELIVERY_STEPS.length (41). Reading one table for both, or printing one denominator,
// understates half the book. clients.onboarding_lane is what says which.
//
// ‼️ TWO QUERIES FOR PROGRESS, NOT ONE PER CLIENT. The launch front door already does it this way
// and the reason is the same: a page that fans out per row gets slower every time a client signs.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { supabaseAdmin } from "@/lib/db";
import { LAUNCH_STEPS } from "@/config/launch-steps";
import { DELIVERY_STEPS } from "@/config/delivery-steps";
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

/**
 * ‼️ "Invited" IS NOT A CLIENT YET AND THE TWO ARE SHOWN APART.
 * A row at `invited` is somebody who was sent a link and may never come back; six of them at the
 * top of this page is what made it read as a list of leads. They keep their own section, under the
 * ones being delivered for, with no progress bar, because there is no progress to report.
 */
const NOT_STARTED = new Set(["invited", "intake_started"]);

function daysLeft(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400_000);
  if (days < 0) return "Pilot ended";
  if (days === 0) return "Last day";
  return `${days} days left`;
}

interface ClientRow {
  id: string;
  slug: string | null;
  legal_name: string | null;
  dba_name: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  onboarding_status: string | null;
  onboarding_lane: string | null;
  pilot_ends_at: string | null;
  market_conflict: boolean | null;
  slack_channel_name: string | null;
}

export default async function ClientsPage() {
  const { data } = await supabaseAdmin
    .from("clients")
    .select(
      "id, slug, legal_name, dba_name, website, city, state, onboarding_status, " +
        "onboarding_lane, pilot_ends_at, market_conflict, slack_channel_name"
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as ClientRow[];
  const ids = rows.map((r) => r.id);

  const [launchSteps, deliverySteps] = ids.length
    ? await Promise.all([
        supabaseAdmin.from("client_launch_steps").select("client_id, status").in("client_id", ids),
        supabaseAdmin.from("client_delivery_steps").select("client_id, status").in("client_id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  // "Settled" is complete OR skipped, the same word the launch board uses: a step deliberately
  // skipped is a step nobody has to look at again, and counting it as outstanding makes a finished
  // client look stuck for ever.
  //
  // ‼️ ONE MAP PER TABLE, NEVER THE TWO ADDED TOGETHER, AND SRT IS WHY.
  // A client moved from the Slack board to the launch lane KEEPS its 41 Slack rows: the move is
  // reversible precisely because nothing is deleted (see moveClientToLaunchLane). Summing both
  // tables printed SRT as "26 / 17 steps", which is its 7 launch steps plus its 19 settled Slack
  // steps over the launch denominator. The lane picks the table; the other one is history.
  function tally(rows: { client_id: string; status: string }[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.status === "complete" || r.status === "skipped") {
        m.set(r.client_id, (m.get(r.client_id) ?? 0) + 1);
      }
    }
    return m;
  }
  const launchDone = tally((launchSteps.data ?? []) as { client_id: string; status: string }[]);
  const deliveryDone = tally((deliverySteps.data ?? []) as { client_id: string; status: string }[]);

  const started = rows.filter((c) => !NOT_STARTED.has(c.onboarding_status ?? ""));
  const waiting = rows.filter((c) => NOT_STARTED.has(c.onboarding_status ?? ""));

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Clients</h1>
        <p className="mt-1 text-xs text-[rgba(255,255,255,0.45)]">
          {rows.length === 0
            ? "No clients yet. Start the first pilot below."
            : `${started.length} being delivered for, ${waiting.length} not started.`}
        </p>
      </div>

      {started.length > 0 && (
        <div className="mb-8 space-y-2">
          {started.map((c) => {
            const launch = c.onboarding_lane === "launch";
            const total = launch ? LAUNCH_STEPS.length : DELIVERY_STEPS.length;
            const done = (launch ? launchDone : deliveryDone).get(c.id) ?? 0;
            const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const remaining = daysLeft(c.pilot_ends_at);
            const board = launch ? `/dashboard/launch/${c.id}` : `/dashboard/clients/${c.id}`;

            return (
              <Link
                key={c.id}
                href={board}
                className="block rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3.5 hover:border-[rgba(255,255,255,0.2)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-white">{c.dba_name || c.legal_name}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide ${
                        launch
                          ? "bg-[rgba(0,201,167,0.12)] text-[#00C9A7]"
                          : "bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.55)]"
                      }`}
                    >
                      {launch ? "Launch lane" : "Slack board"}
                    </span>
                    <span className="text-[rgba(255,255,255,0.45)]">
                      {STAGE_LABEL[c.onboarding_status ?? ""] ?? c.onboarding_status}
                    </span>
                  </span>
                </div>

                {/* The bar is the point of this page. It is the only thing on screen that says
                    whether a client is nearly done or has not been touched since the call. */}
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
                    <div
                      className="h-full rounded-full bg-[#00C9A7]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-[rgba(255,255,255,0.5)]">
                    {done} / {total} steps
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[rgba(255,255,255,0.35)]">
                  {c.website && <span>{c.website}</span>}
                  {c.city && (
                    <span>
                      {c.city}
                      {c.state ? `, ${c.state}` : ""}
                    </span>
                  )}
                  {remaining && <span>{remaining}</span>}
                  {/* Legacy. Per-client Slack channels were retired on 2026-08-20; this renders
                      only for the one client provisioned before that, so the record that the
                      channel existed is not lost. Nothing writes it any more. */}
                  {c.slack_channel_name && <span>#{c.slack_channel_name} (legacy Slack)</span>}
                  {c.market_conflict === true && (
                    <span className="text-[#F5A623]">market overlap, needs a decision</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {waiting.length > 0 && (
        <div className="mb-10">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[rgba(255,255,255,0.35)]">
            Not started
          </p>
          <div className="space-y-1.5">
            {waiting.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/clients/${c.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[rgba(255,255,255,0.06)] px-4 py-2.5 hover:border-[rgba(255,255,255,0.16)]"
              >
                <span className="text-sm text-[rgba(255,255,255,0.75)]">
                  {c.dba_name || c.legal_name}
                </span>
                <span className="text-xs text-[rgba(255,255,255,0.35)]">
                  {STAGE_LABEL[c.onboarding_status ?? ""] ?? c.onboarding_status}
                  {daysLeft(c.pilot_ends_at) ? ` · ${daysLeft(c.pilot_ends_at)}` : ""}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <StartPilotForm />
    </div>
  );
}
