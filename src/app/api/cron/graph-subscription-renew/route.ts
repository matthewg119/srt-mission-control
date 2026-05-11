export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const renewWindowMs = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const { data: rows, error } = await supabaseAdmin
    .from("integrations")
    .select("name, config")
    .like("name", "graph_subscription_%");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const row of rows ?? []) {
    const cfg = (row as { name: string; config: { subscription_id?: string; expires_at?: string } }).config;
    if (!cfg?.subscription_id || !cfg?.expires_at) continue;

    const expiresMs = new Date(cfg.expires_at).getTime();
    if (expiresMs - nowMs > renewWindowMs) {
      results.push({ name: row.name, skipped: "not_due" });
      continue;
    }

    try {
      const renewed = await microsoft.renewSubscription(cfg.subscription_id);
      await supabaseAdmin
        .from("integrations")
        .update({
          config: { ...cfg, expires_at: renewed.expirationDateTime },
          updated_at: new Date().toISOString(),
        })
        .eq("name", row.name);
      results.push({ name: row.name, renewed_to: renewed.expirationDateTime });
    } catch (e) {
      results.push({ name: row.name, error: (e as Error).message });
    }
  }

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_graph_subscription_renew",
    description: `Renewed ${results.filter((r) => r.renewed_to).length} of ${results.length} subscriptions`,
    metadata: { results },
  });

  return NextResponse.json({ ok: true, results });
}
