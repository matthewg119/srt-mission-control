// Outbound queue feed for the Mac-side Playwright worker.
// Returns up to 10 unsent rows ordered oldest-first.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("digits_outbound_queue")
    .select("id, to_phone, body")
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[digits/pending] select error:", error.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
