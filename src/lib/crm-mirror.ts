// Mirrors Zoho notes into lead_activities.
//
// WHY THIS IS A SEPARATE FILE, AND WHY IT HOOKS THE ZOHO CLIENT
// Twelve call sites across the codebase write notes to Zoho — the AI action
// executor, the call-coach wrap card, submissions, iMessage follow-ups,
// income-verification emails, the sales-twin bridge, and more. Those notes ARE
// the activity history we are migrating; missing any of them leaves a hole in
// the timeline.
//
// Editing twelve sites by hand would work once and then rot: the thirteenth
// note site somebody adds next month would silently not be mirrored. So the
// hook lives inside addNoteToLead() / addNoteToRecord() in zoho.ts, which every
// one of those paths already funnels through. A note cannot reach Zoho without
// passing here.
//
// It lives in its own module rather than in crm.ts purely to keep the import
// graph acyclic — crm.ts imports zoho.ts, so zoho.ts must not import crm.ts.
// This file imports nothing but the database client.

import { supabaseAdmin } from "./db";

/**
 * Best-effort: resolve the Zoho parent to a contact and append a timeline row.
 *
 * Silent on every failure by design. A note that reached Zoho successfully must
 * never fail its caller because our mirror couldn't find a matching contact —
 * plenty of Zoho notes belong to records that have no Supabase row at all.
 */
export async function mirrorZohoNote(a: {
  zohoLeadId?: string | null;
  zohoDealId?: string | null;
  title: string;
  content: string;
  actor?: string;
  /** The id Zoho assigned the note it just created, when the write returned one. */
  externalId?: string | null;
}): Promise<void> {
  try {
    if (!a.zohoLeadId && !a.zohoDealId) return;

    let contactId: string | null = null;

    if (a.zohoLeadId) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("zoho_lead_id", a.zohoLeadId)
        .maybeSingle();
      contactId = (data?.id as string) ?? null;
    }
    if (!contactId && a.zohoDealId) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("zoho_deal_id", a.zohoDealId)
        .maybeSingle();
      contactId = (data?.id as string) ?? null;
    }
    if (!contactId) return;

    // THE ID IS WHAT KEEPS THE TIMELINE FROM DOUBLING.
    //
    // This row and the row zoho-pull.mapNote() writes for the same note are the
    // same event. Idempotency is keyed on (source, external_id), so writing ours
    // as source:'mission_control' with no id — as this did originally — does not
    // collide with the importer's source:'zoho' row, and EVERY note Mission
    // Control sends would appear twice as soon as the importer caught up.
    //
    // Zoho hands back the new note's id on the create, so claim the same key the
    // importer will use. The importer then upserts onto this row instead of
    // adding a second one. Without an id (an older Zoho response shape, or a
    // mirror call that never went through a create) fall back to the local
    // namespace — a duplicate is better than a lost note.
    const externalId = a.externalId?.trim() || null;

    const row = {
      contact_id: contactId,
      activity_type: "note",
      direction: "internal",
      channel: "zoho",
      subject: a.title,
      body: a.content,
      occurred_at: new Date().toISOString(),
      actor: a.actor ?? "mission_control",
      source: externalId ? "zoho" : "mission_control",
      external_id: externalId,
      external_module: externalId ? "Notes" : null,
      metadata: {
        mirrored_from: "zoho_note",
        written_by: "mission_control",
        zoho_lead_id: a.zohoLeadId ?? null,
        zoho_deal_id: a.zohoDealId ?? null,
      },
    };

    if (externalId) {
      await supabaseAdmin
        .from("lead_activities")
        .upsert(row, { onConflict: "source,external_id", ignoreDuplicates: true });
    } else {
      await supabaseAdmin.from("lead_activities").insert(row);
    }
  } catch {
    // Never break a successful Zoho write.
  }
}

/**
 * Mirror a Lead_Status that went out on a Zoho updateLead() call.
 *
 * Some status writes ride along inside a bulk field update rather than through
 * crm.setLeadStatus — /api/leads/application updates every field and the status
 * in one PUT, for instance. Routing those through setLeadStatus would mean
 * splitting the payload; hooking updateLead() instead catches them all,
 * including any added later.
 *
 * Records history + a timeline entry, and marks the origin as mission_control
 * so the inbound webhook's echo guard recognises our own write coming back.
 */
export async function mirrorZohoStatusWrite(a: {
  zohoLeadId: string;
  status: string;
  actor?: string;
}): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, application_stage")
      .eq("zoho_lead_id", a.zohoLeadId)
      .maybeSingle();
    if (!data) return;

    const contactId = data.id as string;
    const current = data.application_stage as string | null;
    if (current === a.status) return;

    const now = new Date().toISOString();

    await supabaseAdmin
      .from("contacts")
      .update({
        application_stage: a.status,
        application_stage_updated_at: now,
        application_stage_origin: "mission_control",
      })
      .eq("id", contactId);

    await supabaseAdmin.from("lead_status_history").insert({
      contact_id: contactId,
      old_status: current,
      new_status: a.status,
      reason: "set alongside a Zoho field update",
      origin: "mission_control",
      actor: a.actor ?? null,
      occurred_at: now,
    });

    await supabaseAdmin.from("lead_activities").insert({
      contact_id: contactId,
      activity_type: "status_change",
      direction: "internal",
      channel: "web",
      subject: `${current ?? "—"} → ${a.status}`,
      occurred_at: now,
      actor: a.actor ?? "mission_control",
      source: "mission_control",
      metadata: { oldStatus: current, newStatus: a.status, via: "updateLead" },
    });
  } catch {
    // Never break a successful Zoho write.
  }
}
