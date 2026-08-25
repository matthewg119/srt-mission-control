"use client";

// Delivery step 8: the review counts, read off the listings and typed in.
//
// ‼️ EVERY NUMBER BOX PLACEHOLDERS "not recorded", NEVER "0". Zero reviews and un-checked are
// opposite claims about a business, and this grid is what findings section 3 prints. An empty
// box sends null and the route writes null; it never coerces, because Number("") is 0 and that
// would silently assert a business has no reviews. See the header of the route.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewAuditView {
  id: string;
  subjectType: "client" | "competitor";
  subjectName: string;
  platform: string;
  platformLabel: string;
  reviewCount: number | null;
  averageRating: number | null;
  mostRecentReviewAt: string | null;
  ownerResponseRate: number | null;
  negativeThemes: string[];
  checkedBy: string | null;
  checkedAt: string | null;
}

const INPUT =
  "w-full rounded border border-white/10 bg-transparent px-1.5 py-1 text-[11px] text-white/85 placeholder:text-[rgba(255,255,255,0.25)] focus:border-white/30 focus:outline-none";

function dayOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function ReviewAuditForm({
  clientId,
  rows,
}: {
  clientId: string;
  rows: ReviewAuditView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  function field(row: ReviewAuditView, key: string, stored: string): string {
    return draft[row.id]?.[key] ?? stored;
  }

  function set(rowId: string, key: string, value: string) {
    setDraft((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), [key]: value } }));
  }

  async function save(row: ReviewAuditView) {
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/review-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "measure",
          rowId: row.id,
          reviewCount: field(row, "reviewCount", row.reviewCount?.toString() ?? ""),
          averageRating: field(row, "averageRating", row.averageRating?.toString() ?? ""),
          ownerResponseRate: field(
            row,
            "ownerResponseRate",
            row.ownerResponseRate?.toString() ?? ""
          ),
          mostRecentReviewAt: field(row, "mostRecentReviewAt", dayOnly(row.mostRecentReviewAt)),
          negativeThemes: field(row, "negativeThemes", row.negativeThemes.join(", ")),
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
        No grid yet. It is seeded from the three competitors picked at step 7, so pick them
        first and the rows appear here.
      </p>
    );
  }

  const measured = rows.filter((r) => r.reviewCount !== null && r.checkedAt !== null).length;

  let subject = "";

  return (
    <div className="space-y-3">
      <p className={"text-xs " + (measured === rows.length ? "text-[#4ADE80]" : "text-[#F5A623]")}>
        {measured} of {rows.length} rows carry a measured count.
        {measured < rows.length &&
          " No platform here has an API, so these are read off the listings by hand. A row left blank prints as not recorded, never as zero."}
      </p>

      <div className="space-y-1">
        {rows.map((row) => {
          const showSubject = row.subjectName !== subject;
          if (showSubject) subject = row.subjectName;
          const dirty = Boolean(draft[row.id]);

          return (
            <div key={row.id}>
              {showSubject && (
                <p className="mb-1 mt-3 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                  {row.subjectName}
                  {row.subjectType === "client" && (
                    <span className="ml-1.5 normal-case tracking-normal text-[#00C9A7]">
                      the client
                    </span>
                  )}
                </p>
              )}

              <div className="grid grid-cols-[80px_repeat(4,1fr)_auto] items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-[rgba(255,255,255,0.02)]">
                <span className="text-[11px] text-white/70">{row.platformLabel}</span>

                <input
                  className={INPUT}
                  inputMode="numeric"
                  placeholder="not recorded"
                  title="Total reviews"
                  value={field(row, "reviewCount", row.reviewCount?.toString() ?? "")}
                  onChange={(e) => set(row.id, "reviewCount", e.target.value)}
                />
                <input
                  className={INPUT}
                  inputMode="decimal"
                  placeholder="rating"
                  title="Average rating, 0 to 5"
                  value={field(row, "averageRating", row.averageRating?.toString() ?? "")}
                  onChange={(e) => set(row.id, "averageRating", e.target.value)}
                />
                <input
                  className={INPUT}
                  type="date"
                  title="Date of the most recent review"
                  value={field(row, "mostRecentReviewAt", dayOnly(row.mostRecentReviewAt))}
                  onChange={(e) => set(row.id, "mostRecentReviewAt", e.target.value)}
                />
                <input
                  className={INPUT}
                  inputMode="numeric"
                  placeholder="replies /10"
                  title="How many of the last 10 reviews the owner answered"
                  value={field(
                    row,
                    "ownerResponseRate",
                    row.ownerResponseRate?.toString() ?? ""
                  )}
                  onChange={(e) => set(row.id, "ownerResponseRate", e.target.value)}
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

              <div className="px-2 pb-1">
                <input
                  className={INPUT}
                  placeholder="themes in the negatives, comma separated. Type what you read, nothing is generated here."
                  value={field(row, "negativeThemes", row.negativeThemes.join(", "))}
                  onChange={(e) => set(row.id, "negativeThemes", e.target.value)}
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
