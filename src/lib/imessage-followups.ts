// iMessage follow-up scheduler.
//
// scheduleFollowup(...) records a reminder for a future date in sms_followups,
// ensures the lead's SMS conversation + Slack channel exist (so the reminder can
// post in their own chat), and logs a Zoho task. runDueFollowups() — driven by
// the sms-followups cron — fires every reminder whose due_at has passed: it posts
// a reminder header into the lead's Slack channel, drafts a check-in via the
// adaptive SMS engine, posts the suggestion card (which arms the 2-min auto-send),
// then closes the Zoho task and drops a CRM note.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { postImessageSuggestion } from "@/lib/imessage-suggestion";
import { createZohoTask, closeZohoTask, addNoteResilient } from "@/lib/zoho";

export interface ScheduleFollowupArgs {
  contactId: string;
  reason: string;
  dueDate: string;            // ISO, YYYY-MM-DD, or relative ('tomorrow', 'in 3 days')
  createZohoTask?: boolean;   // default true
}

export interface ScheduleFollowupResult {
  ok: boolean;
  followupId?: string;
  error?: string;
}

// Parse an ISO date, a YYYY-MM-DD date, or a small set of relative phrases.
// Returns a Date or null. Relative phrases default to 9am ET-ish (local server).
export function parseDueDate(input: string): Date | null {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return null;

  // Relative: "tomorrow", "today", "in N day(s)/week(s)", "next week"
  const now = new Date();
  if (raw === "today") return now;
  if (raw === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0); // ~9am ET
    return d;
  }
  if (raw === "next week") {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(14, 0, 0, 0);
    return d;
  }
  const rel = raw.match(/^in\s+(\d+)\s+(day|days|week|weeks|hour|hours)$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const d = new Date(now);
    if (unit.startsWith("hour")) d.setHours(d.getHours() + n);
    else if (unit.startsWith("week")) { d.setDate(d.getDate() + n * 7); d.setHours(14, 0, 0, 0); }
    else { d.setDate(d.getDate() + n); d.setHours(14, 0, 0, 0); }
    return d;
  }

  // Absolute ISO / YYYY-MM-DD
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) {
    // Bare date (no time component) → default to ~9am ET so it doesn't fire at midnight.
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) parsed.setHours(14, 0, 0, 0);
    return parsed;
  }
  return null;
}

