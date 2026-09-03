// One PAGE, initialled.
//
// ‼️ A PAGE IS A RANGE OF SECTIONS, AND THE HASH ECHO IS WHAT STOPS THAT BEING A WEAKER CLAIM
// (2026-09-03). Nine clauses lay out as four pages, so a signature is four initials. The browser
// sends the hash of the WHOLE page it painted, computed over every clause on it, and that must
// equal the page hash frozen into the snapshot at POST /start. Four page hashes over
// {1} {2,3} {4,5,6} {7,8,9} attest to exactly the same characters nine section hashes did, joined
// on the same separator, so nothing about what was attested to has moved. What fell is how many
// times somebody types two letters.
//
// ‼️ THE PAGE GROUPING COMES OFF THE SNAPSHOT, NEVER OFF THE REQUEST. `pageSections` is checked
// against the snapshot rather than trusted, and the row stores the SNAPSHOT's list. A client that
// could declare which sections its initial covered could cover all nine with one tap.
//
// ‼️ NO HONEYPOT AND NO TIME TRAP HERE, AND THAT IS DELIBERATE. A bot that already got a valid
// session token past /start and /email is not stopped by a third honeypot. The real bounds on
// this route are the hash echo and the coverage check at signature, which is what makes a
// hand-crafted POST straight to /sign fail.

import { NextRequest, NextResponse } from "next/server";
import { clean } from "@/lib/medspa/validate";
import { loadByToken } from "@/lib/onboarding2/session";
import { pageOf, sectionOf } from "@/lib/onboarding2/snapshot";
import {
  coverageOf,
  loadInitials,
  pageCoverageOf,
  recordInitial,
  validInitials,
} from "@/lib/onboarding2/initials";
import { safeEqual } from "@/lib/onboarding2/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const row = await loadByToken(body.sessionToken as string);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (row.signed_at) {
    return NextResponse.json({ ok: false, error: "already_signed" }, { status: 409 });
  }

  const pageNo = Number(body.pageNo);
  const page = Number.isFinite(pageNo) ? pageOf(row.agreement_snapshot, pageNo) : null;
  if (!page) {
    return NextResponse.json({ ok: false, error: "Unknown page." }, { status: 400 });
  }

  // ‼️ THE COVERED LIST TRAVELS AND HAS TO AGREE EXACTLY. It is not used to decide anything, the
  // snapshot decides; it is checked so that a client rendering a different grouping than the one
  // it is about to attest to is a 400 rather than a row claiming coverage it never showed anyone.
  const claimedSections = Array.isArray(body.pageSections)
    ? (body.pageSections as unknown[]).map((v) => Number(v))
    : null;
  if (
    !claimedSections ||
    claimedSections.length !== page.sections.length ||
    claimedSections.some((n, i) => n !== page.sections[i])
  ) {
    return NextResponse.json({ ok: false, error: "Unknown page." }, { status: 400 });
  }

  // The echo. Constant-time, and the only thing standing between a stale tab and a record that
  // says somebody initialled wording they never saw.
  const echoed = clean(body.pageSha256, 64);
  if (!echoed || !safeEqual(echoed, page.sha256)) {
    return NextResponse.json({ ok: false, error: "text_changed" }, { status: 409 });
  }

  const initials = clean(body.initials, 12);
  if (!validInitials(initials)) {
    return NextResponse.json(
      { ok: false, error: "Initials should be one to six letters." },
      { status: 400 }
    );
  }

  const clientNonce = clean(body.clientNonce, 40);
  if (!UUID.test(clientNonce)) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const dwellRaw = Number(body.dwellMs);
  const dwellMs =
    Number.isFinite(dwellRaw) && dwellRaw >= 0 ? Math.min(Math.trunc(dwellRaw), 86_400_000) : null;

  // The page's first section, so section_no, section_key and section_sha256 stay populated and
  // the existing index keeps meaning something.
  const first = sectionOf(row.agreement_snapshot, page.sections[0]);
  if (!first) {
    return NextResponse.json({ ok: false, error: "Unknown page." }, { status: 400 });
  }

  const result = await recordInitial({
    signingId: row.id,
    pageNo: page.p,
    // From the snapshot. Never `claimedSections`, which was only ever checked, not trusted.
    pageSections: page.sections,
    pageSha256: page.sha256,
    firstSectionNo: first.n,
    firstSectionKey: first.key,
    firstSectionSha256: first.sha256,
    initials,
    dwellMs,
    clientNonce,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Could not save that." }, { status: 500 });
  }

  // Read the coverage back rather than tracking a counter, so what the client shows and what the
  // signature check will count are the same numbers from the same source. Sections AND pages: the
  // coverage check speaks in sections, the screen ticks off pages, and deriving both here means
  // the client never has to expand a range itself.
  const rows = await loadInitials(row.id);
  return NextResponse.json({
    ok: true,
    duplicate: result.duplicate,
    initialledSections: Array.from(coverageOf(rows)).sort((a, b) => a - b),
    initialledPages: Array.from(pageCoverageOf(rows)).sort((a, b) => a - b),
  });
}
