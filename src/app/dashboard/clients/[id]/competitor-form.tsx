"use client";

// Delivery step 7: pick three from the shortlist the baseline scan built.
//
// ‼️ IT FLAGS AT THREE, IT DOES NOT BLOCK. Same doctrine as the Measure gate and the market
// overlap check: a control that refuses gets worked around. The refusal that matters already
// lives in the step 7 verifier, which will not tick with nothing picked, and that is the right
// place for it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CandidateView {
  id: string;
  name: string;
  website: string | null;
  address: string | null;
  source: string;
  timesNamed: number;
  engines: string[];
  selected: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  baseline_named: "named by an engine",
  client_intake: "the client's guess",
  both: "named by an engine and by the client",
};

export function CompetitorForm({
  clientId,
  candidates,
  required,
}: {
  clientId: string;
  candidates: CandidateView[];
  required: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.selected).map((c) => c.id))
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", ids: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not save.");
      else router.refresh();
    } catch {
      setError("That did not save.");
    }
    setBusy(false);
  }

  if (!candidates.length) {
    return (
      <p className="text-xs text-[rgba(255,255,255,0.5)]">
        No shortlist yet. It is built from the baseline scan, so confirm step 2 first. A scan
        that named nobody is itself a finding worth saying on the call, not an empty screen to
        work around.
      </p>
    );
  }

  const count = picked.size;

  return (
    <div className="space-y-3">
      <p
        className={
          "text-xs " + (count === required ? "text-[#4ADE80]" : "text-[#F5A623]")
        }
      >
        {count} of {required} picked.
        {count !== required &&
          " The review audit and findings section 3 are both built from this choice, so an empty or partial pick makes both of them about the wrong businesses."}
      </p>

      <ul className="space-y-1">
        {candidates.map((c) => {
          const on = picked.has(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(c.id)}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[rgba(255,255,255,0.03)] disabled:opacity-50"
              >
                <span
                  className={
                    "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] " +
                    (on
                      ? "border-[#00C9A7] bg-[#00C9A7] text-[#04252b]"
                      : "border-[rgba(255,255,255,0.2)]")
                  }
                >
                  {on ? "✓" : ""}
                </span>
                <span className="text-[11px] leading-relaxed text-white/85">
                  {c.name}
                  <span className="ml-1.5 text-[rgba(255,255,255,0.4)]">
                    {c.timesNamed > 0
                      ? `named in ${c.timesNamed} of the questions`
                      : "never named by an engine"}
                    {" · "}
                    {SOURCE_LABEL[c.source] ?? c.source}
                    {c.engines.length ? ` · ${c.engines.join(", ")}` : ""}
                  </span>
                  {c.website && (
                    <span className="ml-1.5 text-[rgba(255,255,255,0.3)]">{c.website}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
        >
          {busy ? "…" : "Save the picks"}
        </button>
        <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
          Saving also seeds the review audit grid for whoever is picked.
        </span>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
