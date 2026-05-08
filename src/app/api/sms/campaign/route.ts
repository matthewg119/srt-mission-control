// Campaign CRUD API — create, list, pause/resume campaigns.
// POST   /api/sms/campaign     — create a new campaign
// GET    /api/sms/campaign     — list all campaigns with stats
// PATCH  /api/sms/campaign     — pause, resume, update daily_limit (pass id in body)
// DELETE /api/sms/campaign     — cancel campaign (pass id in body)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { createCampaign, startCampaign, pauseCampaign, resumeCampaign } from "@/lib/sms-campaign";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST — create campaign
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const name = body.name as string | undefined;
  const templateName = body.template_name as string | undefined;
  const contacts = body.contacts as Array<{phone: string; first_name?: string; business_name?: string; contact_id?: string}> | undefined;
  const dailyLimit = (body.daily_limit as number | undefined) ?? 50;
  const spacingMinutes = (body.spacing_minutes as number | undefined) ?? 12;
  const autoStart = body.auto_start as boolean | undefined;

  if (!name || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return NextResponse.json({ error: "name and contacts[] required" }, { status: 400 });
  }

  try {
    const result = await createCampaign({ name, templateName, contacts, dailyLimit, spacingMinutes });

    if (autoStart) {
      await startCampaign(result.id);
    }

    return NextResponse.json({ ok: true, campaign_id: result.id, total: result.total, skipped: result.skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET — list campaigns
export async function GET() {
  const { data: campaigns, error } = await supabaseAdmin
    .from("sms_campaigns")
    .select("id, name, template_name, status, total_contacts, sent_count, reply_count, daily_limit, spacing_minutes, created_at, started_at, completed_at, slack_campaign_ts")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, campaigns: campaigns ?? [] });
}

// PATCH — update campaign (pause/resume/update settings)
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = body.id as string | undefined;
  const action = body.action as string | undefined; // 'pause' | 'resume' | 'start'

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    if (action === "pause") {
      await pauseCampaign(id);
    } else if (action === "resume") {
      await resumeCampaign(id);
    } else if (action === "start") {
      await startCampaign(id);
    } else {
      // Generic field update (daily_limit, spacing_minutes)
      const updates: Record<string, unknown> = {};
      if (body.daily_limit !== undefined) updates.daily_limit = body.daily_limit;
      if (body.spacing_minutes !== undefined) updates.spacing_minutes = body.spacing_minutes;
      if (Object.keys(updates).length > 0) {
        await supabaseAdmin.from("sms_campaigns").update(updates).eq("id", id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — cancel campaign
export async function DELETE(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = body.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await supabaseAdmin
    .from("sms_campaigns")
    .update({ status: "cancelled" })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
