"use client";

// One shell, three ways of arriving. The upsell ladder's container and nothing else.
//
// ‼️ THE THREE PRESENTATIONS ARE THE TEST, so they live behind one component rather than three.
// `dialog` is a centred modal, `sheet` slides up from the bottom edge where a thumb is, and
// `inline` overlays nothing at all: it grows in the document under the card. Written once because
// the part most likely to be got wrong is the focus and scroll management, and getting it wrong
// once and copying it twice is how a funnel ends up with a page nobody can scroll.
//
// ‼️ THE SCROLL LOCK IS RESTORED IN AN EFFECT CLEANUP, NEVER IN A CLOSE HANDLER, AND THIS IS THE
// ONE THING IN THIS FILE THAT CANNOT BE GOT WRONG. Picking a plan calls start(), which flips
// `starting` in Onboarding2Funnel, and the branch above the picker replaces this entire subtree
// with <Starting />. That is an UNMOUNT, not a close: no close handler runs. A lock released on
// close would leave `document.body.style.overflow = "hidden"` set for the rest of the session,
// behind the "Setting up your account" screen and then behind the whole chat. The cleanup runs on
// unmount as well as on close, which is why it is the only correct place for it.
// The shape is copied from src/app/lhr/lhr-client.tsx, previousOverflow and all.
//
// ‼️ NO STYLESHEET. lhr-client.tsx does this with .lhr-modal-* classes from lhr.css; the
// onboarding2 subtree has no CSS file by a decision recorded in its layout.tsx, so the same
// semantics are rebuilt in Tailwind literals. The one keyframe is inline, which is the exception
// offer-cards.tsx already established for `priceIn`.

import { useCallback, useEffect, useRef } from "react";

export type Presentation = "dialog" | "sheet" | "inline";

export function UpsellSurface({
  presentation,
  labelledBy,
  onDismiss,
  children,
}: {
  presentation: Presentation;
  /** id of the heading inside `children`. What a screen reader announces the dialog as. */
  labelledBy: string;
  /**
   * Escape, or a tap on the backdrop.
   *
   * ‼️ NULL MEANS THE SURFACE CANNOT BE DISMISSED, AND THE INLINE VARIANTS PASS NULL ON PURPOSE.
   * An inline panel has no backdrop to tap and no overlay to escape from, so a dismiss gesture
   * would have nothing to act on: the two buttons are the only ways out, which is the whole
   * difference being tested.
   */
  onDismiss: (() => void) | null;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const dismiss = useCallback(() => {
    if (onDismiss) onDismiss();
  }, [onDismiss]);

  // ‼️ THE INLINE PRESENTATION LOCKS NOTHING AND TRAPS NOTHING. It is in the document flow, so
  // locking the body would stop the reader scrolling to the panel that just appeared below them.
  const overlay = presentation !== "inline";

  useEffect(() => {
    if (!overlay) {
      // Still move focus: the panel appeared because of a tap, and a keyboard user who is not
      // moved into it has no idea anything happened.
      window.setTimeout(() => panelRef.current?.focus(), 50);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [overlay, dismiss]);

  // ── Inline. No scrim, no dialog role, in the flow. ──
  if (presentation === "inline") {
    return (
      <section
        ref={panelRef}
        tabIndex={-1}
        aria-labelledby={labelledBy}
        className="mt-4 rounded-2xl bg-white/[0.07] p-6 outline-none ring-2 ring-[#00C9A7] animate-[upsellIn_200ms_ease-out] sm:p-7"
      >
        {children}
        <Keyframes />
      </section>
    );
  }

  const sheet = presentation === "sheet";

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex bg-black/70 p-0 sm:p-6",
        sheet ? "items-end justify-center sm:items-center" : "items-center justify-center",
      ].join(" ")}
      // ‼️ ONLY A PRESS THAT BOTH STARTS AND ENDS ON THE BACKDROP CLOSES. Without the target
      // check, a drag that begins inside the panel and releases outside it dismisses the whole
      // decision. mousedown rather than click for the same reason.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={[
          "max-h-[92vh] w-full overflow-y-auto bg-[#111] p-6 outline-none ring-1 ring-white/15 sm:p-7",
          sheet
            ? "rounded-t-2xl animate-[sheetIn_240ms_ease-out] sm:max-w-md sm:rounded-2xl"
            : "max-w-md rounded-2xl animate-[upsellIn_200ms_ease-out]",
        ].join(" ")}
      >
        {/* The grab handle. Says "this came up from the bottom and can go back down". */}
        {sheet ? (
          <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        ) : null}
        {children}
      </div>
      <Keyframes />
    </div>
  );
}

/**
 * Scoped here rather than in a stylesheet, because onboarding2 has no CSS file and this is the
 * same exception `priceIn` in offer-cards.tsx already takes.
 *
 * ‼️ BOTH ANIMATIONS ARE UNDER 250ms AND NEITHER MOVES FAR. A sheet that takes half a second to
 * arrive is a sheet somebody taps twice.
 */
function Keyframes() {
  return (
    <style>{`
@keyframes upsellIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sheetIn{from{transform:translateY(16px);opacity:.6}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){
  .animate-\\[upsellIn_200ms_ease-out\\],.animate-\\[sheetIn_240ms_ease-out\\]{animation:none}
}`}</style>
  );
}
