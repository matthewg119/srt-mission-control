import { updateLead } from "./zoho";
import { supabaseAdmin } from "./db";

// ============================================================
// Single-offer "final/winning" fields on the Lead record.
// Kept for the few places that still sync one chosen offer
// (contract generation, Zoho pipeline summary). The new per-lender
// grid lives in the `Lender_Submissions` subform — see below.
// ============================================================

export interface MCAOffer {
  factorRate?: number;
  totalPayback?: number;
  dailyPayment?: number;
  weeklyPayment?: number;
  termMonths?: number;
  netFunded?: number;
  useOfFunds?: string;
}

export async function syncMCAOfferToZoho(zohoLeadId: string, offer: MCAOffer): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (offer.factorRate !== undefined) updates.MCA_Factor_Rate = offer.factorRate;
  if (offer.totalPayback !== undefined) updates.MCA_Total_Payback = offer.totalPayback;
  if (offer.dailyPayment !== undefined) updates.MCA_Daily_Payment = offer.dailyPayment;
  if (offer.weeklyPayment !== undefined) updates.MCA_Weekly_Payment = offer.weeklyPayment;
  if (offer.termMonths !== undefined) updates.MCA_Term_Months = offer.termMonths;
  if (offer.netFunded !== undefined) updates.MCA_Net_Funded = offer.netFunded;
  if (offer.useOfFunds !== undefined) updates.MCA_Use_Of_Funds = offer.useOfFunds;

  if (Object.keys(updates).length === 0) return;

  await updateLead(zohoLeadId, updates as Parameters<typeof updateLead>[1]);
}

// ============================================================
// Lender_Submissions subform — the per-lender list that shows up
// inside each Lead record in Zoho. Plan:
//   C:\Users\matth\.claude\plans\i-really-dont-need-floating-pnueli.md
//
// Gated on ZOHO_LENDER_SUBFORM_ENABLED=1 so it safely no-ops until
// the subform exists in the Zoho UI. Wrap every call site in
// try/catch — Zoho outages must not break Supabase or Slack flows
// (see feedback_zoho_currency_fields.md).
//
// Subform PUT semantics: sending an array replaces the entire list.
// So we always send the full list, ordered by submitted_at ASC.
// ============================================================

function subformEnabled(): boolean {
  return process.env.ZOHO_LENDER_SUBFORM_ENABLED === "1";
}

export async function syncLenderSubmissionsSubform(merchantId: string): Promise<void> {
  if (!subformEnabled()) return;

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("zoho_lead_id")
    .eq("id", merchantId)
    .maybeSingle();

  const zohoLeadId = contact?.zoho_lead_id as string | null | undefined;
  if (!zohoLeadId) return;

  const { data: rows } = await supabaseAdmin
    .from("deal_submissions")
    .select("approved_amount, buy_rate, sell_rate, term, notes, submitted_at, lenders(name)")
    .eq("merchant_id", merchantId)
    .order("submitted_at", { ascending: true, nullsFirst: false });

  const subform = (rows ?? []).map((r) => {
    const lender = Array.isArray(r.lenders) ? r.lenders[0] : r.lenders;
    return {
      Lender: (lender as { name?: string | null } | null)?.name ?? "Unknown",
      Approval_Amount: r.approved_amount,
      Buy_Rate: r.buy_rate,
      Sell_Rate: r.sell_rate,
      Term: r.term,
      Notes: r.notes,
    };
  });

  await updateLead(zohoLeadId, { Lender_Submissions: subform } as Parameters<typeof updateLead>[1]);
}
