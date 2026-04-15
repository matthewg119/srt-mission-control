import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getCorsHeaders } from "@/lib/lead-validation";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "email parameter required" }, { status: 400, headers: corsHeaders });
  }

  // Look up contact by email — handle duplicates by picking the one with most data
  const { data: contacts, error } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .ilike("email", email)
    .order("application_completion_pct", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) {
    console.error("[lookup] Supabase error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500, headers: corsHeaders });
  }

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ found: false }, { status: 200, headers: corsHeaders });
  }

  // Pick the contact with the most data
  const contact = contacts.reduce((best, c) => {
    const score = (f: string) => c[f] && c[f] !== "" && c[f] !== null ? 1 : 0;
    const bestScore = (f: string) => best[f] && best[f] !== "" && best[f] !== null ? 1 : 0;
    const fields = ["first_name", "phone", "amount_needed", "credit_score", "monthly_revenue", "business_name"];
    const cTotal = fields.reduce((s, f) => s + score(f), 0);
    const bTotal = fields.reduce((s, f) => s + bestScore(f), 0);
    return cTotal > bTotal ? c : best;
  }, contacts[0]);

  // Check if application was fully completed via system_logs
  const { data: completionLog } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", "application_complete")
    .eq("metadata->>contactId", contact.id)
    .maybeSingle();

  // Also check via description string match as fallback
  const { data: completionLogAlt } = !completionLog
    ? await supabaseAdmin
        .from("system_logs")
        .select("id")
        .ilike("description", `%Application completed%`)
        .ilike("description", `%${email}%`)
        .maybeSingle()
    : { data: null };

  const isComplete = !!(completionLog || completionLogAlt);

  // Infer completion percentage from populated fields
  let completion = 0;
  if (contact.first_name && contact.email) {
    completion = 25;
  }
  if (contact.biz_address || contact.biz_city || contact.biz_state) {
    completion = 50;
  }
  if (contact.dob || contact.credit_score) {
    completion = 67;
  }
  if (contact.ssn_full || contact.ssn4) {
    completion = 92;
  }
  if (isComplete) {
    completion = 100;
  }

  // Determine which slide to resume at
  let slide = 0;
  if (completion < 25) slide = 0;
  else if (completion < 50) slide = 3;
  else if (completion < 67) slide = 6;
  else if (completion < 92) slide = 7;
  else if (completion < 100) slide = 8;

  return NextResponse.json(
    {
      found: true,
      completion,
      slide,
      isComplete,
      contact: {
        email: contact.email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        phone: contact.phone,
        businessName: contact.biz_name,
        bizAddress: contact.biz_address,
        bizCity: contact.biz_city,
        bizState: contact.biz_state,
        bizZip: contact.biz_zip,
        fundingAmount: contact.funding_amount,
        amountNeeded: contact.amount_needed,
        incDate: contact.inc_date,
        monthlyRevenue: contact.monthly_revenue,
        checkingAccount: contact.checking_account,
        monthlyDeposits: contact.monthly_deposits,
        existingLoans: contact.existing_loans,
        // Sensitive fields (ssn_full, ssn4, dob, credit_score) are intentionally
        // NOT returned: this endpoint is unauthenticated and only needs existence +
        // business data for resume-flow. Applicant re-enters sensitive fields.
      },
    },
    { status: 200, headers: corsHeaders }
  );
}
