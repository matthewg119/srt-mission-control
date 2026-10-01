"use client";

// The reactivation add-on, as a sheet that comes up from the bottom. Gold, not reef.
//
// ‼️ IT COPIES offer-sheet.tsx's MECHANICS AND NOT ITS CONTENT, DELIBERATELY.
// Matthew asked for "the same style as the previous one, a simple popup coming from below, same
// format but different colors". So the scrim-as-sibling, the mounted-while-closed transform, the
// bottom anchoring and the thumb-reachable controls are all the same decisions, for the same
// reasons offer-sheet.tsx writes out at length. What changes is the palette and the fact that this
// one asks a single yes or no.
//
// ‼️ IT IS SHORTER THAN THE OFFER SHEET ON PURPOSE: `h-auto` with a max, not `h-[88%]`.
// The offer sheet is 88% tall because it carries three phases, a billing toggle and two priced
// cards. This carries one question. A sheet sized for content it does not have is a sheet with a
// field of empty black above the buttons, and on a phone that reads as a loading state.
//
// ‼️ THE SCRIM IS A SIBLING, NOT A PARENT, for the reason offer-sheet.tsx gives: as a wrapper it
// would have to be unmounted to make the thread tappable again, and unmounting kills the closing
// animation, so the sheet would vanish rather than travel back down.

import { useEffect, useRef } from "react";
import { REACTIVATION_ADDON } from "@/config/onboarding2";

/**
 * ‼️ GOLD IS DEFINED ONCE, HERE, AND IS NOT A TAILWIND `amber-*`.
 * The funnel's reef green is a literal everywhere it appears rather than a theme token, so a
 * palette name here would be the only colour in the funnel that could be changed by a config
 * nobody is reading. The dark ink is the text colour ON gold and is paired with it: changing one
 * without the other is how a gold button ends up with white text on it at 2.1:1.
 */
const GOLD = "#D4A32C";
const GOLD_INK = "#2A1D00";

export function ReactivationSheet({
  open,
  busy,
  onAnswer,
}: {
  open: boolean;
  /** True while the parent is mid-flight, so neither control can be double-tapped. */
  busy?: boolean;
  onAnswer: (yes: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel when it opens, so a keyboard or screen reader lands inside the question
  // rather than wherever the thread left them. Matches the offer sheet.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => panelRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <>
      <div
        aria-hidden="true"
        className={[
          "absolute inset-0 z-40 bg-black/60 transition-opacity duration-300 motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="A complimentary reactivation campaign"
        aria-hidden={!open}
        className={[
          "absolute inset-x-0 bottom-0 z-50 flex max-h-[88%] flex-col rounded-t-3xl bg-[#0a0a0a] text-white outline-none",
          "shadow-[0_-20px_40px_rgba(0,0,0,0.45)]",
          "transition-transform [transition-duration:340ms] ease-out motion-reduce:transition-none",
          open ? "translate-y-0" : "pointer-events-none translate-y-full",
        ].join(" ")}
        style={{ boxShadow: `0 -20px 40px rgba(0,0,0,0.45), inset 0 1px 0 ${GOLD}40` }}
      >
        {/* Says "this came up from the bottom". Not draggable and does not pretend to be. */}
        <div className="flex justify-center pt-3">
          <div className="h-1 w-10 rounded-full bg-white/18" />
        </div>

        <div className="overflow-y-auto px-6 pb-7 pt-4">
          <div
            className="text-[10.5px] font-bold uppercase tracking-[0.12em]"
            style={{ color: GOLD }}
          >
            {REACTIVATION_ADDON.eyebrow}
          </div>

          <h2 className="mt-2 text-balance text-[22px] font-bold leading-tight">
            {REACTIVATION_ADDON.headline}
          </h2>

          <p className="mt-3 text-[13.5px] leading-relaxed text-white/70">
            {REACTIVATION_ADDON.body}
          </p>

          <div
            className="mt-5 rounded-xl p-3.5"
            style={{ backgroundColor: `${GOLD}14`, border: `1px solid ${GOLD}59` }}
          >
            <p className="text-[13px] font-semibold leading-snug" style={{ color: GOLD }}>
              {REACTIVATION_ADDON.optIn}
            </p>
            <p className="mt-1 text-[12px] font-normal leading-relaxed text-white/55">
              {REACTIVATION_ADDON.optInNote}
            </p>
          </div>

          {/* ‼️ ACCEPT FIRST AND DECLINE UNDER IT, BOTH AT THE BOTTOM, matching the offer sheet.
              The decline is a quiet text button rather than a second filled one: two equally
              weighted buttons make a free bonus look like a decision with a catch. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(true)}
            className="mt-5 w-full rounded-xl px-5 py-3.5 text-sm font-bold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: GOLD, color: GOLD_INK }}
          >
            {REACTIVATION_ADDON.accept}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(false)}
            className="mt-1.5 w-full rounded-xl px-5 py-3 text-sm font-medium text-white/52 transition hover:text-white disabled:cursor-not-allowed"
          >
            {REACTIVATION_ADDON.decline}
          </button>
        </div>
      </div>
    </>
  );
}
