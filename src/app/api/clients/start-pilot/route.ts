// "Start pilot", the only caller of startPilot() today.
//
// AUTHENTICATED. src/middleware.ts guards /dashboard/* but NOT /api/*, so a route that
// provisions a client, creates a Slack channel and emails someone has to check the
// session itself. Same pattern as src/app/api/crm/leads/[id]/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { checkEmail, checkPhone, checkCity, checkState, checkPostalCode, checkAddressLine1 } from "@/lib/validate/intake-fields";
import { auth } from "@/lib/auth";
import { waitUntil } from "@vercel/functions";
import { startPilot } from "@/lib/clients/provision";
import { announceClientStart, openClientBoard } from "@/lib/clients/open-board";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Provisioning does DNS, Slack, Graph and Zoho work in sequence, then the board opens in waitUntil.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const tierScope = str(body.tierScope) === "core" ? "core" : "complete";

  // ‼️ VALIDATED BEFORE THE DUPLICATE LOOKUP, NOT AFTER.
  //
  // findDuplicates() matches on the email and the domain, so running it against a malformed
  // address answers "no duplicates" for a reason that has nothing to do with whether one exists,
  // and the caller then creates a second client for a business that already has one. Checking
  // first also means a typo costs a retype rather than a 409 that looks like a real conflict.
  //
  // Only the contact details are required. The address fields are optional here on purpose: this
  // door creates a client that intake step 1 completes minutes later, and startPilot() itself
  // accepts an email alone. What is refused is a value that is WRONG, never one that is absent.
  const fieldChecks: [string, { ok: boolean; error?: string }][] = [
    ["email", checkEmail(str(body.email))],
    ["phone", checkPhone(str(body.phone), false)],
    ["city", checkCity(str(body.city), false)],
    ["state", checkState(str(body.state), false)],
    ["postalCode", checkPostalCode(str(body.postalCode), false)],
    ["addressLine1", checkAddressLine1(str(body.addressLine1), false)],
  ];

  const fieldErrors: Record<string, string> = {};
  for (const [field, verdict] of fieldChecks) {
    if (!verdict.ok && verdict.error) fieldErrors[field] = verdict.error;
  }
  if (Object.keys(fieldErrors).length) {
    return NextResponse.json(
      { ok: false, errors: fieldErrors, error: Object.values(fieldErrors)[0] },
      { status: 400 }
    );
  }

  // Normalised from here on, so "arizona" and "(480) 555-0147" reach startPilot as "AZ" and
  // "+14805550147" and two people typing the same clinic produce one comparable row.
  const clean = (field: string, fallback: string) =>
    fieldChecks.find(([f]) => f === field)?.[1].ok
      ? ((fieldChecks.find(([f]) => f === field)![1] as { value?: string | null }).value ?? fallback)
      : fallback;

  // ‼️ THE DUPLICATE WARNING IS ENFORCED HERE, NOT ONLY DRAWN BY THE FORM. Matthew, 2026-09-15: it "must
  // appear to avoid onboarding duplicates". A request that has not chosen (import one archive, or start
  // fresh) gets the matches back with 409 and nothing is created.
  const decision = str(body.duplicateDecision);
  const importArchiveId = /^import:[0-9a-f-]{36}$/i.test(decision) ? decision.slice("import:".length) : null;
  if (!decision) {
    const { findDuplicates } = await import("@/lib/clients/archive");
    const duplicates = await findDuplicates({
      legalName: str(body.legalName),
      dbaName: str(body.dbaName) || null,
      website: str(body.website),
      email: str(body.email),
      phone: str(body.phone) || null,
    }).catch(() => []);
    if (duplicates.length) {
      return NextResponse.json({ ok: false, duplicates, error: "This looks like a client we already have." }, { status: 409 });
    }
  }

  const result = await startPilot({
    legalName: str(body.legalName),
    dbaName: str(body.dbaName) || null,
    website: str(body.website),
    email: clean("email", str(body.email)),
    phone: clean("phone", "") || null,
    contactFirstName: str(body.contactFirstName) || null,
    contactLastName: str(body.contactLastName) || null,
    addressLine1: clean("addressLine1", "") || null,
    city: clean("city", "") || null,
    state: clean("state", "") || null,
    postalCode: clean("postalCode", "") || null,
    tierScope,
    marketCenterLat: num(body.marketCenterLat),
    marketCenterLng: num(body.marketCenterLng),
    marketRadiusMi: num(body.marketRadiusMi),
    importArchiveId,
    duplicateAcknowledged: Boolean(decision),
    door: "dashboard",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  // ‼️ THE SAME BOARD A BOOKING OPENS (2026-09-15). This button used to hand back an /onboarding?t=
  // link and wait for the client to finish a six-step form, which then fired a scan that pitched the
  // client in #hot-leads. Now it opens the board at once, attaches any audit on file, scans nothing,
  // and announces the channel. In waitUntil because opening a board outlasts this route.
  if (!result.alreadyProvisioned) {
    const name = str(body.dbaName) || str(body.legalName) || str(body.email);
    waitUntil(
      (async () => {
        const board = await openClientBoard(result.clientId, {
          name,
          headline: `:seedling: *${name}* started from the dashboard.`,
        }).catch((e) => ({ claimed: false, adoptedReportId: null, warnings: [(e as Error).message] }));
        await announceClientStart({
          clientId: result.clientId,
          name,
          website: str(body.website) || null,
          opsChannelId: result.opsChannelId ?? null,
          board,
          warnings: result.warnings,
        }).catch((e) => console.error("[start-pilot] announcement failed:", (e as Error).message));
      })()
    );
  }

  return NextResponse.json({
    ok: true,
    clientId: result.clientId,
    slug: result.slug,
    onboardingUrl: result.onboardingUrl,
    alreadyProvisioned: result.alreadyProvisioned,
    warnings: result.warnings,
    imported: result.imported ?? [],
  });
}
