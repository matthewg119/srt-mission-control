"use client";

// The sixteen steps, and what you do to them.
//
// ‼️ A REFUSAL IS RENDERED IN FULL, INCLUDING WHAT WAS CHECKED. The verifier answers "here is
// what I looked at, here is what I found, here is what to do" and a surface that reduced that to
// "failed" would throw away the only part that helps. `not_yet` gets a Re-check button; `broken`
// does not, because re-checking a code fault reproduces it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface BoardStep {
  key: string;
  number: number;
  label: string;
  detail: string | null;
  phase: string;
  gate: boolean;
  noWebsiteOnly: boolean;
  status: string;
  verifiedSource: string | null;
  verifiedDetail: string | null;
  note: string | null;
  skippedReason: string | null;
  errorDetail: string | null;
  waitingOn: string[];
}

interface Verdict {
  ok: boolean;
  kind: string;
  checked?: string;
  found?: string;
  todo?: string;
  fix?: string;
  evidence?: string[];
}

/**
 * The steps whose evidence is an artifact a person produces, not state the app can observe.
 *
 * ‼️ IT MUST STAY IN STEP WITH THE VERIFIERS THAT CALL filedArtifacts() IN lib/launch/verify.ts.
 * A step listed here with no such verifier offers an upload that confirms nothing; a step with
 * one and not listed here can never be ticked from this page at all, which is the worse half.
 */
const FILES_EVIDENCE = new Set(["day_zero_archive", "gbp_access", "gbp_buildout", "reviews_live"]);

const MARK: Record<string, { glyph: string; className: string; title: string }> = {
  observed: { glyph: "✓", className: "text-[#00C9A7]", title: "The app observed real state" },
  filed: { glyph: "▣", className: "text-[#7FB3FF]", title: "A person filed an artifact and the app read it back" },
  skipped: { glyph: "–", className: "text-[rgba(255,255,255,0.3)]", title: "Marked not applicable" },
  error: { glyph: "!", className: "text-[#FF6B6B]", title: "Parked in error" },
  none: { glyph: "○", className: "text-[rgba(255,255,255,0.18)]", title: "Outstanding" },
};

function markFor(s: BoardStep): (typeof MARK)[string] {
  if (s.status === "skipped") return MARK.skipped;
  if (s.status === "error") return MARK.error;
  if (s.status === "complete") return s.verifiedSource === "filed" ? MARK.filed : MARK.observed;
  return MARK.none;
}

