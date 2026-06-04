// DEBUG: list distinct Zoho Lead_Source values (from a recent sample) so the
// exact picklist strings can be confirmed — e.g. "DB 1.0" for the red queue and
// the green funnel names (Meta Ads / BusinessFunding). Open /api/sales-twin/zoho/sources
import { listLeadSources } from "@/lib/sales-twin/zoho-bridge";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sample = Math.min(parseInt(new URL(req.url).searchParams.get("sample") || "400", 10), 2000);
  try {
    const { counts, sampled, apiCallsUsed } = await listLeadSources(sample);
    const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
    return NextResponse.json({ sampled, apiCallsUsed, sources: sorted });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
