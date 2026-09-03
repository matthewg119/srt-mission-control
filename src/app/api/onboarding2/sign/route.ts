// The signature. The one route where the ORDER of the side effects is the design.
//
// GUARD ORDER, CHEAPEST FIRST, AND IT IS LOAD-BEARING: honeypot, time trap, per-IP ledger, then
// the real work. Copied from api/onboardingfree/submit and api/clients/start, both of which say
// the same thing in their headers. Do not reorder and do not add a path that skips it.
//
// ‼️ THE CLAIM AT STEP 9 IS THE ONLY WRITER OF signed_at ANYWHERE. It is a conditional update,
// .is("signed_at", null), so two concurrent requests cannot both win. The loser falls into the
// replay branch and gets the same PDF rather than a second signature and a second startPilot.
//
// ‼️ EVERYTHING AFTER THE CLAIM IS A SIDE EFFECT AND NONE OF IT MAY COST THE SIGNATURE. The
// signature is durable the instant the claim returns. Every step below is caught, collected as a
// warning, and said out loud in Slack. That is startPilot's own doctrine applied one level up.
//
// ‼️ A waitUntil STEP CAN BE KILLED ON A COLD INSTANCE. Nothing after the claim may be required
// for the signature to be valid, and the Slack card is the only place a lost side effect becomes
// visible, which is why the card states what did and did not happen rather than assuming.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { clean, validEmail } from "@/lib/medspa/validate";

import { loadByToken, overSignLimit, patchDelivery } from "@/lib/onboarding2/session";
import { freezeInitials, loadInitials, missingSections } from "@/lib/onboarding2/initials";
import { renderAgreementPdf, signedRecordFrom } from "@/lib/onboarding2/agreement-pdf";
import { provisionFromSigning } from "@/lib/onboarding2/provision";
import { sendSignerCopy, sendSrtCopy } from "@/lib/onboarding2/email";
import { signedCard } from "@/lib/onboarding2/card";
import { openOpsThread } from "@/lib/onboarding2/delivery";
import { leadEmailFor, upsertLead } from "@/lib/onboarding2/lead";
import { safeEqual } from "@/lib/onboarding2/canonical";
import { isDemoRequest } from "@/lib/onboarding2/demo";
import {
  BUCKET,
  MIN_FILL_SECONDS,
  appUrl,
  onboardingChannel,
  pdfKeyFor,
} from "@/lib/onboarding2/constants";
import type { Onboarding2SigningRow } from "@/lib/onboarding2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Load-bearing twice here, not once. Without it the per-IP ledger reads stale AND so does the
// signed_at check, which is two signatures and two startPilot calls for one person.
export const fetchCache = "force-no-store";
// The PDF, two Graph sends, and startPilot's DNS lookup, geocode and Slack post.
export const maxDuration = 300;

/**
 * ‼️ BUILT FROM THE REQUEST'S OWN ORIGIN, NOT FROM NEXT_PUBLIC_APP_URL.
 *
 * That env var names production. On a preview deployment it would hand a tester a link into
 * mission.srtagency.com, which is a different build of this app, and the difference would only
 * show up as a confusing 404 halfway through a test run. The origin is always the deployment the
 * person is actually on. appUrl() stays the fallback for the impossible case of no origin.
 */
