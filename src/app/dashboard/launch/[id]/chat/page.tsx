// The onboarding conversation for one client.
//
// ‼️ IT DOES NOT REPLACE THE BOARD. Matthew asked for the conversation to be the thing he WORKS
// in and the board to stay as the thing he GLANCES at, so this carries the progress line and a
// link back rather than a second copy of the seventeen steps.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { launchBoard, isResolved } from "@/lib/launch/steps";
import { foundationStatus } from "@/lib/launch/documents";
import { ensureConversation, loadHistory, type StoredMessage } from "@/lib/launch/conversation";
import { LaunchThread } from "./thread";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("dba_name, legal_name")
    .eq("id", params.id)
    .maybeSingle();
  const name = (data?.dba_name as string) || (data?.legal_name as string) || "Launch client";
  return { title: `${name} | Onboarding` };
}

export default async function LaunchChatPage({ params }: Props) {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, slug, legal_name, dba_name, vertical_slug, onboarding_lane")
    .eq("id", params.id)
    .maybeSingle();

  if (error) throw new Error(`That client could not be read: ${error.message}`);
  if (!client) notFound();

  if (client.onboarding_lane !== "launch") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold text-white">This client is not on the launch lane</h1>
        <p className="mt-3 text-sm text-[rgba(255,255,255,0.5)]">
          It is worked on the Slack delivery board, in its own channel.
        </p>
      </div>
    );
  }

  const clientId = client.id as string;
  const [board, docs, conversationId] = await Promise.all([
    launchBoard(clientId),
    foundationStatus(clientId),
    ensureConversation(clientId),
  ]);

  const history: StoredMessage[] = conversationId ? await loadHistory(conversationId) : [];

  const settled = board.filter((e) => isResolved(e.row?.status)).length;
  const missingDocs = (docs ?? []).filter((d) => !d.present).map((d) => d.kind);
  const name = (client.dba_name as string) || (client.legal_name as string) || (client.slug as string);

  // ‼️ A CHAT IS A THREE-PART COLUMN, NOT A LONG DOCUMENT.
  //
  // This page used to be one scrolling block with the composer sitting after the messages in
  // normal flow, so the box you type into moved down the page as the conversation grew and you
  // had to scroll to reach it. Every chat interface anybody has ever used pins the composer, and
  // the reason is not fashion: the input is the only control on the screen, so its position must
  // not depend on how much has been said.
  //
  // `h-[100dvh]` and not `h-screen`, because on a phone `vh` includes the browser chrome that
  // slides away, which puts the composer under the address bar on exactly the devices where it
  // matters most. The middle pane carries `min-h-0`, which is the flexbox rule people forget: a
  // flex child defaults to `min-height: auto` and refuses to shrink below its content, so without
  // it the messages push the composer off the bottom instead of scrolling.
  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="shrink-0 border-b border-[rgba(255,255,255,0.08)] px-6 pb-4 pt-6">
        <div className="mx-auto max-w-3xl">
          <Link
            href={`/dashboard/launch/${clientId}`}
            className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white"
          >
            Back to the board
          </Link>

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold text-white">{name}</h1>
            <p className="text-sm text-[rgba(255,255,255,0.45)]">
              {settled} of {board.length} settled
            </p>
          </div>

          {/* The progress bar Matthew asked for, at the top, on every visit. */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <div
              className="h-full rounded-full bg-[#00C9A7] transition-all"
              style={{ width: `${board.length ? Math.round((settled / board.length) * 100) : 0}%` }}
            />
          </div>
        </div>
      </header>

      <LaunchThread
        clientId={clientId}
        clientName={name}
        history={history}
        missingDocs={missingDocs}
        settled={settled}
        total={board.length}
      />
    </div>
  );
}
