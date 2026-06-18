// Guarantees a deal (Supabase row + Zoho conversion + Slack thread) exists for a
// contact. Called when an application completes so the downstream submission flow
// (maybePostSubmissionReady → buildSubmissionPackage) has a deal + thread to work
// with — the bank-statement analyzer does NOT auto-create a deal, it only asks
// "reply `create deal`", so completion has to do it.
//
// Idempotent: returns the newest existing deal for the contact if one already
// exists, and never throws (Slack/Zoho/DB failures must not break completion).

import { supabaseAdmin } from "@/lib/db";
import { convertLeadToDeal } from "@/lib/zoho";
import { postDealThreadUpdate } from "./deal-thread";

interface EnsureDealResult {
  dealId: string | null;
  created: boolean;
}

async function logSystem(row: { event_type: string; description: string; metadata: Record<string, unknown> }): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert(row);
  } catch {
    /* best-effort */
  }
}

function parseAmount(...vals: Array<unknown>): number {
  for (const v of vals) {
    if (v == null) continue;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 0;
}

export async function ensureDealForContact(contactId: string): Promise<EnsureDealResult> {
  if (!contactId) return { dealId: null, created: false };

  try {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select(
        "id, first_name, last_name, business_name, legal_name, amount_needed, portal_funding_range, source, zoho_lead_id, zoho_deal_id",
      )
      .eq("id", contactId)
      .maybeSingle();
    if (!contact) return { dealId: null, created: false };

    // 1) Existing deal wins — just make sure it has a Slack thread.
    const { data: existing } = await supabaseAdmin
      .from("deals")
      .select("id, slack_thread_ts")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      if (!existing.slack_thread_ts) {
        await postDealThreadUpdate({
          dealId: existing.id as string,
          action: "created",
          text: "Deal thread opened",
        }).catch((e) => console.warn("[ensure-deal] thread for existing deal failed:", (e as Error).message));
      }
      return { dealId: existing.id as string, created: false };
    }

    // 2) No deal — convert the Zoho lead (best-effort) and create the Supabase row.
    const contactName =
      (contact.business_name as string) ||
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      "Applicant";
    const amount = parseAmount(contact.amount_needed, contact.portal_funding_range);

    let zohoDealId = (contact.zoho_deal_id as string | null) ?? null;
    if (!zohoDealId && contact.zoho_lead_id) {
      try {
        const conv = await convertLeadToDeal(contact.zoho_lead_id as string, {
          dealName: `${(contact.business_name as string) || (contact.legal_name as string) || contactName} — Application`,
          amount,
          stage: "Qualification",
        });
        if (conv?.dealId) {
          zohoDealId = conv.dealId;
          await supabaseAdmin.from("contacts").update({ zoho_deal_id: conv.dealId }).eq("id", contactId);
          await logSystem({
            event_type: "zoho_lead_converted",
            description: `Zoho lead converted to deal for ${contactName} (application complete)`,
            metadata: { contactId, zohoLeadId: contact.zoho_lead_id, zohoDealId: conv.dealId },
          });
        }
      } catch (convErr) {
        const cMsg = convErr instanceof Error ? convErr.message : String(convErr);
        console.error("[ensure-deal] Zoho convertLeadToDeal failed:", cMsg);
        await logSystem({
          event_type: "zoho_convert_error",
          description: `Zoho lead conversion failed for ${contactName}: ${cMsg.slice(0, 300)}`,
          metadata: { contactId, zohoLeadId: contact.zoho_lead_id, error: cMsg },
        });
      }
    }

    const { data: deal, error: dealErr } = await supabaseAdmin
      .from("deals")
      .insert({
        contact_id: contactId,
        pipeline: "New Deals",
        stage: "Open - Not Contacted",
        amount,
        source: (contact.source as string) || "Portal - Application",
        zoho_lead_id: (contact.zoho_lead_id as string | null) ?? null,
      })
      .select("id")
      .maybeSingle();

    if (dealErr || !deal) {
      console.error("[ensure-deal] deal insert failed:", dealErr?.message);
      return { dealId: null, created: false };
    }

    await logSystem({
      event_type: "pipeline_deal_created",
      description: `New deal: ${contactName} → New Deals / Open - Not Contacted`,
      metadata: { contactId, dealId: deal.id, source: "application-complete" },
    });

    // 3) Open the deal thread so submission-ready's thread check passes.
    await postDealThreadUpdate({
      dealId: deal.id as string,
      action: "created",
      text: "Deal thread opened",
    }).catch((e) => console.warn("[ensure-deal] thread creation failed:", (e as Error).message));

    return { dealId: deal.id as string, created: true };
  } catch (err) {
    console.error("[ensure-deal] unexpected error:", err instanceof Error ? err.message : err);
    return { dealId: null, created: false };
  }
}
