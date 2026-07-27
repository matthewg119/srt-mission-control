// Shared inbound-lead stack. One call turns a raw inbound lead into:
//   Supabase contact upsert → Zoho lead (create or update, never duplicate)
//   → #hot-leads top-level Slack post + a detail reply in that thread
//   → Speed-to-Lead RingOut.
//
// Extracted from /api/leads/funnel, which grew this sequence first. Every
// funnel now shares it: /aivisibility, the free-audit intake (/audit, /PDF,
// /contact) and Facebook Lead Ads. Every step is best-effort and logs rather
// than throws — a Zoho outage must never cost us the Slack ping, and vice
// versa. Returns the contact id so the caller can link whatever it creates
// next (an audit report, a deal) back to the same lead thread.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { fireSpeedToLead } from "@/lib/speed-to-lead";
import { postOrThreadLeadUpdate } from "@/lib/lead-thread";
import {
  createLead as zohoCreateLead,
  updateLead as zohoUpdateLead,
  searchLeads as zohoSearchLeads,
  addNoteToLead as zohoAddNote,
} from "@/lib/zoho";

export interface IngestLeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** The lead's own website. Not part of ZohoLeadData, set via a raw-field update. */
  website?: string;
  businessName?: string;
  city?: string;
  /** Internal origin tag written to contacts.source, e.g. "audit" | "pdf" | "facebook_lead". */
  source: string;
  /** Meta's leadgen_id. The only join key back to the ad for Conversions API
   *  for Leads — a lead ad never touches the site, so there is no fbc/fbclid. */
  fbLeadId?: string;
  /** What shows in Zoho's Lead Source picklist. */
  zohoLeadSource: string;
  /** Rendered into both the Zoho note and the Slack thread reply. */
  detailLines?: string[];
  /** First line of the Slack thread reply. Omit to skip the reply entirely. */
  headline?: string;
  /** Title of the Zoho note. Omit to skip the note. */
  noteTitle?: string;
  speedToLead?: boolean;
}

export interface IngestLeadResult {
  contactId: string | null;
  zohoLeadId: string | null;
  /** True when this call created the top-level #hot-leads message. */
  threadTs: string | null;
}

