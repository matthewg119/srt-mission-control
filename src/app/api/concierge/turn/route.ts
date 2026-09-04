// One turn of the conversation.
//
// ‼️ THE MODE AND THE TENANT ARE READ OFF THE ROW, NEVER OFF THE REQUEST. The browser sends a token
// and a sentence. Which audience it is talking to, which client it belongs to and what has already
// been spent all come from the database. onboarding2's chat route states the same rule, and the
// reason is the same: a client-supplied audience would let anybody ask the patient widget for a
// competitor list by flipping one field.
//
// ‼️ THE TURN ORDINAL IS THE IDEMPOTENCY KEY. concierge_messages is unique on
// (session_id, ordinal), so a double-submitted turn collides in the database instead of being
// replayed as the visitor saying it twice.

import { NextRequest, NextResponse } from "next/server";
import { loadConciergeConfig } from "@/lib/concierge/config";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";
import { runConciergeTurn } from "@/lib/concierge/engine";
import { appendMessage, bumpTurns, loadConciergeSession, loadMessages } from "@/lib/concierge/session";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long one conversation may run. A real one is under ten turns. */
const MAX_TURNS = 30;

/** What one visitor may type at once. Longer than this is a paste, not a question. */
const MAX_MESSAGE_CHARS = 1200;

function no(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** The tenant slug for a session, so the config is loaded from the row rather than the request. */
async function slugForClient(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("clients").select("slug").eq("id", clientId).maybeSingle();
  return typeof data?.slug === "string" ? data.slug : null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return no(400, "Bad request");
  }

  const session = await loadConciergeSession(String(body.token ?? ""));
  if (!session) return no(404, "Not found");

  const message = String(body.message ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return no(400, "Say something first.");

  if (session.turns >= MAX_TURNS) {
    return NextResponse.json(
      {
        reply: "I have taken this as far as I usefully can here. Matthew can pick it up properly on a call.",
        attachments: [],
        evidence: [],
        degraded: false,
        complete: true,
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const slug = await slugForClient(session.clientId);
  const config = slug ? await loadConciergeConfig(slug) : null;
  // A switched-off tenant answers nothing, EXCEPT to a caller holding a signed preview token for
  // this client. The frame forwards it on every call, so a demo walked before concierge_live can
  // hold a whole conversation. See lib/concierge/preview-grant.ts.
  const previewToken = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!config || !conciergeAllowed(config, previewToken)) return no(404, "Not found");

  // The next free ordinal. Reading it rather than trusting a counter means a resumed tab lands in
  // the right place, and the unique index catches the race either way.
  const history = await loadMessages(session.id);
  const ordinal = history.length;

  if (!(await appendMessage(session.id, "user", message, ordinal))) {
    // The ordinal was taken, so this exact turn is already recorded. Replay the last assistant
    // line rather than running the model again and charging for a duplicate.
    const last = [...history].reverse().find((m) => m.role === "assistant");
    return NextResponse.json(
      { reply: last?.content ?? "", attachments: [], evidence: [], degraded: false, replayed: true },
      { headers: { "cache-control": "no-store" } }
    );
  }

  let result;
  try {
    result = await runConciergeTurn({
      config,
      session,
      message,
      business: typeof body.business === "string" ? body.business.slice(0, 160) : null,
      // The frame reports the visitor's own IANA zone so the calendar offers THEIR today.
      // safeTimeZone validates it inside the engine; a missing or bogus value falls back rather
      // than throwing inside a formatter.
      timeZone: typeof body.tz === "string" ? body.tz.slice(0, 64) : null,
    });
  } catch (err) {
    console.error(`[concierge] turn failed: ${err instanceof Error ? err.message : String(err)}`);
    // ‼️ A HANDLED STATE, NOT A 500. The widget sits on a client's live page. A stack trace in the
    // console and an empty bubble reads as a broken site; this reads as a person stepping away.
    return NextResponse.json(
      {
        reply: "Something went wrong on my side. Leave me an email and Matthew will pick this up directly.",
        attachments: [],
        evidence: [],
        degraded: false,
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  await appendMessage(session.id, "assistant", result.reply, ordinal + 1);
  await bumpTurns(session);

  return NextResponse.json(
    {
      reply: result.reply,
      attachments: result.attachments,
      evidence: result.evidence,
      degraded: result.degraded,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
