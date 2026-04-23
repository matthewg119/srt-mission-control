import { NextRequest, NextResponse } from "next/server";
import { runEmailDirector, draftForContact } from "@/lib/ai-intel/email-director";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const contactId = url.searchParams.get("contact_id");
  const limit = Number(url.searchParams.get("limit") ?? "150");

  const start = Date.now();
  try {
    // Single-contact mode for manual triggering / smoke tests.
    if (contactId) {
      const result = await draftForContact(contactId);
      return NextResponse.json({ ok: true, duration_ms: Date.now() - start, result });
    }

    const result = await runEmailDirector({ limit: Math.min(Math.max(limit, 1), 500) });
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_email_director",
      description: `Email Director: processed=${result.processed} drafted=${result.drafted} handoffs=${result.handoffs} skipped=${result.skipped} errors=${result.errors}`,
      metadata: { ...result, duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: true, duration_ms: Date.now() - start, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[email-director] fatal:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_email_director_error",
      description: msg,
      metadata: { duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
