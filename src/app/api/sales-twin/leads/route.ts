import { supabaseAdmin } from "@/lib/db";
import { fetchRedLeads, fetchGreenLeads, ZohoLead } from "@/lib/sales-twin/zoho-bridge";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID = process.env.ST_DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const CACHE_MS = 30 * 60 * 1000; // 30 min — the call list is stable
const READ_LIMIT = parseInt(process.env.ST_ZOHO_PULL_LIMIT || "300", 10);

async function readLeads(queue: "red" | "green") {
  const { data } = await supabaseAdmin
    .from("st_leads")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .filter("metadata->>queue", "eq", queue)
    .order("updated_at", { ascending: false })
    .limit(READ_LIMIT);
  return data || [];
}

async function getConfig(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("st_config_kv")
    .select("value")
    .eq("tenant_id", TENANT_ID)
    .eq("key", key)
    .maybeSingle();
  return data?.value ?? null;
}

export async function GET(req: NextRequest) {
  const queue = (new URL(req.url).searchParams.get("queue") === "green" ? "green" : "red") as "red" | "green";
  const lastSyncKey = `last_sync_${queue}`;

  try {
    const { data: integration } = await supabaseAdmin
      .from("st_integrations")
      .select("*")
      .eq("tenant_id", TENANT_ID)
      .eq("provider", "zoho")
      .single();

    const dailyBudget = parseInt(process.env.ST_ZOHO_DAILY_BUDGET || "80", 10);
    const today = new Date().toISOString().split("T")[0];
    const apiCallsToday = integration?.api_calls_reset_at === today ? integration?.api_calls_today || 0 : 0;

    if (integration && integration.api_calls_reset_at !== today) {
      await supabaseAdmin
        .from("st_integrations")
        .update({ api_calls_today: 0, api_calls_reset_at: today })
        .eq("tenant_id", TENANT_ID)
        .eq("provider", "zoho");
    }

    const lastSyncAt = await getConfig(lastSyncKey);
    const cacheAge = lastSyncAt ? Date.now() - new Date(lastSyncAt).getTime() : Infinity;

    // Cache hit — no Zoho call.
    if (cacheAge < CACHE_MS) {
      const leads = await readLeads(queue);
      return NextResponse.json({
        leads,
        meta: { queue, fromCache: true, apiCallsUsed: 0, apiCallsToday, dailyBudget, pulledAt: lastSyncAt, cacheAgeMs: cacheAge },
      });
    }

    // Budget guard — return whatever is cached rather than erroring.
    if (apiCallsToday + 2 > dailyBudget) {
      const leads = await readLeads(queue);
      return NextResponse.json({
        leads,
        meta: { queue, fromCache: true, budgetExceeded: true, apiCallsUsed: 0, apiCallsToday, dailyBudget, pulledAt: lastSyncAt },
      });
    }

    // Fresh pull from Zoho.
    let zohoLeads: ZohoLead[] = [];
    let apiCallsUsed = 0;
    try {
      const pulled = queue === "green" ? await fetchGreenLeads() : await fetchRedLeads();
      zohoLeads = pulled.leads;
      apiCallsUsed = pulled.apiCallsUsed;
    } catch (e) {
      console.error("[sales-twin] Zoho pull failed:", (e as Error).message);
      const leads = await readLeads(queue);
      return NextResponse.json({
        leads,
        meta: { queue, fromCache: true, zohoError: String((e as Error).message), apiCallsUsed: 0, apiCallsToday, dailyBudget, pulledAt: lastSyncAt },
      });
    }

    // Upsert into st_leads, tagging the queue in metadata.
    for (const lead of zohoLeads) {
      await supabaseAdmin.from("st_leads").upsert(
        {
          tenant_id: TENANT_ID,
          external_id: lead.external_id,
          name: lead.name,
          company: lead.company,
          phone: lead.phone,
          email: lead.email,
          stage: lead.stage,
          metadata: {
            queue: lead.queue,
            co: lead.co,
            initials: lead.initials,
            fund: lead.fund,
            rev: lead.rev,
            biz: lead.biz,
            score: lead.score,
            touch: lead.touch,
            sum: lead.sum,
            notes: lead.notes,
            slack: lead.slack,
            drafts: lead.drafts,
          },
          zoho_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,external_id", ignoreDuplicates: false }
      );
    }

    // Bump global API counter + record this queue's sync time.
    await supabaseAdmin.from("st_integrations").upsert(
      {
        tenant_id: TENANT_ID,
        provider: "zoho",
        status: "connected",
        last_sync_at: new Date().toISOString(),
        api_calls_today: apiCallsToday + apiCallsUsed,
        api_calls_reset_at: today,
      },
      { onConflict: "tenant_id,provider" }
    );
    await supabaseAdmin.from("st_config_kv").upsert(
      { tenant_id: TENANT_ID, key: lastSyncKey, value: new Date().toISOString() },
      { onConflict: "tenant_id,key" }
    );

    const leads = await readLeads(queue);
    return NextResponse.json({
      leads,
      meta: { queue, fromCache: false, apiCallsUsed, apiCallsToday: apiCallsToday + apiCallsUsed, dailyBudget, pulledAt: new Date().toISOString(), totalLeads: zohoLeads.length },
    });
  } catch (err) {
    console.error("Sales Twin leads error:", err);
    return NextResponse.json({ leads: [], error: String(err), meta: { queue } }, { status: 500 });
  }
}
