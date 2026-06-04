// Approved stage handler — fires when a deal's Zoho stage flips to "Approved"
// (lender has approved the deal). Sends a custom `DealApproved` Meta CAPI
// event ungated, so Meta can build an audience of high-intent users for
// lookalike modeling regardless of original traffic source.

import { supabaseAdmin } from "@/lib/db";
import { maybeFireMetaEvent } from "./meta-events";

export interface ApprovedResult {
  dealId: string;
  metaFired: boolean;
  metaReason: string;
}

export async function onApproved(dealId: string): Promise<ApprovedResult> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount, contact_id, contacts:contact_id(business_name)")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || !deal.contact_id) {
    return { dealId, metaFired: false, metaReason: "deal_or_contact_not_found" };
  }

  const businessName = (deal as unknown as { contacts: { business_name: string | null } | null }).contacts?.business_name ?? null;

  const result = await maybeFireMetaEvent({
    eventName: "DealApproved",
    contactId: deal.contact_id as string,
    eventId: `dealapproved-${dealId}`,
    enforceAttribution: false,
    customData: {
      content_name: "Deal Approved",
      ...(businessName ? { business_name: businessName } : {}),
      ...(deal.amount ? { approved_amount: deal.amount } : {}),
    },
  });

  console.log(`[onApproved] dealId=${dealId} fired=${result.fired} reason=${result.reason}`);
  return { dealId, metaFired: result.fired, metaReason: result.reason };
}
