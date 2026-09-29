// Create a Launch Lane client.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this checks the session itself.
// Same pattern as every /api/clients/* route.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { startLaunchClient } from "@/lib/launch/provision";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const email = str(body.email, 200);
  if (!email) return NextResponse.json({ ok: false, error: "An email is required." }, { status: 400 });

  const verticalSlug = str(body.verticalSlug, 64);
  if (!verticalSlug) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Say what this business is. There is no website for a scan to classify in this lane, so " +
          "nothing downstream can fill it in later.",
      },
      { status: 400 }
    );
  }

  const result = await startLaunchClient({
    email,
    verticalSlug,
    legalName: str(body.legalName, 200),
    dbaName: str(body.dbaName, 200),
    phone: str(body.phone, 40),
    addressLine1: str(body.addressLine1, 200),
    city: str(body.city, 100),
    state: str(body.state, 40),
    postalCode: str(body.postalCode, 20),
    website: str(body.website, 300),
    language: body.language === "es" || body.language === "both" ? body.language : "en",
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
