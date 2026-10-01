"use client";

// The front door, at the top of /dashboard/launch.
//
// ‼️ IT OPENS ITSELF. Matthew's instruction was that the bot asks who he is onboarding today
// rather than him having to start it, so the first question is rendered from real state on mount,
// with no model call and no click. A door that waits to be opened is a form with a cursor in it.
//
// ‼️ IT LEAVES FOR THE CLIENT THREAD THE MOMENT A CLIENT EXISTS. This conversation is a router
// and keeps nothing. One client per thread is the rule, and this is not one of those threads.

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Turn {
  role: "user" | "assistant";
  text: string;
  problems?: string[];
}

export interface DoorClientSummary {
  id: string;
  name: string;
  vertical: string | null;
  settled: number;
  total: number;
}

export function FrontDoor({ clients }: { clients: DoorClientSummary[] }) {
  const router = useRouter();

  const opener =
    clients.length === 0
      ? "Who are you onboarding today? Nothing is on this lane yet, so it is a new client. Give me the business name, what it is, the phone, the address and an email, all in one go."
      : `Who are you onboarding today? A new client, or finishing one of these: ${clients
          .map((c) => `${c.name} (${c.settled} of ${c.total})`)
          .join(", ")}.`;

  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", text: opener }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setError(null);
    setBusy(true);
    setInput("");

    // The opener is ours, not the model's, so it is not sent back as history. Everything after it
    // is the real exchange.
    const history = turns.slice(1).map((t) => ({ role: t.role, content: t.text }));
    setTurns((t) => [...t, { role: "user", text: message }]);

    try {
      const res = await fetch("/api/launch/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        say?: string;
        asks?: string[];
        openClientId?: string | null;
        openClientName?: string | null;
        problems?: string[];
        error?: string;
      };

      if (!res.ok || !body.ok) {
        setError(body.error ?? `It answered ${res.status}.`);
        return;
      }

      const said = [body.say ?? "", ...(body.asks ?? []).map((a) => `- ${a}`)]
        .filter(Boolean)
        .join("\n");

      setTurns((t) => [
        ...t,
        { role: "assistant", text: said || "...", problems: body.problems?.length ? body.problems : undefined },
      ]);

      if (body.openClientId) {
        setLeaving(body.openClientName ?? "that client");
        router.push(`/dashboard/launch/${body.openClientId}/chat`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-5">
      <div className="max-h-[22rem] space-y-4 overflow-y-auto">
        {turns.map((t, i) => (
          <div key={i}>
            <p className="text-[11px] uppercase tracking-wide text-[rgba(255,255,255,0.3)]">
              {t.role === "user" ? "You" : "Onboarding"}
            </p>
            <div
              className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                t.role === "user"
                  ? "bg-[rgba(255,255,255,0.06)] text-white"
                  : "text-[rgba(255,255,255,0.85)]"
              }`}
            >
              {t.text}
            </div>
            {t.problems?.map((p, j) => (
              <p
                key={j}
                className="mt-1 rounded border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] px-3 py-1.5 text-xs text-[#F5A623]"
              >
                {p}
              </p>
            ))}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {leaving && (
        <p className="mt-3 text-xs text-[#00C9A7]">Opening {leaving}...</p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] px-3 py-2 text-xs text-[#F5A623]">
          {error}
        </p>
      )}

      <div className="mt-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="A new client, or the name of one to finish. Paste everything you have."
          className="w-full resize-y rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(0,201,167,0.5)] focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[rgba(255,255,255,0.3)]">
            It opens the client and hands you straight to its onboarding.
          </p>
          <button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-[#00C9A7] px-4 py-1.5 text-sm font-medium text-[#0B0B0C] hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Thinking..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
