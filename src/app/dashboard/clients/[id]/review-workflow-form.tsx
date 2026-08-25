"use client";

// Delivery steps 29 and 30: how they ask for reviews, who owns the tool, and where reviews go.
//
// ‼️ THIS PANEL IS THE MISSING WRITER FOR THREE THINGS THAT ONLY EVER HAD READERS.
// Step 29's refusal said "Set it on the client board" and there was no control anywhere that
// wrote `review_request_mode`, so that step could never be confirmed for any client. The two
// URL fields are why the review tool's "Post on Google" button has never once appeared: it
// reads `review_workflow.google_url` and nothing has ever written it. See the route header.
//
// The intake destinations are printed above the URL boxes, not as decoration: step 4 asks WHERE
// they collect reviews and gets back labels ("Google", "RealSelf"), which is what tells you
// which links to go and ask for.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewWorkflowView {
  mode: "booking_system" | "card_only" | null;
  ownerName: string | null;
  googleUrl: string | null;
  realselfUrl: string | null;
  /** The labels from intake step 4, verbatim. */
  intakeDestinations: string[];
  bookingSoftware: string | null;
}

const INPUT =
  "w-full rounded border border-white/10 bg-transparent px-2 py-1.5 text-[12px] text-white/85 placeholder:text-[rgba(255,255,255,0.25)] focus:border-white/30 focus:outline-none";
const LABEL = "mb-1 block text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.4)]";

export function ReviewWorkflowForm({
  clientId,
  view,
}: {
  clientId: string;
  view: ReviewWorkflowView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [mode, setMode] = useState<string>(view.mode ?? "");
  const [ownerName, setOwnerName] = useState(view.ownerName ?? "");
  const [googleUrl, setGoogleUrl] = useState(view.googleUrl ?? "");
  const [realselfUrl, setRealselfUrl] = useState(view.realselfUrl ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/review-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ownerName,
          google_url: googleUrl,
          realself_url: realselfUrl,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Save failed.");
        return;
      }
      setNotice("Saved.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A role is not a person. Flagged rather than refused: an owner with one receptionist is
  // entitled to write what they want, and step 30's evidence is a reply in the thread anyway.
  const roleNotName = /^(the )?(front desk|reception|receptionist|staff|team|office)$/i.test(
    ownerName.trim()
  );

  return (
    <div className="space-y-4 text-[12px]">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="rw-mode">
            How they ask (step 29)
          </label>
          <select
            id="rw-mode"
            className={INPUT}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="">Not decided yet</option>
            <option value="booking_system">
              booking_system — automated request in their software
            </option>
            <option value="card_only">card_only — the printed cards are the mechanism</option>
          </select>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            {mode === "booking_system" ? (
              <>
                Recorded. Step 29 still wants a screenshot of the configured request in its
                thread, because their booking software is not something this app can query.
                {view.bookingSoftware ? ` They use ${view.bookingSoftware}.` : ""}
              </>
            ) : mode === "card_only" ? (
              "Recorded, and that is a complete answer. Step 29 confirms on this alone."
            ) : (
              "Step 29 refuses until this is one of the two. The label allows either."
            )}
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor="rw-owner">
            Who owns the tool (step 30)
          </label>
          <input
            id="rw-owner"
            className={INPUT}
            value={ownerName}
            placeholder="A name, not a role"
            onChange={(e) => setOwnerName(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.45)]">
            {roleNotName
              ? "That is a role, not a person. Step 30 says handed to the NAMED person, and a link sent to a desk is a link nobody owns."
              : "Step 30's card reads this back so you can check the handover went to the right person."}
          </p>
        </div>
      </div>

      <div className="rounded border border-white/10 p-3">
        <p className={LABEL}>Where her review goes</p>
        <p className="mb-3 text-[11px] text-[rgba(255,255,255,0.45)]">
          {view.intakeDestinations.length ? (
            <>
              At intake they said they collect on:{" "}
              <span className="text-white/70">{view.intakeDestinations.join(", ")}</span>. Get the
              real links for those.
            </>
          ) : (
            "Intake step 4 recorded no destinations, so ask on the call."
          )}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="rw-google">
              Google review link
            </label>
            <input
              id="rw-google"
              className={INPUT}
              value={googleUrl}
              placeholder="https://g.page/r/..."
              onChange={(e) => setGoogleUrl(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="rw-realself">
              RealSelf review link
            </label>
            <input
              id="rw-realself"
              className={INPUT}
              value={realselfUrl}
              placeholder="https://www.realself.com/..."
              onChange={(e) => setRealselfUrl(e.target.value)}
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.45)]">
          These are the buttons on the review tool. With nothing set, every customer gets a hint
          telling her to go and find the page herself, which is where most of them stop.{" "}
          <span className="text-[#F5A623]">
            Leave a box empty rather than guessing: a wrong link sends her to somebody else&apos;s
            business.
          </span>
        </p>
      </div>

      {error ? <p className="text-[11px] text-[#F87171]">{error}</p> : null}
      {notice ? <p className="text-[11px] text-[#4ADE80]">{notice}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/80 hover:border-white/30 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
