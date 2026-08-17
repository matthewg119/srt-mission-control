export const dynamic = "force-dynamic";
// Chrome extension → draft SMS endpoint.
// Creates a Slack channel for the lead and posts an AI draft for ✅ approval.
// Does NOT send the SMS — approval via Slack reaction triggers sending.
//
// POST body: { zoho_lead_id | contact_id, template_name, first_name }
//
// `zoho_lead_id` is still accepted because the shipped extension sends it, but
// it now resolves against contacts.zoho_lead_id rather than against Zoho. A
// lead that is not in `contacts` can no longer be conjured from a live Zoho
// fetch, so it 404s rather than texting off a half-built record.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveLead } from "@/lib/crm";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel, postAIDraft } from "@/lib/sms-channel";
import { buildVCard, sanitizeFilename } from "@/lib/vcard";
import { slack } from "@/lib/slack-bot";
import { generateDraft } from "@/lib/sms-ai-engine";
import { resolveTenantId } from "@/lib/persona";

// Map each template to the funnel stage that best frames its rewrite. Openers +
// app link are Stage 1 (soft pitch); the follow-ups keep a warm Stage 2 tone.
const TEMPLATE_STAGE: Record<string, number> = {
  "nice-speaking": 1,
  "app-link": 1,
  "tuesday-opener": 1,
  "fu1-guide": 2,
  "fu2-authorized": 2,
  "fu3-worth-reply": 2,
  "fu4-black-hole": 2,
  "fu5-last-ping": 2,
  "fu6-say-anything": 2,
};

export const runtime = "nodejs";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SMS_TEMPLATES: Record<string, string> = {
  "nice-speaking":
    "Hey {{firstName}}! Was great speaking with you. Going to save your number and shoot you an email from matthew@srtagency.com so you have my info. Talk soon! 💪",
  "app-link":
    "Hey {{firstName}}! Here is the link to start your application — only takes 2 min 👉 srtagency.com/fullapp Let me know if you have any questions!",
  "fu1-guide":
    "Hey {{firstName}}, quick question — would it be cool if I sent over our funding guide PDF? No strings, just want to make sure you have all the info 💪",
  "fu2-authorized":
    "Hey {{firstName}}! Based on everything we talked about, you're looking solid for funding. Just need a few docs from you. What's the best time to connect?",
  "fu3-worth-reply":
    "Worth a Reply? KHRT 👊",
  "fu4-black-hole":
    "Did your inbox turn into a black hole? 😅 Still here when you're ready {{firstName}}",
  "fu5-last-ping":
    "Last ping {{firstName}} — unless you're still curious about funding options? No pressure either way 🤙",
  "fu6-say-anything":
    "Say anything and I'll take it as a win {{firstName}} 😂",
  "tuesday-opener":
    "Happy Tuesday! Are you still looking for money for your business? 💰",
};

