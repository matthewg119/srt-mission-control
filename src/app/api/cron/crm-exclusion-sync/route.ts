import { NextRequest, NextResponse } from "next/server";
import { listAllRecords } from "@/lib/zoho";
import {
  toAudienceRow,
  rowKey,
  pushUsersToAudience,
  type AudienceSourceRecord,
} from "@/lib/meta-audience";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SRT CRM Master Exclusion sync. Pulls every lead + contact from Zoho, hashes the
// identifiers, and pushes them into the Meta exclusion audience so Meta stops re-serving
// acquisition ads to people already in the CRM. Idempotent: re-adding an existing member
// is a no-op, so we push the full CRM each run with no diffing. Runs daily via vercel.json.

const FIELDS = "Email,Phone,Mobile,First_Name,Last_Name,City,State,Zip_Code";
const MODULES = ["Leads", "Contacts"];

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

  const start = Date.now();

  try {
    // 1. Pull full CRM.
    let pulled = 0;
    let truncated = false;
    const raw: AudienceSourceRecord[] = [];
    for (const module of MODULES) {
      const { records, truncated: t } = await listAllRecords(module, FIELDS);
      pulled += records.length;
      truncated = truncated || t;
      raw.push(...(records as AudienceSourceRecord[]));
    }

    // 2. Hash + drop rows with no strong identifier + dedupe across Leads/Contacts.
    const seen = new Set<string>();
    const rows: string[][] = [];
    for (const r of raw) {
      const row = toAudienceRow(r);
      if (!row) continue;
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    const skipped = pulled - rows.length;

    // 3. Push to Meta in 10k batches.
    const { received, invalid } = await pushUsersToAudience(rows);

    const durationMs = Date.now() - start;

    // 4. Log.
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_crm_exclusion_sync",
      description: `CRM exclusion sync: pulled ${pulled}, pushed ${received}`,
      metadata: { pulled, pushed: received, skipped, invalid, truncated, duration_ms: durationMs },
    });

    // 5. Slack summary (no em dashes).
    const channel = process.env.SLACK_TEAM_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (channel) {
      const lines = [
        "CRM Exclusion Sync complete",
        `Pulled from Zoho: ${pulled} records`,
        `Pushed to Meta exclusion audience: ${received}`,
        `Skipped (no email or phone, or duplicate): ${skipped}`,
        `Rejected by Meta as invalid: ${invalid}`,
      ];
      if (truncated) {
        lines.push("WARNING: hit the page ceiling, pull is partial. Raise maxPages in listAllRecords.");
      }
      await slack.postMessage(channel, lines.join("\n"));
    }

    return NextResponse.json({ ok: true, pulled, pushed: received, skipped, invalid, truncated, duration_ms: durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "exclusion sync failed";
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_crm_exclusion_sync_error",
      description: message,
      metadata: { duration_ms: Date.now() - start },
    });
    const channel = process.env.SLACK_TEAM_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (channel) {
      await slack.postMessage(channel, `CRM Exclusion Sync FAILED: ${message}`);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
