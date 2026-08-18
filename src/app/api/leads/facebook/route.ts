export const dynamic = "force-dynamic";
// Meta Lead Ads webhook. Facebook/Instagram instant-form submissions land here
// and go through the same inbound-lead stack as the website funnels: Supabase
// contact → Zoho lead → #hot-leads thread → Speed-to-Lead, plus an automatic
// AI-visibility audit whenever the form captured a website.
//
// TIMING IS LOAD-BEARING. Meta wants a 200 within 5 seconds on Page webhooks;
// sustained slow responses get the app UNSUBSCRIBED from the Page (recovering
// needs a manual re-POST to /{page-id}/subscribed_apps). So this route verifies
// the signature, acks immediately, and does every bit of real work — the Graph
// API lead fetch included — inside waitUntil.
//
// Setup lives outside this file: subscribe the `leadgen` field on the Page
// object in the App Dashboard, POST /{page-id}/subscribed_apps?subscribed_fields=leadgen,
// and grant the app Leads Access under Business Settings → Integrations.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { ingestLead } from "@/lib/lead-intake";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { normalizeLeadPhone } from "@/lib/phone";

export const runtime = "nodejs";
export const maxDuration = 300;

const GRAPH_VERSION = "v25.0";
const ZOHO_LEAD_SOURCE = "Facebook Lead Ad";

