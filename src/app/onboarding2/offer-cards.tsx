"use client";

// The offers, picked before anything else happens.
//
// ‼️ THIS SCREEN EXISTS SO THE LEAD IS LABELLED FROM THE FIRST ROW WRITTEN. Before it, every
// /onboarding2 visitor was the same undifferentiated lead and the offer was discovered on the
// call. The whole point of asking here is that the Slack card, the delivery board, the contract
// variant and the call itself all know what was chosen before anybody picks up the phone.
//
// ‼️ NO PLAN PRICE APPEARS ANYWHERE ON THIS SCREEN (Matthew, 2026-09-16). The link is now
// primarily for new clients arriving off a VSL, where the number belongs in the conversation and
// a figure on the screen only invites a decision before the argument has been made. What IS shown
// is VALUE: the program's worth over a year, and the Concierge struck through and given away.
// `price` and `anchor` still exist on every Offer and are still read by the Slack card, the client
// board and the agreement. This is a different presentation of the same offer, not a second
// version of it, which is why the funnel fields live beside the commercial ones on one object.
//
// ‼️ EVERY FIGURE COMES FROM config/pitch.ts AND NOT ONE IS TYPED HERE. That file is the single
// home for a price, and its header records what happened the last time a number was copied into a
// second file: /chatgpt-ads quoted $499 while pitch.ts said $349, both reached one prospect, and
// the fix was one price or a contradiction.
//
// ‼️ MOBILE REORDERS, AND IT IS NOT A STYLE PREFERENCE. The house order on a phone is headline,
// then tagline, then the CTA, then the detail. A card that puts six ticked lines above its button
// means the button is below the fold on every card, and the visitor scrolls past the thing they
// came to do. `order-*` classes do this at the flex level so the DOM order stays reading order for
// anything that does not paint: the button follows the headline it belongs to, which is also the
// correct tab order.

import { useState } from "react";
import { FUNNEL_OFFERS, PRICE_CONCIERGE, type FunnelLine, type Offer, type OfferKey } from "@/config/pitch";

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
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-16">
      <header className="mb-8 text-center sm:mb-12">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Pick how you want to start.</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/60 sm:text-base">
          Pick one and we will book your onboarding call, get your campaign set up, and take it
          live with your approval.
        </p>
      </header>

      {/*
        Two cards today, and the grid asks the array rather than being told. `lg:grid-cols-2` is
        wrong the moment a third offer is put back in the funnel, and the failure would be silent:
        three cards in a two column grid just wraps the last one underneath.
      */}
      <div
        className="grid gap-4 sm:gap-5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(FUNNEL_OFFERS.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {FUNNEL_OFFERS.map((offer) => (
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
        Nothing is charged here and no card is taken. We go through everything together on the call
        before anything is signed.
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
  // The guaranteed plan is the one being recommended, so it carries the border and the badge.
  const featured = offer.guarantee !== null;

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
      {/* ── The headline. Where the price used to be, and the biggest thing on the card. ── */}
      <div className="order-1 text-center">
        {featured ? (
          <span
            className="mb-3 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: REEF, color: "#04252b" }}
          >
            Most take this
          </span>
        ) : null}

        <div className="text-2xl font-bold leading-tight text-white sm:text-[26px]">
          {offer.funnelHeadline}
        </div>

        <h2 className="mt-2 text-base font-semibold" style={{ color: REEF }}>
          {offer.name}
        </h2>
      </div>

      <p className="order-2 mt-3 text-center text-sm text-white/70">{offer.tagline}</p>

      {/*
        ── The button. THIRD ON MOBILE, LAST ON DESKTOP. ──
        order-4 on a phone puts it directly under the tagline, above the list, which is the whole
        reason this component orders at the flex level. lg:order-last drops it back to the bottom
        on a wide screen, where the cards sit side by side and the buttons should line up along
        one baseline. `mt-auto` only applies once it is last, which is why it is inside the lg:
        prefix set rather than always on.
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
          {pending ? "One moment" : offer.funnelCta}
        </button>
      </div>

      {/* ── What is in it. Last on mobile, above the button on desktop. ── */}
      <ul className="order-5 mt-6 space-y-3 lg:order-4 lg:mt-6">
        {offer.funnelIncludes.map((line) => (
          <li key={line.text} className="flex gap-2.5 text-sm">
            <Tick />
            <Line line={line} onConcierge={() => onChoose(offer.key, true)} disabled={busy || disabled} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One ticked line, with its struck-through value where it has one.
 *
 * ‼️ THE STRIKE IS THE ARGUMENT ON THE PAID CARD. "AI Skin Concierge, $199 / month, FREE" says in
 * one line what a paragraph would say worse: this is a real product with a real price and you are
 * not paying it. The figure is struck rather than omitted precisely because a reader has to see
 * the number to know what was given up.
 *
 * ‼️ AND IT IS STILL TAPPABLE. Matthew's ask, and the reason is a real segment: some clinics only
 * want the Concierge. A figure they cannot tap is a dead end for exactly the person most ready to
 * buy something. Tapping records `review_free` plus Concierge interest, because somebody asking
 * about the Concierge has not agreed to a year of AI visibility work and must not be recorded as
 * though they had. The Slack card reads the flag and titles them a Concierge enquiry.
 */
function Line({
  line,
  onConcierge,
  disabled,
}: {
  line: FunnelLine;
  onConcierge: () => void;
  disabled: boolean;
}) {
  const conciergePrice = line.was === PRICE_CONCIERGE;
  return (
    <span className={line.strong ? "font-semibold text-white" : "text-white/80"}>
      {line.text}
      {line.was ? (
        <>
          {", "}
          {conciergePrice ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onConcierge}
              className="text-white/40 line-through decoration-white/40 disabled:no-underline"
            >
              {line.was}
            </button>
          ) : (
            <span className="text-white/40 line-through">{line.was}</span>
          )}
        </>
      ) : null}
      {line.tag ? (
        <span
          className="ml-1.5 whitespace-nowrap text-xs font-bold uppercase tracking-wide"
          style={{ color: REEF }}
        >
          {line.tag}
        </span>
      ) : null}
    </span>
  );
}

function Tick() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-1 h-4 w-4 shrink-0"
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
