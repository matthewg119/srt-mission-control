// /chatgpt-ads, every write. PUBLIC and unauthenticated.
//
// A PUBLIC ROUTE THAT POSTS TO SLACK needs its guards in the right order, cheapest first,
// exactly as api/onboardingfree/submit, api/clients/start and api/scan/start all document:
// honeypot, then time trap, then per-IP ledger, then the real work. Do not reorder them and
// do not add a path that skips them. The honeypot answers 200: a bot that gets an error
// learns where the gap is, one that gets a cheerful success learns nothing.
//
// ONE ROUTE, SIX STAGES, because they all write the same row keyed on the same email and
// splitting them would mean six copies of the validation and the guards. The stage decides
// which Slack card fires and which timestamp is stamped, nothing else.
//
//   lead        after the 3-field intake. The lead exists from this moment; everything
//               after it is enrichment. Same doctrine as the email step in srt-agwb/funnel.js.
//   answers     after the question screens, before the path screen.
//   wedge       under $10k, took the free review setup.
//   call_me_now / booked_call / self_intake   the three paths.
//
// ‼️ THE LEAD IS CREATED AT STAGE `lead`, WHICH IS BEFORE THE REVENUE ANSWER. That is
// deliberate and it has the same cost /audit's prefill path has: somebody who turns out to be
// under $10k is already a contact by then. The alternative is losing every visitor who closes
// the tab on question three, which is worse. The wedge card is what tells anyone reading
// Slack that this one is not a build.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { ingestLead } from "@/lib/lead-intake";
import { clean, normalizePhone, validEmail } from "@/lib/medspa/validate";
import { normalizeTarget } from "@/lib/scan/normalize";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { isValidAnswer, branchFor, type SignupPath } from "@/config/chatgpt-ads";
import { readReportParamsFromObject } from "@/lib/chatgpt-ads/params";
import { upsertLead, type ChatgptAdsLeadRow } from "@/lib/chatgpt-ads/lead";
import {
  callMeNowCard,
  bookedCard,
  selfIntakeCard,
  wedgeCard,
} from "@/lib/chatgpt-ads/card";
import { signOnboardingToken, hashToken, isClientLinkSecretConfigured } from "@/lib/clients/token";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// force-dynamic governs the ROUTE cache and does not cover supabase-js, which calls the
// global fetch that Next patches. Without this the per-IP ledger count can be read from a
// snapshot seconds old, which is the whole gate.
export const fetchCache = "force-no-store";

const RATE_LIMIT = Number(process.env.CHATGPT_ADS_RATE_LIMIT || 8);
const RATE_WINDOW_HOURS = 24;
const MIN_FILL_SECONDS = 2;

type Stage = "lead" | "answers" | "wedge" | SignupPath;

const TERMINAL: Stage[] = ["wedge", "call_me_now", "booked_call", "self_intake"];

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

function ok(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...extra });
}

/**
 * How many leads this IP has already created in the window.
 *
 * Rows, not requests. The row is upserted on email, so one person filling the funnel in
 * properly is one row however many stages they post, and this only bites somebody creating
 * genuinely distinct leads. A clinic and their office manager on the same office wifi are two
 * rows, which is why the limit is 8 and not 2.
 */
async function countRecentForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("chatgpt_ads_leads")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", cutoff);
  return count ?? 0;
}

/** #hot-leads, or nothing. There is no literal channel name anywhere in this repo. */
function hotLeads(): string {
  return process.env.SLACK_HOT_LEADS_CHANNEL || "";
}

/**
 * The thread ingestLead opened for this contact, if it opened one.
 *
 * ingestLead only hands back a threadTs on the call that CREATED the top-level message, so a
 * second touch has to read it off the contact. contacts.slack_channel takes precedence over
 * the env var for a lead that has been given its own channel, which lead-thread.ts already
 * does and which this has to match or the reply lands somewhere nobody is reading.
 */
