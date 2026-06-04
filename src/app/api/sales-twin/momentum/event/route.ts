import { supabaseAdmin } from "@/lib/db";
import { evaluateConnect, evaluateWindowExpired, MomentumSnapshot } from "@/lib/sales-twin/momentum";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID = process.env.ST_DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";

// In-process window connects (fine for single-server demo).
const windowConnects: Date[] = [];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { eventType, leadId } = body as { eventType: string; leadId?: string };

  const { data: snapshot } = await supabaseAdmin
    .from("st_momentum_state")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .single();

  const { data: configRows } = await supabaseAdmin
    .from("st_config_kv")
    .select("key,value")
    .eq("tenant_id", TENANT_ID)
    .in("key", ["momentum_required_connects", "momentum_window_minutes", "momentum_green_duration_minutes"]);

  const cfg = Object.fromEntries((configRows || []).map((r) => [r.key, r.value]));
  const config = {
    required_connects: Number(cfg.momentum_required_connects) || 3,
    window_minutes: Number(cfg.momentum_window_minutes) || 8,
    green_duration_minutes: Number(cfg.momentum_green_duration_minutes) || 15,
  };

  const now = new Date();
  let result: { nextSnapshot: MomentumSnapshot; didFlipToGreen: boolean; didExtendGreen: boolean };
  let transitioned = false;
  const snap = (snapshot || { current_state: "RED", consecutive_connects: 0 }) as unknown as MomentumSnapshot;

  if (eventType === "connect") {
    windowConnects.push(now);
    const cutoff = new Date(now.getTime() - config.window_minutes * 60 * 1000);
    while (windowConnects.length && windowConnects[0] < cutoff) windowConnects.shift();

    result = evaluateConnect(snap, config, windowConnects, now);
    transitioned = result.didFlipToGreen;

    await supabaseAdmin
      .from("st_momentum_state")
      .update({ ...result.nextSnapshot, updated_at: now.toISOString() })
      .eq("tenant_id", TENANT_ID);

    if (leadId) {
      const { data: lead } = await supabaseAdmin
        .from("st_leads")
        .select("id")
        .eq("tenant_id", TENANT_ID)
        .eq("external_id", leadId)
        .single();
      if (lead) {
        await supabaseAdmin.from("st_lead_timeline_events").insert({
          tenant_id: TENANT_ID,
          lead_id: lead.id,
          event_type: "disposition",
          channel: "call",
          direction: "outbound",
          body: `Connected — momentum: ${windowConnects.length}/${config.required_connects} in window`,
          occurred_at: now.toISOString(),
        });
      }
    }
  } else if (eventType === "window_expired") {
    const nextSnapshot = evaluateWindowExpired(snap, now);
    transitioned = snap.current_state === "GREEN";
    await supabaseAdmin
      .from("st_momentum_state")
      .update({ ...nextSnapshot, updated_at: now.toISOString() })
      .eq("tenant_id", TENANT_ID);
    windowConnects.length = 0;
    result = { nextSnapshot, didFlipToGreen: false, didExtendGreen: false };
  } else {
    // no_answer, disconnect — no state change
    result = { nextSnapshot: snap, didFlipToGreen: false, didExtendGreen: false };
  }

  return NextResponse.json({
    previousState: snap?.current_state,
    newState: result.nextSnapshot.current_state,
    transitioned,
    didFlipToGreen: result.didFlipToGreen,
    didExtendGreen: result.didExtendGreen,
  });
}
