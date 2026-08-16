"use client";

// One click, then a number.
//
// D-P9 makes the timing log mandatory from day 0, and the number it produces is what
// goes on camera. A log that takes a form, a date picker and a dropdown will not get
// filled in during a working day, and an unfilled log turns a measurement back into an
// estimate. So: pick a category, the minutes field is already focused, Enter saves.

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "baseline_retest", label: "Baseline retest" },
  { key: "pages_new", label: "Pages, new" },
  { key: "pages_refresh", label: "Pages, refresh" },
  { key: "review_tool_setup", label: "Review tool setup" },
  { key: "review_responses", label: "Review responses" },
  { key: "outreach", label: "Outreach" },
  { key: "reporting_video", label: "Reporting video" },
  { key: "client_comms", label: "Client comms" },
  // Excluded from the subscription total in every rollup. Labelled so it is chosen
  // deliberately rather than by accident.
  { key: "implementation", label: "Implementation (one time)" },
];

export function TimeLogForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const mins = Number(minutes);
    if (!category || !Number.isFinite(mins) || mins <= 0) {
      setError("Pick a category and enter the minutes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/time-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskCategory: category, minutes: mins, note }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "That did not save.");
        setBusy(false);
        return;
      }
      setMinutes("");
      setNote("");
      setCategory(null);
      router.refresh();
    } catch {
      setError("That did not save.");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(category === c.key ? null : c.key)}
            className={
              "rounded-full border px-3 py-1.5 text-xs " +
              (category === c.key
                ? "border-[#00C9A7] bg-[rgba(0,201,167,0.15)] text-white"
                : "border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.55)] hover:text-white")
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      {category && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            inputMode="numeric"
            placeholder="Minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-28 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white outline-none focus:border-[#00C9A7]"
          />
          <input
            placeholder="Note, optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="min-w-[160px] flex-1 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white outline-none focus:border-[#00C9A7]"
          />
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-[#00C9A7] px-4 py-2 text-sm font-semibold text-[#04252b] disabled:opacity-60"
          >
            {busy ? "Saving" : "Log"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
