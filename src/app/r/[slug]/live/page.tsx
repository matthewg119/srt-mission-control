// Screenshot-mode companion — one-tap links to run each prompt live in
// ChatGPT/Perplexity/Google AI from a phone, for manual screenshot capture.
// No client JS needed; this is a link directory, not an app.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/db";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function engineLinks(prompt: string) {
  const q = encodeURIComponent(prompt);
  return [
    { label: "Open in ChatGPT", href: `https://chatgpt.com/?q=${q}` },
    { label: "Open in Perplexity", href: `https://www.perplexity.ai/search?q=${q}` },
    { label: "Open in Google AI", href: `https://www.google.com/search?udm=50&q=${q}` },
  ];
}

export default async function LiveScreenshotPage({ params }: { params: { slug: string } }) {
  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slug", params.slug)
    .maybeSingle();

  if (!report) notFound();
  const row = report as AuditReportRow;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <h1 className="text-lg font-semibold text-text-primary">Screenshot mode · {row.business_type ?? row.website}</h1>
      <p className="text-sm text-text-secondary">Tap a link to run that prompt live and grab a screenshot.</p>
      <div className="space-y-3">
        {row.prompts.map((p, i) => (
          <div key={i} className="rounded-lg border border-surface-border bg-surface p-3">
            <p className="mb-2 text-sm text-text-primary">{p.prompt}</p>
            <div className="flex flex-wrap gap-2">
              {engineLinks(p.prompt).map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-surface-border px-3 py-1 text-xs text-ocean hover:bg-surface-hover"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
