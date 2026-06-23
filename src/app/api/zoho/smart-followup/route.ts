export const dynamic = "force-dynamic";
// Dialer "⚡ Smart Follow-up" endpoint.
//
// Called by the SRT Auto-Dialer Chrome extension (v43) from a Zoho Lead OR Deal
// page. Two-step:
//   • DRAFT (default)  { module, record_id, email?, phone?, name? }
//       → resolve the record, gather status (stage, last-contact gap, OneDrive
//         package / bank statements), AI-draft the follow-up. Returns the draft
//         so the dialer fills its editable subject/body for review. Nothing sent.
//   • ROUTE  { ...same, subject, body, route:true }
//       → post the (possibly edited) draft to BOTH approval surfaces: a Slack
//         👍/✏️/🚫 card in the email-director channel AND a 'suggested' bubble in
//         textwin.ai. The actual send is gated on approval (never auto-sent).
//
// POST — Bearer CRON_SECRET (same gate as zoho/compose-email-approval).

import { NextRequest, NextResponse } from "next/server";
import {
  resolveRecord,
  gatherStatus,
  draftFollowup,
  routeFollowup,
} from "@/lib/ai-intel/smart-followup";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    module?: string;
    record_id?: string;
    email?: string;
    phone?: string;
    name?: string;
    subject?: string;
    body?: string;
    route?: boolean;
  };

  const moduleRaw = (body.module ?? "Leads").trim();
  const module = moduleRaw === "Deals" ? "Deals" : moduleRaw === "Leads" ? "Leads" : null;
  if (!module) {
    return NextResponse.json({ error: `unsupported_module: ${moduleRaw}` }, { status: 400 });
  }
  if (!body.record_id) {
    return NextResponse.json({ error: "missing record_id" }, { status: 400 });
  }

  try {
    const rec = await resolveRecord({
      module,
      recordId: body.record_id,
      email: body.email,
      phone: body.phone,
      name: body.name,
    });

    if (!rec.email) {
      return NextResponse.json(
        { error: "no_email_on_record", status_summary: "no email on file — add one in Zoho first" },
        { status: 422 }
      );
    }

    const status = await gatherStatus(rec);

    // ROUTE: post the (edited) copy for approval on both surfaces.
    if (body.route) {
      const subject = (body.subject ?? "").trim();
      const draftBody = (body.body ?? "").trim();
      if (!subject || !draftBody) {
        return NextResponse.json({ error: "missing subject or body for route" }, { status: 400 });
      }
      const routed = await routeFollowup(rec, status, { subject, body: draftBody });
      return NextResponse.json({
        ok: true,
        routed: true,
        slack_ts: routed.slackTs,
        bubble: routed.bubble,
        conversation_id: rec.conversationId,
        status_summary: status.summary,
      });
    }

    // DRAFT: generate and return for review.
    const draft = await draftFollowup(rec, status);
    return NextResponse.json({
      ok: true,
      routed: false,
      module,
      record_id: rec.recordId,
      to: rec.email,
      first_name: rec.firstName,
      business_name: rec.businessName,
      subject: draft.subject,
      body: draft.body,
      status_summary: status.summary,
      conversation_id: rec.conversationId,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[smart-followup] failed:", msg);
    return NextResponse.json({ error: `smart_followup_error: ${msg}` }, { status: 500 });
  }
}
