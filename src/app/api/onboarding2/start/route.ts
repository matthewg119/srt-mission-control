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
import { loadByToken, mintSessionToken, overStartLimit } from "@/lib/onboarding2/session";
import { coverageOf, loadInitials, pageCoverageOf } from "@/lib/onboarding2/initials";
import { pagesOf } from "@/lib/onboarding2/snapshot";
import { attributionForSigning } from "@/lib/onboarding2/lead";
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

  const snapshot = await buildSnapshot();
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
