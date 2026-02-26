import { PipelineBoard } from "@/components/pipeline-board";
import { supabaseAdmin } from "@/lib/db";

export const metadata = { title: "Pipeline | SRT Mission Control" };

export default async function PipelinePage() {
  const { data: deals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*")
    .order("synced_at", { ascending: false });

  return <PipelineBoard initialDeals={deals || []} />;
}
