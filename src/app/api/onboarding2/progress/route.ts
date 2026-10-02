// The funnel reporting one answer. PUBLIC, no token, same posture as /start.
//
// ‼️ IT IS A SEPARATE ROUTE FROM /start AND THAT IS NOT DUPLICATION.
// /start signs an agreement, provisions a client and takes a seat. This takes a name and a phone
// and opens a lead. Folding progress into /start would mean relaxing readIdentity's "all four or
// none" rule, which exists because a half-filled identity writes a signing row with no email, and
// that rule is worth more than one fewer file.
//
// ‼️ NOTHING HERE SIGNS, PROVISIONS, CHARGES OR DIALS. The only side effects are a contacts row, a
// Slack card in the lead's own thread, and a progress row the nudge reads.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { parseIntake } from "@/lib/onboarding2/intake-steps";
import { isDemoRequest } from "@/lib/onboarding2/demo";
import { pageFromRequest } from "@/lib/lead-intake";
import { recordProgress, isProgressStep } from "@/lib/onboarding2/progress";

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // ‼️ THE HONEYPOT ANSWERS 200 AND DOES NOTHING, exactly as /start does. A bot that learns which
  // field is the trap from a 400 simply stops filling it.
  if (clean(body.company_url_hp, 200)) return NextResponse.json({ ok: true });

  const step = clean(body.step, 40);
  if (!isProgressStep(step)) return NextResponse.json({ ok: false }, { status: 400 });

  const name = parseIntake("name", clean(body.contactName, 200));
  const phone = parseIntake("phone", clean(body.phone, 60));
  // ‼️ BOTH OR NOTHING, for the reason the header gives: a lead with no phone cannot be acted on,
  // and the whole point of firing here rather than at the website is that it can be.
  if (!name.ok || !phone.ok) return NextResponse.json({ ok: false }, { status: 400 });

  const emailRaw = clean(body.email, 300);
  const email = emailRaw ? parseIntake("email", emailRaw) : null;

  // ‼️ DEMO RUNS DO NOTHING HERE, which is the opposite of /start's "write the row, suppress the
  // side effect". Everything this route does IS a side effect, so there is no row left to write.
  if (isDemoRequest(req)) return NextResponse.json({ ok: true, demo: true });

  const attribution = (body.attribution ?? {}) as Record<string, unknown>;
  const res = await recordProgress({
    step,
    name: name.value,
    phone: phone.value,
    website: clean(body.website, 400) || null,
    email: email && email.ok ? email.value : null,
    wantsReactivation: typeof body.wantsReactivation === "boolean" ? body.wantsReactivation : null,
    sourcePage: pageFromRequest(req, "/onboarding2"),
    utmSource: clean(attribution.utmSource, 120) || undefined,
    utmMedium: clean(attribution.utmMedium, 120) || undefined,
    utmCampaign: clean(attribution.utmCampaign, 160) || undefined,
    utmContent: clean(attribution.utmContent, 160) || undefined,
  });

  return NextResponse.json({ ok: res.ok });
}
