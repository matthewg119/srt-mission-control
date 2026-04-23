import { supabaseAdmin } from "@/lib/db";
import { getLead, getLeadNotes } from "@/lib/zoho";
import type { ZohoApiRecord } from "@/lib/zoho";

// ── MerchantContext ──────────────────────────────────────────────────────
// Everything VeKtor needs in order to draft a personalized email: the raw
// contact, Zoho notes, deal events, portal activity, recent marketing history,
// and signals the Touch Policy uses to decide whether we should even email.

export interface MerchantContextInput {
  contactId?: string;
  zohoLeadId?: string;
}

export interface ContactSnapshot {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  industry: string | null;
  amount_needed: number | null;
  monthly_revenue: number | null;
  credit_score: string | null;
  inc_date: string | null;
  use_of_funds: string | null;
  portal_app_completed: boolean;
  portal_statements_uploaded: boolean;
  application_signed_at: string | null;
  statements_uploaded_at: string | null;
  last_portal_login_at: string | null;
  portal_login_count: number;
  zoho_lead_id: string | null;
  do_not_contact: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecentSend {
  campaign_key: string;
  subject: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
}

export interface NoteDigest {
  title: string;
  content: string;
  modified_at: string;
}

export interface DealEventDigest {
  event_type: string;
  old_stage: string | null;
  new_stage: string | null;
  occurred_at: string;
}

export interface MerchantContext {
  contact: ContactSnapshot;
  zoho?: {
    lead_status: string | null;
    lead_source: string | null;
    lead_owner: string | null;
    last_activity: string | null;
    notes: NoteDigest[];
  } | null;
  deal_events: DealEventDigest[];
  recent_sends: RecentSend[];
  open_tasks: Array<{ title: string; assigned_to: string | null; due_at: string | null }>;
  cadence: {
    track: string;
    current_day: number;
    sends_today: number;
    started_at: string;
    last_send_at: string | null;
    paused: boolean;
    paused_reason: string | null;
  } | null;
  days_since_created: number | null;
  days_since_updated: number | null;
  hours_since_signature: number | null;
}

export async function buildMerchantContext(input: MerchantContextInput): Promise<MerchantContext | null> {
  let contactRow: Record<string, unknown> | null = null;

  if (input.contactId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", input.contactId)
      .maybeSingle();
    contactRow = data;
  } else if (input.zohoLeadId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("zoho_lead_id", input.zohoLeadId)
      .maybeSingle();
    contactRow = data;
  }

  if (!contactRow) return null;

  const c = contactRow;
  const contact: ContactSnapshot = {
    id: c.id as string,
    email: (c.email as string | null) ?? null,
    phone: ((c.phone as string | null) || (c.mobile_phone as string | null)) ?? null,
    first_name: (c.first_name as string | null) ?? null,
    last_name: (c.last_name as string | null) ?? null,
    business_name: (c.business_name as string | null) ?? null,
    industry: (c.industry as string | null) ?? null,
    amount_needed: (c.amount_needed as number | null) ?? null,
    monthly_revenue: (c.monthly_revenue as number | null) ?? null,
    credit_score: (c.credit_score as string | null) ?? null,
    inc_date: (c.inc_date as string | null) ?? null,
    use_of_funds: (c.use_of_funds as string | null) ?? null,
    portal_app_completed: Boolean(c.portal_app_completed),
    portal_statements_uploaded: Boolean(c.portal_statements_uploaded),
    application_signed_at: (c.application_signed_at as string | null) ?? null,
    statements_uploaded_at: (c.statements_uploaded_at as string | null) ?? null,
    last_portal_login_at: (c.last_portal_login_at as string | null) ?? null,
    portal_login_count: Number(c.portal_login_count ?? 0),
    zoho_lead_id: (c.zoho_lead_id as string | null) ?? null,
    do_not_contact: Boolean(c.do_not_contact),
    created_at: (c.created_at as string | null) ?? null,
    updated_at: (c.updated_at as string | null) ?? null,
  };

  // Fetch Zoho side-by-side with events/sends/tasks to keep latency low.
  const [zohoBundle, dealEvents, recentSends, openTasks, cadenceRow] = await Promise.all([
    fetchZohoBundle(contact.zoho_lead_id),
    fetchRecentDealEvents(contact.id, 10),
    fetchRecentSends(contact.id, 10),
    fetchOpenTasks(contact.id),
    fetchCadenceState(contact.id),
  ]);

  const now = Date.now();
  const daysSinceCreated = contact.created_at
    ? Math.floor((now - new Date(contact.created_at).getTime()) / 86_400_000)
    : null;
  const daysSinceUpdated = contact.updated_at
    ? Math.floor((now - new Date(contact.updated_at).getTime()) / 86_400_000)
    : null;
  const hoursSinceSig = contact.application_signed_at
    ? Math.floor((now - new Date(contact.application_signed_at).getTime()) / 3_600_000)
    : null;

  return {
    contact,
    zoho: zohoBundle,
    deal_events: dealEvents,
    recent_sends: recentSends,
    open_tasks: openTasks,
    cadence: cadenceRow,
    days_since_created: daysSinceCreated,
    days_since_updated: daysSinceUpdated,
    hours_since_signature: hoursSinceSig,
  };
}

async function fetchZohoBundle(zohoLeadId: string | null): Promise<MerchantContext["zoho"]> {
  if (!zohoLeadId) return null;
  try {
    const [lead, notes] = await Promise.all([
      getLead(zohoLeadId).catch(() => null as ZohoApiRecord | null),
      getLeadNotes(zohoLeadId, 10),
    ]);
    if (!lead) return null;
    return {
      lead_status: (lead.Lead_Status as string | null) ?? null,
      lead_source: (lead.Lead_Source as string | null) ?? null,
      lead_owner: ((lead.Owner as { name?: string })?.name as string) ?? null,
      last_activity: (lead.Modified_Time as string | null) ?? null,
      notes: notes.map((n) => ({
        title: n.Note_Title ?? "(no title)",
        content: (n.Note_Content ?? "").slice(0, 800),
        modified_at: n.Modified_Time ?? n.Created_Time ?? "",
      })),
    };
  } catch (e) {
    console.error("[merchant-context] zoho fetch failed:", (e as Error).message);
    return null;
  }
}

async function fetchRecentDealEvents(contactId: string, limit: number): Promise<DealEventDigest[]> {
  const { data } = await supabaseAdmin
    .from("deal_events")
    .select("event_type, old_stage, new_stage, created_at, deals!inner(contact_id)")
    .eq("deals.contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as unknown as Array<{
    event_type: string;
    old_stage: string | null;
    new_stage: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    event_type: r.event_type,
    old_stage: r.old_stage,
    new_stage: r.new_stage,
    occurred_at: r.created_at,
  }));
}

