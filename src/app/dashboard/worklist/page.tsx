import Link from "next/link";
import { buildWorklist, worklistSummary } from "@/lib/worklist";
import { WorklistBoard } from "@/components/crm/worklist-board";

export const metadata = { title: "Call list | SRT Mission Control" };
export const dynamic = "force-dynamic";

// "Who do we need to call today?", as a page.
//
// Same buildWorklist() the chatbot's get_worklist tool and the Slack digest
// call, so asking Vektor and opening this page give the same answer. All of it
// reads Supabase — no Zoho call anywhere in this path.

export default async function WorklistPage() {
  const [leads, summary] = await Promise.all([
    buildWorklist({ limit: 100 }),
    worklistSummary(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-white">Call list</h1>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
            {summary.total === 0
              ? "Nothing outstanding."
              : `${summary.total} leads need attention. Every logged call sets the next follow-up date.`}
          </p>
        </div>
        <Link
          href="/dashboard/assistant?q=Who%20do%20we%20need%20to%20call%20today%3F"
          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)] hover:text-white"
        >
          Ask Vektor instead
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Replied", value: summary.byBucket.replied, tone: "#00C9A7" },
          { label: "Overdue", value: summary.byBucket.overdue, tone: "#E74C3C" },
          { label: "Due today", value: summary.byBucket.due_today, tone: "#F5A623" },
          { label: "No follow-up", value: summary.byBucket.unscheduled, tone: "#9C27B0" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5"
          >
            <p className="text-lg font-medium" style={{ color: s.tone }}>
              {s.value}
            </p>
            <p className="text-[11px] text-[rgba(255,255,255,0.4)]">{s.label}</p>
          </div>
        ))}
      </div>

      <WorklistBoard leads={leads} />
    </div>
  );
}
