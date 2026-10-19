// What reached this client's hub, by day and by page.
//
// Behind auth, and internal. It reads hub_hits, which is written by /api/internal/hub-hit
// from middleware. Nothing on this page is ever rendered on a client-facing surface.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { listAllForBoard } from "@/lib/hub/pages";
import { loadHubMetrics, loadReviewFunnel } from "@/lib/hub/analytics";
import { MIN_WALKS_FOR_RATE, referralFunnel, walkFunnel } from "@/lib/hub/review-funnel";
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
  const [metrics, pages, funnelRows] = await Promise.all([
    loadHubMetrics(id, days),
    listAllForBoard(id),
    loadReviewFunnel(id, days),
  ]);

  // Folded here rather than in the view, so the view stays a renderer and the step ORDER stays in
  // REVIEW_SCRIPT. null means the read failed or the migration has not run; the section is absent
  // rather than showing zeroes, because zeroes would say "nobody walked it".
  const walk = funnelRows ? walkFunnel(funnelRows.walk) : null;
  const referral = funnelRows ? referralFunnel(funnelRows.referral) : null;

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

      {/*
        ‼️ THE REVIEW WALK'S OWN FUNNEL. Conversion per step, per form, which is what was asked
        for. It sits under the traffic rather than inside MetricsView because they measure
        different populations: the chart above counts every request to the client's hostname,
        including AI crawlers, and this counts patients who typed something.

        ‼️ THE EXPOSURE NUMBER COMES FROM THE CHART ABOVE AND IT IS THE ONLY HONEST DENOMINATOR
        FOR "OPENED IT". review_tool_submissions has no row for somebody who opened the page and
        typed nothing, and it must never have one: a session id on that table is a spec violation
        by its own migration. hub_hits counts the open; the funnel counts the walk.

        ‼️ NO RATING BREAKDOWN, DELIBERATELY. "Conversion by star rating" is one step from showing
        the public link to happy patients and a private box to unhappy ones, which is the gating
        funnel this tool refuses to be and which Google prohibits. The data cannot answer it.
      */}
      {walk && referral && (
        <section className="mt-10">
          <h2 className="text-lg font-medium text-white">The review walk</h2>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
            Patients who answered at least one question, over the same {days} days.{" "}
            {walk.started === 0
              ? "Nobody has walked it yet."
              : walk.started < MIN_WALKS_FOR_RATE
                ? `${walk.started} walk${walk.started === 1 ? "" : "s"} so far, which is too few ` +
                  `for a percentage to mean anything, so this shows counts only. Rates appear at ` +
                  `${MIN_WALKS_FOR_RATE}.`
                : `${walk.started} walks, ${walk.completed} of which reached a finished review.`}
          </p>

          {walk.started > 0 && (
            <>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[rgba(255,255,255,0.4)]">
                    <th className="pb-2 font-normal">Step</th>
                    <th className="pb-2 text-right font-normal">Reached</th>
                    <th className="pb-2 text-right font-normal">Of all walks</th>
                  </tr>
                </thead>
                <tbody>
                  {walk.steps.map((step) => (
                    <tr key={step.id} className="border-t border-[rgba(255,255,255,0.06)]">
                      <td className="py-2 text-[rgba(255,255,255,0.75)]">{step.label}</td>
                      <td className="py-2 text-right tabular-nums text-white">{step.reached}</td>
                      <td className="py-2 text-right tabular-nums text-[rgba(255,255,255,0.5)]">
                        {step.rate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-3 text-xs text-[rgba(255,255,255,0.35)]">
                {walk.edited} of the finished reviews were edited before copying, and{" "}
                {walk.regenerated} tried another wording.
                {walk.unknown > 0
                  ? ` ${walk.unknown} walk(s) stopped at a step this build no longer has, counted in the totals and not in the table.`
                  : ""}
              </p>
              {/*
                The one claim this page must not let somebody make on a call. It is in the same
                element as the numbers, following funnel-report.ts's rule that a caveat kept beside
                its figures cannot be separated from them by a later tidy-up.
              */}
              <p className="mt-1 text-xs text-[rgba(255,255,255,0.35)]">
                Reaching a finished review is the furthest thing we can observe. Nothing here
                counts reviews actually posted to Google: no code path can see that happen.
              </p>
            </>
          )}

          {referral.invites > 0 && (
            <>
              <h3 className="mt-8 text-sm font-medium text-white">Referrals</h3>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[rgba(255,255,255,0.4)]">
                    <th className="pb-2 font-normal">How she sent it</th>
                    <th className="pb-2 text-right font-normal">Invites</th>
                    <th className="pb-2 text-right font-normal">Opened her app</th>
                    <th className="pb-2 text-right font-normal">Claimed</th>
                    <th className="pb-2 text-right font-normal">Claim rate</th>
                  </tr>
                </thead>
                <tbody>
                  {referral.channels.map((row) => (
                    <tr key={row.channel} className="border-t border-[rgba(255,255,255,0.06)]">
                      <td className="py-2 text-[rgba(255,255,255,0.75)]">{row.channel}</td>
                      <td className="py-2 text-right tabular-nums text-white">{row.invites}</td>
                      <td className="py-2 text-right tabular-nums text-[rgba(255,255,255,0.75)]">
                        {row.sent}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[rgba(255,255,255,0.75)]">
                        {row.claimed}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[rgba(255,255,255,0.5)]">
                        {row.claimRate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-[rgba(255,255,255,0.35)]">
                &quot;Opened her app&quot; is as far as we can see. We are not the sender, so
                nothing here is a delivery confirmation.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
