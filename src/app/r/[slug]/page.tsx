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
import { CompetitorSection } from "@/components/audit-report/CompetitorSection";
import { MethodologyFooter } from "@/components/audit-report/MethodologyFooter";
import { WhatsAppCta } from "@/components/audit-report/WhatsAppCta";
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
        </>
      )}

      <WhatsAppCta />
      <MethodologyFooter createdAt={row.created_at} />
    </main>
  );
}
