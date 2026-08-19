"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, X } from "lucide-react";
import { STAGE_TAKE_OFF_LIST } from "@/config/stage-display";

// The call form. Its whole job is that you cannot leave without a next date.
//
// Save stays disabled until a follow-up date is picked, and the date defaults
// from the lead's stage cadence so the common case is one click. The API route
// (/api/crm/leads/[id]/call-log) rejects a missing date independently — this
// is the ergonomic layer, not the enforcement layer.
//
// The exception is the take-off box: a lead coming off the list has no next
// date, so ticking it replaces the date requirement instead of bypassing it.

/**
 * Outcomes that mean there is nothing left to call. Ticking the box in the form
 * sends the Take Off List stage with the call, which flips do_not_contact and
 * drops the lead off every board. Pre-ticked for these two because "bad number"
 * and "never call me again" have no next date by definition — but it stays a
 * checkbox, since a wrong number can also just be a typo worth fixing.
 */
const TAKE_OFF_OUTCOMES = new Set(["bad_number", "not_interested"]);

const OUTCOMES = [
  { value: "connected", label: "Connected", tone: "#4CAF50" },
  { value: "voicemail", label: "Voicemail", tone: "#F5A623" },
  { value: "no_answer", label: "No answer", tone: "#9CA3AF" },
  { value: "booked", label: "Booked", tone: "#00C9A7" },
  { value: "not_interested", label: "Not interested", tone: "#E74C3C" },
  { value: "bad_number", label: "Bad number", tone: "#E74C3C" },
] as const;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function LogCallForm({
  contactId,
  leadName,
  defaultFollowUpDays = 3,
  initialOutcome,
  onClose,
  chrome = true,
}: {
  contactId: string;
  leadName: string;
  /** From STAGE_CADENCE for the lead's current stage. */
  defaultFollowUpDays?: number;
  initialOutcome?: string;
  onClose?: () => void;
  /**
   * Card border + "Log call — name" header. Off when a parent already draws the
   * card, which is the case on the lead page now that the card carries tabs —
   * the tab strip says which form this is, so a second title said it twice.
   * The worklist modal still owns its own copy and passes nothing.
   */
  chrome?: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(initialOutcome ?? "");
  const [takeOff, setTakeOff] = useState(
    initialOutcome ? TAKE_OFF_OUTCOMES.has(initialOutcome) : false
  );
  const [followUp, setFollowUp] = useState(addDays(defaultFollowUpDays));
  const [notes, setNotes] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A follow-up date is still mandatory for every call that leaves the lead
  // workable. Taking the lead off the list is the one thing that replaces it.
  const canSave = !!outcome && (takeOff || !!followUp) && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/leads/${contactId}/call-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          notes: notes || undefined,
          next_step: nextStep || undefined,
          ...(takeOff
            ? { status: STAGE_TAKE_OFF_LIST }
            : { next_follow_up_date: followUp }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to log call");
      onClose?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const body = (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            onClick={() => {
              setOutcome(o.value);
              setTakeOff(TAKE_OFF_OUTCOMES.has(o.value));
            }}
            className="rounded-lg border px-3 py-1.5 text-xs transition-all"
            style={{
              borderColor: outcome === o.value ? o.tone : "rgba(255,255,255,0.1)",
              background: outcome === o.value ? `${o.tone}22` : "rgba(255,255,255,0.03)",
              color: outcome === o.value ? o.tone : "rgba(255,255,255,0.6)",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {!!outcome && (
        <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: takeOff ? "#C0392B" : "rgba(255,255,255,0.1)",
            background: takeOff ? "rgba(192,57,43,0.12)" : "rgba(255,255,255,0.03)",
          }}
        >
          <input
            type="checkbox"
            checked={takeOff}
            onChange={(e) => setTakeOff(e.target.checked)}
            className="mt-0.5 accent-[#C0392B]"
          />
          <span className={takeOff ? "text-white" : "text-[rgba(255,255,255,0.6)]"}>
            Take off the list
            <span className="block text-[11px] text-[rgba(255,255,255,0.4)]">
              Stops every call, text and email, cancels the open follow-up, and
              drops the lead off the board. Reversible from the status picker.
            </span>
          </span>
        </label>
      )}

      <div className={takeOff ? "hidden" : "mb-3"}>
        <label className="mb-1 block text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
          Next follow-up — required
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={followUp}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setFollowUp(e.target.value)}
            className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-1.5 text-xs text-white"
          />
          {[1, 3, 7, 14].map((d) => (
            <button
              key={d}
              onClick={() => setFollowUp(addDays(d))}
              className="rounded-lg border border-[rgba(255,255,255,0.08)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.5)] hover:text-white"
            >
              +{d}d
            </button>
          ))}
        </div>
      </div>

      <input
        value={nextStep}
        onChange={(e) => setNextStep(e.target.value)}
        placeholder="Next step (e.g. 'Call about statements')"
        className="mb-2 w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
      />

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What was discussed…"
        rows={3}
        className="mb-3 w-full resize-none rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
      />

      {error && <p className="mb-2 text-xs text-[#E74C3C]">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
          {!outcome ? "Pick an outcome to save." : takeOff ? "No follow-up needed." : ""}
        </p>
        <button
          onClick={submit}
          disabled={!canSave}
          className="rounded-lg bg-[#1B65A7] px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : takeOff ? "Log call + take off list" : "Log call"}
        </button>
      </div>
    </>
  );

  if (!chrome) return body;

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <PhoneCall className="h-4 w-4" />
          Log call — {leadName}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[rgba(255,255,255,0.4)] hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {body}
    </div>
  );
}
