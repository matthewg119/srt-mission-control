// Closed stage handler — fires when a deal's Zoho stage flips to "Closed"
// (deal funded). Sends a `Purchase` Meta CAPI event with the deal value so
// Meta's bid optimizer can train on actual revenue. Gated by `_fbc` so only
// Meta-attributed deals affect Ads Manager ROAS.

import { supabaseAdmin } from "@/lib/db";
import { maybeFireMetaEvent } from "./meta-events";

export interface ClosedResult {
  dealId: string;
  metaFired: boolean;
  metaReason: string;
  value: number;
}

export async function onClosed(dealId: string): Promise<ClosedResult> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount, contact_id, contacts:contact_id(business_name)")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || !deal.contact_id) {
    return { dealId, metaFired: false, metaReason: "deal_or_contact_not_found", value: 0 };
  }

  const value = (deal.amount as number | null) ?? 0;
  const businessName = (deal as unknown as { contacts: { business_name: string | null } | null }).contacts?.business_name ?? null;

  const result = await maybeFireMetaEvent({
    eventName: "Purchase",
    contactId: deal.contact_id as string,
    eventId: `purchase-${dealId}`,
    value,
    customData: {
      content_name: "Deal Funded",
      ...(businessName ? { business_name: businessName } : {}),
    },
  });

  console.log(`[onClosed] dealId=${dealId} value=${value} fired=${result.fired} reason=${result.reason}`);
  return { dealId, metaFired: result.fired, metaReason: result.reason, value };
}