export function LaunchBoard({ clientId, steps }: { clientId: string; steps: BoardStep[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Record<string, { message: string; verdict: Verdict | null }>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [filing, setFiling] = useState<string | null>(null);

  async function file(stepKey: string, f: File) {
    setFiling(stepKey);
    setRefusal((r) => {
      const next = { ...r };
      delete next[stepKey];
      return next;
    });
    const form = new FormData();
    form.set("stepKey", stepKey);
    form.set("file", f);
    try {
      const res = await fetch(`/api/launch/${clientId}/artifact`, { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setRefusal((r) => ({ ...r, [stepKey]: { message: json.error ?? "That did not work.", verdict: null } }));
      } else {
        router.refresh();
      }
    } catch {
      setRefusal((r) => ({ ...r, [stepKey]: { message: "That did not work. Check your connection.", verdict: null } }));
    }
    setFiling(null);
  }

  async function act(stepKey: string, transition: "complete" | "skipped" | "reopened", skippedReason?: string) {
    setBusy(stepKey);
    setRefusal((r) => {
      const next = { ...r };
      delete next[stepKey];
      return next;
    });
    try {
      const res = await fetch(`/api/launch/${clientId}/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepKey, transition, skippedReason }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; verdict?: Verdict | null };
      if (!json.ok) {
        setRefusal((r) => ({
          ...r,
          [stepKey]: { message: json.error ?? "That did not work.", verdict: json.verdict ?? null },
        }));
      } else {
        router.refresh();
      }
    } catch {
      setRefusal((r) => ({ ...r, [stepKey]: { message: "That did not work. Check your connection.", verdict: null } }));
    }
    setBusy(null);
  }

  let phase = "";

  return (
    <ol className="space-y-1.5">
      {steps.map((s) => {
        const mark = markFor(s);
        const settled = s.status === "complete" || s.status === "skipped";
        const header = s.phase !== phase ? ((phase = s.phase), s.phase) : null;
        const r = refusal[s.key];
        const isOpen = open === s.key;

        return (
          <li key={s.key}>
            {header && (
              <p className="mb-2 mt-6 text-[11px] uppercase tracking-wider text-[rgba(255,255,255,0.3)]">
                {header}
              </p>
            )}
            <div
              className={`rounded-xl border px-4 py-3 ${
                s.status === "error"
                  ? "border-[rgba(255,107,107,0.35)] bg-[rgba(255,107,107,0.04)]"
                  : "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 text-sm ${mark.className}`} title={mark.title}>
                  {mark.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => setOpen(isOpen ? null : s.key)}
                    className="block w-full text-left"
                  >
                    <p className={`text-sm ${settled ? "text-[rgba(255,255,255,0.45)]" : "text-white"}`}>
                      <span className="mr-2 text-[rgba(255,255,255,0.3)]">{s.number}</span>
                      {s.label}
                      {s.gate && (
                        <span className="ml-2 rounded bg-[rgba(245,166,35,0.15)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#F5A623]">
                          wall
                        </span>
                      )}
                      {s.noWebsiteOnly && (
                        <span className="ml-2 text-[10px] text-[rgba(255,255,255,0.3)]">no-website only</span>
                      )}
                    </p>
                  </button>

                  {s.verifiedDetail && settled && (
                    <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.4)]">{s.verifiedDetail}</p>
                  )}
                  {s.skippedReason && (
                    <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">{s.skippedReason}</p>
                  )}
                  {s.errorDetail && <p className="mt-1 text-[11px] text-[#FF6B6B]">{s.errorDetail}</p>}

                  {isOpen && s.detail && (
                    <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[rgba(255,255,255,0.5)]">
                      {s.detail}
                    </p>
                  )}

                  {s.waitingOn.length > 0 && !settled && (
                    <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.3)]">
                      waits on {s.waitingOn.join(", ")}
                    </p>
                  )}

                  {r && (
                    <div className="mt-2 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.05)] p-3">
                      <p className="text-xs text-[#F5A623]">{r.message}</p>
                      {r.verdict?.checked && (
                        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.4)]">
                          Checked {r.verdict.checked}.
                        </p>
                      )}
                      {r.verdict?.todo && (
                        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.6)]">{r.verdict.todo}</p>
                      )}
                      {r.verdict?.fix && (
                        <p className="mt-1 text-[11px] text-[#FF6B6B]">
                          {/* `broken` is a code fault. It gets no Re-check button, because
                              re-checking one only reproduces it. */}
                          Fix: {r.verdict.fix}
                        </p>
                      )}
                    </div>
                  )}

                  {isOpen && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!settled && (
                        <button
                          onClick={() => void act(s.key, "complete")}
                          disabled={busy === s.key}
                          className="rounded-lg border border-[rgba(0,201,167,0.4)] px-3 py-1.5 text-xs text-[#00C9A7] disabled:opacity-40"
                        >
                          {busy === s.key ? "Checking..." : r ? "Re-check" : "Done"}
                        </button>
                      )}
                      {!settled && !s.gate && (
                        <button
                          onClick={() => void act(s.key, "skipped", "Marked not applicable from the board")}
                          disabled={busy === s.key}
                          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] disabled:opacity-40"
                        >
                          Not applicable
                        </button>
                      )}
                      {FILES_EVIDENCE.has(s.key) && !settled && (
                        <label className="cursor-pointer rounded-lg border border-[rgba(127,179,255,0.4)] px-3 py-1.5 text-xs text-[#7FB3FF]">
                          <input
                            type="file"
                            className="hidden"
                            disabled={filing === s.key}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void file(s.key, f);
                              e.target.value = "";
                            }}
                          />
                          {filing === s.key ? "Filing..." : "File evidence"}
                        </label>
                      )}
                      {settled && (
                        <button
                          onClick={() => void act(s.key, "reopened")}
                          disabled={busy === s.key}
                          className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] disabled:opacity-40"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
