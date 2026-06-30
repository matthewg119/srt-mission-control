import { NextRequest, NextResponse } from "next/server";
import { createExclusionAudience } from "@/lib/meta-audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time bootstrap. Hit this once (Bearer CRON_SECRET) to create the
// "SRT - CRM Master Exclusion" Customer List audience, then paste the returned id into
// the META_AUDIENCE_ID env var and redeploy. After that this route is never used again.
//
// Prereqs (see CLAUDE.md): META_ADS_TOKEN (ads_management), META_AD_ACCOUNT_ID, and the
// ad account must have accepted the Custom Audience Terms.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await createExclusionAudience();
    return NextResponse.json({
      ok: true,
      audience_id: id,
      next: "Set META_AUDIENCE_ID to this id, redeploy, then add the audience as an EXCLUSION on each acquisition ad set.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create failed" },
      { status: 500 }
    );
  }
}
