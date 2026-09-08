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
//
// ‼️ 2026-09-08: IT HAD TWO BOXES FOR SIX PLATFORMS, AND THAT WAS THE SECOND HALF OF THE SAME
// BUG THIS PANEL WAS BUILT TO FIX.
//
// The funnel offers six destinations. This panel offered Google and RealSelf. So a client who
// answered Trustpilot, Yelp, BBB or Facebook had their choice recorded on
// review_destination_primary and there was nowhere on any screen to put the matching link.
// SRT Agency's own row says 'trustpilot'. The review tool then rendered no button, correctly
// and silently, because absent beats wrong, and every customer got the fallback hint.
//
// All six are drawn from REVIEW_PLATFORMS now, and the panel SAYS WHICH ONE THE CLIENT PICKED,
// because the failure was never a missing box. It was that nothing on screen connected the
// answer they gave to the box that was empty.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  REVIEW_PLATFORMS,
  destinationLine,
  destinationState,
} from "@/lib/hub/review-destinations";

export interface ReviewWorkflowView {
  mode: "booking_system" | "card_only" | null;
  ownerName: string | null;
  /**
   * The `review_workflow` bag as stored, so this panel can read all six URL keys without the
   * page having to name each one. Only the URL fields are read here; the intake keys beside
   * them are left alone, and the route MERGES rather than replaces on save.
   */
  workflow: Record<string, unknown>;
  /** `clients.review_destination_primary`. A platform NAME, never a link. */
  primaryKey: string | null;
  /** The labels from intake step 4, verbatim. */
  intakeDestinations: string[];
  bookingSoftware: string | null;
  /** The live reviews host, so the panel can offer the thing it configures. */
  reviewsHost: string | null;
  /** Internal preview, login required. Null when CLIENT_LINK_SECRET is unset. */
  previewUrl: string | null;
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

  // One entry per platform, keyed by the review_workflow field it writes.
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const platform of REVIEW_PLATFORMS) {
      const raw = view.workflow[platform.field];
      seed[platform.field] = typeof raw === "string" ? raw : "";
    }
    return seed;
  });

  // Described from what is SAVED, not from what is typed. A box with an unsaved link in it has
  // not fixed anything yet, and a panel that said otherwise would be the same class of lie as a
  // green tick over unchecked work.
  const state = destinationState(view.workflow, view.primaryKey);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/review-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ownerName, ...urls }),
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

      {/*
        id="review-destination" so a step card can link straight at the boxes rather than at the
        top of a long board. Same precedent as id="theme", which step 15's card names by anchor.
      */}
      <div id="review-destination" className="rounded border border-white/10 p-3">
        <p className={LABEL}>Where her review goes</p>

        {/*
          ‼️ THE STATE LINE, AND ITS ABSENCE WAS THE WHOLE FAILURE. Everything needed to say
          "they chose Trustpilot and no Trustpilot link is set, so no button will appear" was
          already in the database. Nothing said it. destinationLine() is the one place that
          sentence is written, so the board, a step card and the tool all describe the same
          state in the same words.
        */}
        <p
          className={`mb-3 text-[11px] ${
            state.configured.length === 0 || state.primaryMissingUrl
              ? "text-[#F5A623]"
              : "text-[#4ADE80]"
          }`}
        >
          {destinationLine(state)}
        </p>

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
          {REVIEW_PLATFORMS.map((platform) => {
            const isPrimary = state.primary?.key === platform.key;
            return (
              <div key={platform.key}>
                <label className={LABEL} htmlFor={`rw-${platform.key}`}>
                  {platform.name} review link
                  {isPrimary ? (
                    <span className="ml-2 normal-case tracking-normal text-[#F5A623]">
                      their choice
                    </span>
                  ) : null}
                </label>
                <input
                  id={`rw-${platform.key}`}
                  className={
                    isPrimary && !urls[platform.field]?.trim()
                      ? `${INPUT} border-[#F5A623]/50`
                      : INPUT
                  }
                  value={urls[platform.field] ?? ""}
                  placeholder={platform.placeholder}
                  onChange={(e) =>
                    setUrls((prev) => ({ ...prev, [platform.field]: e.target.value }))
                  }
                />
              </div>
            );
          })}
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

      {/*
        ‼️ EVERY PANEL THAT STARTS SOMETHING PRINTS WHAT CAN BE DONE NEXT. Matthew's acceptance
        criterion, and the shape is step 15's card: the options, the preview, the live thing.
        A control that saves and then offers nothing is the bug being fixed.
      */}
      <div className="rounded border border-white/10 p-3 text-[11px] text-[rgba(255,255,255,0.55)]">
        <p className="mb-1 text-[rgba(255,255,255,0.75)]">Next</p>
        <ul className="space-y-1">
          {state.primaryMissingUrl && state.primary ? (
            <li>
              Ask them for their {state.primary.name} review link. It is the one they chose and
              the one box still empty.
            </li>
          ) : null}
          {view.previewUrl ? (
            <li>
              <a className="text-[#F5A623] underline" href={view.previewUrl}>
                Open the review tool
              </a>{" "}
              and check the buttons are the ones you expect. Nothing typed there is stored.
            </li>
          ) : null}
          {view.reviewsHost ? (
            <li>
              Live at{" "}
              <a
                className="text-[#F5A623] underline"
                href={`https://${view.reviewsHost}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {view.reviewsHost}
              </a>
              , which is what the QR on the printed cards resolves to.
            </li>
          ) : (
            <li>No reviews host is attached yet, so the QR on the cards has nothing to open.</li>
          )}
          <li>
            Step 29 confirms on the mode above. Step 30 confirms on a handover to the named
            person, with the evidence in its own Slack thread.
          </li>
        </ul>
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