/** Find an existing contact by email, falling back to either phone column. */
async function findContact(email: string, phone: string) {
  const filters: string[] = [];
  if (email) filters.push(`email.ilike.${email}`);
  if (phone) filters.push(`phone.eq.${phone}`, `mobile_phone.eq.${phone}`);
  if (!filters.length) return null;

  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, zoho_lead_id")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function ingestLead(input: IngestLeadInput): Promise<IngestLeadResult> {
  const firstName = input.firstName?.trim() || "";
  const lastName = input.lastName?.trim() || "";
  const email = input.email?.trim().toLowerCase() || "";
  const phone = input.phone?.trim() || "";
  const website = input.website?.trim() || "";
  const businessName = input.businessName?.trim() || "";
  const city = input.city?.trim() || "";
  const fbLeadId = input.fbLeadId?.trim() || "";
  const leadName = [firstName, lastName].filter(Boolean).join(" ") || businessName || email || phone;

  // ── Supabase contact upsert ──
  let contactId: string | null = null;
  let existingZohoId: string | null = null;
  try {
    const existing = await findContact(email, phone);
    if (existing) {
      contactId = existing.id;
      existingZohoId = existing.zoho_lead_id || null;
      await supabaseAdmin
        .from("contacts")
        .update({
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(businessName ? { business_name: businessName } : {}),
          ...(phone ? { phone, mobile_phone: phone } : {}),
          ...(email ? { email } : {}),
          ...(website ? { website } : {}),
          ...(fbLeadId ? { fb_lead_id: fbLeadId } : {}),
          source: input.source,
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId!);
    } else {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("contacts")
        .insert({
          first_name: firstName || null,
          last_name: lastName || null,
          email: email || null,
          phone: phone || null,
          mobile_phone: phone || null,
          business_name: businessName || null,
          website: website || null,
          fb_lead_id: fbLeadId || null,
          source: input.source,
        })
        .select("id")
        .single();
      if (insertErr || !inserted) throw new Error(insertErr?.message || "contact insert failed");
      contactId = inserted.id;
    }
  } catch (err) {
    console.error("[lead-intake] contact upsert failed:", err instanceof Error ? err.message : err);
  }

  const detailLines = (input.detailLines ?? []).filter(Boolean);

  // ── Zoho: update the existing lead or search-then-create. Awaited so the
  // serverless function isn't torn down mid-write. ──
  let zohoLeadId: string | null = existingZohoId;
  try {
    if (!zohoLeadId && email) {
      const found = await zohoSearchLeads({ email });
      if (found && found.length > 0) zohoLeadId = found[0].id as string;
    }

    if (zohoLeadId) {
      await zohoUpdateLead(zohoLeadId, {
        ...(firstName ? { First_Name: firstName } : {}),
        Last_Name: lastName || firstName || businessName || "Unknown",
        ...(businessName ? { Company: businessName } : {}),
        ...(phone ? { Phone: phone } : {}),
        ...(email ? { Email: email } : {}),
        ...(website ? { Website: website } : {}),
        ...(city ? { City: city } : {}),
      });
    } else {
      zohoLeadId = await zohoCreateLead({
        firstName,
        lastName: lastName || firstName || businessName,
        businessName,
        email,
        phone,
        bizCity: city || undefined,
        source: input.zohoLeadSource,
        Lead_Status: "New Lead",
      });
      // Website isn't part of ZohoLeadData — set it with a raw-field update.
      if (zohoLeadId && website) {
        await zohoUpdateLead(zohoLeadId, { Website: website });
      }
    }

    if (zohoLeadId) {
      if (contactId && zohoLeadId !== existingZohoId) {
        await supabaseAdmin.from("contacts").update({ zoho_lead_id: zohoLeadId }).eq("id", contactId);
      }
      if (input.noteTitle && detailLines.length) {
        await zohoAddNote(zohoLeadId, input.noteTitle, detailLines.join("\n")).catch((err) =>
          console.error("[lead-intake] zoho note failed:", err instanceof Error ? err.message : err)
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lead-intake] zoho sync failed:", msg);
    await supabaseAdmin
      .from("system_logs")
      .insert({
        event_type: "zoho_sync_error",
        description: `Zoho sync failed for ${input.source} lead ${email || phone}: ${msg.slice(0, 300)}`,
        metadata: { contactId, email, phone, source: input.source },
      })
      .then(undefined, () => {});
  }

  // ── Activity log ──
  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "lead_capture",
      description: `New ${input.source} lead: ${leadName}${businessName ? " — " + businessName : ""}`,
      metadata: { contactId, zohoLeadId, email, phone, website, city, source: input.source },
    })
    .then(undefined, () => {});

  // ── Slack: top-level #hot-leads post on first touch, then the detail reply ──
  let threadTs: string | null = null;
  if (contactId) {
    await postOrThreadLeadUpdate({ contactId, action: "create" }).catch((err) =>
      console.error("[lead-intake] lead-thread failed:", err instanceof Error ? err.message : err)
    );
    try {
      const { data: refreshed } = await supabaseAdmin
        .from("contacts")
        .select("slack_thread_ts, slack_channel")
        .eq("id", contactId)
        .single();
      threadTs = refreshed?.slack_thread_ts ?? null;
      const channel = refreshed?.slack_channel || process.env.SLACK_HOT_LEADS_CHANNEL || "";
      if (channel && threadTs && input.headline) {
        await slack.postThreadReply(
          channel,
          threadTs,
          [input.headline, ...detailLines].join("\n")
        );
      }
    } catch (err) {
      console.error("[lead-intake] slack reply failed:", err instanceof Error ? err.message : err);
    }
  }

  // ── Speed-to-Lead RingOut. Its own gates (kill switch, business hours,
  // 30-min cooldown, DNC) decide whether the call actually fires. ──
  if (input.speedToLead !== false && phone && contactId) {
    fireSpeedToLead({
      leadId: contactId,
      leadPhone: phone,
      leadName,
      leadSource: input.source,
    });
  }

  return { contactId, zohoLeadId, threadTs };
}

/**
 * Append a follow-up to a lead that already exists: a Zoho note plus a reply in
 * the same #hot-leads thread. Used for post-lead quiz answers, which arrive
 * after the lead has already been created and the audit already kicked off.
 * No-op when the email matches nothing.
 */
export async function enrichLead(opts: {
  email: string;
  headline: string;
  detailLines: string[];
  noteTitle: string;
}): Promise<boolean> {
  const email = opts.email.trim().toLowerCase();
  if (!email) return false;

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, zoho_lead_id, slack_thread_ts, slack_channel")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!contact) return false;

  const detailLines = opts.detailLines.filter(Boolean);

  if (contact.zoho_lead_id && detailLines.length) {
    await zohoAddNote(contact.zoho_lead_id, opts.noteTitle, detailLines.join("\n")).catch((err) =>
      console.error("[lead-intake] enrich zoho note failed:", err instanceof Error ? err.message : err)
    );
  }

  const channel = contact.slack_channel || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel && contact.slack_thread_ts) {
    await slack
      .postThreadReply(channel, contact.slack_thread_ts, [opts.headline, ...detailLines].join("\n"))
      .catch((err) =>
        console.error("[lead-intake] enrich slack reply failed:", err instanceof Error ? err.message : err)
      );
  }

  return true;
}
