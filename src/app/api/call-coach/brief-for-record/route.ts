export const dynamic = "force-dynamic";

// The brief for a contact we already know the id of.
//
// Two callers, two auth lanes, one implementation:
//   - The Auto-Dialer, which has the record id on screen and uses the CRON_SECRET bearer it
//     already carries.
//   - The Call Coach's confirm strip, which uses the per-rep call-coach key.
//
// Both get the same brief and both write the same session row, so whichever surface starts the
// call, the post-call wrap finds one place to read the identity from.
//
// ‼️ A legacy 6+ digit Zoho record id is still accepted and resolved through
// contacts.zoho_lead_id. The dialer that sends it lives in another repo and ships on its own
// schedule, so rejecting the old shape would break calling before that release lands.

import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateCallCoachKey } from "@/lib/call-coach-auth";
import { buildCallBrief } from "@/lib/call-coach/brief";
import { whoLine, type CallTarget } from "@/lib/call-coach/resolve-target";
import { createPendingSession, attachIdentityToSession, latestPendingTarget } from "@/lib/call-coach/session";
import { resolveLead } from "@/lib/crm";
import { crmRecordUrl } from "@/lib/call-coach/record-url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZOHO_ID = /^\d{6,}$/;

/** Either lane opens the door. The dialer has no per-rep key and never will. */
async function authorize(req: NextRequest): Promise<{ userId: string | null } | null> {
  const key = extractApiKey(req);
  if (!key) return null;

  const cron = process.env.CRON_SECRET;
  if (cron && key === cron) return { userId: null };

  const user = await validateCallCoachKey(key);
  return user ? { userId: user.id } : null;
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { contactId?: string; contact_id?: string; recordId?: string; record_id?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const id = String(
    body.contactId ?? body.contact_id ?? body.recordId ?? body.record_id ?? ""
  ).trim();

  if (!UUID.test(id) && !ZOHO_ID.test(id)) {
    return NextResponse.json(
      { error: "bad_record_id", detail: "Expected a contact uuid, or a legacy 18-19 digit Zoho lead id." },
      { status: 400 }
    );
  }

  try {
    const lead = await resolveLead(UUID.test(id) ? { contactId: id } : { zohoLeadId: id });
    if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const target: CallTarget = {
      contactId: lead.id,
      businessName: lead.businessName,
      personName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
      email: lead.email,
      phone: lead.phone ?? lead.mobilePhone,
      website: lead.website,
      // The id came from the caller's own page, so there is nothing to be uncertain about.
      confidence: "exact",
      source: "dialer",
      crmUrl: crmRecordUrl(lead.id),
      zohoLeadId: lead.zohoLeadId,
    };

    const brief = await buildCallBrief(target);

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId
        ? (await attachIdentityToSession(body.sessionId, brief.who, brief, "exact"), body.sessionId)
        : await createPendingSession(auth.userId, brief.who, brief, "exact");

    return NextResponse.json({
      ok: true,
      sessionId,
      callType: brief.callType,
      hasAudit: brief.hasAudit,
      // `brief.who`, NOT the local `target`. buildCallBrief fills in a missing business name from
      // the audit report and then the website host, and reading the pre-correction copy here meant
      // the API kept answering "unknown business" while the brief itself had the real one.
      // `module`, `recordId` and `zohoUrl` are the pre-cutover wire shape. The shipped extension
      // and dialer read them by those names, so they stay populated until those repos ship.
      who: {
        module: "Leads",
        recordId: brief.who.zohoLeadId ?? brief.who.contactId,
        contactId: brief.who.contactId,
        label: whoLine(brief.who),
        crmUrl: brief.who.crmUrl,
        zohoUrl: brief.who.crmUrl,
        businessName: brief.who.businessName,
      },
      reasons: brief.reasons,
      briefText: brief.text,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[call-coach/brief-for-record] failed:", msg);
    return NextResponse.json({ error: "brief_failed", detail: msg }, { status: 500 });
  }
}

/** The coach's "Load latest" button: pick up whatever the dialer just resolved. */
export async function GET(req: NextRequest) {
  const key = extractApiKey(req);
  const user = key ? await validateCallCoachKey(key) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const latest = await latestPendingTarget(user.id);
  if (!latest) return NextResponse.json({ ok: true, found: false });

  return NextResponse.json({
    ok: true,
    found: true,
    sessionId: latest.sessionId,
    callType: latest.callType,
    who: { label: [latest.businessName, latest.personName, latest.prospectPhone].filter(Boolean).join(" · ") },
    briefText: latest.briefText,
  });
}
