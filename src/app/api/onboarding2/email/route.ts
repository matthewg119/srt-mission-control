// Screen one. THE WHOLE IDENTITY, AND THE MOMENT SOMEBODY BECOMES A LEAD.
//
// ‼️ SIX FIELDS, AND EVERY ONE OF THEM IS COLLECTED HERE SO THAT NOTHING LATER ASKS FOR IT AGAIN
// (Matthew, 2026-09-03). Full name, company name, title, website, business email, phone. The
// signature screen used to re-ask five of these, which reads as a system that was not listening
// to the person who just filled in the form above it. The signature screen is now a signature, a
// date and a business address, and POST /sign refuses to take any of these from a request body:
// it reads them off this row.
//
// ‼️ THE LEAD ROW IS WRITTEN HERE, NOT AT SIGNATURE. Somebody who types their details, reads two
// pages of the agreement and closes the tab is already a lead, and the whole reason this funnel
// has a table rather than a system_logs row is to be able to ask how many of those there were.
// /chatgpt-ads takes the same position at its intake stage.
//
// ‼️ THE TIME TRAP LIVES HERE. This is the first human action in the flow. /start fires on page
// load with nobody having done anything, so a fill-time check there measures the browser.
//
// ‼️ patchOpenSigning KEEPS ITS .is("signed_at", null) LOCK, which is what makes writing the
// signed columns before the signature safe: the moment signed_at is stamped, this route can no
// longer touch any of them.

import { NextRequest, NextResponse } from "next/server";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { clean, validEmail } from "@/lib/medspa/validate";
import { normalizeLeadPhone } from "@/lib/phone";
import { normalizeTarget } from "@/lib/scan/normalize";
import { loadByToken, patchOpenSigning } from "@/lib/onboarding2/session";
import { attributionColumns, upsertLead } from "@/lib/onboarding2/lead";
import { MIN_FILL_SECONDS } from "@/lib/onboarding2/constants";
import type { Attribution } from "@/lib/onboarding2/types";

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

  // 1. Honeypot. Silent success.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true, leadId: null });
  }

  // 2. Time trap. Nobody lands on a page and fills in six fields in under two seconds.
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true, leadId: null });
  }

  const row = await loadByToken(body.sessionToken as string);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (row.signed_at) {
    return NextResponse.json({ ok: false, error: "already_signed" }, { status: 409 });
  }

  // ── The six, validated server-side. The client checks the same things first, so the message
  //    arrives without a round trip, but this is the check that counts. ──

  // ‼️ THE NAME IS REQUIRED, AND clients.legal_name IS WHY. That column is NOT NULL and startPilot
  // falls back to the email address when it has no name, so a funnel that only collected an
  // address put "someone@clinic.com" where a company name goes on every board in Mission Control.
  // Two characters and at least one letter: this is a name field on a phone, not an identity check.
  const contactName = clean(body.contactName, 120);
  if (contactName.length < 2 || !/\p{L}/u.test(contactName)) {
    return NextResponse.json({ ok: false, error: "Please give us your full name." }, { status: 400 });
  }

  const businessLegalName = clean(body.businessLegalName, 200);
  if (businessLegalName.length < 2 || !/\p{L}/u.test(businessLegalName)) {
    return NextResponse.json(
      { ok: false, error: "Please give us your business name." },
      { status: 400 }
    );
  }

  const signerTitle = clean(body.signerTitle, 120);
  if (signerTitle.length < 2 || !/\p{L}/u.test(signerTitle)) {
    return NextResponse.json({ ok: false, error: "Please give us your title." }, { status: 400 });
  }

  // ‼️ normalizeTarget IS THE GATE, NOT A REGEX. It is what the scanner and the hub lane use, so
  // anything it accepts here is something intakePatchFrom() can later turn into a real domain.
  // What is STORED is what they typed: the normalised form is derived at delivery time, and a
  // funnel that silently rewrote somebody's answer would be editing their input.
  const websiteTyped = clean(body.website, 300);
  if (!websiteTyped || !normalizeTarget(websiteTyped).ok) {
    return NextResponse.json(
      { ok: false, error: "That website address does not look right." },
      { status: 400 }
    );
  }

  const email = clean(body.email, 254).toLowerCase();
  if (!email || !validEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "That email address does not look right." },
      { status: 400 }
    );
  }

  // ‼️ BOTH FORMS, ALWAYS. E.164 is what every system downstream joins on; the typed string is
  // what the person wrote and what goes back into the input on a resume. A normalizer that
  // silently replaced one with the other would be editing the record.
  const phoneTyped = clean(body.contactPhone, 40);
  const phoneE164 = phoneTyped ? normalizeLeadPhone(phoneTyped) : "";
  // normalizeLeadPhone returns the digits as given when it cannot make a US number of them, so a
  // leading + and ten digits is the real test rather than a truthy check.
  if (!phoneTyped || !/^\+?\d{10,15}$/.test(phoneE164)) {
    return NextResponse.json(
      { ok: false, error: "That phone number does not look right." },
      { status: 400 }
    );
  }

  const patched = await patchOpenSigning(row.id, {
    email,
    contact_name: contactName,
    business_legal_name: businessLegalName,
    signer_title: signerTitle,
    website: websiteTyped,
    // The signature block's "best contact email" and screen one's address are the same thing now.
    // leadEmailFor() still prefers `email`, so attribution stays on the row it was created under.
    contact_email: email,
    contact_phone: phoneE164,
    contact_phone_typed: phoneTyped,
  });
  if (!patched) {
    // Somebody signed between the load and the update. Vanishingly unlikely on screen one, and
    // still not an error worth showing: the session is simply past this point.
    return NextResponse.json({ ok: false, error: "already_signed" }, { status: 409 });
  }

  const ipHash = hashIp(clientIpFrom(req));
  const lead = await upsertLead({
    email,
    contact_name: contactName,
    business_name: businessLegalName,
    signer_title: signerTitle,
    website: websiteTyped,
    phone: phoneE164,
    signing_id: row.id,
    // Carried from the signing so a funnel report can exclude test runs without a join.
    is_demo: row.is_demo,
    ip_hash: ipHash,
    ...attributionColumns(body.attribution as Attribution | undefined),
  });

  if (lead) await patchOpenSigning(row.id, { lead_id: lead.id });

  return NextResponse.json({ ok: true, leadId: lead?.id ?? null });
}
