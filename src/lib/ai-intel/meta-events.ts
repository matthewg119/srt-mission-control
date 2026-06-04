import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";

export type IntelMetaEventName = "Purchase" | "DealDeclined" | "DealApproved";

export interface MaybeFireArgs {
  eventName: IntelMetaEventName;
  contactId: string;
  value?: number;
  eventId?: string;
  /**
   * When false, fires regardless of `_fbc` presence — use for audience-training
   * signals (DealApproved, DNQ-style) where we want Meta to learn from every
   * lead, not just Meta-attributed ones. Default: true.
   */
  enforceAttribution?: boolean;
  /** Extra custom_data fields to merge alongside value/currency. */
  customData?: Record<string, unknown>;
}

export interface MaybeFireResult {
  fired: boolean;
  reason: string;
}

export async function maybeFireMetaEvent(args: MaybeFireArgs): Promise<MaybeFireResult> {
  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select("email, phone, first_name, last_name, fbc, fbp")
    .eq("id", args.contactId)
    .maybeSingle();

  if (error || !contact) {
    return { fired: false, reason: "contact_not_found" };
  }

  const fbc = (contact.fbc as string | null) ?? null;
  const enforceAttribution = args.enforceAttribution ?? true;
  if (enforceAttribution && !hasMetaAttributionServer({ fbc })) {
    return { fired: false, reason: "no_meta_attribution" };
  }

  const customData: Record<string, unknown> = { ...(args.customData ?? {}) };
  if (args.value != null) {
    customData.value = args.value;
    customData.currency = "USD";
  }

  const res = await sendEvent({
    eventName: args.eventName,
    actionSource: "system_generated",
    eventId: args.eventId,
    userData: {
      email: contact.email as string | undefined,
      phone: contact.phone as string | undefined,
      firstName: contact.first_name as string | undefined,
      lastName: contact.last_name as string | undefined,
      fbc: fbc ?? undefined,
      fbp: (contact.fbp as string | null) ?? undefined,
      externalId: args.contactId,
    },
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  });

  return { fired: res.success, reason: res.success ? "fired" : (res.error ?? "send_failed") };
}