export async function scheduleFollowup(args: ScheduleFollowupArgs): Promise<ScheduleFollowupResult> {
  const createTask = args.createZohoTask !== false;

  const due = parseDueDate(args.dueDate);
  if (!due) {
    return { ok: false, error: `Could not parse due date: "${args.dueDate}"` };
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, phone, mobile_phone, zoho_lead_id")
    .eq("id", args.contactId)
    .maybeSingle();

  if (!contact) {
    return { ok: false, error: "Contact not found." };
  }

  const digits = (contact.phone || contact.mobile_phone || "").replace(/\D/g, "");
  if (!digits) {
    return { ok: false, error: "Contact has no phone number on file." };
  }
  const phone = `+1${digits.slice(-10)}`;

  // Ensure an SMS conversation + Slack channel so the reminder posts in the
  // lead's own chat.
  const { data: convo } = await supabaseAdmin
    .from("sms_conversations")
    .upsert({ phone, contact_id: contact.id }, { onConflict: "phone", ignoreDuplicates: false })
    .select("id, slack_channel_id")
    .maybeSingle();

  if (!convo) {
    return { ok: false, error: "Could not create or load the SMS conversation." };
  }

  const displayName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    contact.business_name ||
    phone;

  const ensured = await ensureSmsChannel({
    conversationId: convo.id,
    phone,
    displayName,
    contactId: contact.id,
    zohoLeadId: contact.zoho_lead_id ?? null,
    businessName: contact.business_name ?? null,
  });
  const channelId = ensured.channelId ?? (convo.slack_channel_id as string | null);

  // Log the Zoho task (best-effort).
  let zohoTaskId: string | null = null;
  if (createTask && contact.zoho_lead_id) {
    zohoTaskId = await createZohoTask({
      leadId: contact.zoho_lead_id,
      subject: `Follow up: ${displayName}`,
      dueDate: due.toISOString().slice(0, 10),
      description: args.reason,
      priority: "High",
    });
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("sms_followups")
    .insert({
      conversation_id: convo.id,
      contact_id: contact.id,
      slack_channel_id: channelId,
      due_at: due.toISOString(),
      reason: args.reason,
      zoho_task_id: zohoTaskId,
      status: "scheduled",
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? "Could not save the follow-up." };
  }

  if (channelId) {
    const when = due.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    await slack.postMessage(channelId, `🗓 Follow-up scheduled for ${when}: ${args.reason}`);
  }

  return { ok: true, followupId: inserted.id as string };
}

// Auto-schedule on send. Called from the shared outbound path (manual ✅ Send AND
// the 2-min auto-send sweep) right after a successful dispatchOutbound. If the
// conversation's pending draft carried a suggested follow-up (and the user did NOT
// already schedule it via 📅 Follow-up, which clears these fields), create it now so
// it lands in sms_followups + the CRM. Best-effort — never throws, never blocks the
// send. Returns true when a follow-up was scheduled.
export async function autoScheduleFollowupOnSend(conversationId: string): Promise<boolean> {
  try {
    const { data: draftRow } = await supabaseAdmin
      .from("sms_pending_drafts")
      .select("suggested_followup_days, suggested_followup_reason")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    const days = (draftRow?.suggested_followup_days as number | null) ?? null;
    const reason = (draftRow?.suggested_followup_reason as string | null) ?? null;
    if (!days || !reason) return false;

    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("contact_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv?.contact_id) return false;

    const res = await scheduleFollowup({
      contactId: conv.contact_id as string,
      reason,
      dueDate: `in ${days} days`,
      createZohoTask: true,
    });
    return res.ok;
  } catch (e) {
    console.error("[imessage-followups] auto-schedule on send failed:", (e as Error).message);
    return false;
  }
}

interface DueFollowupRow {
  id: string;
  conversation_id: string | null;
  contact_id: string;
  slack_channel_id: string | null;
  reason: string;
  zoho_task_id: string | null;
}

export async function runDueFollowups(): Promise<{ posted: number }> {
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabaseAdmin
    .from("sms_followups")
    .select("id, conversation_id, contact_id, slack_channel_id, reason, zoho_task_id")
    .eq("status", "scheduled")
    .lte("due_at", nowIso)
    .limit(50);

  if (error) {
    console.error("[imessage-followups] due query failed:", error.message);
    return { posted: 0 };
  }

  let posted = 0;
  for (const row of (due ?? []) as DueFollowupRow[]) {
    try {
      const channelId = row.slack_channel_id;
      if (channelId) {
        await slack.postMessage(channelId, `🔔 Follow-up due: ${row.reason}`);
      }

      // Draft a check-in via the adaptive prompt (handles stale/stage-less threads).
      if (row.conversation_id && channelId) {
        const { draft, suggestedFollowup } = await draftSmsReply(row.conversation_id, `<follow-up: ${row.reason}>`);
        if (draft) {
          await postImessageSuggestion({ channelId, conversationId: row.conversation_id, draft, suggestedFollowup });
        }
      }

      await supabaseAdmin
        .from("sms_followups")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", row.id);
      posted++;

      // Close the Zoho task + drop a CRM note (best-effort).
      if (row.zoho_task_id) {
        await closeZohoTask(row.zoho_task_id);
      }
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("zoho_lead_id, business_name")
        .eq("id", row.contact_id)
        .maybeSingle();
      if (contact?.zoho_lead_id || contact?.business_name) {
        await addNoteResilient({
          zohoLeadId: (contact?.zoho_lead_id as string | null) ?? null,
          businessName: (contact?.business_name as string | null) ?? null,
          title: "Follow-up executed",
          content: `Follow-up executed: ${row.reason}`,
        });
      }
    } catch (e) {
      console.error("[imessage-followups] row failed:", (e as Error).message);
    }
  }

  return { posted };
}
