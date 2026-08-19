import Link from "next/link";
import { supabaseAdmin } from "@/lib/db";
import { ALL_STAGES, isTerminalStage, stageColor } from "@/config/stage-display";
import { formatRelativeTime } from "@/lib/utils";
import { HuntLink } from "@/components/crm/hunt-nav";

export const metadata = { title: "Leads | SRT Mission Control" };
export const dynamic = "force-dynamic";

// The lead book. Reads contacts directly — no Zoho.
//
// Filters ride on searchParams so the whole page stays a server component and
// every view is a shareable URL.

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  application_stage: string | null;
  working_state: string | null;
  source: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  next_action_reason: string | null;
  open_task_count: number | null;
}

function name(r: LeadRow): string {
  const n = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return n || r.business_name || r.email || "Unknown";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; unscheduled?: string }>;
}) {
  const sp = await searchParams;

  // A lead on the Take Off List is parked at working_state 'closed', which is
  // the predicate every live-lead query in the app already uses — so it drops
  // out of this list for free. The one place it must still be visible is its
  // own chip: without this, clicking "Take Off List" would show an empty table
  // and look like the leads had been deleted rather than shelved.
  const showingTerminal = !!sp.status && isTerminalStage(sp.status);

  let query = supabaseAdmin
    .from("contacts")
    .select(
      "id, first_name, last_name, business_name, email, phone, application_stage, working_state, source, last_activity_at, next_action_at, next_action_reason, open_task_count"
    )
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    // Secondary key so the order is TOTAL. Roughly 7,400 of 8,300 contacts have never
    // been touched and so share a NULL last_activity_at; without a tiebreaker Postgres
    // returns those in arbitrary order that can differ between two identical requests,
    // which makes "the list I was just looking at" a meaningless phrase.
    .order("id", { ascending: true })
    .limit(200);

  if (!showingTerminal) query = query.neq("working_state", "closed");
  if (sp.status) query = query.eq("application_stage", sp.status);
  if (sp.unscheduled === "1") query = query.eq("open_task_count", 0);
  if (sp.q) {
    const like = `%${sp.q}%`;
    query = query.or(
      `business_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`
    );
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as LeadRow[];

  // The hunt queue: this list, in this order, as it stands right now.
  const queueIds = rows.map((r) => r.id);
  const queueLabel = sp.q
    ? `Search: ${sp.q}`
    : sp.status
      ? `Leads: ${sp.status}`
      : sp.unscheduled === "1"
        ? "Leads with no follow-up"
        : "All leads";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-white">Leads</h1>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
            {rows.length} shown{rows.length === 200 ? " (capped)" : ""}
          </p>
        </div>
        <form className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search name, business, email…"
            className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-1.5 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
          />
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <button className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-white">
            Search
          </button>
        </form>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        <Link
          href="/dashboard/leads"
          className={`rounded-lg border px-2.5 py-1 text-[11px] ${
            !sp.status && sp.unscheduled !== "1"
              ? "border-white/40 text-white"
              : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.45)]"
          }`}
        >
          All
        </Link>
        <Link
          href="/dashboard/leads?unscheduled=1"
          className={`rounded-lg border px-2.5 py-1 text-[11px] ${
            sp.unscheduled === "1"
              ? "border-[#9C27B0] text-[#9C27B0]"
              : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.45)]"
          }`}
        >
          No follow-up scheduled
        </Link>
        {ALL_STAGES.map((s) => (
          <Link
            key={s.name}
            href={`/dashboard/leads?status=${encodeURIComponent(s.name)}`}
            className="rounded-lg border px-2.5 py-1 text-[11px]"
            style={{
              borderColor: sp.status === s.name ? s.color : "rgba(255,255,255,0.08)",
              color: sp.status === s.name ? s.color : "rgba(255,255,255,0.45)",
            }}
          >
            {s.name}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgba(255,255,255,0.07)]">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-[rgba(255,255,255,0.03)] text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.35)]">
            <tr>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Last touch</th>
              <th className="px-3 py-2.5">Next follow-up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.02)]"
              >
                <td className="px-3 py-2.5">
                  {/* Freezes this exact list so the next/prev arrows on the lead page
                      walk it in this order, even after logging a call reshuffles the
                      underlying query. */}
                  <HuntLink
                    id={r.id}
                    ids={queueIds}
                    label={queueLabel}
                    className="text-white hover:underline"
                  >
                    {name(r)}
                  </HuntLink>
                  {r.business_name && r.business_name !== name(r) && (
                    <p className="text-[11px] text-[rgba(255,255,255,0.35)]">{r.business_name}</p>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px]"
                    style={{
                      background: `${stageColor(r.application_stage)}22`,
                      color: stageColor(r.application_stage),
                    }}
                  >
                    {r.application_stage ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[rgba(255,255,255,0.45)]">
                  {r.source ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-[rgba(255,255,255,0.45)]">
                  {r.last_activity_at ? formatRelativeTime(r.last_activity_at) : "never"}
                </td>
                <td className="px-3 py-2.5">
                  {r.next_action_at ? (
                    <span className="text-[rgba(255,255,255,0.6)]">
                      {r.next_action_at.slice(0, 10)}
                      {r.next_action_reason && (
                        <span className="text-[rgba(255,255,255,0.3)]">
                          {" "}
                          · {r.next_action_reason}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[#9C27B0]">none scheduled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-[rgba(255,255,255,0.35)]">
            No leads match.
          </p>
        )}
      </div>
    </div>
  );
}
