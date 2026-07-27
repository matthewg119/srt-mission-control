// Lead outcome reporting: DNQ / Booked Call / Converted, clicked from the
// #hot-leads message and pushed back to Meta as a Conversions API CRM event.
//
// WHY THIS EXISTS: Meta optimizes for whatever you tell it success looks like.
// With no feedback it optimizes for volume of form fills, which is how you end
// up paying for junk. Telling it which leads were junk, which booked and which
// closed is what moves the algorithm toward quality.
//
// WHY NOT THE PIXEL PATH: a Lead Ad form is filled inside Facebook. The lead
// never touches the site, so there is no _fbc, no fbclid, and no pixel fire —
// hasMetaAttributionServer() is false for every one of these leads. Meta's
// answer is the CRM event, which matches on the lead's own leadgen_id instead.
// That id is captured at intake into contacts.fb_lead_id.
//
// WHY NO ZOHO WRITE: deliberate. Every Zoho Lead_Status write round-trips back
// through /api/webhooks/zoho-lead and trips a Deluge rule, so this flow stays
// Slack-only and out of that loop. See docs/2026-07-27-lead-disposition.sql.

import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { refreshLeadMessage, LEAD_DISPOSITIONS, type LeadDisposition } from "@/lib/lead-thread";

/** Free-form CRM stage names, per Meta's payload spec. */
const META_EVENT_NAME: Record<LeadDisposition, string> = {
  dnq: "DNQ",
  booked_call: "BookedCall",
  converted: "Converted",
};

/** Identifies us as the CRM in Events Manager. */
const LEAD_EVENT_SOURCE = "SRT Mission Control";

export interface ApplyDispositionResult {
  ok: boolean;
  reason?: string;
  metaSent?: boolean;
}

/**
 * Record a lead outcome and report it to Meta. Best-effort throughout: the
 * disposition is written first, so a Meta outage never costs us the record.
 */
export async function applyLeadDisposition(opts: {
  contactId: string;
  disposition: LeadDisposition;
  slackUserId: string;
}): Promise<ApplyDispositionResult> {
  const { contactId, disposition, slackUserId } = opts;

  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select("id, email, phone, mobile_phone, first_name, last_name, fb_lead_id, disposition")
    .eq("id", contactId)
    .single();

  if (error || !contact) {
    console.error("[lead-disposition] contact not found:", contactId, error?.message);
    return { ok: false, reason: "contact_not_found" };
  }

  const { error: updateErr } = await supabaseAdmin
    .from("contacts")
    .update({
      disposition,
      disposition_at: new Date().toISOString(),
      disposition_by: slackUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (updateErr) {
    console.error("[lead-disposition] update failed:", updateErr.message);
    return { ok: false, reason: "update_failed" };
  }

  // Redraw the Slack message before the network call to Meta, so the click
  // feels instant rather than waiting on Graph.
  await refreshLeadMessage(contactId);

  if (!contact.fb_lead_id) {
    // Expected for website funnel leads, which have no Meta lead to attribute
    // against. Nothing is broken; there is simply nothing to report.
    return { ok: true, metaSent: false, reason: "no_fb_lead_id" };
  }

  try {
    const result = await sendEvent({
      eventName: META_EVENT_NAME[disposition],
      actionSource: "system_generated",
      // Same deterministic convention as /api/leads/disqualify, so Meta dedups
      // if a lead is ever dispositioned through more than one path.
      eventId: `${disposition}_${contact.id}`,
      userData: {
        leadId: String(contact.fb_lead_id),
        email: contact.email || undefined,
        phone: contact.mobile_phone || contact.phone || undefined,
        firstName: contact.first_name || undefined,
        lastName: contact.last_name || undefined,
        externalId: contact.id || undefined,
      },
      customData: {
        lead_event_source: LEAD_EVENT_SOURCE,
        event_source: "crm",
        content_name: LEAD_DISPOSITIONS[disposition].label,
      },
    });

    if (!result.success) {
      console.error("[lead-disposition] Meta CRM event rejected:", result.error);
      return { ok: true, metaSent: false, reason: result.error };
    }
    return { ok: true, metaSent: true };
  } catch (err) {
    console.error("[lead-disposition] Meta CRM event threw:", err instanceof Error ? err.message : err);
    return { ok: true, metaSent: false, reason: "meta_error" };
  }
}
