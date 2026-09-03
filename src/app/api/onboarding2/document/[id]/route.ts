// The signed PDF, back to the person who signed it.
//
// ‼️ GATED ON THE SIGNING'S OWN session_token, AND DELIBERATELY NOT ON CLIENT_LINK_SECRET.
// CLAUDE.md records that secret is unset in production, which is why startPilot currently returns
// onboardingUrl: null and skips the welcome email. A signer must be able to fetch their own
// contract regardless of whether an unrelated env var has landed yet.
//
// ‼️ 404 ON A BAD TOKEN, NEVER 401 OR 403. A status that confirms the row exists is a status that
// enumerates them. Same rule src/middleware.ts states for the hub and concierge hostnames.
//
// ‼️ IT RE-RENDERS FROM THE SNAPSHOT WHEN THE STORED FILE IS MISSING, AND THAT IS THE POINT OF
// THE SNAPSHOT. The bytes are recoverable from the row alone, forever, without the template.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { loadByToken } from "@/lib/onboarding2/session";
import { renderAgreementPdf, signedRecordFrom } from "@/lib/onboarding2/agreement-pdf";
import { BUCKET } from "@/lib/onboarding2/constants";
import { safeEqual } from "@/lib/onboarding2/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("t") ?? "";

  const row = await loadByToken(token);
  // The token has to belong to THIS signing. Without the id check a valid token would fetch any
  // document by changing the path.
  if (!row || !safeEqual(row.id, id)) return notFound();
  if (!row.signed_at) return notFound();

  let bytes: Buffer | null = null;

  if (row.pdf_path) {
    const dl = await supabaseAdmin.storage.from(BUCKET).download(row.pdf_path);
    if (dl.data) bytes = Buffer.from(await dl.data.arrayBuffer());
    else console.error("[onboarding2/document] download failed, re-rendering from the snapshot");
  }

  if (!bytes) {
    try {
      bytes = renderAgreementPdf(row.agreement_snapshot, signedRecordFrom(row));
    } catch (e) {
      console.error("[onboarding2/document] render failed:", (e as Error).message);
      return notFound();
    }
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="SRT-Onboarding-Agreement.pdf"',
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
