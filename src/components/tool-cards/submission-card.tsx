"use client";

import Link from "next/link";

interface SubmissionData {
  success?: boolean;
  draft_id?: string;
  lender_name?: string;
  to_email?: string;
  subject?: string;
  message?: string;
  error?: string;
}

export function SubmissionCard({ data }: { data: SubmissionData }) {
  if (data.error) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(231,76,60,0.2)] bg-[rgba(231,76,60,0.05)] px-4 py-3">
        <p className="text-sm text-[#E74C3C]">{data.error}</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(0,201,167,0.2)] bg-[rgba(0,201,167,0.03)] px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[#00C9A7] uppercase tracking-wider">Submission Draft Created</span>
        <Link href="/dashboard/email-agents" className="text-[10px] text-[#00C9A7] hover:underline">
          Review in Submissions →
        </Link>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[rgba(255,255,255,0.4)]">Lender:</span>
          <span className="text-white font-medium">{data.lender_name}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[rgba(255,255,255,0.4)]">To:</span>
          <span className="text-white">{data.to_email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[rgba(255,255,255,0.4)]">Subject:</span>
          <span className="text-white truncate">{data.subject}</span>
        </div>
      </div>
      <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-2">
        Draft saved. Review and approve in the Submissions page to send via Outlook.
      </p>
    </div>
  );
}
