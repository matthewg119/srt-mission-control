"use client";

// The AI Concierge switch. One control, two states, and it says what it is actually doing.
//
// ‼️ IT REPORTS `live`, NOT `enabled`. loadConciergeConfig serves `enabled && addonStatus !==
// "declined"` (config.ts:164), so a declined client with the column set true is OFF on every page.
// A panel reading the raw column would say "on" about a widget nobody can see. The switch writes
// `enabled`; the banner reads `live`.
//
// ‼️ THE WARNINGS ARE NOT A GATE. Audience unconfirmed and no booking destination are step 36's
// conditions, and step 36 still refuses over both. They are shown here so turning it on is never a
// surprise, and the panel says so in as many words rather than implying this completes the step.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { stepNumber } from "@/config/delivery-steps";

export interface ConciergeSwitchView {
  /** Null when step 18 has not provisioned a config row yet. */
  present: boolean;
  enabled: boolean;
  live: boolean;
  addonStatus: "undecided" | "included" | "declined";
  audienceConfirmed: boolean;
  hasBookingDestination: boolean;
  originCount: number;
  embedSnippet: string | null;
}

export function ConciergeForm({ clientId, view }: { clientId: string; view: ConciergeSwitchView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const previewStep = stepNumber("concierge_preview");
  const liveStep = stepNumber("concierge_live");

  async function flip(enabled: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/concierge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; lines?: string[] };
      if (!json.ok) {
        setError(json.error ?? "Save failed.");
        return;
      }
      setNotice((json.lines ?? []).join(" ").replace(/:[a-z_]+:/g, "").trim() || "Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!view.present) {
    return (
      <div className="space-y-3 text-[12px]">
        <div className="rounded border border-[#F5A623]/25 bg-[#F5A623]/5 p-3">
          <p className="text-[#F5A623]">No concierge row for this client yet.</p>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            Step {previewStep} (<code>concierge_preview</code>) is what creates it, seeds the allowed
            origins and mints the demo link. Run that step and this switch appears.
          </p>
        </div>
      </div>
    );
  }

  const declined = view.addonStatus === "declined";

  return (
    <div className="space-y-4 text-[12px]">
      <div
        className={`rounded border p-3 ${
          view.live ? "border-[#4ADE80]/25 bg-[#4ADE80]/5" : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.02)]"
        }`}
      >
        <p className={view.live ? "text-[#4ADE80]" : "text-white/70"}>
          {view.live ? "The concierge is live on their pages." : "The concierge is not showing on any page."}
        </p>
        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
          {declined ? (
            <>
              The add-on is marked <span className="text-white/85">declined</span>, so the widget stays
              off whatever this switch says. Type <code>concierge install</code> in any of their step
              threads to undo that.
            </>
          ) : (
            <>
              A change takes up to five minutes to reach a page already open, because the public
              config is cached that long.
            </>
          )}
        </p>
      </div>

      {error ? <p className="text-[11px] text-[#F87171]">{error}</p> : null}
      {notice ? <p className="text-[11px] text-[#4ADE80]">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void flip(true)}
          disabled={busy || (view.enabled && !declined) || declined}
          className="rounded border border-[#4ADE80]/30 px-3 py-1.5 text-[11px] text-[#4ADE80] hover:border-[#4ADE80]/60 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Turn it ON"}
        </button>
        <button
          type="button"
          onClick={() => void flip(false)}
          disabled={busy || !view.enabled}
          className="rounded border border-[#F87171]/30 px-3 py-1.5 text-[11px] text-[#F87171] hover:border-[#F87171]/60 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Turn it OFF"}
        </button>
      </div>

      {/* The step 36 conditions this switch deliberately does not enforce. */}
      <ul className="space-y-1 text-[11px] text-[rgba(255,255,255,0.45)]">
        <li>
          {view.audienceConfirmed ? "OK" : "TODO"} &nbsp; Audience{" "}
          {view.audienceConfirmed ? "confirmed" : "is still the seeded one, confirm it on step " + previewStep}
        </li>
        <li>
          {view.hasBookingDestination ? "OK" : "TODO"} &nbsp; Booking destination{" "}
          {view.hasBookingDestination ? "set" : "missing, the widget has nowhere to send anybody"}
        </li>
        <li>
          {view.originCount > 0 ? "OK" : "note"} &nbsp;{" "}
          {view.originCount > 0
            ? `${view.originCount} allowed origin${view.originCount === 1 ? "" : "s"}`
            : "No allowed origins listed, which means their own hosts only"}
        </li>
      </ul>

      <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
        This switch does not tick step {liveStep}. That step checks the audience, the booking
        destination and the consent copy as well, and it still refuses until all of them hold.
      </p>

      {view.embedSnippet ? (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
            The line for their own website
          </p>
          <code className="block overflow-x-auto rounded border border-white/10 bg-black/30 p-2 text-[11px] text-white/70">
            {view.embedSnippet}
          </code>
        </div>
      ) : null}
    </div>
  );
}
