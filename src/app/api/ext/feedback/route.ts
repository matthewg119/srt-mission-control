export const dynamic = "force-dynamic";
// Standalone feedback endpoint for the bubble's thumbs-down (and any feedback not
// tied to a send). Approve/edit normally ride along on the send route, but this
// lets the bubble register a 👎 on a suggestion it chose not to send.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { recordExtFeedback, ExtFeedbackKind } from "@/lib/ext-feedback";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const VALID: ExtFeedbackKind[] = ["approve", "edit", "thumbs_down"];

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const parsed = await req.json().catch(() => null);
  const conversationId = parsed?.conversationId as string | undefined;
  const kind = parsed?.kind as ExtFeedbackKind | undefined;
  if (!conversationId || !kind || !VALID.includes(kind)) {
    return jsonCors(req, { ok: false, error: "conversationId and valid kind required" }, 400);
  }

  await recordExtFeedback({
    tenantId: tenant.tenantId,
    conversationId,
    kind,
    finalBody: (parsed?.finalBody as string | undefined) ?? null,
    aiSuggestion: (parsed?.aiSuggestion as string | undefined) ?? null,
    inbound: (parsed?.inbound as string | undefined) ?? null,
  });

  return jsonCors(req, { ok: true });
}
