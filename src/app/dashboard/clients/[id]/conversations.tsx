"use client";

// Every onboarding conversation on one client, on the client's own page.
//
// Matthew, 2026-10-08, having clicked a client out of the list and landed on the delivery board:
// "I want to be able to see the new UI where we can see previous conversations regarding that
// client or start a new one to complete onboarding or unfinished tasks in that client."
//
// ‼️ IT IS A DOOR, NOT A SECOND CHAT. The conversation itself lives at
// /dashboard/launch/{id}/chat, which carries the thread, the progress line and the model turn.
// Rendering a second transcript here would be two places one conversation can be read and one of
// them would go stale the moment the other posted a turn. This lists what exists, opens one, and
// starts one.
//
// ‼️ AND IT REUSES THE ROUTE THE CHAT'S OWN RAIL USES. POST /api/launch/{id}/chat/new is the one
// door that opens a thread; it checks the lane itself and may hand back an existing thread rather
// than failing while docs/2026-10-06-launch-threads.sql is still unrun. Writing a second create
// path here would be a second place that rule has to be got right.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Plus } from "lucide-react";

export interface ClientThreadView {
  id: string;
  title: string | null;
  lastTurnAt: string | null;
  createdAt: string;
}

/** The date a person would call this thread's, which is the last thing said in it. */
function when(row: ClientThreadView): string {
  const raw = row.lastTurnAt ?? row.createdAt;
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ClientConversations({
  clientId,
  lane,
  threads,
}: {
  clientId: string;
  lane: "slack" | "launch";
  threads: ClientThreadView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openNew(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/chat/new`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string; conversationId?: string };
      if (!data.ok || !data.conversationId) {
        setError(data.error ?? "That did not open.");
        return;
      }
      router.push(`/dashboard/launch/${clientId}/chat?c=${data.conversationId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <MessageSquare className="h-4 w-4 text-[#00C9A7]" aria-hidden />
          Conversations
        </h2>
        {lane === "launch" && (
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            {threads.length === 0
              ? "none yet"
              : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
          </span>
        )}
      </div>

      {/*
        ‼️ A SLACK BOARD CLIENT IS TOLD WHERE ITS ONBOARDING ACTUALLY HAPPENS. The chat belongs to
        the launch lane: /api/launch/{id}/chat/new refuses any other lane and the chat page answers
        one with a sentence saying so. An empty panel with a dead button would send somebody to
        read that sentence to find out; this says it here, where the question is asked.
      */}
      {lane !== "launch" ? (
        <p className="text-xs leading-relaxed text-[rgba(255,255,255,0.45)]">
          This client is worked on the Slack delivery board, in its own ops channel, so it has no
          onboarding conversation here. The launch lane is the one with a chat.
        </p>
      ) : (
        <>
          {threads.length === 0 ? (
            <p className="mb-4 text-xs text-[rgba(255,255,255,0.4)]">
              Nothing has been talked through yet. Start one to walk the intake, pick up an
              unfinished step, or ask what is still owed.
            </p>
          ) : (
            <ul className="mb-4 divide-y divide-[rgba(255,255,255,0.06)]">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/dashboard/launch/${clientId}/chat?c=${t.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:text-white"
                  >
                    {/* Truncated: an untitled thread is named after whatever was pasted into it. */}
                    <span className="min-w-0 flex-1 truncate text-xs text-[rgba(255,255,255,0.75)]">
                      {t.title ?? "Untitled thread"}
                    </span>
                    <span className="shrink-0 text-[11px] text-[rgba(255,255,255,0.3)]">
                      {when(t)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mb-3 text-[11px] text-[#F5A623]">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void openNew()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(0,201,167,0.45)] bg-[rgba(0,201,167,0.12)] px-3 py-1.5 text-xs font-medium text-[#00C9A7] transition-colors hover:bg-[rgba(0,201,167,0.22)] hover:text-white disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {busy ? "Opening…" : "Start a new conversation"}
            </button>
            {threads.length > 0 && (
              <Link
                href={`/dashboard/launch/${clientId}/chat`}
                className="rounded-lg border border-[rgba(255,255,255,0.07)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
              >
                Open the latest
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
