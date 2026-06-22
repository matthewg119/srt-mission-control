export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getCorsHeaders } from "@/lib/lead-validation";
import { sendPdfGuideEmail } from "@/lib/pdf-guide-email";
import { supabaseAdmin } from "@/lib/db";

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
    // Pull the lead's stored funding amount so the resend stays personalized.
    // Falls back to the "How much funding…" ask when absent.
    let amountNeeded: string | undefined;
    try {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("amount_needed")
        .ilike("email", normalizedEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      amountNeeded = (contact?.amount_needed as string) || undefined;
    } catch (lookupErr) {
      console.warn("[resend-guide] amount lookup failed:", lookupErr instanceof Error ? lookupErr.message : lookupErr);
    }
    await sendPdfGuideEmail(normalizedEmail, typeof firstName === "string" ? firstName : undefined, amountNeeded);
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err) {
    console.error("[resend-guide] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500, headers: corsHeaders });
  }
}
