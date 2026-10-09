// Open a new thread on one launch client.
//
// ‼️ ITS OWN ROUTE RATHER THAN A FLAG ON THE TURN ROUTE. That one answers "run this message" and
// carries a 120 second budget and a model call; this one inserts a row. Folding them together
// would mean every turn request also had to be read for whether it was secretly a create.
//
// ‼️ IT MAY RETURN AN EXISTING THREAD, AND THAT IS NOT AN ERROR. Until
// docs/2026-10-06-launch-threads.sql is run, launch_conversations still holds a unique index on
// client_id, so a second thread cannot exist. startConversation falls back to the latest rather
// than failing, which keeps the button honest: it opens a thread, and before the migration that is
// the one there already.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { startConversation } from "@/lib/launch/conversation";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, onboarding_lane")
    .eq("id", id)
    .maybeSingle();

  if (!client) return NextResponse.json({ ok: false, error: "No such client." }, { status: 404 });
  if (client.onboarding_lane !== "launch") {
    return NextResponse.json(
      { ok: false, error: "That client is worked on the Slack delivery board, not this lane." },
      { status: 400 }
    );
  }

  const conversationId = await startConversation(id);
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "The thread could not be opened." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, conversationId });
}
