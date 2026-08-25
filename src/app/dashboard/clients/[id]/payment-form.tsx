"use client";

// The payment record. What unlocks delivery step 21.
//
// ‼️ THIS PANEL RECORDS AN ASSERTION AND EVERY WORD ON IT SAYS SO.
// Nothing in Mission Control talks to a payment processor, so nothing here can observe money
// arriving. It is the same distinction `day_0_source` draws between a real archived run and a
// human ticking a box. The copy is "payment recorded by X on DATE", never "payment received",
// and the test suite greps for the second phrase.
//
// ‼️ IT IS A PANEL RATHER THAN A DELIVERY-STEP CHECKBOX ON PURPOSE. Recording the payment does
// not complete a step; it unblocks step 21, which still wants its own screenshots before anybody
// ticks it. Same split the competitors panel draws between picking and ticking.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PaymentView {
  recordedAt: string | null;
  recordedBy: string | null;
  terms: string | null;
  note: string | null;
  /** Whether step 21 is still outstanding, so the panel can say what it is holding up. */
  accessOutstanding: boolean;
}

const INPUT =
  "w-full rounded border border-white/10 bg-transparent px-2 py-1.5 text-[12px] text-white/85 placeholder:text-[rgba(255,255,255,0.25)] focus:border-white/30 focus:outline-none";
const LABEL = "mb-1 block text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.4)]";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentForm({ clientId, view }: { clientId: string; view: PaymentView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [terms, setTerms] = useState(view.terms ?? "");
  const [note, setNote] = useState(view.note ?? "");
  const [recordedAt, setRecordedAt] = useState((view.recordedAt ?? "").slice(0, 10) || today());

  const recorded = Boolean(view.recordedAt);

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; line?: string };
      if (!json.ok) {
        setError(json.error ?? "Save failed.");
        return;
      }
      setNotice(json.line ?? "Cleared.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-[12px]">
      <div
        className={`rounded border p-3 ${
          recorded ? "border-[#4ADE80]/25 bg-[#4ADE80]/5" : "border-[#F5A623]/25 bg-[#F5A623]/5"
        }`}
      >
        <p className={recorded ? "text-[#4ADE80]" : "text-[#F5A623]"}>
          {recorded ? (
            <>
              Payment recorded by{" "}
              <span className="text-white/85">{view.recordedBy ?? "somebody unnamed"}</span> on{" "}
              <span className="text-white/85">{(view.recordedAt ?? "").slice(0, 10)}</span>
            </>
          ) : (
            "No payment recorded. Step 21 refuses until there is one."
          )}
        </p>
        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
          This is an assertion this board keeps, not evidence of a charge. Nothing here talks to a
          payment processor, so it records what somebody says was agreed and who said it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="pay-terms">
            What was agreed
          </label>
          <input
            id="pay-terms"
            className={INPUT}
            value={terms}
            placeholder="e.g. card on file, first invoice on day 30"
            onChange={(e) => setTerms(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            Required. Every card that mentions the payment reads this back, so a blank one leaves
            the next person with a date and no idea what it means.
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="pay-date">
            Date recorded
          </label>
          <input
            id="pay-date"
            type="date"
            className={INPUT}
            value={recordedAt}
            max={today()}
            onChange={(e) => setRecordedAt(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            The day it was agreed, not the day you typed it. A future date is refused.
          </p>
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="pay-note">
          Anything else the next person needs
        </label>
        <input
          id="pay-note"
          className={INPUT}
          value={note}
          placeholder="Card on file yes or no, what is still outstanding"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {view.accessOutstanding ? (
        <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
          Step 21 collects GBP manager access, Search Console and Analytics. It is held until this
          is recorded, because a client who has not committed does not hand over their Google
          account, and asking early is how a call ends with neither.
        </p>
      ) : (
        <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
          Step 21 is already resolved, so this is a record rather than a gate.
        </p>
      )}

      {error ? <p className="text-[11px] text-[#F87171]">{error}</p> : null}
      {notice ? <p className="text-[11px] text-[#4ADE80]">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void send({ terms, note, recordedAt })}
          disabled={busy}
          className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/80 hover:border-white/30 disabled:opacity-50"
        >
          {busy ? "Saving…" : recorded ? "Update the record" : "Record the payment"}
        </button>

        {recorded ? (
          <button
            type="button"
            onClick={() => void send({ clear: true })}
            disabled={busy}
            className="rounded border border-[#F87171]/30 px-3 py-1.5 text-[11px] text-[#F87171] hover:border-[#F87171]/60 disabled:opacity-50"
          >
            Clear it
          </button>
        ) : null}
      </div>

      {recorded ? (
        <p className="text-[11px] text-[rgba(255,255,255,0.45)]">
          Clearing it removes all four fields together and puts step 21 back behind the gate. Do it
          when the record was wrong, not to tidy up.
        </p>
      ) : null}
    </div>
  );
}
