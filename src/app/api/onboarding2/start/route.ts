// Open a signing session, and FREEZE THE AGREEMENT INTO IT.
//
// This is the only route in the codebase that reads the live agreement template. Everything
// downstream, every screen, the PDF and the grounded chatbot, reads the snapshot this route
// stored. See src/lib/onboarding2/snapshot.ts for why the snapshot is taken here rather than at
// signature.
//
// ‼️ NO TIME TRAP HERE. This fires on page load, before a human has done anything, so a fill-time
// check would be measuring the browser rather than a person. The time trap lives on
// /api/onboarding2/email, which is the first human action in the flow.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { clean } from "@/lib/medspa/validate";
import { buildSnapshot } from "@/lib/onboarding2/snapshot";
import { isOfferKey, type OfferKey } from "@/config/pitch";
import { loadByToken, mintSessionToken, overStartLimit } from "@/lib/onboarding2/session";
import { coverageOf, loadInitials, pageCoverageOf } from "@/lib/onboarding2/initials";
import { pagesOf } from "@/lib/onboarding2/snapshot";
import { attributionForSigning, upsertLead } from "@/lib/onboarding2/lead";
import { parseIntake } from "@/lib/onboarding2/intake-steps";
import { NO_WEBSITE_OPTION } from "@/config/onboarding2";
import { ingestLead, pageFromRequest } from "@/lib/lead-intake";
import { isDemoRequest } from "@/lib/onboarding2/demo";
import type { AgreementSnapshot } from "@/lib/onboarding2/snapshot";
import type { Attribution, Onboarding2SigningRow } from "@/lib/onboarding2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// force-dynamic governs the ROUTE cache and does not cover supabase-js, which calls the global
// fetch that Next patches. Without this the per-IP ledger below can be read from a snapshot
// seconds old, which is the whole gate.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // 1. Honeypot. Silent success: a bot that gets an error learns where the gap is, one that gets
  // a cheerful 200 learns nothing.
  if (clean(body.company_url_hp, 200)) {
    return NextResponse.json({ ok: true, sessionToken: null, limited: false });
  }

  // 2. RESUME BEFORE ANYTHING ELSE.
  //
  // ‼️ WITHOUT THIS, A PAGE REFRESH IS A CATASTROPHE ON A FOURTEEN-SCREEN FORM. It would mint a
  // second session, orphan every initial already recorded against the first, and burn one of the
  // five daily starts this IP is allowed, so a signer who refreshed a few times would lock
  // themselves out of their own contract. Checked BEFORE the ledger for the same reason
  // api/clients/start checks for an existing client before its rate limit: somebody must never
  // be refused by their own earlier visit.
  //
  // ‼️ IT RETURNS THE STORED SNAPSHOT, NOT A FRESH ONE. That is the whole design holding: a
  // session that opened before a template edit keeps reading the version it opened with, and the
  // hash echoes keep matching. Rebuilding here would silently swap the document under somebody
  // mid-read, which is exactly what the snapshot exists to prevent.
  const resumed = await loadByToken(body.resume as string);
  if (resumed && !resumed.signed_at) {
    return NextResponse.json(await sessionPayload(resumed, true));
  }

  // 3. Per-IP ledger. clientIpFrom deliberately does NOT trust x-forwarded-for[0]: Vercel
  // appends the real IP, so index 0 is attacker-controlled. hashIp never stores a raw address;
  // this column is a rate-limit ledger, not a visitor log.
  const ipHash = hashIp(clientIpFrom(req));
  if (await overStartLimit(ipHash)) {
    // 200, not 429. The page renders a plain "reply to our email instead" card, and a bot
    // learns nothing from a success it cannot use.
    return NextResponse.json({ ok: true, sessionToken: null, limited: true });
  }

  // 4. THE OFFER. Required, validated against the closed list, and never defaulted.
  //
  // ‼️ A DEFAULT HERE WOULD BE A CLIENT SIGNED ONTO TERMS NOBODY QUOTED THEM. The three
  // offers are three different arrangements, not three prices, so "whichever one the code picked
  // when the field was missing" is not a recoverable mistake: it decides whether there is a
  // guarantee, whether a refund exists, and what the fee is. A missing or unknown offer is a 400.
  //
  // ‼️ 400 IS SAFE TO RETURN HERE AND THE RATE LIMIT ABOVE IS NOT. The ledger answers 200 so a
  // bot learns nothing from a refusal it could use. This is a malformed request from our own
  // client, not a probe, and the picker cannot send one: it posts a key off OFFERS.
  const offer = body.offer;
  if (!isOfferKey(offer)) {
    console.error("[onboarding2/start] bad offer:", JSON.stringify(offer));
    return NextResponse.json({ ok: false, error: "bad_offer" }, { status: 400 });
  }

  // 5. THE IDENTITY, WHEN THE CONVERSATION TOOK IT BEFORE THE OFFER.
  //
  // ‼️ VALIDATED HERE AND NOT TRUSTED FROM THE BROWSER, even though the browser validated it too.
  // The client copy exists so somebody gets told about a typo while they are still looking at the
  // box; this one exists because it is the only one an attacker cannot skip. Same functions the
  // chat route runs through parseIntake, so a value this route accepts is a value that lane can
  // already use.
  //
  // ‼️ UNPARSEABLE MEANS OMITTED, NOT REFUSED. A 400 here would strand somebody who has already
  // answered four questions and chosen an offer, over a field the chat can simply ask for again:
  // nextIntakeStep() walks the columns and re-asks whichever one is still null. The offer, by
  // contrast, IS a 400 above, because there is no way to re-ask it without re-freezing a document.
  const identity = readIdentity(body.identity);

  const snapshot = await buildSnapshot(offer as OfferKey);
  const sessionToken = mintSessionToken();
  // Host decides, and only the host. See src/lib/onboarding2/demo.ts.
  const isDemo = isDemoRequest(req);
  const attribution = body.attribution as Attribution | undefined;

  const { data, error } = await supabaseAdmin
    .from("onboarding2_signings")
    .insert({
      session_token: sessionToken,
      status: "open",
      agreement_snapshot: snapshot,
      template_version: snapshot.version,
      agreement_sha256: snapshot.documentSha256,
      offer_key: offer,
      concierge_interest: body.conciergeInterest === true,
      // ‼️ VALIDATED AGAINST CLOSED LISTS AND NULL ON ANYTHING ELSE, THE WAY `offer` IS. These two
      // are not authorisation, so an unknown value is not a 400 the way a bad offer is: the worst a
      // junk `?v=` can do is mislabel a row in a presentation test. But an unvalidated string from
      // a query param going straight into a column is how a column stops being a closed list, and
      // then the report that groups by it grows a long tail of one-row buckets nobody can read.
      funnel_variant: variantOrNull(body.funnelVariant),
      upsell_outcome: outcomeOrNull(body.upsellOutcome),
      started_ip_hash: ipHash,
      is_demo: isDemo,
      ...attributionForSigning(attribution),
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[onboarding2/start] insert failed:", error?.message);
    return NextResponse.json({ ok: false, error: "Could not start. Try again." }, { status: 500 });
  }

  // ── The conversation-first funnel hands over four answers it already took ──
  //
  // ‼️ NOTHING BELOW IS ALLOWED TO FAIL THE REQUEST, AND THAT IS THE WHOLE SHAPE OF IT. The
  // signing row is already written and the session token is already minted; the only thing the
  // caller is waiting for is permission to open the chat. A Slack outage, a missing column or a
  // duplicate contact must never turn into "Could not start your session" in front of somebody who
  // has just typed their phone number in. Every failure logs and continues, exactly as
  // lib/lead-intake.ts does internally for the same reason.
  //
  // ‼️ THE COLUMNS ARE PATCHED AFTER THE INSERT RATHER THAN SPREAD INTO IT. An insert that fails
  // loses the session; a patch that fails loses four fields the conversation can ask for again.
  if (identity) {
    await writeIdentity(data.id as string, identity, offer as OfferKey, isDemo, req, attribution);
  }

  return NextResponse.json({
    ok: true,
    limited: false,
    resumed: false,
    demo: isDemo,
    sessionToken,
    signingId: data.id as string,
    identity: null,
    initialledSections: [],
    initialledPages: [],
    // The browser renders THIS and hashes THIS. It never hashes the DOM.
    agreement: publicAgreement(snapshot),
  });
}

