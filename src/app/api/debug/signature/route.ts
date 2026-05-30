export const dynamic = "force-dynamic";
// Debug: confirm an Outlook signature resolves via Graph for the connected
// Microsoft 365 account. GET /api/debug/signature?name=S
// Auth: Authorization: Bearer <CRON_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";

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

  const name = req.nextUrl.searchParams.get("name") || "S";

  const named = await microsoft.getSignatureByName(name).catch((e) => `error: ${(e as Error).message}`);
  const def = await microsoft.getDefaultSignature().catch((e) => `error: ${(e as Error).message}`);

  const preview = (html: unknown) =>
    typeof html === "string" ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : html;

  return NextResponse.json({
    ok: true,
    name,
    named_signature: {
      found: typeof named === "string" && !named.startsWith("error:"),
      length: typeof named === "string" ? named.length : 0,
      preview: preview(named),
    },
    default_signature: {
      found: typeof def === "string" && !def.startsWith("error:"),
      length: typeof def === "string" ? def.length : 0,
      preview: preview(def),
    },
  });
}
