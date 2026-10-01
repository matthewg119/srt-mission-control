"use client";

// The thread itself.
//
// ‼️ IT OPENS WITH A BULLET LIST AND A START BUTTON, NOT A WALL OF PROSE.
// Matthew asked for exactly that: the list of what is needed, then one button. The opener is
// rendered from real state (which of the four documents are actually missing), so it is a
// statement about this client rather than a greeting.

import { useState, useRef, useEffect } from "react";
import type { StoredMessage, ActionResult } from "@/lib/launch/conversation";

interface Turn {
  role: "user" | "assistant";
  text: string;
  results?: ActionResult[];
  heldBack?: boolean;
}

const DOC_LABELS: Record<string, string> = {
  deep_research: "the deep research",
  avatar_sheet: "the avatar sheet",
  short_offer: "the short offer",
  necessary_beliefs: "the necessary beliefs",
};

export function LaunchThread({
  clientId,
  clientName,
  history,
  missingDocs,
  settled,
  total,
}: {
  clientId: string;
  clientName: string;
  history: StoredMessage[];
  missingDocs: string[];
  settled: number;
  total: number;
}) {
  const [turns, setTurns] = useState<Turn[]>(
    history
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        text: m.content,
        results: m.actions ?? undefined,
      }))
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setError(null);
    setBusy(true);
    setInput("");
    setTurns((t) => [...t, { role: "user", text: message }]);

    try {
      const res = await fetch(`/api/launch/${clientId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        say?: string;
        asks?: string[];
        results?: ActionResult[];
        heldBack?: boolean;
        error?: string;
      };

      if (!res.ok || !body.ok) {
        setError(body.error ?? `It answered ${res.status}.`);
        return;
      }

      const text = [body.say ?? "", ...(body.asks ?? []).map((a) => `- ${a}`)]
        .filter(Boolean)
        .join("\n");

      setTurns((t) => [
        ...t,
        { role: "assistant", text, results: body.results, heldBack: body.heldBack },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const opener = turns.length === 0;

  return (
    <>
      {/* The scrolling middle. `min-h-0` is what lets it shrink; see the note in page.tsx. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
      {opener && (
        <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-5">
          <p className="text-sm text-white">Here is what this onboarding needs.</p>
          <ul className="mt-3 space-y-1.5 text-sm text-[rgba(255,255,255,0.6)]">
            <li>
              The four foundation documents.{" "}
              {missingDocs.length === 0 ? (
                <span className="text-[#00C9A7]">All four are in.</span>
              ) : (
                <span className="text-[#F5A623]">
                  Missing: {missingDocs.map((d) => DOC_LABELS[d] ?? d).join(", ")}. I can hand you
                  the prompt chain that produces them.
                </span>
              )}
            </li>
            <li>The words this trade uses, confirmed by you.</li>
            <li>The offer in one line, and what it promises.</li>
            <li>A domain, or a decision to skip it for now.</li>
            <li>The Day-0 archive, which is a wall. Nothing publishes until it is filed.</li>
            <li>The pages, drafted from research and published by you.</li>
          </ul>
          <p className="mt-4 text-xs text-[rgba(255,255,255,0.4)]">
            {settled} of {total} settled. I will pick what is most useful next and ask you several
            things at once, so you can answer in one voice note.
          </p>
          <button
            onClick={() => send(`Start the onboarding for ${clientName}. What do you need first?`)}
            disabled={busy}
            className="mt-5 rounded-lg bg-[#00C9A7] px-4 py-2 text-sm font-medium text-[#0B0B0C] hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Thinking..." : "Start"}
          </button>
        </div>
      )}

      <div className="space-y-5">
        {turns.map((t, i) => (
          <div key={i}>
            <p className="text-[11px] uppercase tracking-wide text-[rgba(255,255,255,0.3)]">
              {t.role === "user" ? "You" : "Onboarding"}
            </p>
            <div
              className={`mt-1 whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${
                t.role === "user"
                  ? "bg-[rgba(255,255,255,0.06)] text-white"
                  : "border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.85)]"
              }`}
            >
              {t.text}
            </div>

            {t.heldBack && (
              <p className="mt-2 text-xs text-[#F5A623]">
                It was not sure enough to act, so it asked instead of doing.
              </p>
            )}

            {t.results?.map((r, j) => (
              <div
                key={j}
                className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                  r.ok
                    ? "border-[rgba(0,201,167,0.3)] bg-[rgba(0,201,167,0.05)] text-[rgba(255,255,255,0.75)]"
                    : "border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] text-[#F5A623]"
                }`}
              >
                <span className="font-medium">{r.kind}</span>
                {r.ok ? "" : " refused"}: {r.detail}
                {/* ‼️ THE PROMPT IS SHOWN, NEVER RUN. This is the whole mechanic: it hands him
                    something to paste into another session, and he brings the answer back. */}
                {r.prompt && (
                  <div className="mt-2">
                    <button
                      onClick={() => navigator.clipboard?.writeText(r.prompt ?? "")}
                      className="rounded border border-[rgba(255,255,255,0.15)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.7)] hover:text-white"
                    >
                      Copy the prompt
                    </button>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[rgba(0,0,0,0.35)] p-3 text-[11px] leading-relaxed text-[rgba(255,255,255,0.65)]">
                      {r.prompt}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        <div ref={endRef} />
      </div>

          {error && (
            <p className="mt-4 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] px-4 py-3 text-xs text-[#F5A623]">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* The composer, pinned. Never scrolls away, never moves as the thread grows. */}
      <div className="shrink-0 border-t border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.25)] px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, shift-enter makes a line. A pasted voice-note transcript is many
                // lines and arrives as one paste, so it is unaffected either way.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder="Paste a transcript, answer the questions, or say what to do next."
              className="w-full resize-none rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] py-3 pl-4 pr-28 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(0,201,167,0.5)] focus:outline-none"
            />
            <button
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              className="absolute bottom-2.5 right-2.5 rounded-lg bg-[#00C9A7] px-4 py-2 text-sm font-medium text-[#0B0B0C] hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "Thinking..." : "Send"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.3)]">
            It never buys a domain and never publishes a page. Both are buttons on the board.
          </p>
        </div>
      </div>
    </>
  );
}