/** The four answers the conversation-first funnel takes before the offer. */
interface PreOfferIdentity {
  contactName: string;
  /** The typed site, or null when they tapped the "I don't have a website" button. */
  website: string | null;
  /** E.164. The form every system downstream joins on. */
  phone: string;
  phoneTyped: string;
  email: string;
  /** They have no site AND ticked the free-build box. Only ever true when website is null. */
  wantsFreeWebsite: boolean;
}

/**
 * Read and validate the pre-offer identity, or null.
 *
 * ‼️ ALL FOUR OR NONE. A half-filled identity would write a signing row with a name and no email,
 * which nextIntakeStep() then walks into by asking for the email, which is correct; but it would
 * ALSO mean ingestLead() below fires with nothing to key a contact on. The conversation only ever
 * sends this block once it has all four, so a partial block is a malformed request rather than a
 * state to support, and dropping it entirely puts the chat back in charge of asking.
 */
function readIdentity(raw: unknown): PreOfferIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const name = parseIntake("name", clean(o.contactName, 200));
  const email = parseIntake("email", clean(o.email, 300));
  const phone = parseIntake("phone", clean(o.phone, 60));
  if (!name.ok || !email.ok || !phone.ok) return null;

  // ‼️ THE BUTTON IS MATCHED AGAINST THE EXPORTED CONSTANT, NOT AGAINST ITS OWN WORDS. Comparing
  // to a literal here would silently start rejecting the answer the button produces the first time
  // somebody rewords it in config/onboarding2.ts.
  const typedSite = clean(o.website, 400);
  const noSite = typedSite === NO_WEBSITE_OPTION || typedSite === "";
  const site = noSite ? null : parseIntake("website", typedSite);
  if (site && !site.ok) return null;

  return {
    contactName: name.value,
    website: site && site.ok ? site.value : null,
    phone: phone.value,
    phoneTyped: String(phone.extra?.typed ?? phone.value),
    email: email.value,
    // A free build can only be wanted by somebody who has no site. Anything else is a stale flag
    // from a back button, and honouring it would put "wants a free website" on a Slack card beside
    // the URL of the website they already have.
    wantsFreeWebsite: noSite && o.wantsFreeWebsite === true,
  };
}

