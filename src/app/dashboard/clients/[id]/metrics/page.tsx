// What reached this client's hub, by day and by page.
//
// Behind auth, and internal. It reads hub_hits, which is written by /api/internal/hub-hit
// from middleware. Nothing on this page is ever rendered on a client-facing surface.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { listAllForBoard } from "@/lib/hub/pages";
import { loadHubMetrics } from "@/lib/hub/analytics";
import { subdomainLabel } from "@/lib/clients/normalize";
import { MetricsView } from "./metrics-view";

// Same as the board it hangs off. supabase-js calls the patched global fetch, so without
// fetchCache a read lands in the DATA cache and the page serves a stale chart.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const RANGES = [7, 30, 90] as const;

export default async function ClientMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  const { days: daysParam } = await searchParams;

  const days = RANGES.includes(Number(daysParam) as (typeof RANGES)[number])
    ? Number(daysParam)
    : 30;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, domain, subdomain")
    .eq("id", id)
    .maybeSingle();

  if (!client) notFound();

  // listAllForBoard, not listPublished: a draft page that nothing has fetched and a
  // published page that nothing has fetched are different facts and the table says which.
  const [metrics, pages] = await Promise.all([loadHubMetrics(id, days), listAllForBoard(id)]);

  const name = (client.dba_name as string) || (client.legal_name as string);
  const hubBase =
    client.domain && client.subdomain
      ? `${subdomainLabel(client.subdomain as string, client.domain as string)}.${client.domain as string}`
      : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/dashboard/clients/${id}`}
        className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white"
      >
        {name}
      </Link>

      <div className="mb-6 mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium text-white">Traffic</h1>
          {hubBase && <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">{hubBase}</p>}
        </div>

        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/dashboard/clients/${id}/metrics?days=${r}`}
              className={
                r === days
                  ? "rounded-lg border border-[rgba(0,201,167,0.35)] bg-[rgba(0,201,167,0.07)] px-2.5 py-1 text-xs text-[#00C9A7]"
                  : "rounded-lg border border-[rgba(255,255,255,0.07)] px-2.5 py-1 text-xs text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.03)]"
              }
            >
              {r}d
            </Link>
          ))}
        </div>
      </div>

      <MetricsView
        daily={metrics.daily}
        pages={metrics.pages}
        agents={metrics.agents}
        perPageDaily={metrics.perPageDaily}
        totals={metrics.totals}
        lastHitAt={metrics.lastHitAt}
        days={days}
        known={pages.map((p) => ({ slug: p.slug, title: p.title, status: p.status }))}
        hubBase={hubBase}
      />
    </div>
  );
}
