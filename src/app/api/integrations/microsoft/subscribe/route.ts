import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

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

  const body = await req.json().catch(() => ({}));
  const mailbox: string = body.mailbox || "submissions@srtagency.com";
  const notificationPath: string = body.notificationPath || "/api/agent/submissions";
  const integrationName = `graph_subscription_${mailbox.replace(/[^a-z0-9]/gi, "_")}`;

  const { data: existing } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", integrationName)
    .maybeSingle();

  if (existing?.config?.subscription_id) {
    try {
      await microsoft.deleteSubscription(existing.config.subscription_id);
    } catch (e) {
      console.warn("[subscribe] existing subscription delete failed:", (e as Error).message);
    }
  }

  const clientState = generateClientState();

  let sub;
  try {
    sub = await microsoft.createSubscription({
      resource: `users/${mailbox}/messages`,
      changeType: "created",
      notificationUrl: `${getAppUrl()}${notificationPath}`,
      clientState,
      expirationMinutes: 60 * 24 * 3,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  await supabaseAdmin
    .from("integrations")
    .upsert(
      {
        name: integrationName,
        config: {
          subscription_id: sub.id,
          resource: sub.resource,
          mailbox,
          notification_path: notificationPath,
          client_state: clientState,
          expires_at: sub.expirationDateTime,
        },
        status: "connected",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "name" }
    );

  return NextResponse.json({ ok: true, subscription: { id: sub.id, expires_at: sub.expirationDateTime, mailbox } });
}

export async function POST(req: NextRequest) {
  return handle(req);
}
