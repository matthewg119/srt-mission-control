// One turn of the onboarding conversation.
//
// ‼️ THE CLIENT ID COMES FROM THE ROUTE AND NEVER FROM THE MESSAGE.
// Matthew's rule is one client per thread, never two. Taking the id from the URL segment is what
// makes that structural: no wording in a message can move a turn onto another client, because the
// only id any action ever sees is this one.
//
// ‼️ AUTHENTICATED, BECAUSE MIDDLEWARE DOES NOT COVER /api.
// middleware.ts guards /dashboard/* and leaves API routes to guard themselves, which every other
// route under /api/launch already does. This one executes work against a real board, so it is not
// the place to be the exception.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { ensureConversation, runTurn } from "@/lib/launch/conversation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const actor = session.user.name ?? session.user.email ?? "the dashboard";

  let body: { message?: string; conversationId?: string };
  try {
    body = (await req.json()) as { message?: string; conversationId?: string };
  } catch {
    return NextResponse.json({ error: "That was not JSON." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Say something first." }, { status: 400 });

  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, dba_name, legal_name, slug, onboarding_lane")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: `That client could not be read: ${error.message}` }, { status: 500 });
  if (!client) return NextResponse.json({ error: "No such client." }, { status: 404 });

  // The board page refuses a Slack-lane client for the same reason: this lane's steps would show
  // an empty board beside work that is already done, and the conversation would then propose
  // redoing it.
  if (client.onboarding_lane !== "launch") {
    return NextResponse.json(
      { error: "That client is worked on the Slack delivery board, not this lane." },
      { status: 400 }
    );
  }

  // ‼️ THE ID FROM THE BODY IS A REQUEST, NOT AN INSTRUCTION. ensureConversation checks it against
  // THIS client's own threads and falls back to the latest, so a thread id belonging to somebody
  // else cannot put one client's history in front of another's board. The client itself still comes
  // from the route and never from the body.
  const conversationId = await ensureConversation(client.id as string, body.conversationId ?? null);
  if (!conversationId) {
    return NextResponse.json({ error: "The conversation could not be opened." }, { status: 500 });
  }

  const clientName =
    (client.dba_name as string) || (client.legal_name as string) || (client.slug as string) || "this client";

  try {
    const turn = await runTurn({
      clientId: client.id as string,
      clientName,
      conversationId,
      message,
      actor,
    });
    return NextResponse.json({ ok: true, ...turn });
  } catch (e) {
    // The model being unreachable is the one failure runTurn does not swallow, because a turn that
    // never happened must not be written into the thread as though it did.
    return NextResponse.json({ error: `The turn failed: ${(e as Error).message}` }, { status: 502 });
  }
}
