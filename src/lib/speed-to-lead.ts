// Speed to Lead — instant callback when a new lead arrives
// Calls agent's phone via RingCentral RingOut, agent presses 1, gets connected to lead.

import { supabaseAdmin } from "@/lib/db";
import { initiateRingOut, getRingOutStatus, formatPhone } from "@/lib/ringcentral";
import { slack } from "@/lib/slack-bot";

// ── Types ──

interface SpeedToLeadParams {
  leadId?: string;
  leadPhone: string;
  leadName: string;
  leadSource: string;
}

// ── Safety gates ──

function isEnabled(): boolean {
  return process.env.SPEED_TO_LEAD_ENABLED === "true";
}

function isBusinessHours(): boolean {
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etString);

  const hour = et.getHours();

  const startHour = parseInt(process.env.SPEED_TO_LEAD_START_HOUR || "9", 10);
  const endHour = parseInt(process.env.SPEED_TO_LEAD_END_HOUR || "20", 10);

  return hour >= startHour && hour < endHour;
}

async function isDuplicate(phone: string): Promise<boolean> {
  const cooldownMin = parseInt(process.env.SPEED_TO_LEAD_COOLDOWN_MIN || "30", 10);
  const cutoff = new Date(Date.now() - cooldownMin * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from("call_log")
    .select("id")
    .eq("lead_phone", phone)
    .gte("created_at", cutoff)
    .limit(1);

  return (data && data.length > 0) || false;
}

async function isOnDncList(phone: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("dnc_list")
    .select("id")
    .eq("phone", phone)
    .limit(1);

  return (data && data.length > 0) || false;
}

// ── Status mapping ──

function mapStatus(callStatus: string, callerStatus: string, calleeStatus: string): string {
  if (callStatus === "Success") return "connected";
  if (callerStatus === "CannotReach" || callerStatus === "NoAnswer") return "agent_missed";
  if (calleeStatus === "CannotReach" || calleeStatus === "NoAnswer") return "lead_no_answer";
  if (callStatus === "Error") return "failed";
  return "in_progress";
}

// ── Slack notifications ──

async function notifySlack(status: string, leadName: string, leadPhone: string, leadSource: string): Promise<void> {
  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (!channel) return;

  let message: string;

  switch (status) {
    case "agent_ringing":
      message = [
        `:bell: *Speed to Lead — Calling Now!*`,
        `*Lead:* ${leadName}`,
        `*Phone:* ${leadPhone}`,
        `*Source:* ${leadSource}`,
        `Ringing agent — pick up and press 1 to connect.`,
      ].join("\n");
      break;

    case "connected":
      message = [
        `:telephone_receiver: *Speed to Lead — Connected!*`,
        `*Lead:* ${leadName}`,
        `*Phone:* ${leadPhone}`,
        `*Source:* ${leadSource}`,
        `Call connected successfully.`,
      ].join("\n");
      break;

    case "agent_missed":
      message = [
        `:rotating_light: *Speed to Lead — Missed Call!*`,
        `*Lead:* ${leadName}`,
        `*Phone:* ${leadPhone}`,
        `*Source:* ${leadSource}`,
        `Agent did not pick up. Call back ASAP!`,
      ].join("\n");
      break;

    case "lead_no_answer":
      message = [
        `:phone: *Speed to Lead — Lead Didn't Answer*`,
        `*Lead:* ${leadName}`,
        `*Phone:* ${leadPhone}`,
        `*Source:* ${leadSource}`,
        `Agent connected but lead didn't answer. Try again shortly.`,
      ].join("\n");
      break;

    case "failed":
      message = [
        `:x: *Speed to Lead — Call Failed*`,
        `*Lead:* ${leadName}`,
        `*Phone:* ${leadPhone}`,
        `*Source:* ${leadSource}`,
        `RingOut API error. Check logs.`,
      ].join("\n");
      break;

    default:
      return;
  }

  slack.postMessage(channel, message).catch((err: unknown) =>
    console.error("[Speed to Lead] Slack notification failed:", err instanceof Error ? err.message : err)
  );
}

// ── Main trigger function ──

export async function triggerSpeedToLead(params: SpeedToLeadParams): Promise<void> {
  const { leadId, leadPhone, leadName, leadSource } = params;

  try {
    // Gate 1: Kill switch
    if (!isEnabled()) {
      console.log("[Speed to Lead] Disabled via SPEED_TO_LEAD_ENABLED");
      return;
    }

    // Gate 2: Phone validation
    const formattedPhone = formatPhone(leadPhone);
    if (!formattedPhone) {
      console.log("[Speed to Lead] Invalid phone:", leadPhone);
      return;
    }

    // Gate 3: Business hours
    if (!isBusinessHours()) {
      console.log("[Speed to Lead] Outside business hours — skipping");
      return;
    }

    // Gate 4: Duplicate prevention
    if (await isDuplicate(formattedPhone)) {
      console.log("[Speed to Lead] Duplicate — same phone called recently:", formattedPhone);
      return;
    }

    // Gate 5: DNC list
    if (await isOnDncList(formattedPhone)) {
      console.log("[Speed to Lead] Phone on DNC list:", formattedPhone);
      return;
    }

    // All gates passed — initiate call
    const agentPhone = process.env.RC_AGENT_NUMBER || "";
    const agentExtension = process.env.RC_AGENT_EXTENSION || "";
    if (!agentPhone && !agentExtension) {
      console.error("[Speed to Lead] RC_AGENT_NUMBER and RC_AGENT_EXTENSION not set");
      return;
    }

    // Insert call_log row
    const isUuid = leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("call_log")
      .insert({
        lead_id: isUuid ? leadId : null,
        lead_phone: formattedPhone,
        agent_phone: agentPhone,
        call_type: "speed_to_lead",
        status: "initiated",
        lead_name: leadName,
        lead_source: leadSource,
      })
      .select("id")
      .single();

    if (logErr || !logRow) {
      console.error("[Speed to Lead] call_log insert failed:", logErr?.message);
      return;
    }

    const callLogId = logRow.id;

    // Initiate RingOut (use extension to bypass IVR if available)
    const ringout = await initiateRingOut(agentPhone, formattedPhone, agentExtension || undefined);

    if (!ringout.success || !ringout.data) {
      await supabaseAdmin.from("call_log").update({
        status: "failed",
        error_message: ringout.error || "RingOut initiation failed",
        updated_at: new Date().toISOString(),
      }).eq("id", callLogId);

      await notifySlack("failed", leadName, formattedPhone, leadSource);
      return;
    }

    const ringoutId = ringout.data.id;

    // Update with ringout ID
    await supabaseAdmin.from("call_log").update({
      ringout_id: ringoutId,
      status: "agent_ringing",
      updated_at: new Date().toISOString(),
    }).eq("id", callLogId);

    // Send Slack notification immediately (before polling loop which may timeout)
    await notifySlack("agent_ringing", leadName, formattedPhone, leadSource);

    // Poll for status (every 3s, up to 60s = 20 iterations)
    let finalStatus = "agent_ringing";

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const statusResult = await getRingOutStatus(ringoutId);
      if (!statusResult.success || !statusResult.data) {
        finalStatus = "failed";
        break;
      }

      const { callStatus, callerStatus, calleeStatus } = statusResult.data.status;
      const mapped = mapStatus(callStatus, callerStatus, calleeStatus);

      if (mapped !== "in_progress") {
        finalStatus = mapped;
        break;
      }
    }

    // Update final status
    await supabaseAdmin.from("call_log").update({
      status: finalStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", callLogId);

    // Send final status to Slack (if different from initial ringing)
    if (finalStatus !== "agent_ringing") {
      await notifySlack(finalStatus, leadName, formattedPhone, leadSource);
    }

    console.log(`[Speed to Lead] Call completed — status: ${finalStatus}, lead: ${leadName}`);
  } catch (err) {
    console.error("[Speed to Lead] Unexpected error:", err instanceof Error ? err.message : err);
  }
}

// ── Fire-and-forget helper (for use in existing lead routes) ──

export function fireSpeedToLead(params: SpeedToLeadParams): void {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  fetch(`${baseUrl}/api/speed-to-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch((err) =>
    console.error("[Speed to Lead] Fire failed:", err instanceof Error ? err.message : err)
  );
}
