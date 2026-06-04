export const dynamic = "force-dynamic";
// Create a real Zoho test lead so the SRT Auto-Dialer can scan it and exercise
// the direct email-send flow end-to-end.
//
// Hit with:  POST /api/admin/create-test-lead
//   Authorization: Bearer <CRON_SECRET>
//   (optional body) { "email": "...", "firstName": "...", "lastName": "...", "phone": "..." }
//
// Defaults to chronos9d@gmail.com / "Chronos Test". Returns the new Zoho lead id
// and a direct CRM link.

import { NextRequest, NextResponse } from "next/server";
import { createLead } from "@/lib/zoho";

export const runtime = "nodejs";
export const maxDuration = 30;

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

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  };

  const email = body.email?.trim() || "chronos9d@gmail.com";
  const firstName = body.firstName?.trim() || "Chronos";
  const lastName = body.lastName?.trim() || "Test";

  try {
    const zohoLeadId = await createLead({
      firstName,
      lastName,
      email,
      phone: body.phone?.trim() || "",
      source: "Dialer Test",
    });

    if (!zohoLeadId) {
      return NextResponse.json({ ok: false, error: "create_returned_null" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      zoho_lead_id: zohoLeadId,
      email,
      zoho_url: `https://crm.zoho.com/crm/org/_/tab/Leads/${zohoLeadId}`,
      next_steps: "Open the zoho_url, click Scan in the dialer, pick the Next Steps template, and hit Send.",
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