async function threadFor(contactId: string | null): Promise<{ channel: string; ts: string } | null> {
  if (!contactId) return null;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("slack_channel, slack_thread_ts")
    .eq("id", contactId)
    .maybeSingle();
  const row = data as { slack_channel?: string | null; slack_thread_ts?: string | null } | null;
  if (!row?.slack_thread_ts) return null;
  return { channel: row.slack_channel || hotLeads(), ts: row.slack_thread_ts };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // ── Guard 1: honeypot. Cheerful 200, nothing written. ──
  if (clean(body.company_url_hp, 100)) return ok();

  // ── Guard 2: time trap. A human cannot read the intake and answer in under two seconds. ──
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return ok();
  }

  const stage = String(body.stage || "") as Stage;
  const validStage =
    stage === "lead" || stage === "answers" || TERMINAL.includes(stage);
  if (!validStage) {
    return NextResponse.json({ ok: false, error: "Unknown stage." }, { status: 400 });
  }

  // ── Identity ──
  const identity = (body.identity ?? {}) as Record<string, unknown>;
  const email = clean(identity.email, 254).toLowerCase();
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: "That email does not look right." }, { status: 400 });
  }
  const phone = normalizePhone(clean(identity.phone, 40));
  const websiteRaw = clean(identity.website, 200);

  // The website is re-normalized here rather than trusted, and it reuses the scanner's parser
  // instead of a second URL reader. normalizeTarget carries the SSRF host rules, and this
  // value is later handed to an audit.
  let website: string | null = null;
  if (websiteRaw) {
    const n = normalizeTarget(websiteRaw);
    if (n.ok) website = n.target.website;
  }

  const ipHash = hashIp(clientIpFrom(req));

  // ── Guard 3: per-IP ledger, only for the stage that can create a row. ──
  if (stage === "lead" && (await countRecentForIp(ipHash)) >= RATE_LIMIT) {
    return ok({ limited: true });
  }

  // ── Answers, re-checked against the config rather than trusted ──
  const a = (body.answers ?? {}) as Record<string, unknown>;
  const answer = (key: string): string | null => {
    const v = clean(a[key], 60);
    if (!v) return null;
    return isValidAnswer(key, v) ? v : null;
  };
  const channels = Array.isArray(a.channels)
    ? (a.channels as unknown[])
        .map((c) => clean(c, 40))
        .filter((c) => isValidAnswer("channels", c))
        .slice(0, 8)
    : null;

  const revenue = answer("revenue");
  const report = readReportParamsFromObject((body.report ?? {}) as Record<string, unknown>);
  const utm = (body.utm ?? {}) as Record<string, unknown>;

  const patch: Partial<ChatgptAdsLeadRow> & { email: string } = {
    email,
    phone: phone ?? undefined,
    website: website ?? undefined,
    business_name: report.business ?? undefined,
    city: report.city ?? undefined,
    revenue: revenue ?? undefined,
    branch: revenue ? branchFor(revenue) : undefined,
    channels: channels && channels.length ? channels : undefined,
    patient_volume: answer("patient_volume") ?? undefined,
    one_service: answer("one_service") ?? undefined,
    gbp_access: answer("gbp_access") ?? undefined,
    website_access: answer("website_access") ?? undefined,
    // Free text, not an option id. It is only ever shown back, never branched on.
    website_host: clean(a.website_host, 40) || undefined,
    ai_visibility_score: report.score ?? undefined,
    competitor_name: report.competitor ?? undefined,
    user_showed_count: report.userShowed ?? undefined,
    comp_showed_count: report.compShowed ?? undefined,
    report_slug: report.reportSlug ?? undefined,
    ip_hash: ipHash,
    source_url: clean(body.sourceUrl, 500) || undefined,
    utm_source: clean(utm.source, 80) || undefined,
    utm_medium: clean(utm.medium, 80) || undefined,
    utm_campaign: clean(utm.campaign, 120) || undefined,
    utm_content: clean(utm.content, 120) || undefined,
    fbc: clean(body.fbc, 255) || undefined,
    fbp: clean(body.fbp, 255) || undefined,
    fbclid: clean(body.fbclid, 255) || undefined,
  };

  if (TERMINAL.includes(stage)) {
    // `wedge` is not a signup_path: the column's check constraint holds exactly the four
    // values the spec named, and a lead who booked the free review setup has still not
    // chosen one of them. It is recorded by the branch column and by its own Slack card.
    if (stage !== "wedge") patch.signup_path = stage as SignupPath;
    if (stage === "call_me_now") patch.call_requested_at = new Date().toISOString();
    if (stage === "booked_call") {
      const booked = (body.booked ?? {}) as Record<string, unknown>;
      const when = clean(booked.startTime, 40);
      patch.booked_slot_at = when && !Number.isNaN(Date.parse(when)) ? when : undefined;
      patch.calendly_event_uri = clean(booked.eventUri, 300) || undefined;
    }
  }

  let row = await upsertLead(patch);
  if (!row) {
    return NextResponse.json({ ok: false, error: "That did not save. Try once more." }, { status: 500 });
  }

  // ── The contact, once ──
  //
  // Only on the call that has no contact yet. ingestLead posts the top-level #hot-leads card
  // and a thread reply every time it runs, so calling it on all six stages would produce six
  // cards for one person. Everything after the first is a patch on this row and a threaded
  // reply, which is what enrichLead exists for and what the cards below do directly.
  if (!row.contact_id) {
    const result = await ingestLead({
      email,
      phone: phone ?? undefined,
      website: website ?? undefined,
      businessName: report.business ?? undefined,
      city: report.city ?? undefined,
      source: "chatgpt-ads",
      // No RingOut on this funnel. The whole point of Call Me Now is that a human dials, and
      // an automated callback firing alongside it means the lead's phone rings twice from two
      // different numbers before anybody has said anything.
      speedToLead: false,
      noteTitle: "ChatGPT Ads funnel",
      headline: `New /chatgpt-ads lead: ${report.business || email}`,
      detailLines: [
        `Score: ${report.score ?? "not given"}`,
        `City: ${report.city ?? "not given"}`,
        `Website: ${website ?? "not given"}`,
      ],
      utmSource: clean(utm.source, 80) || undefined,
      utmMedium: clean(utm.medium, 80) || undefined,
      utmCampaign: clean(utm.campaign, 120) || undefined,
      utmContent: clean(utm.content, 120) || undefined,
    });
    if (result.contactId) {
      row = (await upsertLead({ email, contact_id: result.contactId })) ?? row;
    }
  }

  if (!TERMINAL.includes(stage)) return ok({ leadId: row.id });

  // ── The path cards ──
  const channel = hotLeads();
  const thread = await threadFor(row.contact_id);

  if (stage === "call_me_now") {
    const card = callMeNowCard(row);
    // TOP LEVEL, and it is the one card here that is. A threaded reply does not interrupt
    // anybody, and interrupting is the entire function of this message: somebody is watching
    // a 60 second countdown. Its ts is stored so the fallback reply can thread under it.
    const res = channel ? await slack.postMessage(channel, card.text, card.blocks) : null;
    const ts = typeof res?.ts === "string" ? res.ts : null;
    if (ts) await upsertLead({ email, slack_thread_ts: ts });
    return ok({ leadId: row.id, callerId: process.env.MATTHEW_CALLER_ID_NUMBER || null });
  }

  if (stage === "wedge") {
    const card = wedgeCard(row);
    if (thread) await slack.postThreadReply(thread.channel, thread.ts, card.text, card.blocks);
    else if (channel) await slack.postMessage(channel, card.text, card.blocks);
    return ok({ leadId: row.id });
  }

  if (stage === "booked_call") {
    const booked = (body.booked ?? {}) as Record<string, unknown>;
    const emailed = await sendBookedEmail(row, clean(booked.startTimeLabel, 120));
    const card = bookedCard(row, {
      when: clean(booked.startTimeLabel, 120) || null,
      joinUrl: clean(booked.joinUrl, 500) || null,
      rescheduleUrl: clean(booked.rescheduleUrl, 500) || null,
      emailed,
    });
    if (thread) await slack.postThreadReply(thread.channel, thread.ts, card.text, card.blocks);
    else if (channel) await slack.postMessage(channel, card.text, card.blocks);
    return ok({ leadId: row.id });
  }

  // ── self_intake ──
  let handoffUrl: string | null = null;
  if (isClientLinkSecretConfigured()) {
    const signed = signOnboardingToken(row.id, undefined, "chatgpt_ads");
    handoffUrl = `${appUrl()}/chatgpt-ads/setup?t=${encodeURIComponent(signed.token)}`;
    // The HASH, never the token. Clearing this column revokes one link without rotating the
    // secret for everybody, which is exactly what clients.onboarding_token_hash is for.
    await upsertLead({ email, intake_token_hash: hashToken(signed.token) });
  }
  const emailed = await sendHandoffEmail(row, handoffUrl);
  const card = selfIntakeCard(row, { handoffUrl, emailed });
  if (thread) await slack.postThreadReply(thread.channel, thread.ts, card.text, card.blocks);
  else if (channel) await slack.postMessage(channel, card.text, card.blocks);
  return ok({ leadId: row.id, handoffUrl });
}

