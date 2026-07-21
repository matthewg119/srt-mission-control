export const dynamic = "force-dynamic";
// Nightly TRT email enrichment (Vercel Cron, 09:00 UTC — 2h after pull-trt so
// the Outscraper webhook has landed the day's leads). Crawls each new lead's
// website for a published email (free, fetch + regex — see src/lib/email-scrape.ts),
// writes it to trt_leads, and pushes it onto the Zoho lead. Small batch + a 45s
// deadline guard keep us under the 60s serverless cap; rows not reached keep
// email_checked_at null and are picked up the next night. The ~400-row backlog
// is handled by the manual script instead: bun run trt:emails -- --push-zoho

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { enrichEmails } from "@/lib/email-scrape";
import { updateLead } from "@/lib/zoho";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEADLINE_BUDGET_MS = 45_000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

interface Row {
  id: string;
  business_name: string;
  website: string | null;
  email: string | null;
  email_source?: string | null;
  zoho_lead_id: string | null;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const batchLimit = Math.max(1, Number(process.env.TRT_EMAIL_CRON_LIMIT) || 25);

  try {
    const { data, error } = await supabaseAdmin
      .from("trt_leads")
      .select("id, business_name, website, email, zoho_lead_id")
      .is("email", null)
      .not("website", "is", null)
      .is("email_checked_at", null)
      .limit(batchLimit);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Row[];
    if (!rows.length) {
      return NextResponse.json({ ok: true, message: "no unchecked rows" });
    }

    const { found, scanned } = await enrichEmails(rows, {
      deadlineMs: started + DEADLINE_BUDGET_MS,
    });

    // Sequential, checked write-backs (unbounded Promise.all drops updates — see trt-zoho-sync.ts).
    const nowIso = new Date().toISOString();
    let updated = 0;
    for (const r of scanned) {
      const patch: Record<string, unknown> = { email_checked_at: nowIso };
      if (r.email) {
        patch.email = r.email;
        patch.email_source = r.email_source;
      }
      const { error: upErr } = await supabaseAdmin.from("trt_leads").update(patch).eq("id", r.id);
      if (!upErr) updated++;
    }

    let zohoOk = 0;
    let zohoFailed = 0;
    for (const r of scanned) {
      if (!r.email || !r.zoho_lead_id) continue;
      try {
        await updateLead(r.zoho_lead_id, { Email: r.email.slice(0, 100) });
        zohoOk++;
      } catch {
        zohoFailed++; // converted/deleted leads throw — skip, don't abort
      }
    }

    return NextResponse.json({
      ok: true,
      candidates: rows.length,
      scanned: scanned.length,
      found,
      supabaseUpdated: updated,
      zohoOk,
      zohoFailed,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
