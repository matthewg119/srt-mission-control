"use client";

// The internal delivery checklist, ticked from here.
//
// Not Slack buttons: fourteen steps blow past Block Kit's five-elements-per-actions-block
// limit, and this repo's reaction-gated cards are documented as unreliable while the
// reactions:read scope is outstanding. Ticking here re-renders the Slack message and
// drops a line into the thread, so Slack stays the place you READ it and this is the
// place you change it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DELIVERY_STEPS } from "@/lib/clients/delivery-checklist";

export function DeliveryChecklistForm({
  clientId,
  completed,
}: {
  clientId: string;
  /** step_key values currently marked complete. */
  completed: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = new Set(completed);

  const gateIndex = DELIVERY_STEPS.findIndex((s) => s.gate);
  const gateOpen = gateIndex >= 0 && !done.has(DELIVERY_STEPS[gateIndex].key);
  const jumpedGate =
    gateOpen && DELIVERY_STEPS.slice(gateIndex + 1).some((s) => done.has(s.key));

  async function toggle(stepKey: string, complete: boolean) {
    setBusy(stepKey);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/delivery-step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey, complete }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || "That did not save.");
      else router.refresh();
    } catch {
      setError("That did not save.");
    }
    setBusy(null);
  }

  let phase = "";

  return (
    <div>
      {jumpedGate && (
        <p className="mb-3 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.08)] px-3 py-2 text-[11px] text-[#F5A623]">
          Build steps are ticked but the Day-0 scan was never archived. Day 30, 60 and 90
          have nothing to measure against.
        </p>
      )}

      <ul className="space-y-1">
        {DELIVERY_STEPS.map((step, i) => {
          const isDone = done.has(step.key);
          const showPhase = step.phase !== phase;
          if (showPhase) phase = step.phase;

          return (
            <li key={step.key}>
              {showPhase && (
                <p className="mb-1 mt-3 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                  {step.phase}
                </p>
              )}
              <button
                type="button"
                disabled={busy === step.key}
                onClick={() => toggle(step.key, !isDone)}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[rgba(255,255,255,0.03)] disabled:opacity-50"
              >
                <span
                  className={
                    "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] " +
                    (isDone
                      ? "border-[#00C9A7] bg-[#00C9A7] text-[#04252b]"
                      : "border-[rgba(255,255,255,0.2)]")
                  }
                >
                  {isDone ? "✓" : ""}
                </span>
                <span
                  className={
                    "text-[11px] leading-relaxed " +
                    (isDone ? "text-[rgba(255,255,255,0.4)] line-through" : "text-white/85")
                  }
                >
                  {i + 1}. {step.label}
                  {step.auto && (
                    <span className="ml-1.5 text-[rgba(255,255,255,0.3)]">auto</span>
                  )}
                  {step.gate && (
                    <span className="ml-1.5 text-[#F5A623]">gate</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
