import { NextRequest, NextResponse } from "next/server";
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

// SRT CRM Master Exclusion sync. Pulls every contact, hashes the identifiers, and
// pushes them into the Meta exclusion audience so Meta stops re-serving acquisition
// ads to people already in the CRM. Idempotent: re-adding an existing member is a
// no-op, so we push the full CRM each run with no diffing. Runs daily via vercel.json.
//
// Source is `contacts`, not Zoho Leads + Contacts. The dedupe across those two
// modules is gone because there is only one table now; rowKey() dedupe is kept
// anyway, since two contacts can legitimately share a front-desk phone.
//
// ‼️ IF THIS BREAKS QUIETLY, EXISTING LEADS START SEEING ACQUISITION ADS AGAIN.
// There is no error state for "pushed far fewer people than yesterday", so the
// Slack summary prints the pulled count and the run logs it to system_logs.
// Compare against the previous run before assuming a small number is correct.
//
// Location fields are named biz_* here. `working_state` is the CRM working state,
// NOT a geographic one, and must never be mapped onto State.
const PAGE = 1000;
const CONTACT_COLS =
  "email, phone, mobile_phone, first_name, last_name, biz_city, biz_state, biz_zip";

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
    // 1. Pull the full CRM, paged. `truncated` is kept in the payload for
    //    continuity with the old Zoho page ceiling; range paging has no such
    //    ceiling, so it is always false now.
    let pulled = 0;
    const truncated = false;
    const raw: AudienceSourceRecord[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("contacts")
        .select(CONTACT_COLS)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`contacts: ${error.message}`);
      const batch = (data ?? []) as Array<Record<string, unknown>>;
      pulled += batch.length;
      for (const c of batch) {
        // Mapped into the Zoho-shaped record toAudienceRow already takes, so the
        // hashing and normalization stay exactly as they were.
        raw.push({
          Email: (c.email as string | null) ?? null,
          Phone: (c.phone as string | null) ?? null,
          Mobile: (c.mobile_phone as string | null) ?? null,
          First_Name: (c.first_name as string | null) ?? null,
          Last_Name: (c.last_name as string | null) ?? null,
          City: (c.biz_city as string | null) ?? null,
          State: (c.biz_state as string | null) ?? null,
          Zip_Code: (c.biz_zip as string | null) ?? null,
        });
      }
      if (batch.length < PAGE) break;
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
        `Pulled from contacts: ${pulled} records`,
        `Pushed to Meta exclusion audience: ${received}`,
        `Skipped (no email or phone, or duplicate): ${skipped}`,
        `Rejected by Meta as invalid: ${invalid}`,
      ];
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
