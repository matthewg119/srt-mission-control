export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

const INTEGRATION_NAME = "graph_subscription_onedrive_deals";

function generateClientState(): string {
  return crypto.randomBytes(24).toString("hex");
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const { data: existing } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", INTEGRATION_NAME)
    .maybeSingle();

  if (existing?.config?.subscription_id) {
    try {
      await microsoft.deleteSubscription(existing.config.subscription_id);
    } catch (e) {
      console.warn("[subscribe-drive] existing subscription delete failed:", (e as Error).message);
    }
  }

  // Bootstrap the delta link so we only process future changes
  let deltaLink: string | null = null;
  try {
    const initial = await microsoft.driveDelta({ initialLatest: true });
    deltaLink = initial.deltaLink;
  } catch (e) {
    console.warn("[subscribe-drive] initial delta failed:", (e as Error).message);
  }

  const clientState = generateClientState();

  let sub;
  try {
    sub = await microsoft.createSubscription({
      resource: "/me/drive/root",
      changeType: "updated",
      notificationUrl: `${getAppUrl()}/api/agent/onedrive-changes`,
      clientState,
      expirationMinutes: 60 * 24 * 2,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  await supabaseAdmin.from("integrations").upsert(
    {
      name: INTEGRATION_NAME,
      config: {
        subscription_id: sub.id,
        resource: sub.resource,
        client_state: clientState,
        delta_link: deltaLink,
        expires_at: sub.expirationDateTime,
      },
      status: "connected",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "name" }
  );

  return NextResponse.json({
    ok: true,
    subscription: { id: sub.id, resource: sub.resource, expires_at: sub.expirationDateTime },
    delta_bootstrapped: !!deltaLink,
  });
}

export async function POST(req: NextRequest) {
  return handle(req);
}
