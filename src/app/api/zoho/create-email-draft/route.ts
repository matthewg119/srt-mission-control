export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Chrome extension → create Outlook email draft endpoint (v21).
// Resolves the lead in `contacts`, renders the selected template, injects the
// user's Outlook signature, then creates a real draft via Microsoft Graph.
// Returns the webLink that opens it in Outlook Web compose view.
//
// POST body: { zoho_lead_id | contact_id, template_key }
//
// `zoho_lead_id` is still accepted because the shipped extension sends it; it
// now resolves against contacts.zoho_lead_id rather than against Zoho.

import { NextRequest, NextResponse } from "next/server";
import { resolveLead } from "@/lib/crm";
import { microsoft } from "@/lib/microsoft";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Mirror of the EMAIL_TEMPLATES array in the v21 Chrome extension content.js
const EMAIL_TEMPLATES: Record<string, { subject: string; body: string }> = {
  "nice-speaking": {
    subject: "Great speaking with you!",
    body: `<p>Hi {{firstName}},</p>
<p>It was great speaking with you today. Here's my contact info so you have it handy — I'll follow up on the funding options we discussed.</p>
<p>In the meantime, feel free to reach out anytime.</p>`,
  },
  "app-link": {
    subject: "Your Business Funding Application",
    body: `<p>Hi {{firstName}},</p>
<p>Here is your application link — it only takes about 5 minutes to complete, and there's no hard credit pull:</p>
<p><a href="https://srtagency.com/apply">srtagency.com/apply</a></p>
<p>Once I receive it, I'll start pulling options for your business right away.</p>`,
  },
  "funding-options": {
    subject: "Funding Options for Your Business",
    body: `<p>Hi {{firstName}},</p>
<p>I've been working on some funding options for your business and I'd love to walk you through what I've found.</p>
<p>Can we set up a quick 15-minute call this week? Just reply with a time that works for you.</p>`,
  },
  "fu-1": {
    subject: "Following Up — Business Funding",
    body: `<p>Hi {{firstName}},</p>
<p>Just wanted to follow up on our conversation about business funding. I know things get busy — wanted to check in and see if you're still interested in exploring your options.</p>
<p>No pressure at all. Would love to connect whenever you have a moment.</p>`,
  },
  "fu-2": {
    subject: "Last Follow-Up — SRT Agency",
    body: `<p>Hi {{firstName}},</p>
<p>I don't want to keep filling your inbox, so this will be my last follow-up.</p>
<p>If you're ever ready to explore business funding options down the road, I'm here — just reach out and we'll pick up from here.</p>`,
  },
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

  const body = (await req.json().catch(() => ({}))) as {
    zoho_lead_id?: string;
    contact_id?: string;
    template_key?: string;
  };

  const { zoho_lead_id, contact_id, template_key } = body;

  if ((!zoho_lead_id && !contact_id) || !template_key) {
    return NextResponse.json(
      { error: "zoho_lead_id or contact_id, and template_key, are required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const tmpl = EMAIL_TEMPLATES[template_key];
  if (!tmpl) {
    return NextResponse.json(
      { error: `unknown template_key: ${template_key}`, available: Object.keys(EMAIL_TEMPLATES) },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const lead = await resolveLead({ contactId: contact_id, zohoLeadId: zoho_lead_id });
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404, headers: CORS_HEADERS });
  }

  const toEmail = lead.email;
  if (!toEmail) {
    return NextResponse.json(
      { error: "no_email_on_lead" },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const firstName = lead.firstName ?? "";

  // Render template body
  const renderedBody = tmpl.body.replace(/\{\{firstName\}\}/g, firstName || "there");

  // Append Outlook signature if available (cached 30min)
  let fullBody = renderedBody;
  try {
    const signature = await microsoft.getDefaultSignature();
    if (signature) {
      fullBody = `${renderedBody}\n${signature}`;
    }
  } catch {
    // Signature fetch failing is non-fatal — draft is still useful without it
  }

  // Create Outlook draft via Microsoft Graph
  let draftUrl: string;
  try {
    const draft = await microsoft.createDraft({
      to: toEmail,
      subject: tmpl.subject,
      body: fullBody,
    });
    draftUrl = draft.webLink;
  } catch (err) {
    return NextResponse.json(
      { error: `graph_draft_failed: ${(err as Error).message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, draftUrl, template: template_key, to: toEmail },
    { headers: CORS_HEADERS }
  );
}
