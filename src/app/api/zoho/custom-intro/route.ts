export const dynamic = "force-dynamic";
// Custom-intro generator for the SRT Auto-Dialer "Scaling Revenue Together"
// template. The dialer POSTs a zoho_lead_id; this builds the lead's merchant
// context (Zoho notes + Supabase amount/revenue/industry/use-of-funds) and asks
// Claude for ONE personalized line, which the dialer drops into its editable box
// for review before sending (as the {{customLine}} token).
//
// POST body: { zoho_lead_id }
// Returns: { ok: true, line }

import { NextRequest, NextResponse } from "next/server";
import { buildMerchantContext } from "@/lib/ai-intel/merchant-context";
import { draftCustomIntroLine } from "@/lib/ai-intel/custom-intro-director";

export const runtime = "nodejs";
export const maxDuration = 30;

// Safe fallback so the dialer box is never left empty.
const FALLBACK_LINE =
  "I'd love to learn a bit more about what you're looking to fund, so when's a good time to connect?";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { zoho_lead_id?: string };
  const zohoLeadId = body.zoho_lead_id;
  if (!zohoLeadId) {
    return NextResponse.json({ error: "missing zoho_lead_id" }, { status: 400 });
  }

  try {
    const ctx = await buildMerchantContext({ zohoLeadId });
    if (!ctx) {
      return NextResponse.json({ ok: true, line: FALLBACK_LINE, fallback: true });
    }
    const line = await draftCustomIntroLine(ctx);
    return NextResponse.json({ ok: true, line: line || FALLBACK_LINE, fallback: !line });
  } catch (err) {
    console.error("[custom-intro] failed:", (err as Error).message);
    return NextResponse.json({ ok: true, line: FALLBACK_LINE, fallback: true });
  }
}
