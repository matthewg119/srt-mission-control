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

/**
 * The page a lead came from, for `sourcePage`.
 *
 * ‼️ THE REFERER FIRST, THE KNOWN PATH SECOND, AND THE DIFFERENCE MATTERS. Every funnel route knows
 * which funnel it is, and that is what they were putting in a thread reply as "Funnel: /scan". What none
 * of them knew is the HOST, and our funnels are served from at least two: srtagency.com rewrites to
 * mission.srtagency.com for /scan, /onboardingfree and the rest, and a Webflow page can post to the same
 * route from a third. "The lead came from /scan" and "the lead came from srtagency.com/scan" are
 * different facts once there is more than one front door, and attribution is the whole point of this.
 *
 * ‼️ AND IT IS BROWSER REPORTED, SO IT IS DATA AND NEVER A DECISION. A Referer can be absent,
 * stripped by a privacy setting, or forged. Nothing branches on it: it is printed on a card for a person
 * to read. The fallback is what the route already knew about itself, so a stripped header degrades to the
 * old behaviour rather than to nothing.
 */
export function pageFromRequest(req: { headers: { get(name: string): string | null } }, fallbackPath: string): string {
  const referer = (req.headers.get("referer") || "").trim();
  if (referer) {
    try {
      const u = new URL(referer);
      // Query strings are attribution of their own (utm_*, fbclid) and are already captured in their
      // own columns. On a card they would push the useful half of the line off the screen.
      const page = `${u.host}${u.pathname}`.replace(/\/+$/, "");
      if (u.host) return page.slice(0, 300);
    } catch {
      // A malformed Referer is no worse than a missing one. Fall through.
    }
  }
  const path = fallbackPath.startsWith("/") ? fallbackPath : `/${fallbackPath}`;
  return `srtagency.com${path}`;
}

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
  /**
   * WHICH page they came from. Host and path, no scheme, e.g. "srtagency.com/scan".
   *
   * ‼️ IT IS ON THE CARD, WHICH IS THE ONLY REASON THIS FIELD EXISTS. `headline` and `detailLines`
   * already carried a "Page:" line for the callers that knew one, and both land in the THREAD REPLY.
   * That is the "1 reply" under a lead card that nobody opens, so nothing in #hot-leads was
   * attributable without a click. This is written to contacts.source_page and rendered beside Source.
   *
   * ‼️ AND IT IS NOT `source`. That is an origin TAG ("concierge", "pdf", "facebook_lead") and is
   * what the channel and every query group by; this is the URL a human recognises. A lane that put a
   * path in `source` would break all of them.
   *
   * Omitted where there genuinely is no page: a Meta lead ad never touches the site and an email reply
   * has no page at all. An empty value is left off the card rather than printed blank.
   */
  sourcePage?: string;
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
  /** Attribution, written straight through to the matching contacts columns.
   *  Every write below is conditional: a second touch on an existing contact
   *  must never blank the origin a first touch recorded. There is no
   *  utm_term column, so do not add a field for one. */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
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
  const utmSource = input.utmSource?.trim() || "";
  const utmMedium = input.utmMedium?.trim() || "";
  const utmCampaign = input.utmCampaign?.trim() || "";
  const utmContent = input.utmContent?.trim() || "";
  // Host and path as the caller reported them, trimmed and bounded. The value is browser-reported on
  // every caller that has one, so it is data about the visit and never trusted as anything else.
  const sourcePage = input.sourcePage?.trim().slice(0, 300) || "";
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
          ...(utmSource ? { utm_source: utmSource } : {}),
          ...(utmMedium ? { utm_medium: utmMedium } : {}),
          ...(utmCampaign ? { utm_campaign: utmCampaign } : {}),
          ...(utmContent ? { utm_content: utmContent } : {}),
          // ‼️ CONDITIONAL, LIKE EVERY utm ABOVE IT AND FOR THE SAME REASON. A second touch must
          // never blank the page a first touch recorded: somebody who arrived through /scan and later
          // replies to an email is still a /scan lead, and the reply knows no page to overwrite it with.
          ...(sourcePage ? { source_page: sourcePage } : {}),
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
          utm_source: utmSource || null,
          utm_medium: utmMedium || null,
          utm_campaign: utmCampaign || null,
          utm_content: utmContent || null,
          source_page: sourcePage || null,
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
        // ‼️ AND NOT IN THE REPLY EITHER. This one carries the "Website:" and "Page:" lines, so it
        // is the post most likely to unfurl: a lead who gave a website got a preview of that website in
        // our own channel, fetched by Slack, under a card about a person.
        await slack.postThreadReply(
          channel,
          threadTs,
          [input.headline, ...detailLines].join("\n"),
          undefined,
          { unfurl: false }
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
      .postThreadReply(channel, contact.slack_thread_ts, [opts.headline, ...detailLines].join("\n"), undefined, {
        unfurl: false,
      })
      .catch((err) =>
        console.error("[lead-intake] enrich slack reply failed:", err instanceof Error ? err.message : err)
      );
  }

  return true;
}
