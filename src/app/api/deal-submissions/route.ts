import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { syncLenderSubmissionsSubform } from "@/lib/zoho-mca-fields";

export const runtime = "nodejs";

const SUBMISSION_COLUMNS = "id, created_at, merchant_id, deal_id, lender_id, submitted_at, amount_requested, status, last_funder_response_at, follow_up_sent, notes, onedrive_folder_url, approved_amount, buy_rate, sell_rate, term, lenders(name, submission_email, tier), contacts:merchant_id(business_name, first_name, last_name)";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);
  const status = url.searchParams.get("status");
  const dealId = url.searchParams.get("deal_id");
  const merchantId = url.searchParams.get("merchant_id");

  let query = supabaseAdmin
    .from("deal_submissions")
    .select(SUBMISSION_COLUMNS)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (dealId) query = query.eq("deal_id", dealId);
  if (merchantId) query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submissions: data ?? [] });
}

const EDITABLE_FIELDS = ["status", "approved_amount", "buy_rate", "sell_rate", "term", "notes"] as const;
const NUMERIC_FIELDS = new Set(["approved_amount", "buy_rate", "sell_rate"]);
const STATUS_VALUES = new Set(["pending", "approved", "declined", "counter"]);

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];

    if (raw === null || raw === "") {
      patch[key] = null;
      continue;
    }

    if (NUMERIC_FIELDS.has(key)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: `${key} must be numeric` }, { status: 400 });
      }
      patch[key] = n;
      continue;
    }

    if (key === "status") {
      if (!STATUS_VALUES.has(String(raw))) {
        return NextResponse.json({ error: "status must be pending|approved|declined|counter" }, { status: 400 });
      }
      patch[key] = raw;
      if (raw === "approved" || raw === "declined" || raw === "counter") {
        patch.last_funder_response_at = new Date().toISOString();
      }
      continue;
    }

    patch[key] = typeof raw === "string" ? raw : String(raw);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("deal_submissions")
    .update(patch)
    .eq("id", body.id)
    .select(SUBMISSION_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data?.merchant_id) {
    try {
      await syncLenderSubmissionsSubform(data.merchant_id as string);
    } catch (e) {
      console.warn("[deal-submissions PATCH] Zoho sync failed:", (e as Error).message);
    }
  }

  return NextResponse.json({ submission: data });
}