function documentUrlFor(req: NextRequest, id: string, token: string): string {
  const base = req.nextUrl.origin || appUrl();
  return `${base}/api/onboarding2/document/${id}?t=${encodeURIComponent(token)}`;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // 1. Honeypot. Silent success.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true, signingId: null });
  }

  // 2. Time trap on the final screen.
  const renderedAt = Number(body.renderedAt);
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_SECONDS * 1000) {
    return NextResponse.json({ ok: true, signingId: null });
  }

  // 3. Per-IP ledger. Tight: signing three contracts from one connection in a day is a story.
  const ipHash = hashIp(clientIpFrom(req));
  if (await overSignLimit(ipHash)) {
    return NextResponse.json(
      { ok: false, error: "That has already come through. Reply to our email instead." },
      { status: 429 }
    );
  }

  // 4. Load.
  const token = clean(body.sessionToken, 128);
  const row = await loadByToken(token);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  // 5. REPLAY BRANCH, NOT AN ERROR. A double-tapped button gets the same document back.
  if (row.signed_at) {
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      signingId: row.id,
      documentUrl: documentUrlFor(req, row.id, row.session_token),
    });
  }

  // 6. The document echo.
  const echoed = clean(body.documentSha256, 64);
  if (!echoed || !safeEqual(echoed, row.agreement_sha256)) {
    return NextResponse.json({ ok: false, error: "text_changed" }, { status: 409 });
  }

  // 7. Coverage. THIS IS THE CHECK THAT MAKES THE PER-PAGE INITIALS MEAN ANYTHING. Without it a
  // hand-crafted POST straight here produces a signed agreement nobody paged through, and every
  // initial printed in the PDF would be decoration.
  //
  // ‼️ IT STILL COUNTS IN SECTIONS, NOT PAGES, AFTER THE 2026-09-03 MOVE TO PER-PAGE INITIALS,
  // AND THAT IS THE POINT. One initial now covers a range, so coverageOf() expands each row's
  // page_sections; this call site and missingSections() are unchanged. A page was accepted only
  // after the browser echoed a hash computed over every clause on it, so the text attested to is
  // identical to what nine section initials attested to. `missing` is a list of SECTION numbers.
  const initialRows = await loadInitials(row.id);
  const missing = missingSections(
    initialRows,
    row.agreement_snapshot.sections.map((s) => s.n)
  );
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: "initials_incomplete", missing },
      { status: 409 }
    );
  }

  // 8. The typed fields.
  //
  // ‼️ ONLY THREE THINGS COME OFF THE REQUEST NOW: THE SIGNATURE, THE DATE AND THE ADDRESS
  // (2026-09-03). Name, company, title, email and phone were collected on screen one and live on
  // this row already. Accepting them here again would mean the signature screen had to ask for
  // them again, which is the exact duplicate-question fault this pass removed, and it would also
  // let a crafted request sign one company's agreement under another company's name.
  const signatureTyped = clean(body.signatureTyped, 160);
  if (!signatureTyped) {
    return NextResponse.json({ ok: false, error: "Type your name to sign." }, { status: 400 });
  }

  // Read, never taken. clients.legal_name is NOT NULL and startPilot falls back to the email
  // address, which would put an email where a company name goes on every board in Mission Control.
  const printName = clean(row.contact_name, 120);
  const businessLegalName = clean(row.business_legal_name, 200);
  const contactEmail = clean(row.contact_email || row.email, 254).toLowerCase();

  // Missing means screen one was never completed on this session, which the funnel cannot produce
  // and a crafted request can. Sending them back to screen one is the only correct answer.
  if (!printName || !businessLegalName || !contactEmail || !validEmail(contactEmail)) {
    return NextResponse.json({ ok: false, error: "identity_missing" }, { status: 400 });
  }

  // 9. THE CLAIM. The only writer of signed_at.
  const now = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("onboarding2_signings")
    .update({
      status: "signed",
      signed_at: now,
      signed_ip_hash: ipHash,
      signed_user_agent: clean(req.headers.get("user-agent"), 500) || null,
      signature_typed: signatureTyped,
      // Screen one's name IS the printed name. There is no second box to type it into.
      print_name: printName,
      address_line1: clean(body.addressLine1, 200) || null,
      address_city: clean(body.addressCity, 120) || null,
      address_state: clean(body.addressState, 60) || null,
      address_postal: clean(body.addressPostal, 20) || null,
      signed_date: clean(body.signedDate, 40) || null,
      initials_snapshot: freezeInitials(initialRows, row.agreement_snapshot.sections),
      updated_at: now,
    })
    .eq("id", row.id)
    .is("signed_at", null)
    .select("*")
    .maybeSingle();

  if (!claimed) {
    // Somebody else won the race. Same answer as the replay branch.
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      signingId: row.id,
      documentUrl: documentUrlFor(req, row.id, row.session_token),
    });
  }

  const signed = claimed as Onboarding2SigningRow;
  const documentUrl = documentUrlFor(req, signed.id, signed.session_token);

  // ── From here down, nothing may cost the signature. ──

  // 10. The PDF, inline, so the response can hand back a link that already works.
  let pdf: Buffer | null = null;
  try {
    pdf = renderAgreementPdf(signed.agreement_snapshot, signedRecordFrom(signed));
    const key = pdfKeyFor(signed.id);
    const up = await supabaseAdmin.storage.from(BUCKET).upload(key, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (up.error) {
      console.error("[onboarding2/sign] pdf upload failed:", up.error.message);
    } else {
      await patchDelivery(signed.id, {
        pdf_path: key,
        // Describes THIS rendering only. jsPDF stamps a CreationDate, so the bytes are not
        // reproducible and nothing may verify anything against this.
        pdf_sha256: crypto.createHash("sha256").update(pdf).digest("hex"),
        pdf_generated_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error("[onboarding2/sign] pdf render failed:", (e as Error).message);
  }

  // 11 to 15. Provisioning is slow and the signer is watching a screen.
  //
  // ‼️ BOTH EMAILS RUN IN HERE, AFTER PROVISIONING, AND NOT INLINE ABOVE. The signer's copy has
  // to carry the /onboarding?t=... intake link, and that link does not exist until startPilot has
  // minted it. Sending the receipt first would mean posting a contract copy with the next step
  // missing from it, and then a second email to correct that.
  //
  // ‼️ ON A PREVIEW OR ON LOCALHOST, NONE OF IT RUNS. The signature, the snapshot, the initials
  // and the PDF above are all real; what demo mode suppresses is everything that ESCAPES: no
  // startPilot so no client row and no seat spent, no ingestLead so nothing reaches contacts or
  // #hot-leads, no Slack, no email. The card is logged instead so a test run can still be read.
  if (isDemoRequest(req)) {
    console.info(
      `[onboarding2 DEMO] signature ${signed.id} recorded. No client, no CRM, no Slack, no email.`
    );
  } else {
    waitUntil(finishSigning({ signed, pdf, documentUrl }));
  }

  return NextResponse.json({
    ok: true,
    demo: signed.is_demo,
    signingId: signed.id,
    documentUrl,
    prefill: {
      businessLegalName: signed.business_legal_name,
      printName: signed.print_name,
      email: signed.contact_email,
      phone: signed.contact_phone,
      title: signed.signer_title,
    },
  });
}

/**
 * Provision, tell Slack, send the internal copy.
 *
 * Ordering: provision first, so the card can carry the intake link and the real outcome rather
 * than a card that says "provisioning" and never gets edited.
 */
async function finishSigning(args: {
  signed: Onboarding2SigningRow;
  pdf: Buffer | null;
  documentUrl: string;
}): Promise<void> {
  const { signed, pdf } = args;

  const provision = await provisionFromSigning(signed).catch((e) => ({
    ok: false,
    clientId: null,
    slug: null,
    onboardingUrl: null,
    contactId: null,
    alreadyProvisioned: false,
    error: (e as Error).message,
    warnings: [(e as Error).message],
  }));

  if (provision.clientId || provision.contactId) {
    await patchDelivery(signed.id, {
      client_id: provision.clientId,
      contact_id: provision.contactId,
    });
  }

  await upsertLead({
    email: leadEmailFor(signed),
    signed_at: signed.signed_at,
    business_name: signed.business_legal_name,
    contact_name: signed.print_name,
    signer_title: signed.signer_title,
    phone: signed.contact_phone,
    city: signed.address_city,
    state: signed.address_state,
    client_id: provision.clientId,
    contact_id: provision.contactId,
  }).catch(() => null);

  // The receipt, now that there is an intake link to put in it.
  const emailedSigner = pdf
    ? await sendSignerCopy({
        row: signed,
        pdf,
        onboardingUrl: provision.onboardingUrl,
        documentUrl: args.documentUrl,
      })
    : false;
  if (emailedSigner) await patchDelivery(signed.id, { emailed_signer_at: new Date().toISOString() });

  const emailedSrt = pdf
    ? await sendSrtCopy({
        row: signed,
        pdf,
        clientId: provision.clientId,
        onboardingUrl: provision.onboardingUrl,
        provisionError: provision.error,
      })
    : false;
  if (emailedSrt) await patchDelivery(signed.id, { emailed_srt_at: new Date().toISOString() });

  // The card. TOP LEVEL, and it stays that way.
  //
  // ‼️ ITS ts IS *NOT* clients.ops_thread_ts. See openOpsThread() in lib/onboarding2/delivery.ts:
  // postDeliveryChecklist edits the ops thread message in place to become the board header, so
  // pointing ops_thread_ts here would erase this card the moment the board opened. The ops
  // thread is a separate message, posted just below.
  const channel = onboardingChannel();
  const card = signedCard({
    row: signed,
    provision,
    emailedSigner,
    emailedSrt,
    documentUrl: args.documentUrl,
  });

  if (!channel) {
    console.error(
      "[onboarding2/sign] SLACK_CLIENT_ONBOARDING_CHANNEL unset. Card:\n" + card.text
    );
    return;
  }

  const posted = await slack.postMessage(channel, card.text, card.blocks).catch((e) => {
    console.error("[onboarding2/sign] slack post failed:", (e as Error).message);
    return null;
  });

  // slackFetch never throws, so ok has to be checked rather than assumed.
  const ts = posted && posted.ok ? (posted.ts as string) : null;
  if (ts) await patchDelivery(signed.id, { slack_channel: channel, slack_thread_ts: ts });

  // ── The ops thread ──
  //
  // ‼️ OPENED AT SIGNATURE, BUT THE BOARD DOES NOT. Matthew's call, 2026-09-02: startPilot and
  // the ops thread happen the moment somebody signs, so an abandoned chat is still visible in
  // Slack; seedDeliverySteps and intake_received wait for the ninth answer, because
  // intake_received's verifier needs clients.intake_completed_at and four steps are blocked
  // behind it. Opening a board on a half-finished intake produces one stalled on step 1.
  //
  // postDeliveryChecklist REFUSES outright when ops_thread_ts is null (delivery-checklist.ts:222),
  // so if this post fails the board never opens later. That is why the failure is a warning in
  // the thread rather than a silent log.
  if (provision.clientId) {
    const ops = await openOpsThread({
      clientId: provision.clientId,
      name: signed.business_legal_name || signed.contact_name || signed.print_name || "New client",
    }).catch((e) => ({ ts: null, warning: (e as Error).message }));

    if (ops.warning && ts) {
      await slack
        .postThreadReply(
          channel,
          ts,
          [
            `:warning: The ops thread did not open: ${ops.warning}`,
            "The delivery board cannot post until it does.",
          ].join("\n")
        )
        .catch(() => null);
    }
  }
}
