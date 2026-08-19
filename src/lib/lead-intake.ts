// Shared inbound-lead stack. One call turns a raw inbound lead into:
//   Supabase contact upsert → timeline note
//   → #hot-leads top-level Slack post + a detail reply in that thread
//   → Speed-to-Lead RingOut.
//
// Extracted from /api/leads/funnel, which grew this sequence first. Every
// funnel now shares it: /aivisibility, the free-audit intake (/audit, /PDF,
// /contact) and Facebook Lead Ads. Every step is best-effort and logs rather
// than throws — a Slack outage must never cost us the contact row, and vice
// versa. Returns the contact id so the caller can link whatever it creates
// next (an audit report, a deal) back to the same lead thread.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { fireSpeedToLead } from "@/lib/speed-to-lead";
import { postOrThreadLeadUpdate } from "@/lib/lead-thread";
import { companiesConflict, type CompanyIdentity } from "@/lib/company-identity";
import { logActivity } from "@/lib/crm";
import { normalizeLeadPhone } from "@/lib/phone";

export interface IngestLeadInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  website?: string;
  businessName?: string;
  city?: string;
  /** Internal origin tag written to contacts.source, e.g. "audit" | "pdf" | "facebook_lead". */
  source: string;
  /** Meta's leadgen_id. The only join key back to the ad for Conversions API
   *  for Leads — a lead ad never touches the site, so there is no fbc/fbclid. */
  fbLeadId?: string;
  /** Rendered into both the timeline note and the Slack thread reply. */
  detailLines?: string[];
  /** First line of the Slack thread reply. Omit to skip the reply entirely. */
  headline?: string;
  /** Subject of the timeline note. Omit to skip the note. */
  noteTitle?: string;
  speedToLead?: boolean;
}

export interface IngestLeadResult {
  contactId: string | null;
  /** True when this call created the top-level #hot-leads message. */
  threadTs: string | null;
}

/** How many email/phone matches to consider before giving up and creating a new contact. */
const CONTACT_CANDIDATES = 5;

/**
 * Find an existing contact by email, falling back to either phone column — but never reuse one
 * that belongs to a DIFFERENT company.
 *
 * Matching on phone-or-email alone collapsed genuinely separate businesses onto one contact:
 * a shared front-desk line, or one person who requests audits for two of their companies. The
 * row's business_name/website then got overwritten by whichever lead landed last, and
 * downstream that contact's Slack thread received the other company's results.
 *
 * Conflict is judged by companiesConflict(), which only fires when BOTH sides carry the field.
 * The funding funnels pass no website or business name, so they match exactly as they did.
 */
async function findContact(email: string, phone: string, identity: CompanyIdentity) {
  const filters: string[] = [];
  if (email) filters.push(`email.ilike.${email}`);

  // ‼️ THE LAST TEN DIGITS, NOT THE STRING. This used to be `phone.eq.${phone}`, an exact
  // text match against whatever shape the funnel happened to store, so "3368332303",
  // "13368332303" and "+13368332303" were three different people to the one function every
  // inbound funnel dedupes through. phone_last10 / mobile_last10 are generated columns
  // (docs/2026-06-04-contacts-phone-last10.sql) that five other lookups in this app already
  // use, and matching on them collapses the rows ALREADY stored in mismatched shapes, which
  // normalizing at the door alone would never have reached.
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length === 10) {
    filters.push(`phone_last10.eq.${last10}`, `mobile_last10.eq.${last10}`);
  }
  if (!filters.length) return null;

  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, website, business_name")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(CONTACT_CANDIDATES);

  const candidates = data ?? [];
  // Newest first, so the most recent compatible contact still wins as before.
  for (const c of candidates) {
    if (!companiesConflict({ website: c.website, businessName: c.business_name }, identity)) {
      return { id: c.id as string };
    }
  }

  if (candidates.length > 0) {
    console.warn(
      `[lead-intake] ${candidates.length} contact match(es) on email/phone, all a different company than ` +
        `${identity.businessName || identity.website}. Creating a separate contact rather than overwriting one.`
    );
  }
  return null;
}

export async function ingestLead(input: IngestLeadInput): Promise<IngestLeadResult> {
  const firstName = input.firstName?.trim() || "";
  const lastName = input.lastName?.trim() || "";
  const email = input.email?.trim().toLowerCase() || "";
  // Normalized HERE as well as at each funnel, because this is the one door every
  // inbound lead goes through and a caller added later must not be able to reintroduce
  // a raw string. It is what gets written to contacts.phone and pushed to the CRM.
  const phone = normalizeLeadPhone(input.phone);
  const website = input.website?.trim() || "";
  const businessName = input.businessName?.trim() || "";
  const city = input.city?.trim() || "";
  const fbLeadId = input.fbLeadId?.trim() || "";
  const leadName = [firstName, lastName].filter(Boolean).join(" ") || businessName || email || phone;

  // ── Supabase contact upsert ──
  let contactId: string | null = null;
  try {
    const existing = await findContact(email, phone, { website, businessName });
    if (existing) {
      contactId = existing.id;
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

  // ── The intake detail goes straight onto the timeline. ──
  //
  // This used to be a Zoho note, and that note was the only record of it. The
  // #hot-leads Slack post and the Speed-to-Lead RingOut below always keyed off
  // `contactId`, never off a Zoho id, so nothing else here changed when Zoho
  // went away.
  if (contactId && input.noteTitle && detailLines.length) {
    await logActivity({
      contactId,
      activityType: "note",
      direction: "internal",
      channel: "web",
      subject: input.noteTitle,
      body: detailLines.join("\n"),
      actor: "lead-intake",
      source: "mission_control",
    });
  }

  // ── Activity log ──
  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "lead_capture",
      description: `New ${input.source} lead: ${leadName}${businessName ? " — " + businessName : ""}`,
      metadata: { contactId, email, phone, website, city, source: input.source },
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

  return { contactId, threadTs };
}

/**
 * Append a follow-up to a lead that already exists: a timeline note plus a reply in
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
    .select("id, slack_thread_ts, slack_channel")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!contact) return false;

  const detailLines = opts.detailLines.filter(Boolean);

  if (detailLines.length) {
    await logActivity({
      contactId: contact.id as string,
      activityType: "note",
      direction: "internal",
      channel: "web",
      subject: opts.noteTitle,
      body: detailLines.join("\n"),
      actor: "lead-intake",
      source: "mission_control",
    });
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
