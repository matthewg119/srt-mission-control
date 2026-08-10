export const dynamic = "force-dynamic";

// The brief for a Zoho record we already know the id of.
//
// Two callers, two auth lanes, one implementation:
//   - The Auto-Dialer, which has the record id on screen and uses the CRON_SECRET bearer it
//     already carries for every other /api/zoho/* call.
//   - The Call Coach's confirm strip, which uses the per-rep call-coach key.
//
// Both get the same brief and both write the same session row, so whichever surface starts the
// call, the post-call wrap finds one place to read the identity from.

import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateCallCoachKey } from "@/lib/call-coach-auth";
import { buildCallBrief } from "@/lib/call-coach/brief";
import { attachContactId, whoLine, type CallTarget } from "@/lib/call-coach/resolve-target";
import { zohoRecordUrl, type ZohoModule } from "@/lib/call-coach/zoho-url";
import { createPendingSession, attachIdentityToSession, latestPendingTarget } from "@/lib/call-coach/session";
import { getLead, getDeal } from "@/lib/zoho";

const MODULES: ZohoModule[] = ["Leads", "Deals", "Contacts", "Accounts"];

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

  let body: { module?: string; recordId?: string; record_id?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const recordId = String(body.recordId ?? body.record_id ?? "").trim();
  const rawModule = String(body.module ?? "Leads").trim();
  const module = MODULES.find((m) => m.toLowerCase() === rawModule.toLowerCase()) ?? "Leads";

  if (!/^\d{6,}$/.test(recordId)) {
    return NextResponse.json({ error: "bad_record_id", detail: "Expected an 18 or 19 digit Zoho record id." }, { status: 400 });
  }

  try {
    const rec = module === "Deals" ? await getDeal(recordId) : await getLead(recordId);
    if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const base: CallTarget = {
      module,
      recordId,
      businessName:
        (rec.Company as string | undefined) ??
        (rec.Deal_Name as string | undefined) ??
        null,
      personName: [rec.First_Name, rec.Last_Name].filter(Boolean).join(" ").trim() || null,
      email: (rec.Email as string | undefined) ?? null,
      phone: (rec.Phone as string | undefined) ?? null,
      website: (rec.Website as string | undefined) ?? null,
      contactId: null,
      // The id came from the caller's own page, so there is nothing to be uncertain about.
      confidence: "exact",
      source: "dialer",
      zohoUrl: zohoRecordUrl({ module, recordId }),
    };

    const target = await attachContactId(base);
    const brief = await buildCallBrief(target);

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId
        ? (await attachIdentityToSession(body.sessionId, target, brief, "exact"), body.sessionId)
        : await createPendingSession(auth.userId, target, brief, "exact");

    return NextResponse.json({
      ok: true,
      sessionId,
      callType: brief.callType,
      hasAudit: brief.hasAudit,
      who: { label: whoLine(target), zohoUrl: target.zohoUrl, businessName: target.businessName },
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
