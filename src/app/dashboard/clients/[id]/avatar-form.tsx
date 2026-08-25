"use client";

// Delivery step 8: which customer this whole build is aimed at.
//
// ‼️ THIS PANEL IS THE THING THAT DID NOT EXIST. Step 11's card said "The proposal is on the
// board" and there was no such control, so on the first real client that step came out `skipped`
// because nobody could have ticked it. clients.primary_avatar has had a column, a CHECK
// constraint and a verifier since it was created, and until this panel it had no writer anywhere.
//
// ‼️ THREE CANDIDATES AND A FOURTH BOX, AND THE FOURTH IS NOT A FALLBACK. Matthew: "always give
// me the 3 default options and if I want a new option allow me to type it in there to create a
// new one." Rejecting all three is a real answer: the candidates are cached per NICHE, so every
// med spa audited this month has the same three, and the person who has read this client's audit
// knows something the cache does not.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AvatarCandidateView {
  slot: string;
  label: string;
  slug: string;
  why: string | null;
  ticket: string | null;
  aiQuestion: string | null;
}

export interface AvatarConfirmedView {
  slot: string;
  label: string;
  slug: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export function AvatarForm({
  clientId,
  candidates,
  confirmed,
  nicheKey,
  matchedBy,
  frozen,
  loadError,
}: {
  clientId: string;
  candidates: AvatarCandidateView[];
  confirmed: AvatarConfirmedView | null;
  nicheKey: string | null;
  matchedBy: string;
  /** Day 0 is stamped, so the avatar is the frozen baseline and cannot move. */
  frozen: boolean;
  loadError: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  async function confirm(label: string, slot?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, slot }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not save.");
      else {
        setTyped("");
        router.refresh();
      }
    } catch {
      setError("That did not save.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {confirmed ? (
        <p className="text-sm text-white">
          Confirmed: <span className="font-medium">{confirmed.label}</span>{" "}
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            ({confirmed.slot} · {confirmed.slug}
            {confirmed.confirmedBy ? ` · by ${confirmed.confirmedBy}` : ""})
          </span>
        </p>
      ) : (
        <p className="text-sm text-[rgba(255,255,255,0.6)]">
          Nothing is confirmed yet. Step 10 researches whoever is picked here, and the custom
          question set and the page candidates are both scored against it.
        </p>
      )}

      {frozen && (
        <p className="rounded-lg border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.08)] p-3 text-xs text-[rgba(255,255,255,0.75)]">
          Day 0 is archived, so this is frozen. The tracked question set was built against the
          avatar above and it is what the day 30, 60 and 90 reports are measured against.
        </p>
      )}

      {loadError && (
        <p className="text-xs text-[rgba(255,120,120,0.9)]">{loadError}</p>
      )}

      {candidates.length > 0 ? (
        <>
          <p className="text-xs text-[rgba(255,255,255,0.4)]">
            Three candidates from the {nicheKey ? <code>{nicheKey}</code> : "niche"} brief
            {matchedBy === "vertical" ? "" : ` (matched by ${matchedBy.replace(/_/g, " ")})`}. They
            are cached per NICHE, not per business, so every client audited in this niche this
            month has the same three. Candidates, never a default.
          </p>
          <div className="space-y-2">
            {candidates.map((c) => {
              const isCurrent = confirmed?.slug === c.slug;
              return (
                <div
                  key={c.slot}
                  className="rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-white">{c.label}</span>
                    <button
                      type="button"
                      disabled={busy || frozen || isCurrent}
                      onClick={() => confirm(c.label, c.slot)}
                      className="rounded-md border border-[rgba(255,255,255,0.14)] px-2.5 py-1 text-xs text-white disabled:opacity-40"
                    >
                      {isCurrent ? "confirmed" : "Confirm"}
                    </button>
                  </div>
                  {c.ticket && (
                    <p className="mt-1 text-xs text-[rgba(255,255,255,0.5)]">{c.ticket}</p>
                  )}
                  {c.why && <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">{c.why}</p>}
                  {c.aiQuestion && (
                    <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
                      Asks an engine: <span className="italic">{c.aiQuestion}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-[rgba(255,255,255,0.4)]">
          No niche brief carries candidates for this vertical, so there are no three to offer.
          Type the avatar instead; that is a supported answer rather than a workaround.
        </p>
      )}

      {/* ‼️ NOT A FALLBACK. Rejecting all three and typing one is the point of the panel: the
          candidates are per niche and the person reading this has read THIS client's audit. */}
      <div className="space-y-2 border-t border-[rgba(255,255,255,0.07)] pt-4">
        <label className="block text-xs text-[rgba(255,255,255,0.5)]">
          Or type the one you actually want. For a med spa that is laser hair removal, filler,
          HIFU, BBL, whatever this client makes money on.
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy || frozen}
            placeholder="laser hair removal"
            className="min-w-[16rem] flex-1 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.25)] px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.25)]"
          />
          <button
            type="button"
            disabled={busy || frozen || typed.trim().length < 3}
            onClick={() => confirm(typed.trim())}
            className="rounded-md bg-[rgba(0,201,167,0.9)] px-3 py-2 text-sm font-medium text-[#04231f] disabled:opacity-40"
          >
            Confirm this one
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-[rgba(255,120,120,0.9)]">{error}</p>}
    </div>
  );
}
