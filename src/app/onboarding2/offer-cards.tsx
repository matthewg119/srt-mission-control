"use client";

// The three offers, picked before anything else happens.
//
// ‼️ THIS SCREEN EXISTS SO THE LEAD IS LABELLED FROM THE FIRST ROW WRITTEN. Before it, every
// /onboarding2 visitor was the same undifferentiated lead and the offer was discovered on the
// call. The whole point of asking here is that the Slack card, the delivery board, the contract
// variant and the call itself all know what was chosen before anybody picks up the phone.
//
// ‼️ EVERY FIGURE COMES FROM config/pitch.ts AND NOT ONE IS TYPED HERE. That file is the single
// home for a price, and its header records what happened the last time a number was copied into
// a second file: /chatgpt-ads quoted $499 while pitch.ts said $349, both reached one prospect,
// and the fix was one price or a contradiction. Read OFFERS, render OFFERS, add nothing.
//
// ‼️ MOBILE REORDERS, AND IT IS NOT A STYLE PREFERENCE. The house order on a phone is title,
// then tagline, then the CTA, then the detail. A card that puts six ticked bullets above its
// button means the button is below the fold on every one of the three, and the visitor scrolls
// past the thing they came to do. `order-*` classes do this at the flex level so the DOM order
// stays reading order for anything that does not paint: the button follows the price it belongs
// to, which is also the correct tab order.

import { useState } from "react";
import { OFFERS, PRICE_CONCIERGE, type Offer, type OfferKey } from "@/config/pitch";

const REEF = "#00C9A7";

export function OfferCards({
  onPick,
  busy,
}: {
  /**
   * Chosen offer, plus whether they got here by tapping the Concierge price.
   *
   * ‼️ TWO ARGUMENTS BECAUSE THEY ARE TWO DIFFERENT FACTS. The offer is what they are buying;
   * Concierge interest is a question they want answered on the call. Folding the second into the
   * first as a fourth offer key would put a thing nobody sells into a column the contract reads.
   */
  onPick: (offer: OfferKey, conciergeInterest: boolean) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<OfferKey | null>(null);

  function choose(offer: OfferKey, conciergeInterest = false): void {
    if (busy || picked) return;
    setPicked(offer);
    onPick(offer, conciergeInterest);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-16">
      <header className="mb-8 text-center sm:mb-12">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Pick how you want to start.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/60 sm:text-base">
          You can change your mind on the call. This just tells us what to walk you through.
        </p>
      </header>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        {OFFERS.map((offer) => (
          <Card
            key={offer.key}
            offer={offer}
            busy={busy}
            pending={picked === offer.key}
            disabled={Boolean(picked) && picked !== offer.key}
            onChoose={choose}
          />
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-xl text-center text-xs text-white/40">
        Nothing is charged here and no card is taken. Whatever you pick, we go through it together
        on the call before anything is signed.
      </p>
    </div>
  );
}

function Card({
  offer,
  busy,
  pending,
  disabled,
  onChoose,
}: {
  offer: Offer;
  busy: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: (offer: OfferKey, conciergeInterest?: boolean) => void;
}) {
  // The middle card is the one being recommended, so it carries the border and the badge.
  const featured = offer.key === "year_3300";

  return (
    <section
      className={[
        "flex flex-col rounded-2xl p-6 transition sm:p-7",
        featured
          ? "bg-white/[0.07] ring-2 ring-[#00C9A7]"
          : "bg-white/[0.04] ring-1 ring-white/10",
        disabled ? "opacity-40" : "",
      ].join(" ")}
      aria-busy={pending}
    >
      {/* ── Price block. First on every breakpoint, like the plan cards this copies. ── */}
      <div className="order-1 text-center">
        {featured ? (
          <span
            className="mb-3 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: REEF, color: "#04252b" }}
          >
            Most take this
          </span>
        ) : null}

        {offer.anchor ? (
          <div className="text-sm text-white/35 line-through">{offer.anchor}</div>
        ) : null}

        <div className="text-3xl font-bold text-white sm:text-4xl">
          {offer.price ?? "Free"}
        </div>

        <h2 className="mt-2 text-lg font-semibold" style={{ color: REEF }}>
          {offer.name}
        </h2>
      </div>

      {/* ── Tagline, second on mobile per the house order. ── */}
      <p className="order-2 mt-3 text-center text-sm text-white/70">{offer.tagline}</p>
      {offer.priceNote ? (
        <p className="order-3 mt-1 text-center text-xs text-white/40">{offer.priceNote}</p>
      ) : null}

      {/*
        ── The button. THIRD ON MOBILE, LAST ON DESKTOP. ──
        order-4 on a phone puts it directly under the tagline, above the bullets, which is the
        whole reason this component orders at the flex level. lg:order-last drops it back to the
        bottom on a wide screen, where three cards sit side by side and the buttons should line
        up along one baseline. `mt-auto` only applies once it is last, which is why it is inside
        the lg: prefix set rather than always on.
      */}
      <div className="order-4 mt-5 lg:order-last lg:mt-auto lg:pt-6">
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onChoose(offer.key)}
          className={[
            "w-full rounded-lg px-5 py-3.5 text-sm font-bold transition disabled:cursor-not-allowed",
            featured
              ? "bg-[#00C9A7] text-[#04252b] hover:opacity-90"
              : "bg-white/10 text-white hover:bg-white/15",
          ].join(" ")}
        >
          {pending ? "One moment" : offer.cta}
        </button>
      </div>

      {/* ── What is in it. Last on mobile, above the button on desktop. ── */}
      <ul className="order-5 mt-6 space-y-2.5 lg:order-4 lg:mt-6">
        {offer.includes.map((line) => (
          <li key={line} className="flex gap-2.5 text-sm text-white/80">
            <Tick />
            <span>{renderLine(line, () => onChoose(offer.key, true), busy || disabled)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Concierge price, made tappable wherever it appears in a bullet.
 *
 * ‼️ MATTHEW'S ASK, AND THE REASON IS A REAL SEGMENT: some clinics only want the Concierge and
 * nothing else. A figure they cannot tap is a dead end for exactly the person most ready to buy
 * something, so it takes them into the booking with the question attached.
 *
 * ‼️ IT DOES NOT SELL THEM THE CARD IT IS PRINTED ON. Tapping it records `review_free` plus
 * Concierge interest, because somebody asking what the Concierge costs has not agreed to a year
 * of AI visibility work and must not be recorded as though they had. What makes this legible on
 * our side is the Slack card, which reads the interest flag and titles the lead as a Concierge
 * enquiry rather than as a Review Engine signup.
 *
 * The split is on the literal PRICE_CONCIERGE string rather than on a marker in the copy, so a
 * bullet in pitch.ts stays plain readable text with no markup language invented for it.
 */
function renderLine(line: string, onConcierge: () => void, disabled: boolean): React.ReactNode {
  const at = line.indexOf(PRICE_CONCIERGE);
  if (at === -1) return line;
  return (
    <>
      {line.slice(0, at)}
      <button
        type="button"
        disabled={disabled}
        onClick={onConcierge}
        className="underline decoration-dotted underline-offset-2 disabled:no-underline"
        style={{ color: REEF }}
      >
        {PRICE_CONCIERGE}
      </button>
      {line.slice(at + PRICE_CONCIERGE.length)}
    </>
  );
}

function Tick() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="none"
      stroke={REEF}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}
