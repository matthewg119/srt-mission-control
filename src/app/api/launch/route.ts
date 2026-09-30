// Create a Launch Lane client.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this checks the session itself.
// Same pattern as every /api/clients/* route.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { startLaunchClient } from "@/lib/launch/provision";
import { validateLaunchIntake } from "@/lib/validate/intake-fields";

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

  // ‼️ THE SERVER IS THE AUTHORITY, AND IT RUNS THE SAME MODULE THE FORM RUNS.
  // The form's copy is for the person typing; this one is the one that decides. A form is never
  // the only way into a route, and this route had nothing but trim() until a real attempt stored
  // `777777777` as a city and a state.
  const checked = validateLaunchIntake({
    email: str(body.email, 200) ?? "",
    verticalSlug: str(body.verticalSlug, 80) ?? "",
    legalName: str(body.legalName, 200) ?? "",
    dbaName: str(body.dbaName, 200) ?? "",
    phone: str(body.phone, 40) ?? "",
    addressLine1: str(body.addressLine1, 200) ?? "",
    city: str(body.city, 100) ?? "",
    state: str(body.state, 60) ?? "",
    postalCode: str(body.postalCode, 20) ?? "",
    website: str(body.website, 300) ?? "",
  });

  if (!checked.ok) {
    return NextResponse.json(
      {
        ok: false,
        // Every bad field at once, so four mistakes are one round trip rather than four.
        errors: checked.errors,
        error: Object.values(checked.errors)[0] ?? "Some of those details are not usable.",
      },
      { status: 400 }
    );
  }

  const v = checked.values;

  const result = await startLaunchClient({
    email: v.email as string,
    verticalSlug: v.verticalSlug as string,
    legalName: v.legalName ?? null,
    dbaName: v.dbaName ?? null,
    phone: v.phone ?? null,
    addressLine1: v.addressLine1 ?? null,
    city: v.city ?? null,
    state: v.state ?? null,
    postalCode: v.postalCode ?? null,
    website: v.website ?? null,
    language: body.language === "es" || body.language === "both" ? body.language : "en",
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