/**
 * Put the four answers on the signing row, open the lead, and post the hot lead.
 *
 * ‼️ THE HOT LEAD IS THE POINT OF THE WHOLE REORDER. Under the old order the first durable trace
 * of a visitor was the signing row created when they tapped an offer card, so somebody who read
 * the offer and left was, to us, nobody. Here the four answers are already in, so this fires the
 * moment the offer is chosen and, more importantly, the DATA to fire it with exists from the
 * moment the email lands. If the offer sheet is ever made abandonable, this same call moves
 * earlier without changing shape.
 *
 * ‼️ ingestLead() IS THE SHARED STACK, NOT A SECOND IMPLEMENTATION. Contact upsert, timeline note,
 * top-level #hot-leads post with a detail reply in the thread, and the Speed-to-Lead RingOut, all
 * exactly as /aivisibility and the audit intake already get them. A bespoke Slack call here would
 * be a second lead lane to keep in step with the first.
 */
async function writeIdentity(
  signingId: string,
  id: PreOfferIdentity,
  offer: OfferKey,
  isDemo: boolean,
  req: NextRequest,
  attribution: Attribution | undefined
): Promise<void> {
  try {
    await supabaseAdmin
      .from("onboarding2_signings")
      .update({
        contact_name: id.contactName,
        website: id.website,
        contact_phone: id.phone,
        contact_phone_typed: id.phoneTyped,
        email: id.email,
        contact_email: id.email,
      })
      .eq("id", signingId);
  } catch (e) {
    console.error("[onboarding2/start] identity patch failed:", (e as Error).message);
  }

  let leadId: string | null = null;
  try {
    const lead = await upsertLead({
      email: id.email,
      contact_name: id.contactName,
      website: id.website,
      phone: id.phone,
      signing_id: signingId,
      is_demo: isDemo,
      offer_key: offer,
    });
    leadId = lead?.id ?? null;
    if (leadId) {
      await supabaseAdmin.from("onboarding2_signings").update({ lead_id: leadId }).eq("id", signingId);
    }
  } catch (e) {
    console.error("[onboarding2/start] lead upsert failed:", (e as Error).message);
  }

  // ‼️ ITS OWN PATCH, AND A FAILURE HERE IS INERT RATHER THAN FATAL. `wants_free_website` arrives
  // with the migration at the bottom of this file's PR. Until that has run, this update errors,
  // the catch swallows it, and every other part of the funnel behaves exactly as it does today.
  // Folding the column into the upsert above would have made the whole lead row undeployable
  // ahead of the migration, which is the trap docs/2026-09-29-onboarding2-upsell-variants.sql
  // records for funnel_variant.
  if (id.wantsFreeWebsite && leadId) {
    try {
      await supabaseAdmin
        .from("onboarding2_leads")
        .update({ wants_free_website: true })
        .eq("id", leadId);
    } catch (e) {
      console.error("[onboarding2/start] free-website flag failed:", (e as Error).message);
    }
  }

  // ‼️ DEMO RUNS WRITE ROWS AND SEND NOTHING. The whole reason demo mode is decided server-side
  // (lib/onboarding2/demo.ts) is that a preview should run every line production runs; what it must
  // not do is ring Matthew's phone and open a #hot-leads thread for a test.
  if (isDemo) return;

  try {
    const parts = id.contactName.trim().split(/\s+/);
    await ingestLead({
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      email: id.email,
      phone: id.phone,
      website: id.website ?? undefined,
      source: "onboarding2",
      sourcePage: pageFromRequest(req, "/onboarding2/start"),
      noteTitle: "Started onboarding",
      headline: `Started the onboarding conversation and chose ${offer}.`,
      detailLines: [
        `Offer: ${offer}`,
        `Website: ${id.website ?? (id.wantsFreeWebsite ? "none, asked for a free build" : "none")}`,
        `Phone: ${id.phoneTyped}`,
        // ‼️ ON THE CARD BECAUSE IT IS A JOB, NOT A PREFERENCE. A tick here is a promise that a few
        // website options land in their inbox within four hours, and the only thing that makes that
        // true is a person reading this line.
        ...(id.wantsFreeWebsite ? ["ACTION: send free website options within 4 hours."] : []),
      ],
      speedToLead: true,
      utmSource: attribution?.utmSource,
      utmMedium: attribution?.utmMedium,
      utmCampaign: attribution?.utmCampaign,
      utmContent: attribution?.utmContent,
    });
  } catch (e) {
    console.error("[onboarding2/start] hot lead failed:", (e as Error).message);
  }
}

