export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { recreateSubscription, DEFAULT_SUBSCRIPTION_PATH } from "@/lib/graph-subscription";

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
    const cfg = (row as {
      name: string;
      config: { subscription_id?: string; expires_at?: string; mailbox?: string; notification_path?: string };
    }).config;
    if (!cfg?.subscription_id) {
      results.push({ name: row.name, skipped: "no_subscription_id" });
      continue;
    }
    const mailbox = cfg.mailbox || (row.name as string).replace(/^graph_subscription_/, "").replace(/_/g, "@");
    const notificationPath = cfg.notification_path || DEFAULT_SUBSCRIPTION_PATH;

    // 1) Does Microsoft still have this subscription? Our stored expires_at can be
    //    in the future while Microsoft has already dropped it (delegated-token lapse
    //    / lifecycle event), so trusting expires_at alone lets the mailbox go dark.
    let exists: { expirationDateTime: string } | null;
    try {
      exists = await microsoft.getSubscription(cfg.subscription_id);
    } catch (e) {
      // Transient (token/5xx) — don't churn-recreate; try again next run.
      results.push({ name: row.name, error: `existence_check_failed: ${(e as Error).message}` });
      continue;
    }

    // 2) Gone → re-create.
    if (!exists) {
      try {
        const sub = await recreateSubscription(mailbox, notificationPath);
        results.push({ name: row.name, recreated: true, recreated_to: sub.expires_at });
        await alert(`♻️ Re-created the dropped Graph subscription for *${mailbox}* (inbound was silently down). New expiry ${sub.expires_at}.`);
      } catch (e) {
        results.push({ name: row.name, error: `recreate_failed: ${(e as Error).message}` });
        await alert(`⚠️ Graph subscription for *${mailbox}* is gone and re-create FAILED: ${(e as Error).message}. submissions@ inbound is down.`);
      }
      continue;
    }

    // 3) Present but expiring within the window → renew.
    const expiresMs = new Date(cfg.expires_at ?? exists.expirationDateTime).getTime();
    if (expiresMs - nowMs > renewWindowMs) {
      results.push({ name: row.name, skipped: "not_due" });
      continue;
    }

    try {
      const renewed = await microsoft.renewSubscription(cfg.subscription_id);
      await supabaseAdmin
        .from("integrations")
        .update({ config: { ...cfg, expires_at: renewed.expirationDateTime }, updated_at: new Date().toISOString() })
        .eq("name", row.name);
      results.push({ name: row.name, renewed_to: renewed.expirationDateTime });
    } catch (e) {
      results.push({ name: row.name, error: `renew_failed: ${(e as Error).message}` });
    }
  }

  const recreated = results.filter((r) => r.recreated).length;
  const renewed = results.filter((r) => r.renewed_to).length;
  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_graph_subscription_renew",
    description: `Renewed ${renewed}, re-created ${recreated} of ${results.length} subscriptions`,
    metadata: { results },
  });

  return NextResponse.json({ ok: true, results });
}

/** Best-effort alert to the submissions channel (falls back to CEO channel). */
async function alert(text: string): Promise<void> {
  const channel = process.env.SLACK_SUB_CHANNEL || process.env.SLACK_CEO_CHANNEL || "";
  if (!channel) return;
  try {
    await slack.postMessage(channel, text);
  } catch {
    /* non-fatal */
  }
}