// ---------------------------------------------------------------------------
// Email
//
// Through microsoft.sendMail, which sends as the connected mailbox, matthew@srtagency.com.
// There is no Resend and no third-party email service in this stack.
//
// Both of these return a boolean rather than throwing, and the Slack card prints which way
// it went. A confirmation that silently failed to send is worse than one that never existed,
// because everybody downstream assumes the person has it.
// ---------------------------------------------------------------------------

async function sendBookedEmail(row: ChatgptAdsLeadRow, whenLabel: string): Promise<boolean> {
  try {
    await microsoft.sendMail({
      to: row.email,
      subject: "You are booked with SRT",
      body:
        `Thanks for booking.\n\n` +
        (whenLabel ? `We are on for ${whenLabel}.\n\n` : "") +
        `Calendly has sent the invite with the join link, and the reschedule link is in it if anything changes.\n\n` +
        `Before we speak, it helps to have your Google Business Profile login to hand. That is usually the first thing we fix.\n\n` +
        `Matthew\nSRT Agency\n(336) 833-2303`,
      isHtml: false,
    });
    return true;
  } catch (err) {
    console.error("[chatgpt-ads] booked email", err instanceof Error ? err.message : err);
    return false;
  }
}

async function sendHandoffEmail(row: ChatgptAdsLeadRow, url: string | null): Promise<boolean> {
  if (!url) return false;
  try {
    await microsoft.sendMail({
      to: row.email,
      subject: "Your SRT setup link",
      body:
        `Here is your setup link. It is yours alone and it works for 30 days, so you can stop and come back.\n\n` +
        `${url}\n\n` +
        `It takes about five minutes. Once it is in, we have what we need to start.\n\n` +
        `Matthew\nSRT Agency\n(336) 833-2303`,
      isHtml: false,
    });
    return true;
  } catch (err) {
    console.error("[chatgpt-ads] handoff email", err instanceof Error ? err.message : err);
    return false;
  }
}