/**
 * Which of the six free-first presentations this session saw, or null.
 *
 * ‼️ THE LIST IS RESTATED HERE RATHER THAN IMPORTED FROM app/onboarding2/free/variants.ts, AND
 * THAT DUPLICATION IS DELIBERATE. That module is a "use client" neighbour full of Tailwind class
 * literals and JSX-shaped records; importing it into a route handler would pull a client module
 * into the server bundle to read six one-character strings. The cost of the duplication is bounded
 * because these are not names, they are the first six integers, and the column's comment in
 * docs/2026-09-29-onboarding2-upsell-variants.sql records the same range.
 */
function variantOrNull(v: unknown): string | null {
  return typeof v === "string" && ["1", "2", "3", "4", "5", "6"].includes(v) ? v : null;
}

/** Where the upsell ladder ended, or null for a session that never saw it. */
function outcomeOrNull(v: unknown): string | null {
  const allowed = ["accepted_year", "accepted_month", "declined", "free_direct"];
  return typeof v === "string" && allowed.includes(v) ? v : null;
}

/** The snapshot as the browser gets it. Every field it needs to render and to re-hash. */
function publicAgreement(s: AgreementSnapshot) {
  return {
    version: s.version,
    canon: s.canon,
    title: s.title,
    preamble: s.preamble,
    promise: s.promise,
    sections: s.sections,
    // ‼️ THE GROUPING TRAVELS WITH THE TEXT. The browser lays the document out from this and
    // hashes each page from this, so what it renders and what it attests to cannot come apart.
    // pagesOf() synthesises one-section pages for a snapshot frozen before pages existed, so an
    // old tab that is still open keeps working through this deploy.
    pages: pagesOf(s),
    closing: s.closing,
    footer: s.footer,
    documentSha256: s.documentSha256,
  };
}

/**
 * A resumed session, with enough state for the client to land on the right screen.
 *
 * ‼️ THE WHOLE IDENTITY COMES BACK, NOT JUST THE EMAIL (2026-09-03). Screen one now collects
 * name, company, title, website, email and phone, and a refresh must repopulate every one of
 * them. Handing back only the email would put somebody who reloaded on screen one with five empty
 * boxes and ask them to type it all a second time, which is the exact fault this whole pass
 * exists to remove.
 */
async function sessionPayload(row: Onboarding2SigningRow, resumed: boolean) {
  const rows = await loadInitials(row.id);
  return {
    ok: true,
    limited: false,
    resumed,
    demo: row.is_demo,
    sessionToken: row.session_token,
    signingId: row.id,
    identity: identityOf(row),
    initialledSections: Array.from(coverageOf(rows)).sort((a, b) => a - b),
    initialledPages: Array.from(pageCoverageOf(rows)).sort((a, b) => a - b),
    agreement: publicAgreement(row.agreement_snapshot),
  };
}

/** Screen one, as stored. Null until they have completed it. */
function identityOf(row: Onboarding2SigningRow) {
  if (!row.email) return null;
  return {
    contactName: row.contact_name ?? "",
    businessLegalName: row.business_legal_name ?? "",
    signerTitle: row.signer_title ?? "",
    website: row.website ?? "",
    email: row.email,
    // The typed form, not the E.164 one. This goes back into an input somebody reads.
    phone: row.contact_phone_typed ?? row.contact_phone ?? "",
  };
}
