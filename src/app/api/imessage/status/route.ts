export const dynamic = "force-dynamic";
// Mac bridge status — reads the heartbeat the inbound webhook writes into the
// integrations row name='Mac iMessage Bridge' on every authenticated hit. The
// bridge POSTs /api/imessage/inbound about every 10s even when idle, so a
// last_sync within 45s means it is online.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin
    .from("integrations")
    .select("last_sync")
    .eq("name", "Mac iMessage Bridge")
    .maybeSingle();

  const lastSync = (data?.last_sync as string | null) ?? null;
  const secondsSince = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 1000 : null;
  const status = secondsSince != null && secondsSince < 45 ? "online" : "offline";

  return NextResponse.json({
    status,
    last_seen: lastSync,
    seconds_since: secondsSince != null ? Math.round(secondsSince) : null,
  });
}
