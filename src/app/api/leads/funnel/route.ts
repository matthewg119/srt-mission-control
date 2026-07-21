export const dynamic = "force-dynamic";
// POST /api/leads/funnel — secret-gated intake for the static-site funnels
// (srtagency.com/aivisibility). Server-to-server only: the srt-agwb
// /api/visibility-notify function forwards the captured lead here with the
// x-funnel-secret header (same secret as /api/notify/funnel).
//
// One call gives the funnel the full inbound-lead stack:
//   Supabase contact upsert → Zoho lead (create or update, phone always synced)
//   → #hot-leads Slack thread + "New Index lead" reply → Speed-to-Lead RingOut.
// Every downstream step is best-effort; the route always answers fast so the
// static site's beacon never hangs.

import { NextRequest, NextResponse } from "next/server";
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

const ZOHO_LEAD_SOURCE = "AI Visibility Index";

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

export async function POST(req: NextRequest) {
  const secret = process.env.FUNNEL_NOTIFY_SECRET;
  if (!secret || req.headers.get("x-funnel-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const name = clean(body.name, 80);
    const clinic = clean(body.clinic, 120);
    const email = clean(body.email, 120).toLowerCase();
    const phone = clean(body.phone, 20).replace(/[^\d+]/g, "");
    const website = clean(body.website, 120);
    const city = clean(body.city, 60);
    const services = Array.isArray(body.services)
      ? body.services.map((s: unknown) => clean(s, 40)).filter(Boolean).slice(0, 6)
      : [];
    const patientGoal = clean(body.patientGoal, 20);
    const ads = clean(body.ads, 20);
    const marketing = clean(body.marketing, 20);
    const budget = clean(body.budget, 20);
    const fit = clean(body.fit, 10);
    const consentTs = clean(body.consentTs, 40);
    const source = clean(body.source, 40) || "aivisibility";

    if (!email && !phone) {
      return NextResponse.json({ error: "email or phone required" }, { status: 400 });
    }

    const nameParts = name.split(" ").filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const leadName = name || clinic || email;

    // ── Supabase contact upsert (keyed on email, phone fallback) ──
    let contactId: string | null = null;
    let existingZohoId: string | null = null;
    try {
      const orFilter = phone
        ? `email.ilike.${email},phone.eq.${phone},mobile_phone.eq.${phone}`
        : `email.ilike.${email}`;
      const { data: existing } = await supabaseAdmin
        .from("contacts")
        .select("id, zoho_lead_id")
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        contactId = existing.id;
        existingZohoId = existing.zoho_lead_id || null;
        await supabaseAdmin
          .from("contacts")
          .update({
            ...(firstName ? { first_name: firstName } : {}),
            ...(lastName ? { last_name: lastName } : {}),
            ...(clinic ? { business_name: clinic } : {}),
            ...(phone ? { phone, mobile_phone: phone } : {}),
            ...(email ? { email } : {}),
            source,
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
            business_name: clinic || null,
            source,
          })
          .select("id")
          .single();
        if (insertErr || !inserted) throw new Error(insertErr?.message || "contact insert failed");
        contactId = inserted.id;
      }
    } catch (err) {
      console.error("[leads/funnel] contact upsert failed:", err instanceof Error ? err.message : err);
    }

    const answerLines = [
      website ? `Website: ${website}` : "",
      city ? `City: ${city}` : "",
      services.length ? `Services: ${services.join(", ")}` : "",
      patientGoal ? `New patients goal: ${patientGoal}/mo` : "",
      ads ? `Running ads: ${ads}` : "",
      marketing ? `Marketing today: ${marketing}` : "",
      budget ? `Budget: ${budget} (fit: ${fit || "?"})` : "",
      consentTs ? `SMS/email consent: agreed at ${consentTs}` : "",
      `Funnel: /${source}`,
    ].filter(Boolean);

    // ── Zoho: update existing lead or search-then-create (no duplicates).
    // Phone always syncs to Zoho. Awaited so the serverless function isn't
    // torn down before Zoho finishes. ──
    let zohoLeadId: string | null = existingZohoId;
    try {
      if (!zohoLeadId && email) {
        const found = await zohoSearchLeads({ email });
        if (found && found.length > 0) zohoLeadId = found[0].id as string;
      }

      if (zohoLeadId) {
        await zohoUpdateLead(zohoLeadId, {
          ...(firstName ? { First_Name: firstName } : {}),
          Last_Name: lastName || firstName || clinic || "Unknown",
          ...(clinic ? { Company: clinic } : {}),
          ...(phone ? { Phone: phone } : {}),
          ...(email ? { Email: email } : {}),
          ...(website ? { Website: website } : {}),
          ...(city ? { City: city } : {}),
        });
      } else {
        zohoLeadId = await zohoCreateLead({
          firstName,
          lastName: lastName || firstName || clinic,
          businessName: clinic,
          email,
          phone,
          bizCity: city || undefined,
          source: ZOHO_LEAD_SOURCE,
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
        await zohoAddNote(zohoLeadId, "AI Visibility Index", answerLines.join("\n")).catch((err) =>
          console.error("[leads/funnel] zoho note failed:", err instanceof Error ? err.message : err)
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[leads/funnel] zoho sync failed:", msg);
      await supabaseAdmin.from("system_logs").insert({
        event_type: "zoho_sync_error",
        description: `Zoho sync failed for funnel lead ${email || phone}: ${msg.slice(0, 300)}`,
        metadata: { contactId, email, phone, source },
      }).then(undefined, () => {});
    }

    // ── Activity log ──
    await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `New funnel lead: ${leadName} — ${clinic || "N/A"} (${source})`,
      metadata: { contactId, zohoLeadId, email, phone, website, city, budget, fit, source },
    }).then(undefined, () => {});

    // ── Slack: #hot-leads thread (top-level on first touch) + formatted
    // "New Index lead" reply with the full funnel answers ──
    if (contactId) {
      await postOrThreadLeadUpdate({ contactId, action: "create" }).catch((err) =>
        console.error("[leads/funnel] lead-thread failed:", err instanceof Error ? err.message : err)
      );
      try {
        const { data: refreshed } = await supabaseAdmin
          .from("contacts")
          .select("slack_thread_ts, slack_channel")
          .eq("id", contactId)
          .single();
        const channel = refreshed?.slack_channel || process.env.SLACK_HOT_LEADS_CHANNEL || "";
        if (channel && refreshed?.slack_thread_ts) {
          const summary =
            `New Index lead: ${leadName} · ${clinic || "?"} · ${city || "?"} · ${website || "?"} · budget ${budget || "?"} · fit ${fit || "?"} · phone ${phone || "?"}`;
          await slack.postThreadReply(
            channel,
            refreshed.slack_thread_ts,
            summary + "\n" + answerLines.join("\n")
          );
        }
      } catch (err) {
        console.error("[leads/funnel] slack reply failed:", err instanceof Error ? err.message : err);
      }
    }

    // ── Speed-to-Lead RingOut. Its own gates (kill switch, business hours,
    // 30-min cooldown, DNC) decide whether the call actually fires. ──
    if (phone && contactId) {
      fireSpeedToLead({
        leadId: contactId,
        leadPhone: phone,
        leadName,
        leadSource: source,
      });
    }

    return NextResponse.json({ success: true, contactId, zohoLeadId });
  } catch (err) {
    console.error("[leads/funnel] fatal:", err);
    return NextResponse.json({ error: "capture failed" }, { status: 500 });
  }
}
