"use client";

// The thread rail: every conversation on this client, newest first, and a button for a new one.
//
// ‼️ IT LISTS THREADS ON ONE CLIENT AND NEVER ACROSS CLIENTS, which is the rule the unique index
// was written for. docs/2026-10-06-launch-threads.sql relaxes "one thread per client" to "many
// threads, each on one client", and the thing it must not relax is two clients sharing a thread:
// an action would then run against whichever the model last mentioned. The client is in the URL,
// every row here belongs to it, and ensureConversation checks the id against this same list.
//
// Before that migration runs this shows exactly one entry, because only one row can exist. That is
// the honest render of the database rather than a broken rail.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ThreadRow {
  id: string;
  title: string | null;
  lastTurnAt: string | null;
  createdAt: string;
}

function when(row: ThreadRow): string {
  const raw = row.lastTurnAt ?? row.createdAt;
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function ThreadHistory({
  clientId,
  threads,
  currentId,
}: {
  clientId: string;
  threads: ThreadRow[];
  currentId: string | null;
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
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] md:flex">
      <div className="flex items-center justify-between px-4 pb-3 pt-6">
        <span className="text-[11px] uppercase tracking-wide text-[rgba(255,255,255,0.3)]">History</span>
        <button
          type="button"
          onClick={openNew}
          disabled={busy}
          title="Start a new thread on this client"
          className="rounded-lg border border-[rgba(0,201,167,0.4)] px-2 py-0.5 text-sm text-[#00C9A7] disabled:opacity-40"
        >
          {busy ? "..." : "+"}
        </button>
      </div>

      {error && <p className="px-4 pb-2 text-[11px] text-[#F5A623]">{error}</p>}

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-6">
        {threads.length === 0 && (
          <p className="px-2 text-[11px] text-[rgba(255,255,255,0.3)]">No threads yet.</p>
        )}
        {threads.map((t) => {
          const active = t.id === currentId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                router.push(`/dashboard/launch/${clientId}/chat?c=${t.id}`);
                router.refresh();
              }}
              className={`block w-full rounded-lg px-2 py-2 text-left ${
                active ? "bg-[rgba(0,201,167,0.08)]" : "hover:bg-[rgba(255,255,255,0.04)]"
              }`}
            >
              {/* truncate, because an untitled thread is named after a whole pasted transcript. */}
              <span
                className={`block truncate text-xs ${
                  active ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.75)]"
                }`}
              >
                {t.title ?? "Untitled thread"}
              </span>
              <span className="block text-[10px] text-[rgba(255,255,255,0.3)]">{when(t)}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
