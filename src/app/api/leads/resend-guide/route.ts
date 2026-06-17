export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/lead-validation";
import { sendPdfGuideEmail } from "@/lib/pdf-guide-email";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

// Resend the free PDF guide on demand — called by the DNQ "Resend" button on the
// srtagency.com/PDF landing page (cross-origin, hence CORS).
export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  try {
    const { email, firstName } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ success: false, error: "invalid_email" }, { status: 400, headers: corsHeaders });
    }
    await sendPdfGuideEmail(normalizedEmail, typeof firstName === "string" ? firstName : undefined);
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("[resend-guide] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500, headers: corsHeaders });
  }
}
