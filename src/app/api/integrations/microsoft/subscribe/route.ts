export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  recreateSubscription,
  DEFAULT_SUBSCRIPTION_MAILBOX,
  DEFAULT_SUBSCRIPTION_PATH,
} from "@/lib/graph-subscription";

export const runtime = "nodejs";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const mailbox: string = body.mailbox || DEFAULT_SUBSCRIPTION_MAILBOX;
  const notificationPath: string = body.notificationPath || DEFAULT_SUBSCRIPTION_PATH;

  try {
    const sub = await recreateSubscription(mailbox, notificationPath);
    return NextResponse.json({ ok: true, subscription: sub });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}