/** Prebuilt Meta field ids. Anything else on the form is a custom question. */
const KNOWN_FIELDS = new Set(["first_name", "last_name", "full_name", "email", "phone_number"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
    console.log("[FB Webhook] Verification successful");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[FB Webhook] Verification failed — token mismatch");
  return new NextResponse("Forbidden", { status: 403 });
}

/** HMAC-SHA256 of the RAW body against the app secret. Must run on the exact
 *  bytes received — parsing and re-serializing changes the hash. */
function verifySignature(rawBody: string, header: string | null): boolean {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) {
    // Fail CLOSED. Accepting unverified payloads left this endpoint open to
    // anyone who knew the URL, and the "secret is missing" case is a
    // misconfiguration we want to hear about, not silently paper over.
    console.error("[FB Lead] FB_APP_SECRET not set — rejecting payload");
    return false;
  }
  if (!header?.startsWith("sha256=")) return false;

  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface LeadGenQuestion {
  key: string;
  label: string;
  type?: string;
}

/** Ask Meta what the form's questions actually are. `field_data[].name` is the
 *  question's field id, which for UI-built forms is an undocumented auto-slug
 *  of the label (punctuation and all), so it must never be reconstructed by
 *  hand. Cached per form id — a published form can't be edited, and duplicating
 *  one mints a new form_id. */
const formQuestionCache = new Map<string, LeadGenQuestion[]>();

async function getFormQuestions(formId: string, pageToken: string): Promise<LeadGenQuestion[]> {
  const cached = formQuestionCache.get(formId);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${formId}` +
        `?fields=id,name,questions{key,label,type}&access_token=${pageToken}`
    );
    const data = (await res.json()) as { questions?: LeadGenQuestion[] };
    const questions = data.questions ?? [];
    if (questions.length) formQuestionCache.set(formId, questions);
    return questions;
  } catch (err) {
    console.error("[FB Lead] form questions fetch failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v) || v.includes("@")) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return u.hostname.includes(".") && /^[a-z0-9.-]+$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Resolve the lead's website. Preferred path: match the question whose LABEL
 *  mentions a website. Fallbacks: an obvious field id, then any answer that
 *  parses as a hostname. */
function extractWebsite(fields: Record<string, string>, questions: LeadGenQuestion[]): string {
  const websiteish = /(website|web site|url|domain|\bsite\b)/i;

  const byLabel = questions.find((q) => websiteish.test(q.label || ""));
  if (byLabel && fields[byLabel.key] && looksLikeUrl(fields[byLabel.key])) {
    return fields[byLabel.key].trim();
  }

  for (const [key, value] of Object.entries(fields)) {
    if (websiteish.test(key) && looksLikeUrl(value)) return value.trim();
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!KNOWN_FIELDS.has(key) && looksLikeUrl(value)) return value.trim();
  }

  return "";
}

/** A lead left in `processing` for longer than this is treated as stalled and
 *  may be replayed. Long enough to cover a slow Graph call, short enough that a
 *  retry is still useful. */
const REPLAY_AFTER_MS = 5 * 60 * 1000;

/**
 * Every failure in this route returns 200 to Meta, because a non-200 only buys
 * a retry of something that will fail identically. That used to mean a dropped
 * lead left nothing but a console line while Meta's dashboard read 100%
 * healthy. Anything that costs us a lead now says so in #hot-leads and leaves a
 * queryable row behind.
 */
async function alertLeadFailure(reason: string, context: Record<string, unknown>): Promise<void> {
  console.error(`[FB Lead] ${reason}`, context);

  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "facebook_lead_error",
      description: `Facebook lead dropped: ${reason}`.slice(0, 300),
      metadata: { reason, ...context },
    })
    .then(undefined, () => {});

  const channel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (!channel) return;

  const detail = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  try {
    await slack.postMessage(
      channel,
      `:rotating_light: *Facebook lead dropped:* ${reason}${detail ? `\n${detail}` : ""}`
    );
  } catch (err) {
    console.error("[FB Lead] failure alert could not be posted:", err instanceof Error ? err.message : err);
  }
}

/**
 * Meta does not guarantee once-only delivery, and it retries on any non-200, so
 * the same leadgen_id can arrive more than once.
 *
 * Dedup is two-phase: a row is written as `processing` before the work starts
 * and flipped to `done` only once the lead is actually in the CRM. A row that
 * is not `done` and has gone stale means the lead failed somewhere downstream,
 * so we let it through again rather than skipping it forever, which is what the
 * old write-then-work order did.
 */
async function alreadyProcessed(leadgenId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("system_logs")
    .select("id, created_at, metadata")
    .eq("event_type", "facebook_lead")
    .eq("metadata->>leadgen_id", leadgenId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return false;
  if ((data.metadata as { status?: string } | null)?.status === "done") return true;

  // Still in flight: skip, so two concurrent deliveries don't both run. Once it
  // has clearly stalled, treat it as replayable.
  return Date.now() - new Date(data.created_at as string).getTime() < REPLAY_AFTER_MS;
}

/** Claim this leadgen_id before doing any work. Returns the row id to finish. */
async function markProcessing(leadgenId: string, formId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "facebook_lead",
      description: `Facebook Lead Ad: processing ${leadgenId}`,
      metadata: { status: "processing", leadgen_id: leadgenId, form_id: formId },
    })
    .select("id")
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function processLeadgen(value: Record<string, unknown>): Promise<void> {
  const leadgenId = String(value.leadgen_id ?? "");
  if (!leadgenId) return;

  if (await alreadyProcessed(leadgenId)) {
    console.log(`[FB Lead] ${leadgenId} already processed — skipping`);
    return;
  }

  const pageToken = process.env.FB_PAGE_ACCESS_TOKEN || "";
  const formId = String(value.form_id ?? "");

  // Claim the lead before any slow work, so a duplicate delivery doesn't run in
  // parallel. Finished below, once we know whether it actually landed.
  const logId = await markProcessing(leadgenId, formId);

  let fields: Record<string, string> = {};
  let adName = "";
  let adsetName = "";
  let campaignName = "";

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}` +
        `?fields=id,created_time,field_data,form_id,ad_name,adset_name,campaign_name` +
        `&access_token=${pageToken}`
    );
    const lead = (await res.json()) as {
      field_data?: Array<{ name: string; values: string[] }>;
      ad_name?: string;
      adset_name?: string;
      campaign_name?: string;
      error?: { message?: string };
    };

    if (lead.error) {
      // Almost always Leads Access not granted to this app, or an expired page
      // token. Either way field_data comes back empty and the lead is lost, so
      // this is the single most important thing in the route to shout about.
      await alertLeadFailure("Graph API rejected the lead fetch (check Leads Access and the page token)", {
        leadgen_id: leadgenId,
        graph_error: lead.error.message,
        has_page_token: Boolean(pageToken),
      });
    }

    for (const f of lead.field_data ?? []) {
      fields[f.name] = f.values?.[0] ?? "";
    }
    adName = lead.ad_name ?? "";
    adsetName = lead.adset_name ?? "";
    campaignName = lead.campaign_name ?? "";
  } catch (err) {
    await alertLeadFailure("Graph API fetch threw", {
      leadgen_id: leadgenId,
      error: err instanceof Error ? err.message : String(err),
    });
    fields = {};
  }

  const questions = formId && pageToken ? await getFormQuestions(formId, pageToken) : [];
  const labelFor = (key: string) =>
    questions.find((q) => q.key === key)?.label || key.replace(/_/g, " ");

  const fullName = (fields.full_name || "").trim();
  const firstName = fields.first_name || fullName.split(" ")[0] || "";
  const lastName = fields.last_name || fullName.split(" ").slice(1).join(" ") || "";
  const email = (fields.email || "").trim().toLowerCase();
  const phone = normalizeLeadPhone(fields.phone_number);
  const website = extractWebsite(fields, questions);

  const extraLines = Object.entries(fields)
    .filter(([k, v]) => !KNOWN_FIELDS.has(k) && v)
    .map(([k, v]) => `${labelFor(k)}: ${v}`);

  const name = [firstName, lastName].filter(Boolean).join(" ") || email || phone || "Unknown";

  let contactId: string | null = null;
  if (email || phone) {
    const result = await ingestLead({
      firstName,
      lastName,
      email,
      phone,
      website,
      // The join key back to the ad. Without it the disposition buttons have
      // nothing to report against, since a lead ad never sets fbc/fbclid.
      fbLeadId: leadgenId,
      source: "facebook_lead",
      zohoLeadSource: ZOHO_LEAD_SOURCE,
      noteTitle: "Facebook Lead Ad",
      headline: website
        ? `:mag: *AI visibility audit running now* on ${website}. The report lands in this thread in a few minutes.`
        : ":large_blue_circle: *New Facebook lead* (no website on the form, so no audit)",
      detailLines: [
        website ? `Website: ${website}` : "",
        campaignName ? `Campaign: ${campaignName}` : "",
        adsetName ? `Ad set: ${adsetName}` : "",
        adName ? `Ad: ${adName}` : "",
        ...extraLines,
        "Source: Facebook Lead Ad",
      ],
    });
    contactId = result.contactId;
  } else {
    // Nearly always a downstream symptom of the Graph fetch above returning
    // nothing, so the lead exists on Meta's side but never reaches the CRM.
    await alertLeadFailure("lead had neither email nor phone, so it was not ingested", {
      leadgen_id: leadgenId,
      form_id: formId,
      field_keys: Object.keys(fields).join(", ") || "(none returned)",
    });
  }

  // Finish the claim from markProcessing. Only `done` suppresses a replay, so a
  // lead that never reached the CRM stays retryable. field_data keys are kept
  // raw so a form's real field ids are visible when the website mapping needs
  // checking. Written before the audit, which is the slow part.
  if (logId) {
    await supabaseAdmin
      .from("system_logs")
      .update({
        description: `Facebook Lead Ad: ${name} (${email || phone || "no contact"})`,
        metadata: {
          status: contactId ? "done" : "failed",
          leadgen_id: leadgenId,
          form_id: formId,
          contact_id: contactId,
          name,
          email,
          phone,
          website,
          campaign: campaignName,
          field_keys: Object.keys(fields),
        },
      })
      .eq("id", logId)
      .then(undefined, () => {});
  }

  if (website && email) {
    await runAuditPipeline({
      website: /^https?:\/\//i.test(website) ? website : `https://${website}`,
      requesterName: name,
      requesterEmail: email,
      requesterPhone: phone || undefined,
      contactId: contactId ?? undefined,
      allowLowConfidenceCity: true,
      onError: async (message) => console.error("[FB Lead] audit pipeline error:", message),
    });
  }
}

