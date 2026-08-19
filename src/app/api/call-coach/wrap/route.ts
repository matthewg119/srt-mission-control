export const dynamic = "force-dynamic";

// The call ended. Write it up and post one card for approval.
//
// Idempotent on session id: CALL_ENDED can fire twice (stopCapture and then the window closing),
// and a second card for one call would mean two Zoho notes if both got approved.

import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateCallCoachKey } from "@/lib/call-coach-auth";
import { supabaseAdmin } from "@/lib/db";
import { generateWrap } from "@/lib/call-coach/wrap";
import { postWrapCard, type WrapSessionRow } from "@/lib/call-coach/wrap-card";

/** A 20 second misdial should not produce a Slack card and a CRM note. */
const MIN_TRANSCRIPT_ENTRIES = 8;

export async function POST(req: NextRequest) {
  const key = extractApiKey(req);
  const user = key ? await validateCallCoachKey(key) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    sessionId?: string;
    qualification?: Record<string, { value?: string | null } | string | null>;
    notes?: string[];
    durationSeconds?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return NextResponse.json({ error: "no_session" }, { status: 400 });

  const { data: sessionData } = await supabaseAdmin
    .from("call_coach_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sessionData) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  const session = sessionData as WrapSessionRow;

  // One card per session, always. A second CALL_ENDED gets the first answer back.
  if (session.wrap && session.wrap_card_ts) {
    return NextResponse.json({ ok: true, alreadyWrapped: true, cardTs: session.wrap_card_ts });
  }

  const { count } = await supabaseAdmin
    .from("call_coach_transcripts")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if ((count ?? 0) < MIN_TRANSCRIPT_ENTRIES) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `Only ${count ?? 0} transcript lines, which is a misdial rather than a call.`,
    });
  }

  try {
    // The extension sends the checklist as {key: {value, capturedAt}}; flatten to {key: value}.
    const qualification: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(body.qualification ?? {})) {
      qualification[k] = typeof v === "string" ? v : ((v as { value?: string | null } | null)?.value ?? null);
    }

    const wrap = await generateWrap({
      sessionId,
      callType: (session.call_type as "cold" | "followup" | "close" | null) ?? null,
      who: {
        businessName: session.business_name,
        personName: session.person_name,
        zohoRef: session.contact_id ? `contact ${session.contact_id}` : "no CRM record identified",
      },
      qualification,
      notes: Array.isArray(body.notes) ? body.notes : [],
      durationSeconds: body.durationSeconds ?? session.duration_seconds ?? null,
      briefText: (sessionData as { brief_text?: string | null }).brief_text ?? null,
    });

    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap, wrap_state: "pending", wrap_error: null })
      .eq("id", sessionId);

    const posted = await postWrapCard({ ...session, wrap }, wrap);

    return NextResponse.json({ ok: true, posted: Boolean(posted), outcome: wrap.outcome });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[call-coach/wrap] failed:", msg);
    await supabaseAdmin
      .from("call_coach_sessions")
      .update({ wrap_state: "failed", wrap_error: msg })
      .eq("id", sessionId);
    return NextResponse.json({ error: "wrap_failed", detail: msg }, { status: 500 });
  }
}
