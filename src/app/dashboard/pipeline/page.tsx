import { supabaseAdmin } from "@/lib/db";
import Link from "next/link";

export const metadata = { title: "Pipeline | SRT Mission Control" };

export const dynamic = "force-dynamic";

interface DealRow {
  id: string;
  zoho_stage: string | null;
  amount: number | null;
  assigned_to: string | null;
  updated_at: string;
  contact_id: string | null;
  contacts: { first_name: string | null; last_name: string | null; business_name: string | null; zoho_lead_id: string | null } | null;
}

function stageColor(stage: string | null): string {
  const s = (stage ?? "").toLowerCase();
  if (s.includes("funded")) return "#4CAF50";
  if (s.includes("approved")) return "#00BCD4";
  if (s.includes("shopping") || s.includes("underwriting")) return "#1B65A7";
  if (s.includes("contract")) return "#00C9A7";
  if (s.includes("declined") || s.includes("dead") || s.includes("lost")) return "#E74C3C";
  if (s.includes("stip")) return "#F5A623";
  return "#9CA3AF";
}

function formatDollars(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString()}`;
}

export default async function PipelinePage() {
  const { data } = await supabaseAdmin
    .from("deals")
    .select(
      "id, zoho_stage, amount, assigned_to, updated_at, contact_id, contacts(first_name, last_name, business_name, zoho_lead_id)"
    )
    .order("updated_at", { ascending: false })
    .limit(300);

  const rows = (data ?? []) as unknown as DealRow[];
  const byStage = new Map<string, DealRow[]>();
  for (const d of rows) {
    const key = d.zoho_stage || "(unmapped)";
    const list = byStage.get(key) ?? [];
    list.push(d);
    byStage.set(key, list);
  }
  const stages = [...byStage.keys()].sort();

  return (
    <div className="p-6 space-y-4">
      <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Read-only Zoho mirror.</strong> Stage is owned by Zoho. Edit a deal in Zoho CRM —
        the change will reflect here within 10 minutes via webhook + reconciliation cron.
      </div>

      <h1 className="text-xl font-semibold">Pipeline ({rows.length} deals)</h1>

      <div className="flex gap-4 overflow-x-auto">
        {stages.map((stage) => {
          const deals = byStage.get(stage) ?? [];
          return (
            <div key={stage} className="min-w-[260px] flex-shrink-0 rounded bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div
                  className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: stageColor(stage) }}
                >
                  {stage}
                </div>
                <span className="text-xs text-gray-500">{deals.length}</span>
              </div>
              <div className="space-y-2">
                {deals.map((d) => {
                  const name = d.contacts?.business_name
                    || [d.contacts?.first_name, d.contacts?.last_name].filter(Boolean).join(" ")
                    || "Unknown";
                  const zohoUrl = d.contacts?.zoho_lead_id
                    ? `https://crm.zoho.com/crm/org/tab/Leads/${d.contacts.zoho_lead_id}`
                    : null;
                  return (
                    <div key={d.id} className="rounded border border-gray-200 bg-white p-2 text-sm">
                      <Link href={`/dashboard/deals/${d.id}`} className="font-medium text-gray-900 hover:underline">
                        {name}
                      </Link>
                      <div className="mt-0.5 flex items-center justify-between text-xs text-gray-500">
                        <span>{formatDollars(d.amount)}</span>
                        {zohoUrl && (
                          <a href={zohoUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            Open in Zoho ↗
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