export async function POST(request: NextRequest) {
  // Read the raw body: the signature is computed over these exact bytes.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    // Still 200: a non-200 makes Meta retry, and a bad signature won't improve.
    // Alerted because the usual cause is FB_APP_SECRET drifting out of sync
    // with the app after a rotation, which silently eats every lead.
    waitUntil(
      alertLeadFailure("webhook signature verification failed", {
        has_app_secret: Boolean(process.env.FB_APP_SECRET),
        signature_present: Boolean(request.headers.get("x-hub-signature-256")),
      })
    );
    return NextResponse.json({ ok: true });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Facebook only sends the page object for Lead Ads
  if (body.object !== "page") {
    return NextResponse.json({ ok: true });
  }

  const jobs: Array<Record<string, unknown>> = [];
  for (const entry of (body.entry as Array<Record<string, unknown>>) ?? []) {
    for (const change of (entry.changes as Array<Record<string, unknown>>) ?? []) {
      if (change.field !== "leadgen") continue;
      const value = change.value as Record<string, unknown> | undefined;
      if (value?.leadgen_id) jobs.push(value);
    }
  }

  // Ack inside Meta's 5s window; each lead is isolated so one failure can't
  // take down the rest of the batch.
  if (jobs.length) {
    waitUntil(
      Promise.allSettled(
        jobs.map((value) =>
          processLeadgen(value).catch((err) =>
            console.error("[FB Lead] processing failed:", err instanceof Error ? err.message : err)
          )
        )
      ).then(() => undefined)
    );
  }

  return NextResponse.json({ ok: true });
}
