"use client";

// The offer, as a sheet that comes up from the bottom of the thread.
//
// ‼️ THIS IS THE PRESENTATION MATTHEW PICKED OUT OF FIVE (2026-09-30), and the reason is the thumb.
// Every control on this offer, the free CTA, the accept, the decline, the toggle and the last exit,
// sits at the BOTTOM of it. A centred dialog puts them mid-screen and a full-screen takeover puts
// the first of them below the fold on a 375px phone. A sheet anchored to the bottom edge puts the
// whole decision inside the arc a thumb already covers.
//
// ‼️ IT COVERS 88%, NOT 100%, AND THE MISSING 12% IS DOING WORK. The strip of thread left showing
// above is the last thing they typed, in full colour, while they read the price. The dialog variant
// achieves the same thing with a dimmed scrim; this achieves it without dimming anything.
//
// ‼️ THE THREE PHASES SWAP IN PLACE RATHER THAN STACKING. Free card, then the add-on, then the
// plan choice, all inside one sheet that never closes between them. A second sheet over the first
// would be two scrim layers and two scroll containers, and on a phone that is how a page ends up
// with a panel nobody can scroll.
//
// ‼️ NOT ONE FIGURE IS TYPED HERE. Prices come from config/pitch.ts. The pricing PARTS come from
// offer-cards.tsx rather than being rebuilt, for the reason free-first-picker.tsx gives at length:
// `Line` alone carries the bug where an absolutely positioned strike covered 109px of a 241px
// sentence at 375px and stopped mid-air. Rebuilding it here would rebuild that.

import { useCallback, useEffect, useRef } from "react";
import {
  PAID_BILLING,
  PRICE_YEAR,
  PRICE_YEAR_EQUIV,
  UPSELL,
  offerFor,
  type BillingState,
  type OfferKey,
} from "@/config/pitch";
import { BillingToggle, Cross, Line, Price, Tick } from "../offer-cards";
import type { UpsellOutcome } from "../free/free-first-picker";

const REEF = "#00C9A7";

/**
 * Free card, the appointments add-on, the plan choice. In that order, never skipped.
 *
 * ‼️ OWNED BY THE PARENT, NOT BY THIS COMPONENT, AND THAT IS A BUG FIX RATHER THAN A PREFERENCE
 * (2026-09-30). Tapping a terminal button flips `starting` in ConvoFirstFunnel, whose next render
 * returns <Starting /> and UNMOUNTS this whole subtree. On the happy path that is fine, the chat
 * replaces it. On a FAILED /start it comes back, and anything held in local state here came back
 * reset: somebody who tapped "Start monthly" and hit an error was returned to the free card, three
 * screens behind where they were, with no error anywhere on screen because the only place it
 * rendered was the thread underneath this sheet. That reads exactly like the button doing nothing.
 */
export type OfferPhase = "card" | "one" | "two";

/**
 * ‼️ MONTHLY, WHICH IS THE OPPOSITE OF THE COLD PICKER, AND THE DIFFERENCE IS DELIBERATE. By the
 * time phase two is on screen the reader has been shown PRICE_YEAR once and said no to it. Opening
 * on the same number asks the same question twice, which is the one thing a second screen must not
 * do. Derived from PAID_BILLING rather than moving DEFAULT_BILLING, which the live two-card picker
 * opens on and this route must not reach across and change.
 */
export const OPENING_BILLING = PAID_BILLING.find((b) => b.plan === "monthly") ?? PAID_BILLING[0];

const CTA =
  "w-full rounded-xl px-5 py-3.5 text-sm font-bold text-[#04252b] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const GHOST =
  "w-full rounded-xl px-5 py-3 text-sm font-medium text-white/52 transition hover:text-white disabled:cursor-not-allowed";

