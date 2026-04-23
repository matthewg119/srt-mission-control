import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INTEGRATION_NAME = "graph_subscription_onedrive_deals";

// Handle Graph subscription validation (both GET and POST may receive ?validationToken=)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ ok: true, endpoint: "agent/onedrive-changes" });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.value)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", INTEGRATION_NAME)
    .maybeSingle();

  const cfg = (integration?.config ?? {}) as {
    subscription_id?: string;
    client_state?: string;
    delta_link?: string;
  };

  // Verify clientState on at least one notification
  const mismatched = (body.value as Array<{ clientState?: string }>).some(
    (n) => cfg.client_state && n.clientState && n.clientState !== cfg.client_state
  );
  if (mismatched) {
    return NextResponse.json({ error: "bad_client_state" }, { status: 403 });
  }

  // 200 fast; process delta async
  void (async () => {
    try {
      await processDelta(cfg.delta_link);
    } catch (e) {
      console.error("[onedrive-changes] delta processing error:", (e as Error).message);
    }
  })();

  return NextResponse.json({ ok: true });
}

async function processDelta(savedDeltaLink: string | undefined): Promise<void> {
  const { items, deltaLink } = await microsoft.driveDelta({
    deltaLink: savedDeltaLink,
    initialLatest: !savedDeltaLink,
  });

  // Persist new deltaLink immediately so we don't re-process on retries
  if (deltaLink) {
    await supabaseAdmin
      .from("integrations")
      .update({
        config: {
          delta_link: deltaLink,
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("name", INTEGRATION_NAME);
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  for (const item of items) {
    if (item.deleted) continue;
    if (!item.file) continue; // folders and other non-file items
    if (item.file.mimeType !== "application/pdf") continue;

    const rawPath = item.parentReference?.path ?? "";
    const parentPath = decodeURIComponent(rawPath.replace(/^\/drive\/root:/, ""));

    // Expect path like "/Deals/{Merchant}/Bank Statements"
    const match = parentPath.match(/^\/?Deals\/([^/]+)\/Bank Statements\/?$/i);
    if (!match) continue;

    const merchantName = match[1].trim();

    // Dedupe — has this drive_item_id already triggered analysis?
    const { data: existing } = await supabaseAdmin
      .from("ai_decisions")
      .select("id")
      .eq("state_classified", "bank_statement_analysis")
      .contains("raw_response", { drive_item_ids: [item.id] })
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    // Resolve deal
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, business_name")
      .ilike("business_name", merchantName)
      .limit(1)
      .maybeSingle();

    if (!contact) {
      console.warn("[onedrive-changes] no contact for merchant folder:", merchantName);
      continue;
    }

    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("contact_id", contact.id as string)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!deal) {
      console.warn("[onedrive-changes] no active deal for contact:", contact.business_name);
      continue;
    }

    try {
      await fetch(`${siteUrl}/api/agent/bank-statements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: deal.id,
          drive_item_ids: [item.id],
          source: "onedrive",
          onedrive_folder_url: item.webUrl ? item.webUrl.replace(/\/[^/]+$/, "") : undefined,
        }),
      });
    } catch (e) {
      console.error("[onedrive-changes] analyze call failed:", (e as Error).message);
    }
  }
}