// Human-readable labels for each template key (used in Slack copy-paste block header)
const SMS_TEMPLATES_LABELS: Record<string, string> = {
  "nice-speaking":    "Nice Speaking With You",
  "app-link":         "Application Link",
  "fu1-guide":        "FU1: PDF Guide Ask",
  "fu2-authorized":   "FU2: Authorized + Contact Info",
  "fu3-worth-reply":  "FU3: Worth a Reply? KHRT",
  "fu4-black-hole":   "FU4: Black Hole Inbox",
  "fu5-last-ping":    "FU5: Last Ping",
  "fu6-say-anything": "FU6: Say Anything",
  "tuesday-opener":   "Tuesday Opener",
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const body = (await req.json()) as {
    zoho_lead_id?: string;
    contact_id?: string;
    template_name: string;
    first_name?: string;
  };

  const { zoho_lead_id, contact_id, template_name, first_name: firstNameHint } = body;

  if ((!zoho_lead_id && !contact_id) || !template_name) {
    return NextResponse.json(
      { error: "missing zoho_lead_id/contact_id or template_name" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const templateRaw = SMS_TEMPLATES[template_name];
  if (!templateRaw) {
    return NextResponse.json(
      { error: `unknown template: ${template_name}`, available: Object.keys(SMS_TEMPLATES) },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const lead = await resolveLead({ contactId: contact_id, zohoLeadId: zoho_lead_id });
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404, headers: CORS_HEADERS });
  }

  const phoneRaw = lead.mobilePhone ?? lead.phone ?? undefined;
  const firstName = firstNameHint || lead.firstName || "";
  const lastName = lead.lastName ?? "";
  const businessName = lead.businessName ?? "";

  if (!phoneRaw) {
    return NextResponse.json(
      { error: "no_phone_on_lead" },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { error: `invalid_phone: ${phoneRaw}` },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const contactId: string = lead.id;

  // Create or find SMS conversation
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contactId,
        outcome: "open",
        first_sms_sent: false,
        // Stamp activity so a freshly-drafted lead (no inbound yet) surfaces in
        // textwin's "Recent" list instead of sinking under inbound-only ordering.
        last_outbound_at: new Date().toISOString(),
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id")
    .single();

  if (!conv) {
    return NextResponse.json(
      { error: "conversation_upsert_failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const displayName = businessName || [firstName, lastName].filter(Boolean).join(" ") || phone;

  // Ensure Slack channel exists
  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id as string,
    phone,
    displayName,
    contactId,
    zohoLeadId: lead.zohoLeadId ?? undefined,
    businessName: businessName || null,
  });

  if (!channelId) {
    return NextResponse.json(
      { error: "slack_channel_creation_failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Deterministic template render — kept verbatim as the copy-paste reference block
  // and as the fallback if the AI personalization fails.
  const templateRendered = templateRaw.replace(/\{\{firstName\}\}/g, firstName || "there");

  // Personalize the template in Matthew's voice for this lead. The template is the
  // INTENT/seed (same CTA), the engine rewrites it personalized to name/business/
  // revenue. Falls back to the raw template so the card is never empty.
  let draft = templateRendered;
  try {
    const { data: contactRow } = await supabaseAdmin
      .from("contacts")
      .select("monthly_revenue")
      .eq("id", contactId)
      .maybeSingle();
    const monthlyRevenue = (contactRow?.monthly_revenue as number | null) ?? null;

    const tenantId = (await resolveTenantId()) ?? "";
    const seed =
      `[Outbound template "${SMS_TEMPLATES_LABELS[template_name] ?? template_name}". ` +
      `Rewrite it in Matthew's voice, personalized to this lead, keeping the SAME intent and call-to-action. ` +
      `This is a cold/outbound first-touch or follow-up, NOT a reply to an inbound message. ` +
      `Template: ${templateRendered}]`;
    const gen = await generateDraft({
      tenantId,
      stage: TEMPLATE_STAGE[template_name] ?? 1,
      inboundMessage: seed,
      history: [],
      contact: { firstName: firstName || null, businessName: businessName || null, monthlyRevenue },
      translateSpanish: false,
    });
    if (gen.draft) draft = gen.draft;
  } catch (e) {
    console.warn("[draft-sms] personalization failed, using raw template:", (e as Error).message);
  }

  // Upload vCard so Matthew can tap to add contact to his phone
  const vCardText = buildVCard({
    firstName,
    lastName,
    businessName: businessName || null,
    phone,
    email: lead.email,
  });
  const vcfName = `${sanitizeFilename([firstName, lastName].filter(Boolean).join("_") || phone)}.vcf`;
  try {
    await slack.uploadFile(channelId, vcfName, Buffer.from(vCardText, "utf8"), "text/vcard");
  } catch (e) {
    console.warn("[draft-sms] vCard upload failed (non-fatal):", (e as Error).message);
  }

  // Post the template text as a preformatted block so Matthew can copy + paste it
  const templateLabel = SMS_TEMPLATES_LABELS[template_name] ?? template_name;
  try {
    await slack.postMessage(channelId, `*📋 SMS Template: ${templateLabel}*\n\`\`\`${templateRendered}\`\`\``);
  } catch (e) {
    console.warn("[draft-sms] Template text post failed (non-fatal):", (e as Error).message);
  }

  // Post as AI draft (✅ to send)
  await postAIDraft(channelId, 1, displayName, draft, conv.id as string);

  return NextResponse.json(
    {
      ok: true,
      channelId,
      displayName,
      phone,
      template: template_name,
      draft,
    },
    { headers: CORS_HEADERS }
  );
}
