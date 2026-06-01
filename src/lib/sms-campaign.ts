// SMS Campaign Engine — bulk outreach campaign management.
// Handles campaign creation, contact scheduling, progress tracking, and Slack updates.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { normalizePhone } from "@/lib/phone";

// LoopMessage has been removed — campaigns no longer auto-send (the sender cron
// is gone). createCampaign still builds the contact list + schedule so the
// dashboard renders, but there is no outbound transport to assign senders to.
const getSenderCount = (): number => 1;
const getNextSender = (_index: number): string | null => null;

// Wave windows in America/New_York: [startHour, endHour (exclusive)]
const SEND_WAVES: [number, number][] = [
  [8, 11],   // Wave 1: 12 slots @ 15-min spacing
  [11, 14],  // Wave 2: 12 slots
  [14, 16],  // Wave 3:  8 slots
  [16, 18],  // Wave 4:  8 slots
  [18, 20],  // Overflow: 8 slots
];

function getETComponents(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  // Parse ET date/time without adding a date library dependency
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function etMidnightUTC(year: number, month: number, day: number): Date {
  // Build the ISO string for midnight ET on the given date, then parse as UTC offset
  // We do this by finding the UTC offset via a known reference point
  const etStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
  // Use Intl to get the UTC offset for America/New_York at that date
  const probe = new Date(`${etStr}Z`); // treat as UTC first
  const et = getETComponents(probe);
  const offsetMs = probe.getTime() - new Date(`${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}T${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")}:00Z`).getTime();
  return new Date(new Date(`${etStr}Z`).getTime() + offsetMs);
}

// Build a flat list of UTC-scheduled send times distributed across ET waves.
// Each element contains the UTC timestamp and which sender (round-robin) to use.
function buildWaveSchedule(
  totalContacts: number,
  senderCount: number,
  spacingMinutes: number,
  now: Date
): Date[] {
  const schedule: Date[] = [];
  const et = getETComponents(now);

  // Build day loop starting from today; if we run out of slots today, continue to tomorrow+
  for (let dayOffset = 0; dayOffset < 30 && schedule.length < totalContacts; dayOffset++) {
    const targetDate = new Date(now.getTime() + dayOffset * 86400000);
    const tEt = getETComponents(targetDate);
    const midnight = etMidnightUTC(tEt.year, tEt.month, tEt.day);

    for (const [waveStart, waveEnd] of SEND_WAVES) {
      if (schedule.length >= totalContacts) break;
      const waveStartMs = midnight.getTime() + waveStart * 3600000;
      const waveEndMs = midnight.getTime() + waveEnd * 3600000;
      const waveDurationMs = waveEndMs - waveStartMs;
      const spacingMs = spacingMinutes * 60000;
      const slotsInWave = Math.floor(waveDurationMs / spacingMs);

      for (let slot = 0; slot < slotsInWave && schedule.length < totalContacts; slot++) {
        const slotTime = new Date(waveStartMs + slot * spacingMs);
        // Skip slots in the past (only on day 0)
        if (dayOffset === 0) {
          const currentET = getETComponents(now);
          const nowHour = currentET.hour + currentET.minute / 60;
          const slotHour = waveStart + (slot * spacingMinutes) / 60;
          if (slotHour < nowHour) continue;
        }
        schedule.push(slotTime);
      }
    }
  }

  return schedule;
}

export interface CampaignContact {
  phone: string;
  first_name?: string | null;
  business_name?: string | null;
  contact_id?: string | null;
}

export interface CreateCampaignArgs {
  name: string;
  templateName?: string;
  contacts: CampaignContact[];
  dailyLimit?: number;
  spacingMinutes?: number;
}

export async function createCampaign(args: CreateCampaignArgs): Promise<{ id: string; total: number; skipped: number }> {
  const { name, templateName, contacts, dailyLimit = 50, spacingMinutes = 12 } = args;

  // Insert campaign row
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from("sms_campaigns")
    .insert({
      name,
      template_name: templateName ?? "new-lead",
      status: "draft",
      daily_limit: dailyLimit,
      spacing_minutes: spacingMinutes,
    })
    .select()
    .single();

  if (campErr || !campaign) {
    throw new Error(`Failed to create campaign: ${campErr?.message}`);
  }

  const campaignId = campaign.id as string;

  // Normalize and dedupe contacts
  const senderCount = Math.max(getSenderCount(), 1);
  let skipped = 0;
  let inserted = 0;
  const now = new Date();

  // Pre-filter: normalize phones and collect valid unique contacts
  const validContacts: typeof contacts = [];
  for (const contact of contacts) {
    const phone = normalizePhone(contact.phone);
    if (!phone) { skipped++; continue; }

    const { data: existing } = await supabaseAdmin
      .from("sms_campaign_contacts")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("phone", phone)
      .maybeSingle();

    if (existing) { skipped++; continue; }
    validContacts.push({ ...contact, phone });
  }

  // Build wave schedule for all valid contacts
  const waveSchedule = buildWaveSchedule(validContacts.length, senderCount, spacingMinutes, now);

  // Build rows with round-robin sender assignment mapped to wave slots
  const rows = [];
  let slotIndex = 0;

  for (const contact of validContacts) {
    const phone = contact.phone; // already normalized above
    const assignedSender = getNextSender(slotIndex % senderCount);
    const scheduledAt = waveSchedule[slotIndex] ?? new Date(now.getTime() + slotIndex * spacingMinutes * 60000);

    rows.push({
      campaign_id: campaignId,
      phone,
      first_name: contact.first_name ?? null,
      business_name: contact.business_name ?? null,
      contact_id: contact.contact_id ?? null,
      assigned_sender: assignedSender,
      status: "pending",
      scheduled_at: scheduledAt.toISOString(),
    });

    slotIndex++;
    inserted++;
  }

  if (rows.length > 0) {
    const { error: insertErr } = await supabaseAdmin.from("sms_campaign_contacts").insert(rows);
    if (insertErr) throw new Error(`Failed to insert campaign contacts: ${insertErr.message}`);
  }

  // Update total_contacts count
  await supabaseAdmin
    .from("sms_campaigns")
    .update({ total_contacts: inserted })
    .eq("id", campaignId);

  return { id: campaignId, total: inserted, skipped };
}

export async function startCampaign(campaignId: string): Promise<void> {
  await supabaseAdmin
    .from("sms_campaigns")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", campaignId);

  const { data: campaign } = await supabaseAdmin
    .from("sms_campaigns")
    .select("name, total_contacts, spacing_minutes, daily_limit")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return;

  const outreachChannelId = process.env.SLACK_SMS_OUTREACH_CHANNEL;
  if (!outreachChannelId) return;

  const totalContacts = campaign.total_contacts as number;
  const daily = campaign.daily_limit as number;
  const spacingMin = campaign.spacing_minutes as number;
  const estDays = daily > 0 ? Math.ceil(totalContacts / daily) : "?";

  const res = await slack.postMessage(
    outreachChannelId,
    [
      `*Campaign launched: ${campaign.name as string}*`,
      `${totalContacts.toLocaleString()} contacts · ${daily}/day limit · ${spacingMin}min spacing`,
      `Est. completion: ${estDays} day${estDays !== 1 ? "s" : ""}`,
    ].join("\n")
  );

  if (res.ok && res.ts) {
    await supabaseAdmin
      .from("sms_campaigns")
      .update({ slack_campaign_ts: res.ts as string })
      .eq("id", campaignId);
  }
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await supabaseAdmin
    .from("sms_campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId);
}

export async function resumeCampaign(campaignId: string): Promise<void> {
  // Reschedule pending contacts from now (preserve their relative spacing)
  const { data: pending } = await supabaseAdmin
    .from("sms_campaign_contacts")
    .select("id, scheduled_at")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .order("scheduled_at", { ascending: true });

  if (pending && pending.length > 0) {
    const { data: campaign } = await supabaseAdmin
      .from("sms_campaigns")
      .select("spacing_minutes")
      .eq("id", campaignId)
      .maybeSingle();
    const spacingMin = (campaign?.spacing_minutes as number) ?? 12;
    const now = new Date();

    for (let i = 0; i < pending.length; i++) {
      const newScheduled = new Date(now.getTime() + i * spacingMin * 60 * 1000);
      await supabaseAdmin
        .from("sms_campaign_contacts")
        .update({ scheduled_at: newScheduled.toISOString() })
        .eq("id", pending[i].id);
    }
  }

  await supabaseAdmin
    .from("sms_campaigns")
    .update({ status: "running" })
    .eq("id", campaignId);
}

export async function postCampaignSlackUpdate(campaignId: string): Promise<void> {
  const outreachChannelId = process.env.SLACK_SMS_OUTREACH_CHANNEL;
  if (!outreachChannelId) return;

  const { data: campaign } = await supabaseAdmin
    .from("sms_campaigns")
    .select("name, total_contacts, sent_count, reply_count, status, slack_campaign_ts")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) return;

  const total = campaign.total_contacts as number;
  const sent = campaign.sent_count as number;
  const replies = campaign.reply_count as number;
  const status = campaign.status as string;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
  const bar = buildProgressBar(pct);

  const text = status === "completed"
    ? `*${campaign.name as string}* — complete! ${sent.toLocaleString()} sent · ${replies} replies`
    : `*${campaign.name as string}* — ${bar} ${pct}% (${sent.toLocaleString()}/${total.toLocaleString()} sent · ${replies} replies)`;

  const threadTs = campaign.slack_campaign_ts as string | null;
  if (threadTs) {
    await slack.postThreadReply(outreachChannelId, threadTs, text);
  } else {
    await slack.postMessage(outreachChannelId, text);
  }
}

function buildProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export async function markCampaignComplete(campaignId: string): Promise<void> {
  await supabaseAdmin
    .from("sms_campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", campaignId);

  await postCampaignSlackUpdate(campaignId);
}
