import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);
  const status = url.searchParams.get("status");

  let query = supabaseAdmin
    .from("deal_submissions")
    .select("id, created_at, merchant_id, deal_id, lender_id, submitted_at, amount_requested, status, last_funder_response_at, follow_up_sent, notes, onedrive_folder_url, lenders(name, submission_email, tier), contacts:merchant_id(business_name, first_name, last_name)")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submissions: data ?? [] });
}
