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
import { ingestLead } from "@/lib/lead-intake";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";

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
    console.warn("[FB Lead] FB_APP_SECRET not set — accepting unverified payload");
    return true;
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

/** Meta does not guarantee once-only delivery, and it retries on any non-200. */
async function alreadyProcessed(leadgenId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("system_logs")
    .select("id")
    .eq("event_type", "facebook_lead")
    .eq("metadata->>leadgen_id", leadgenId)
    .limit(1)
    .maybeSingle();
  return !!data;
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
      // Almost always Leads Access not granted to this app, or an expired page token.
      console.error("[FB Lead] Graph API error:", lead.error.message);
    }

    for (const f of lead.field_data ?? []) {
      fields[f.name] = f.values?.[0] ?? "";
    }
    adName = lead.ad_name ?? "";
    adsetName = lead.adset_name ?? "";
    campaignName = lead.campaign_name ?? "";
  } catch (err) {
    console.error("[FB Lead] Graph API fetch failed:", err instanceof Error ? err.message : err);
    fields = {};
  }

  const questions = formId && pageToken ? await getFormQuestions(formId, pageToken) : [];
  const labelFor = (key: string) =>
    questions.find((q) => q.key === key)?.label || key.replace(/_/g, " ");

  const fullName = (fields.full_name || "").trim();
  const firstName = fields.first_name || fullName.split(" ")[0] || "";
  const lastName = fields.last_name || fullName.split(" ").slice(1).join(" ") || "";
  const email = (fields.email || "").trim().toLowerCase();
  const phone = (fields.phone_number || "").replace(/[^\d+]/g, "");
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
    console.warn(`[FB Lead] ${leadgenId} has neither email nor phone — logging only`);
  }

  // Log BEFORE the audit: this row is the dedup key, and the audit is the slow part.
  // field_data keys are kept raw so a form's real field ids are visible when the
  // website mapping needs checking.
  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "facebook_lead",
      description: `Facebook Lead Ad: ${name} (${email || phone || "no contact"})`,
      metadata: {
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
    .then(undefined, () => {});

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
    console.error("[FB Lead] signature verification failed — dropping payload");
    // Still 200: a non-200 makes Meta retry, and a bad signature won't improve.
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
