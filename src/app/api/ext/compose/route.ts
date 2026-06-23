export const dynamic = "force-dynamic";
// TextWin extension "＋ text a new number". Thin gate over the existing
// /api/sms/compose logic (lookup-or-create contact + conversation + Slack
// channel). Reuses CRON_SECRET to call the internal route so we don't duplicate
// createLead / ensureSmsChannel here.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";

  try {
    const res = await fetch(`${appUrl}/api/sms/compose`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return jsonCors(req, data, res.status);
  } catch (e) {
    return jsonCors(req, { ok: false, error: (e as Error).message }, 502);
  }
}
