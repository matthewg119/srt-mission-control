// "Start pilot", the only caller of startPilot() today.
//
// AUTHENTICATED. src/middleware.ts guards /dashboard/* but NOT /api/*, so a route that
// provisions a client, creates a Slack channel and emails someone has to check the
// session itself. Same pattern as src/app/api/crm/leads/[id]/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { startPilot } from "@/lib/clients/provision";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Provisioning does DNS, Slack, Graph and Zoho work in sequence. The default 10s would
// cut it off partway, leaving a client with a channel and no welcome email.
export const maxDuration = 120;

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
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    clientId: result.clientId,
    slug: result.slug,
    onboardingUrl: result.onboardingUrl,
    alreadyProvisioned: result.alreadyProvisioned,
    warnings: result.warnings,
  });
}
