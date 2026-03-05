"use client";

interface SOSData {
  sos?: {
    business_profile?: Record<string, string>;
    owner_profile?: Record<string, string>;
    funding_request?: Record<string, unknown>;
    financial_summary?: Record<string, string>;
    additional_context?: string | null;
    notes?: string[];
    pipeline_info?: { stage: string; pipeline: string; days_in_pipeline: number };
  };
  message?: string;
  error?: string;
}

function Section({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-1.5">{title}</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="flex justify-between text-xs">
            <span className="text-[rgba(255,255,255,0.4)]">{label}</span>
            <span className="text-white font-medium">{value || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SOSCard({ data }: { data: SOSData }) {
  if (data.error) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.error}</p>
      </div>
    );
  }

  const sos = data.sos;
  if (!sos) return null;

  const bp = sos.business_profile || {};
  const op = sos.owner_profile || {};
  const fr = sos.funding_request || {};
  const fs = sos.financial_summary || {};
  const pi = sos.pipeline_info;

  return (
    <div className="my-2 rounded-xl border border-[rgba(27,101,167,0.3)] bg-[rgba(27,101,167,0.05)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[rgba(27,101,167,0.2)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#1B65A7] uppercase tracking-wider">Statement of Scenario</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(0,201,167,0.1)] text-[#00C9A7]">
            {bp.business_name || "Unknown"}
          </span>
        </div>
        {pi && (
          <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
            {pi.stage} · {pi.days_in_pipeline}d in pipeline
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        <Section
          title="Business Profile"
          items={[
            ["Business", bp.business_name || "—"],
            ["Industry", bp.industry || "—"],
            ["Entity", bp.entity_type || "—"],
            ["TIB", bp.time_in_business || "—"],
            ["Revenue", bp.annual_revenue || "—"],
            ["EIN", bp.ein || "—"],
          ]}
        />

        <Section
          title="Owner Profile"
          items={[
            ["Name", op.name || "—"],
            ["Credit", op.credit_score_range || "—"],
            ["Ownership", op.ownership_percentage || "—"],
            ["SSN", op.ssn_last4 || "—"],
          ]}
        />

        <Section
          title="Funding Request"
          items={[
            ["Amount", `$${typeof fr.amount_requested === 'number' ? (fr.amount_requested as number).toLocaleString() : fr.amount_requested || "—"}`],
            ["Use", (fr.use_of_funds as string) || "—"],
            ["Product", (fr.financing_type as string) || "—"],
          ]}
        />

        <Section
          title="Financial Summary"
          items={[
            ["Avg Monthly Balance", fs.avg_monthly_balance || "—"],
            ["Existing Loans", fs.existing_loans || "—"],
          ]}
        />

        {sos.additional_context && (
          <div>
            <h4 className="text-[10px] font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-1">Additional Context</h4>
            <p className="text-xs text-[rgba(255,255,255,0.6)] leading-relaxed">{sos.additional_context}</p>
          </div>
        )}

        {sos.notes && sos.notes.length > 0 && sos.notes[0] !== "No notes on file" && (
          <div>
            <h4 className="text-[10px] font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-1">Notes</h4>
            {sos.notes.map((n, i) => (
              <p key={i} className="text-xs text-[rgba(255,255,255,0.5)] italic">{n}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
