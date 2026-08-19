export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/lead-validation";
import { sendMedspaGuideEmail } from "@/lib/medspa/guide-email";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

// Resend the free guide on demand — called by the DNQ "Resend" button on the
// srtagency.com/PDF landing page (cross-origin, hence CORS).
//
// This used to send pdf-guide-email.ts, the "Business Owner's Guide to Funding
// Without a Bank". /PDF has been the AI visibility guide since 2026-08-03, so
// the button was mailing the wrong lead magnet from matthew@srtagency.com, and
// the route takes an arbitrary address with no auth. It now sends the same
// guide the landing page actually promises. sendMedspaGuideEmail degrades to a
// no-button email when MEDSPA_QUESTIONS_PDF_URL is unset rather than rendering
// a dead link, so this is safe with the env var still missing.
//
// The old funding personalization (contacts.amount_needed, "how much funding
// are you looking for") went with it; there is nothing to personalize on here.
export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  try {
    const { email, firstName } = await request.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ success: false, error: "invalid_email" }, { status: 400, headers: corsHeaders });
    }
    await sendMedspaGuideEmail({
      to: normalizedEmail,
      firstName: typeof firstName === "string" ? firstName : undefined,
    });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("[resend-guide] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500, headers: corsHeaders });
  }
}
