// The self-setup answers. PUBLIC, and gated by the row rather than by a secret.
//
// ‼️ IT DOES NOT VERIFY THE TOKEN, AND THAT IS A DELIBERATE, BOUNDED DECISION. The page did
// the verifying; this route takes a leadId. What a caller gets by guessing one is the ability
// to write an address into a Slack thread for a lead they cannot read back, once, because the
// row refuses a second write. That is graffiti, not disclosure: nothing is returned, no
// contact is created, no email is sent, and the ids are uuids.
//
// If that trade ever stops being acceptable, the fix is to pass ?t= through from the page and
// call verifyOnboardingToken(t, "chatgpt_ads") here as well. Do not instead start returning
// the row to prove the caller is genuine: that turns a write-only surface into a lookup.
//
// ‼️ THE REPLAY GUARD IS THE EXISTING ROW, NOT A FLAG. One system_logs row per lead, created
// only if none exists. A refresh, a double tap, or a resubmitted form lands on the same guard
// and costs nothing.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { clean } from "@/lib/medspa/validate";
import { CHATGPT_ADS_SETUP_EVENT, SETUP_FIELDS } from "@/lib/chatgpt-ads/setup";
import type { ChatgptAdsLeadRow } from "@/lib/chatgpt-ads/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const leadId = clean(body.leadId, 64);
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { data } = await supabaseAdmin
    .from("chatgpt_ads_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  const row = data as ChatgptAdsLeadRow | null;
  // Same answer for a bad id and a missing row, for the same reason the page gives one
  // message for tampered and missing tokens.
  if (!row) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  // Only the keys the config declares. A field the form did not ask for cannot be written by
  // renaming an input in devtools.
  const raw = (body.values ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const f of SETUP_FIELDS) {
    const v = clean(raw[f.key], 200);
    if (v) values[f.key] = v;
    else if (f.required) {
      return NextResponse.json({ ok: false, error: "Some answers are missing." }, { status: 400 });
    }
  }

  const { data: existing } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", CHATGPT_ADS_SETUP_EVENT)
    .eq("metadata->>lead_id", leadId)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, replay: true });

  const { error } = await supabaseAdmin.from("system_logs").insert({
    event_type: CHATGPT_ADS_SETUP_EVENT,
    description: `Self setup completed: ${row.business_name || row.email}`,
    metadata: { lead_id: leadId, email: row.email, contact_id: row.contact_id, values },
  });
  if (error) {
    console.error("[chatgpt-ads] setup insert", error.message);
    return NextResponse.json({ ok: false, error: "That did not save. Try once more." }, { status: 500 });
  }

  // Into the thread the self-intake card is already in, so the setup sits under the lead it
  // belongs to rather than as a loose message nobody can place.
  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
  const thread = await threadFor(row.contact_id);
  const lines = SETUP_FIELDS.filter((f) => values[f.key]).map(
    (f) => `*${f.label}:* ${values[f.key]}`
  );
  const text = `\u{2705} ${row.business_name || row.email} finished their own setup.\n${lines.join("\n")}`;
  if (thread) await slack.postThreadReply(thread.channel, thread.ts, text);
  else if (channel) await slack.postMessage(channel, text);

  return NextResponse.json({ ok: true });
}

async function threadFor(contactId: string | null): Promise<{ channel: string; ts: string } | null> {
  if (!contactId) return null;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("slack_channel, slack_thread_ts")
    .eq("id", contactId)
    .maybeSingle();
  const row = data as { slack_channel?: string | null; slack_thread_ts?: string | null } | null;
  if (!row?.slack_thread_ts) return null;
  return { channel: row.slack_channel || process.env.SLACK_HOT_LEADS_CHANNEL || "", ts: row.slack_thread_ts };
}
