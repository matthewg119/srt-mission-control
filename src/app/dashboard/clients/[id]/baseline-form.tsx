"use client";

// Re-run Photograph I.
//
// ‼️ THE COUNT NEXT TO THE BUTTON IS THE POINT, NOT THE BUTTON.
// `baseline_scan` ticking green never meant a measurement happened — it meant the pipeline
// finished, which it does perfectly happily with a dead OpenAI key and twenty no_data rows.
// Printing "0 prompts measured" beside a green step is how somebody notices; a button with
// no number beside it is a button nobody knows to press.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BaselineForm({
  clientId,
  website,
  measured,
  scannedAt,
}: {
  clientId: string;
  website: string | null;
  /** audit_runs rows with status 'ok' on this client's newest baseline. null = never scanned. */
  measured: number | null;
  scannedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rescan() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/rescan`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not start.");
      else {
        setNote(json.message as string);
        router.refresh();
      }
    } catch {
      setError("That did not start.");
    }
    setBusy(false);
  }

  const empty = measured === 0;

  return (
    <div>
      <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
        {measured === null ? (
          "No baseline has been run for this client yet."
        ) : empty ? (
          <span className="text-[#F5A623]">
            The last scan measured NOTHING: 0 prompts returned an answer, so all of them are
            filed as no_data. That is almost always the OpenAI key. Nothing downstream of this
            has anything to work from.
          </span>
        ) : (
          <>
            {measured} prompt{measured === 1 ? "" : "s"} measured
            {scannedAt ? ` · ${new Date(scannedAt).toLocaleDateString()}` : ""}
          </>
        )}
      </p>

      <button
        type="button"
        disabled={busy || !website}
        onClick={rescan}
        className={
          "mt-3 rounded-lg border px-3 py-1.5 text-[11px] transition disabled:opacity-40 " +
          (empty
            ? "border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.08)] text-[#F5A623]"
            : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.7)]")
        }
      >
        {busy ? "Starting…" : "Re-run baseline scan"}
      </button>

      {!website && (
        <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.35)]">
          No website on file, so there is nothing to scan.
        </p>
      )}
      {note && <p className="mt-2 text-[11px] text-[#00C9A7]">{note}</p>}
      {error && <p className="mt-2 text-[11px] text-[#FF6B6B]">{error}</p>}
    </div>
  );
}