export function OfferSheet({
  open,
  busy,
  error,
  phase,
  onPhase,
  billing,
  onBilling,
  onPick,
}: {
  /** Drives the transform. The sheet is MOUNTED while closed, which is what lets it animate. */
  open: boolean;
  busy: boolean;
  /** A failed /start. Rendered HERE, above the buttons, because the thread is behind this sheet. */
  error: string | null;
  phase: OfferPhase;
  onPhase: (next: OfferPhase) => void;
  billing: BillingState;
  onBilling: (next: BillingState) => void;
  onPick: (offer: OfferKey, outcome: UpsellOutcome) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const free = offerFor("review_free");
  const year = offerFor("year_3300");

  // ‼️ EACH PHASE STARTS AT ITS OWN TOP. Without this, tapping the free CTA two thirds of the way
  // down a scrolled sheet lands you two thirds of the way down the NEXT phase, which on a shorter
  // panel is past its heading and sometimes past its buttons.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [phase]);

  // Focus moves into the sheet when it arrives, or a keyboard user has no idea anything happened.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => panelRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  // ‼️ `busy` IS THE ONLY LOCK, AND DROPPING THE LOCAL "picked" FLAG IS THE OTHER HALF OF THE BUG
  // FIX. It was set on the first tap and never cleared, so once a /start failed every button on
  // this sheet was permanently dead for the rest of the session. The parent already owns the one
  // piece of state that answers "is a pick in flight", and it clears it on failure, so a second
  // attempt is possible the moment the first one is known to have failed.
  const choose = useCallback(
    (offer: OfferKey, outcome: UpsellOutcome) => {
      if (busy) return;
      onPick(offer, outcome);
    },
    [busy, onPick]
  );

  const locked = busy;

  return (
    <>
      {/*
        ‼️ THE SCRIM IS A SIBLING, NOT A PARENT. As a wrapper it would have had to be unmounted to
        let the thread be tappable again, and unmounting is what kills the closing animation: the
        sheet would vanish rather than travel back down. Both stay mounted and both are driven by
        `open`, so the close is the open played backwards.
      */}
      <div
        aria-hidden="true"
        className={[
          "absolute inset-0 z-20 bg-black/60 transition-opacity duration-300 motion-reduce:transition-none",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Pick how you want to start"
        aria-hidden={!open}
        className={[
          "absolute inset-x-0 bottom-0 z-30 flex h-[88%] flex-col rounded-t-3xl bg-[#0a0a0a] text-white outline-none",
          "shadow-[0_-20px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/10",
          "transition-transform [transition-duration:340ms] ease-out motion-reduce:transition-none",
          open ? "translate-y-0" : "pointer-events-none translate-y-full",
        ].join(" ")}
      >
        {/* Says "this came up from the bottom". It is not draggable and does not pretend to be:
            the two buttons below are the only ways out, which is what the ladder needs. */}
        <div aria-hidden="true" className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-white/20" />

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-7 pt-4">
          {phase === "card" ? (
            <>
              <h2 className="text-balance text-center text-[22px] font-bold leading-tight">
                Pick how you want to start.
              </h2>
              <p className="mx-auto mt-2 max-w-[30ch] text-center text-[13px] leading-relaxed text-white/60">
                Set it up for you, book your onboarding call, and take it live with your approval.
              </p>

              <section className="mt-5 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
                <div className="text-center text-[25px] font-bold leading-none">{free.funnelHeadline}</div>
                <h3 className="mt-2 text-center text-[15px] font-bold" style={{ color: REEF }}>
                  {free.name}
                </h3>
                <p className="mt-2.5 text-center text-[13px] text-white/70">{free.tagline}</p>

                {/*
                  ‼️ THE BUTTON IS ABOVE THE LIST, NOT UNDER IT. Six ticked lines between the
                  headline and the CTA is the arrangement that put the CTA below the fold on the
                  live card, which is why offer-cards.tsx reorders them with `order-*` on a phone.
                  There is only one layout in a sheet, so it is simply written in this order.
                */}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onPhase("one")}
                  className={`mt-5 ${CTA}`}
                  style={{ backgroundColor: REEF }}
                >
                  {free.funnelCta}
                </button>

                <ul className="mt-6 space-y-3">
                  {free.funnelIncludes.map((line) => (
                    <li key={line.text} className="flex gap-2.5 text-[13px]">
                      <Tick />
                      {/* No line on the free card carries `was`, so nothing here is tappable and
                          the concierge handler is unreachable. A no-op states that. */}
                      <Line line={line} struck={false} onConcierge={() => {}} disabled />
                    </li>
                  ))}
                </ul>
                {free.funnelFooter ? (
                  <p className="mt-4 text-[13.5px] font-semibold">{free.funnelFooter}</p>
                ) : null}
              </section>

              <p className="mx-auto mt-5 max-w-[34ch] text-center text-[11.5px] leading-relaxed text-white/40">
                Nothing is charged here and no card is taken. We go through everything together on
                the call before anything is signed.
              </p>
            </>
          ) : phase === "one" ? (
            <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: REEF }}>
                {UPSELL.one.eyebrow}
              </div>
              <h2 className="mt-3 text-balance text-[19px] font-bold leading-snug">
                {UPSELL.one.headline}
              </h2>
              <div className="mt-4 text-[30px] font-bold leading-none">{PRICE_YEAR}</div>
              <div className="mt-1.5 text-[11.5px] text-white/50">Works out at {PRICE_YEAR_EQUIV}.</div>
              <p className="mt-4 text-[13px] leading-relaxed text-white/70">{UPSELL.one.framing}</p>

              {/*
                ‼️ THE `strong` LINE IS DROPPED HERE AND IT IS THE ONLY LINE THIS PHASE OMITS. It is
                the headline again, in smaller type, and it is the one line on the card that names a
                REMEDY ("or your money back") where the signed agreement's REFUND_LINE is narrower.
                Found by Boolean(line.strong), never by index and never by matching the sentence.

                ‼️ IT IS NOT DROPPED IN PHASE TWO, AND THAT IS NOT AN INCONSISTENCY. There the line
                is what the red strike ACTS ON: striking it is how monthly is shown to have no
                guarantee, so removing it would silently delete the strike.
              */}
              <ul className="mt-4 space-y-2.5">
                {year.funnelIncludes
                  .filter((line) => !line.strong)
                  .map((line) => (
                    <li key={line.text} className="flex gap-2.5 text-[13px]">
                      <Tick />
                      <Line line={line} struck={false} onConcierge={() => {}} disabled />
                    </li>
                  ))}
              </ul>

              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => choose("year_3300", "accepted_year")}
                  className={CTA}
                  style={{ backgroundColor: REEF }}
                >
                  Add the 5 appointments
                </button>
                <button type="button" disabled={locked} onClick={() => onPhase("two")} className={GHOST}>
                  No thanks, just the free tool
                </button>
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-white/35">{UPSELL.one.terms}</p>
            </section>
          ) : (
            <section className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: REEF }}>
                {UPSELL.two.eyebrow}
              </div>
              <h2 className="mt-3 text-balance text-[19px] font-bold leading-snug">
                {UPSELL.two.headline}
              </h2>

              {/* Hidden on monthly, because the struck line below already carries this exact
                  sentence under the guarantee it is striking. Printing it here as well put the
                  same two sentences on screen twice the moment the toggle moved. */}
              {billing.guaranteed ? (
                <p className="mt-3 text-[13px] leading-relaxed text-white/60">{UPSELL.two.turnaround}</p>
              ) : null}

              <p className="mt-5 text-center text-[13px] text-white/70">{UPSELL.two.togglePrompt}</p>
              <div className="mt-3 text-center">
                <BillingToggle current={billing} onBilling={onBilling} disabled={locked} />
                <Price billing={billing} />
              </div>

              {/*
                ‼️ THE HIGHEST-CONSEQUENCE LINES IN THIS FILE. The guarantee is struck when monthly
                is selected, found by Boolean(line.strong) and never by index or by matching its
                text. Rendering struck={false} unconditionally would show "5 booked appointments in
                90 days, or your money back" as a live promise on month_349, whose contract has
                guarantee: null. That is a misrepresentation at the moment of purchase and it would
                look completely fine on screen.
              */}
              <ul className="mt-5 space-y-2.5">
                {year.funnelIncludes.map((line) => {
                  const struck = Boolean(line.strong) && !billing.guaranteed;
                  return (
                    <li key={line.text} className="flex gap-2.5 text-[13px]">
                      {struck ? <Cross /> : <Tick />}
                      <Line line={line} struck={struck} onConcierge={() => {}} disabled />
                    </li>
                  );
                })}
              </ul>

              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    choose(billing.offer, billing.plan === "yearly" ? "accepted_year" : "accepted_month")
                  }
                  className={CTA}
                  style={{ backgroundColor: REEF }}
                >
                  {billing.cta}
                </button>
                {/* ‼️ THE LAST EXIT LEADS SOMEWHERE GOOD AND SAYS SO. Somebody who taps it keeps the
                    whole free engine, so it must never be styled as the cheap way out of a modal. */}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => choose("review_free", "declined")}
                  className={GHOST}
                >
                  I don&apos;t want more appointments
                </button>
              </div>
              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-white/35">
                {UPSELL.refuseNote}
              </p>
            </section>
          )}

          {/*
            ‼️ THE FAILURE HAS TO SURFACE **INSIDE** THE SHEET. ConvoFirstFunnel renders its error
            into the message thread, and the thread is behind this panel and behind a scrim: an
            error painted there is an error nobody can see. A terminal button that fails silently
            is indistinguishable from a terminal button that does nothing, which is exactly how
            this was reported.

            role="alert" so it is announced rather than merely drawn, and it sits under the buttons
            so the thing to do about it is the thing directly above it.
          */}
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-500/12 px-4 py-3 text-center text-[13px] leading-relaxed text-red-300 ring-1 ring-red-500/25"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
