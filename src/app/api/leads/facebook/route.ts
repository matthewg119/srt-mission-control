import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    console.log("[FB Webhook] Verification successful");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[FB Webhook] Verification failed — token mismatch");
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Facebook only sends page object for Lead Ads
  if (body.object !== "page") {
    return NextResponse.json({ ok: true });
  }

  const pageToken = process.env.FB_PAGE_ACCESS_TOKEN || "";
  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";

  for (const entry of (body.entry as Array<Record<string, unknown>>) ?? []) {
    for (const change of (entry.changes as Array<Record<string, unknown>>) ?? []) {
      const value = change.value as Record<string, unknown> | undefined;
      const leadgenId = value?.leadgen_id as string | undefined;
      const adgroupName = value?.adgroup_name as string | undefined;
      const formName = value?.form_id as string | undefined;

      if (!leadgenId) continue;

      // Fetch full lead data from Graph API
      let fields: Record<string, string> = {};
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${pageToken}&fields=field_data,created_time,form_id,ad_name,adset_name,campaign_name`
        );
        const lead = await res.json() as {
          field_data?: Array<{ name: string; values: string[] }>;
          ad_name?: string;
          adset_name?: string;
          campaign_name?: string;
        };

        for (const f of lead.field_data ?? []) {
          fields[f.name] = f.values?.[0] ?? "";
        }

        // Enrich adgroup name from lead if not in payload
        if (!adgroupName && lead.ad_name) {
          Object.assign(fields, { _ad_name: lead.ad_name });
        }
      } catch (err) {
        console.error("[FB Lead] Graph API fetch failed:", err);
        // Still log + post partial data
      }

      const firstName = fields.first_name || "";
      const lastName = fields.last_name || "";
      const name = [firstName, lastName].filter(Boolean).join(" ") || fields.full_name || "Unknown";
      const email = fields.email || "";
      const phone = fields.phone_number || "";

      // Build Slack message
      const knownKeys = new Set(["first_name", "last_name", "full_name", "email", "phone_number"]);
      const extraLines = Object.entries(fields)
        .filter(([k]) => !knownKeys.has(k) && !k.startsWith("_"))
        .map(([k, v]) => `*${k.replace(/_/g, " ")}:* ${v}`);

      const lines = [
        `:large_green_circle: *New Facebook Lead: ${name}*`,
        `*Form:* ${adgroupName || formName || "Guia Gratis doctors"}`,
        `*Email:* ${email || "—"}`,
        `*Phone:* ${phone || "—"}`,
        ...extraLines,
        `*Source:* Facebook Lead Ad`,
      ];

      if (channel) {
        slack.postMessage(channel, lines.join("\n"))
          .catch(err => console.error("[FB Lead] Slack postMessage failed:", err instanceof Error ? err.message : err));
      }

      // Audit log (fire and forget)
      void supabaseAdmin.from("system_logs").insert({
        event_type: "facebook_lead",
        description: `Facebook Lead Ad: ${name} (${email})`,
        metadata: { leadgen_id: leadgenId, name, email, phone, form: adgroupName },
      });
    }
  }

  // Always return 200 — Facebook retries on non-200
  return NextResponse.json({ ok: true });
}