async function fetchRecentSends(contactId: string, limit: number): Promise<RecentSend[]> {
  const { data } = await supabaseAdmin
    .from("marketing_sends")
    .select("campaign_key, subject, sent_at, opened_at, clicked_at, replied_at")
    .eq("contact_id", contactId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as RecentSend[];
}

async function fetchOpenTasks(contactId: string) {
  const { data } = await supabaseAdmin
    .from("contact_tasks")
    .select("title, assigned_to, due_at")
    .eq("contact_id", contactId)
    .is("completed_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{ title: string; assigned_to: string | null; due_at: string | null }>;
}

async function fetchCadenceState(contactId: string): Promise<MerchantContext["cadence"]> {
  const { data } = await supabaseAdmin
    .from("cadence_state")
    .select("track, current_day, sends_today, started_at, last_send_at, paused, paused_reason")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!data) return null;
  return {
    track: data.track as string,
    current_day: Number(data.current_day),
    sends_today: Number(data.sends_today),
    started_at: data.started_at as string,
    last_send_at: (data.last_send_at as string | null) ?? null,
    paused: Boolean(data.paused),
    paused_reason: (data.paused_reason as string | null) ?? null,
  };
}

/** Compact single-line "why this lead" summary for Slack preview cards. */
export function whyThisLead(ctx: MerchantContext): string {
  const who = ctx.contact.business_name || `${ctx.contact.first_name ?? ""} ${ctx.contact.last_name ?? ""}`.trim() || "unknown merchant";
  const bits: string[] = [];
  if (ctx.days_since_created != null) bits.push(`${ctx.days_since_created}d old lead`);
  if (ctx.cadence) bits.push(`${ctx.cadence.track} D${ctx.cadence.current_day}`);
  if (ctx.contact.portal_app_completed && !ctx.contact.portal_statements_uploaded) bits.push("signed, no statements");
  if (ctx.zoho?.lead_status) bits.push(ctx.zoho.lead_status);
  if (ctx.contact.amount_needed) bits.push(`$${ctx.contact.amount_needed.toLocaleString()}`);
  if (ctx.recent_sends.length) bits.push(`${ctx.recent_sends.length} prior sends`);
  return `${who} — ${bits.join(" · ")}`;
}
