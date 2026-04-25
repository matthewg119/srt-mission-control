import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

// POST /api/admin/preview-submission
// Sends a test/preview of the SOS submission email template to the given address.
// Body: { deal_id?: string, to_email: string }
export async function POST(req: NextRequest) {
  const { deal_id, to_email } = await req.json();

  if (!to_email) {
    return NextResponse.json({ error: "to_email is required" }, { status: 400 });
  }

  let sosText: string;
  let subject: string;

  if (deal_id) {
    // Fetch real SOS if available
    const { data: sos } = await supabaseAdmin
      .from("deal_sos")
      .select("sos_text, sos_content, business_name")
      .eq("opportunity_id", deal_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sos?.sos_text) {
      sosText = sos.sos_text as string;
      const content = sos.sos_content as { funding_request?: { amount_requested?: number | string; financing_type?: string } } | null;
      const amount = content?.funding_request?.amount_requested ?? "50,000";
      const product = content?.funding_request?.financing_type ?? "Working Capital";
      subject = `[TEST PREVIEW] SOS - ${sos.business_name} - ${product} - $${typeof amount === "number" ? amount.toLocaleString() : amount}`;
    } else {
      // No SOS yet for this deal — fall through to sample
      sosText = buildSampleSos();
      subject = "[TEST PREVIEW] SOS - TEST Pizza Co - Working Capital - $50,000";
    }
  } else {
    sosText = buildSampleSos();
    subject = "[TEST PREVIEW] SOS - TEST Pizza Co - Working Capital - $50,000";
  }

  const body = `${sosText}

---
This is a TEST PREVIEW of the SRT Agency lender submission email template.
This is what lenders receive when Vektor submits a deal to them.`;

  try {
    await microsoft.sendMail({ to: to_email, subject, body, isHtml: false });
  } catch (err) {
    return NextResponse.json({ error: `Send failed: ${(err as Error).message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, to: to_email, subject });
}

function buildSampleSos(): string {
  return [
    `=== STATEMENT OF SCENARIO (SOS) ===`,
    ``,
    `BUSINESS PROFILE`,
    `Business: TEST Pizza Co`,
    `Industry: Food & Restaurant`,
    `Incorporation: 2019-03-15`,
    ``,
    `OWNER PROFILE`,
    `Name: Test Owner`,
    `Credit Score: 680-720`,
    `Ownership: 100%`,
    ``,
    `FUNDING REQUEST`,
    `Amount: $50,000`,
    `Use of Funds: Equipment upgrade & working capital`,
    `Product: Working Capital`,
    ``,
    `FINANCIAL SUMMARY`,
    `Monthly Deposits: $28,000`,
    `Existing Loans: None`,
    ``,
    `--- SRT Agency | srtagency.com ---`,
  ].join("\n");
}
