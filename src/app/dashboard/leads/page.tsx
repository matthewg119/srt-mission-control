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

// One page of the book. The old cap was a bare .limit(200) with a separate
// `rows.length === 200` check to decide whether to print "(capped)" — two magic
// numbers that would disagree the moment either moved.
const PAGE_SIZE = 100;

type LeadSearchParams = {
  status?: string;
  q?: string;
  unscheduled?: string;
  page?: string;
};

// Every link on this page has to carry the filters the others set, or the page
// number silently resets a search and the chips silently drop it. One helper so
// there is exactly one answer to "what does this link keep".
//
// `page` is always stripped: changing a filter means the old offset describes a
// different result set. Prev/Next build their hrefs separately for that reason.
function hrefWith(sp: LeadSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) {
    if (v) next.set(k, v);
  }
  next.delete("page");
  const qs = next.toString();
  return `/dashboard/leads${qs ? `?${qs}` : ""}`;
}

function pageHref(sp: LeadSearchParams, page: number): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v) next.set(k, v);
  }
  if (page > 1) next.set("page", String(page));
  else next.delete("page");
  const qs = next.toString();
  return `/dashboard/leads${qs ? `?${qs}` : ""}`;
}

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

// Same button styling the Search button already uses, dimmed at the ends of the
// book so the control reads as present-but-spent rather than disappearing.
const pagerBtn =
  "rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-white";
const pagerBtnOff =
  "rounded-lg border border-[rgba(255,255,255,0.05)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.2)]";

function name(r: LeadRow): string {
  const n = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return n || r.business_name || r.email || "Unknown";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<LeadSearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // A lead on the Take Off List is parked at working_state 'closed', which is
  // the predicate every live-lead query in the app already uses — so it drops
  // out of this list for free. The one place it must still be visible is its
  // own chip: without this, clicking "Take Off List" would show an empty table
  // and look like the leads had been deleted rather than shelved.
  const showingTerminal = !!sp.status && isTerminalStage(sp.status);

  let query = supabaseAdmin
    .from("contacts")
    .select(
      "id, first_name, last_name, business_name, email, phone, application_stage, working_state, source, last_activity_at, next_action_at, next_action_reason, open_task_count",
      // The page can't say "of 8,312" without asking. An exact count is a full
      // count scan, but the table is ~8k rows and /api/contacts already pays it.
      { count: "exact" }
    )
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    // Secondary key so the order is TOTAL. Roughly 7,400 of 8,300 contacts have never
    // been touched and so share a NULL last_activity_at; without a tiebreaker Postgres
    // returns those in arbitrary order that can differ between two identical requests,
    // which makes "the list I was just looking at" a meaningless phrase.
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (!showingTerminal) query = query.neq("working_state", "closed");
  if (sp.status) query = query.eq("application_stage", sp.status);
  if (sp.unscheduled === "1") query = query.eq("open_task_count", 0);
  if (sp.q) {
    // The term is interpolated into a PostgREST .or() filter expression, where
    // a comma separates conditions, a dot separates column.operator.value and a
    // paren closes the group. Any of the three from a user corrupts the filter.
    const safe = sp.q.replace(/[,.()"\\]/g, " ").trim();
    if (safe) {
      const like = `%${safe}%`;
      query = query.or(
        `business_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`
      );
    }
  }

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as LeadRow[];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The hunt queue: this list, in this order, as it stands right now.
  //
  // With paging that is THIS PAGE's ids, which is what the arrows should walk —
  // but the label has to say which page, or hunt-nav's "3 of 100" counter is
  // describing a different hundred than the one the label names.
  const queueIds = rows.map((r) => r.id);
  const queueBase = sp.q
    ? `Search: ${sp.q}`
    : sp.status
      ? `Leads: ${sp.status}`
      : sp.unscheduled === "1"
        ? "Leads with no follow-up"
        : "All leads";
  const queueLabel = page > 1 ? `${queueBase} (p${page})` : queueBase;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-white">Leads</h1>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
            {total === 0
              ? "No leads match"
              : `Showing ${offset + 1}-${offset + rows.length} of ${total.toLocaleString()}`}
          </p>
        </div>
        {/* A new search starts at page 1, so `page` is deliberately not carried. */}
        <form className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search name, business, email…"
            className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-1.5 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
          />
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          {sp.unscheduled === "1" && <input type="hidden" name="unscheduled" value="1" />}
          <button className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-white">
            Search
          </button>
        </form>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.35)]">
          Show only
        </p>
        {/* One exclusive choice: `status` and `unscheduled` are different columns,
            so each chip clears the other. Everything else on the URL survives. */}
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={hrefWith(sp, { status: null, unscheduled: null })}
            className={`rounded-lg border px-2.5 py-1 text-[11px] ${
              !sp.status && sp.unscheduled !== "1"
                ? "border-white/40 text-white"
                : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.45)]"
            }`}
          >
            All
          </Link>
          <Link
            href={hrefWith(sp, { unscheduled: "1", status: null })}
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
              href={hrefWith(sp, { status: s.name, unscheduled: null })}
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

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={pageHref(sp, page - 1)} className={pagerBtn}>
              ← Prev
            </Link>
          ) : (
            <span className={pagerBtnOff}>← Prev</span>
          )}
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            Page {page} of {lastPage.toLocaleString()}
          </span>
          {page < lastPage ? (
            <Link href={pageHref(sp, page + 1)} className={pagerBtn}>
              Next →
            </Link>
          ) : (
            <span className={pagerBtnOff}>Next →</span>
          )}
        </div>
      )}
    </div>
  );
}
