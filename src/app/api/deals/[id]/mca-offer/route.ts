import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { syncMCAOfferToZoho, type MCAOffer } from "@/lib/zoho-mca-fields";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as MCAOffer;

  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .select("id, contact_id, contacts!inner(zoho_lead_id)")
    .eq("id", id)
    .maybeSingle();

  if (error || !deal) return NextResponse.json({ error: "deal_not_found" }, { status: 404 });

  const zohoLeadId = (deal as unknown as { contacts: { zoho_lead_id: string | null } }).contacts?.zoho_lead_id;
  if (!zohoLeadId) return NextResponse.json({ error: "no_zoho_lead_id" }, { status: 400 });

  await supabaseAdmin.from("deals").update({
    agreement_amount: body.totalPayback,
    buy_rate: body.factorRate,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  try {
    await syncMCAOfferToZoho(zohoLeadId, body);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  await supabaseAdmin.from("deal_events").insert({
    deal_id: id,
    event_type: "mca_offer_synced",
    description: `MCA offer synced to Zoho: factor=${body.factorRate}, payback=$${body.totalPayback}, term=${body.termMonths}mo`,
    metadata: body as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}
