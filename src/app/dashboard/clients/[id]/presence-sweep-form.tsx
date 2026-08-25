"use client";

// The presence sweep, confirmed one listing at a time. Delivery steps 4, 5 and 25.
//
// ‼️ THE SELECTOR WRITES confirmed_status, NEVER status. `status` is what the seed wrote.
// confirmed_status is what a person says after looking. Every artifact in this app reads the
// second one through effectiveStatus(), and until this panel existed nothing wrote it, so the
// whole sweep read as eighteen rows of "not checked" no matter how much work had been done.
//
// "Not confirmed" is not the same as "looked, could not check". Taking a confirmation back
// sends an empty value and the route nulls the column, which is a person saying they no longer
// stand behind the reading. Writing 'not_checked' into confirmed_status is a person asserting
// they DID look and could not get an answer, which is a different claim and one the cleanup
// list acts on.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SweepView {
  id: string;
  platform: string;
  platformLabel: string;
  tier: "core_six" | "extended";
  status: string;
  rawName: string | null;
  rawAddress: string | null;
  rawPhone: string | null;
  listingUrl: string | null;
  skipReason: string | null;
  confirmedStatus: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "not confirmed" },
  { value: "match", label: "match" },
  { value: "mismatch", label: "mismatch" },
  { value: "duplicate", label: "duplicate" },
  { value: "missing", label: "missing" },
  { value: "not_checked", label: "looked, could not check" },
];

const INPUT =
  "w-full rounded border border-white/10 bg-transparent px-1.5 py-1 text-[11px] text-white/85 placeholder:text-[rgba(255,255,255,0.25)] focus:border-white/30 focus:outline-none";

export function PresenceSweepForm({
  clientId,
  rows,
}: {
  clientId: string;
  rows: SweepView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  function field(row: SweepView, key: string, stored: string): string {
    return draft[row.id]?.[key] ?? stored;
  }

  function set(rowId: string, key: string, value: string) {
    setDraft((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), [key]: value } }));
  }

  async function save(row: SweepView) {
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/presence-sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          rowId: row.id,
          confirmedStatus: field(row, "confirmedStatus", row.confirmedStatus ?? ""),
          rawName: field(row, "rawName", row.rawName ?? ""),
          rawAddress: field(row, "rawAddress", row.rawAddress ?? ""),
          rawPhone: field(row, "rawPhone", row.rawPhone ?? ""),
          listingUrl: field(row, "listingUrl", row.listingUrl ?? ""),
          skipReason: field(row, "skipReason", row.skipReason ?? ""),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not save.");
      else {
        setDraft((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        router.refresh();
      }
    } catch {
      setError("That did not save.");
    }
    setBusy(null);
  }

  if (!rows.length) {
    return (
      <p className="text-xs text-[rgba(255,255,255,0.5)]">
        Nothing seeded yet. Step 4 writes one row per platform. If it is sitting in error, the
        Retry on the delivery checklist re-runs it.
      </p>
    );
  }

  const confirmed = rows.filter((r) => r.confirmedStatus !== null).length;
  const core = rows.filter((r) => r.tier === "core_six");
  const coreConfirmed = core.filter((r) => r.confirmedStatus !== null).length;

  let tier = "";

  return (
    <div className="space-y-3">
      <p className={"text-xs " + (confirmed === rows.length ? "text-[#4ADE80]" : "text-[#F5A623]")}>
        {coreConfirmed} of {core.length} core platforms confirmed, {confirmed} of {rows.length} overall.
        {confirmed < rows.length &&
          " A row with no confirmed status reads as not checked everywhere it is printed, which is an absence of evidence and never a finding of correctness."}
      </p>

      <div className="space-y-1">
        {rows.map((row) => {
          const showTier = row.tier !== tier;
          if (showTier) tier = row.tier;
          const dirty = Boolean(draft[row.id]);

          return (
            <div key={row.id}>
              {showTier && (
                <p className="mb-1 mt-3 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                  {row.tier === "core_six"
                    ? "core six, the findings gate"
                    : "extended, context only"}
                </p>
              )}

              <div className="grid grid-cols-[110px_130px_repeat(3,1fr)_auto] items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-[rgba(255,255,255,0.02)]">
                <span className="text-[11px] text-white/70">{row.platformLabel}</span>

                <select
                  className={INPUT}
                  value={field(row, "confirmedStatus", row.confirmedStatus ?? "")}
                  onChange={(e) => set(row.id, "confirmedStatus", e.target.value)}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-[#0B1426]">
                      {o.label}
                    </option>
                  ))}
                </select>

                <input
                  className={INPUT}
                  placeholder="name as listed"
                  value={field(row, "rawName", row.rawName ?? "")}
                  onChange={(e) => set(row.id, "rawName", e.target.value)}
                />
                <input
                  className={INPUT}
                  placeholder="address as listed"
                  value={field(row, "rawAddress", row.rawAddress ?? "")}
                  onChange={(e) => set(row.id, "rawAddress", e.target.value)}
                />
                <input
                  className={INPUT}
                  placeholder="phone as listed"
                  value={field(row, "rawPhone", row.rawPhone ?? "")}
                  onChange={(e) => set(row.id, "rawPhone", e.target.value)}
                />

                <button
                  type="button"
                  disabled={busy === row.id || !dirty}
                  onClick={() => save(row)}
                  className="rounded border border-white/15 px-2 py-1 text-[10px] hover:border-white/40 disabled:opacity-30"
                >
                  {busy === row.id ? "…" : "Save"}
                </button>
              </div>

              <div className="grid grid-cols-[110px_1fr_1fr] items-center gap-1.5 px-2 pb-1">
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                  {row.checkedAt
                    ? `${row.checkedBy ?? "someone"} · ${row.checkedAt.slice(0, 10)}`
                    : ""}
                </span>
                <input
                  className={INPUT}
                  placeholder="listing url"
                  value={field(row, "listingUrl", row.listingUrl ?? "")}
                  onChange={(e) => set(row.id, "listingUrl", e.target.value)}
                />
                <input
                  className={INPUT}
                  placeholder="if it cannot be checked or fixed, why"
                  value={field(row, "skipReason", row.skipReason ?? "")}
                  onChange={(e) => set(row.id, "skipReason", e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
