import { NextRequest, NextResponse } from "next/server";
import { runZohoGuardian } from "@/lib/ai-intel/zoho-guardian";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limit = Number(url.searchParams.get("limit") ?? "50");

  const start = Date.now();
  try {
    const result = await runZohoGuardian({ dryRun, limit: Math.min(Math.max(limit, 1), 200) });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_vektor_guardian",
      description: `VeKtor Zoho guardian: processed=${result.processed} errors=${result.errors} slack=${result.slack_posted} dry_run=${dryRun}`,
      metadata: { ...result, dry_run: dryRun, duration_ms: Date.now() - start },
    });

    return NextResponse.json({ ok: true, duration_ms: Date.now() - start, dry_run: dryRun, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[vektor-guardian] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
