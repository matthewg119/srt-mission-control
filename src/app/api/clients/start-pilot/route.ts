// "Start pilot", the only caller of startPilot() today.
//
// AUTHENTICATED. src/middleware.ts guards /dashboard/* but NOT /api/*, so a route that
// provisions a client, creates a Slack channel and emails someone has to check the
// session itself. Same pattern as src/app/api/crm/leads/[id]/route.ts.

import { NextRequest, NextResponse } from "next/server";
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
    email: str(body.email),
    phone: str(body.phone) || null,
    contactFirstName: str(body.contactFirstName) || null,
    contactLastName: str(body.contactLastName) || null,
    addressLine1: str(body.addressLine1) || null,
    city: str(body.city) || null,
    state: str(body.state) || null,
    postalCode: str(body.postalCode) || null,
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
