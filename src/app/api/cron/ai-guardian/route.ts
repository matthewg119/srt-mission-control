export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runGuardian } from "@/lib/ai-intel/guardian";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limit = Number(url.searchParams.get("limit") ?? "200");

  const start = Date.now();
  try {
    const result = await runGuardian({ dryRun, limit: Math.min(Math.max(limit, 1), 500) });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_ai_guardian",
      description: `AI Guardian: processed=${result.processed} errors=${result.errors} slack_posted=${result.slack_posted} suppressed=${result.suppressed_sequences} dry_run=${dryRun}`,
      metadata: { ...result, dry_run: dryRun, duration_ms: Date.now() - start },
    });

    return NextResponse.json({ ok: true, duration_ms: Date.now() - start, dry_run: dryRun, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[ai-guardian] fatal:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_ai_guardian_error",
      description: msg,
      metadata: { duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
