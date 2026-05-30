export const dynamic = "force-dynamic";
// Debug: confirm an Outlook signature resolves via Graph for the connected
// Microsoft 365 account. GET /api/debug/signature?name=S
// Auth: Authorization: Bearer <CRON_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";
import { SIGNATURE_S_HTML } from "@/config/email-signature";
import { supabaseAdmin } from "@/lib/db";

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
  const rawProbe = await microsoft
    .rawSignaturesProbe()
    .catch((e) => ({ status: 0, ok: false, body: `error: ${(e as Error).message}` }));

  const preview = (html: unknown) =>
    typeof html === "string" ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : html;

  // What buildHtmlBody would actually use for signature_name === "S".
  const storedS = process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML;

  // Which Supabase project is prod actually using, and is the approval queue
  // table reachable? (If pending_slack_actions errors, 👍 approvals can't persist
  // → no email is ever sent.)
  const supabaseRef = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/^https?:\/\//, "").split(".")[0];
  const approvalProbe = await Promise.resolve(
    supabaseAdmin
      .from("pending_slack_actions")
      .select("id", { count: "exact", head: true })
  )
    .then((r) => ({ reachable: !r.error, error: r.error?.message ?? null, count: r.count ?? null }))
    .catch((e) => ({ reachable: false, error: (e as Error).message, count: null }));

  return NextResponse.json({
    ok: true,
    name,
    supabase_ref: supabaseRef,
    pending_slack_actions_table: approvalProbe,
    // Proves Graph does not expose Outlook signatures (expect a non-2xx status
    // and/or an error body — there is no such endpoint).
    graph_raw_signatures_probe: rawProbe,
    // The store-once fix: what gets appended for signature_name "S".
    stored_s_signature: {
      source: process.env.SIGNATURE_S_HTML ? "env:SIGNATURE_S_HTML" : "const:SIGNATURE_S_HTML",
      found: storedS.length > 0,
      length: storedS.length,
      preview: preview(storedS),
    },
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
