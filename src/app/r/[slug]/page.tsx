// Public branded AI Visibility Report — no auth (src/middleware.ts only guards
// /dashboard), noindex + slug obscurity is the only access control. Server
// component only: the service-role Supabase client never reaches the browser.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/db";
import { buildReportView } from "@/lib/audit-engine/report-view";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { ReportHeader } from "@/components/audit-report/ReportHeader";
import { ScoreGauge } from "@/components/audit-report/ScoreGauge";
import { BlockBreakdown } from "@/components/audit-report/BlockBreakdown";
import { PromptTable } from "@/components/audit-report/PromptTable";
import { SourcesSection } from "@/components/audit-report/SourcesSection";
import { targetsForReport } from "@/lib/clients/offsite-targets";
import { CompetitorSection } from "@/components/audit-report/CompetitorSection";
import { MethodologyFooter } from "@/components/audit-report/MethodologyFooter";
import { PricingCta } from "@/components/audit-report/PricingCta";
import { ReferralEngineNudge } from "@/components/audit-report/ReferralEngineNudge";
import type { AuditReportRow, AuditRunRow } from "@/lib/audit-engine/types";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params }: { params: { slug: string } }) {
  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!report) notFound();
  const row = report as AuditReportRow;

  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", row.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const clientAliases = buildAliases(row.client_name ?? row.business_type ?? row.website, row.website);
  const view = buildReportView(row, runs, clientAliases);

  const isPending = row.status !== "done" && row.status !== "failed";

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <ReportHeader
        businessType={row.business_type}
        city={row.city}
        clientName={row.client_name}
        createdAt={row.created_at}
      />

      {isPending && (
        <div className="rounded-lg border border-surface-border bg-surface p-4 text-sm text-text-secondary">
          ⏳ This report is still running — check back in a few minutes.
        </div>
      )}

      {row.status === "failed" && (
        <div className="rounded-lg border border-surface-border bg-surface p-4 text-sm text-text-secondary">
          This audit didn&apos;t complete. No fabricated data is shown — re-run <code>/audit {row.website}</code> in
          Slack to try again.
        </div>
      )}

      {view.totalPrompts > 0 && (
        <>
          <p className="text-center text-sm text-text-secondary">
            {view.totalPrompts} questions real buyers ask before choosing a{" "}
            {row.business_type ?? "business like this one"}
          </p>
          <ScoreGauge score={row.score ?? 0} mentioned={view.totalMentioned} total={view.totalPrompts} />
          <BlockBreakdown blockStats={view.blockStats} />
          <PromptTable prompts={view.prompts} />
          <CompetitorSection
            mostRecommended={view.mostRecommended}
            citedDomains={view.citedDomains}
            likelyCompetitors={row.competitors}
          />
          {/*
            Where the engines read before answering. The data was always collected and never
            shown: see SourcesSection. It renders nothing when a report has no citations, which
            is every report run before the engines started returning them.
          */}
          <SourcesSection targets={await targetsForReport(row.id)} />
        </>
      )}

      {/* Everything here is already in scope. The CTA turns it into the /chatgpt-ads link so
          the funnel opens on their own score rather than a generic headline. */}
      <PricingCta
        score={row.score}
        city={row.city}
        business={row.client_name}
        competitor={view.mostRecommended[0]?.name ?? null}
        mentioned={view.totalMentioned}
        totalPrompts={view.totalPrompts}
        reportSlug={params.slug}
        // ‼️ THE LAST HOP OF THE CAMPAIGN, AND WITHOUT IT THE FIRST THREE WERE POINTLESS.
        // These four were stamped onto this row when the scan ran. The report is opened from an
        // email days later, so nothing in the browser remembers the link that started it: the
        // row is the only thing that does.
        utm={{
          utmSource: row.utm_source,
          utmMedium: row.utm_medium,
          utmCampaign: row.utm_campaign,
          utmContent: row.utm_content,
        }}
      />
      <MethodologyFooter createdAt={row.created_at} />

      {/*
        The same door as Get Started above, reachable from anywhere on the page.

        ‼️ EVERY PROP IS THE ONE PricingCta WAS JUST GIVEN, INCLUDING utm, AND THAT IS NOT
        DUPLICATION TO TIDY AWAY. Both build their href through buildOnboarding2Url(), so a prop
        dropped here does not break anything visible: it silently produces a funnel link missing a
        score, a slug or a campaign, and the signing that follows is then attributable to nothing.
        The two lists must stay equal. If a third surface ever needs them, lift them into one
        object in this component rather than letting a third copy drift.

        ‼️ RENDERED EVEN ON A PENDING OR FAILED REPORT, deliberately. Somebody whose audit did not
        complete has still asked us to look at them, and the free engine does not depend on a score.
        buildOnboarding2Url omits missing params rather than sending them blank, which is documented
        behaviour on the destination.
      */}
      <ReferralEngineNudge
        score={row.score}
        city={row.city}
        business={row.client_name}
        competitor={view.mostRecommended[0]?.name ?? null}
        mentioned={view.totalMentioned}
        totalPrompts={view.totalPrompts}
        reportSlug={params.slug}
        utm={{
          utmSource: row.utm_source,
          utmMedium: row.utm_medium,
          utmCampaign: row.utm_campaign,
          utmContent: row.utm_content,
        }}
      />
    </main>
  );
}
