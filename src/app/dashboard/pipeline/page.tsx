import { PipelineBoard } from "@/components/pipeline-board";
import { supabaseAdmin } from "@/lib/db";

export const metadata = { title: "Pipeline | SRT Mission Control" };

export default async function PipelinePage() {
  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, stage, pipeline, amount, assigned_to, updated_at, contact_id, contacts(first_name, last_name, business_name)")
    .order("updated_at", { ascending: false });

  // Transform to the shape PipelineBoard expects
  const boardDeals = (deals || []).map((d) => {
    const c = d.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
    return {
      id: d.id,
      contact_name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown",
      business_name: c?.business_name || "",
      stage: d.stage,
      pipeline: d.pipeline,
      amount: d.amount,
      assigned_to: d.assigned_to,
      last_activity: d.updated_at,
      updated_at: d.updated_at,
    };
  });

  return <PipelineBoard initialDeals={boardDeals} />;
}
