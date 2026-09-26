"use client";

// The offers, picked before anything else happens.
//
// ‼️ THIS SCREEN EXISTS SO THE LEAD IS LABELLED FROM THE FIRST ROW WRITTEN. Before it, every
// /onboarding2 visitor was the same undifferentiated lead and the offer was discovered on the
// call. The whole point of asking here is that the Slack card, the delivery board, the contract
// variant and the call itself all know what was chosen before anybody picks up the phone.
//
// ‼️ THE PAID CARD SHOWS A PRICE AGAIN, AND THAT REVERSES A RECORDED DECISION (2026-09-26).
// This file said: "NO PLAN PRICE APPEARS ANYWHERE ON THIS SCREEN (Matthew, 2026-09-16). The link is
// now primarily for new clients arriving off a VSL, where the number belongs in the conversation and
// a figure on the screen only invites a decision before the argument has been made."
//
// That argument was about a SINGLE number sitting on a card with nothing to compare it to. What is
// there now is a choice between two, and a choice is the thing that makes a price argue for itself:
// the yearly figure only reads as cheap next to twelve monthly ones. Matthew asked for the toggle
// precisely so the year can show what it saves. The old reasoning is kept rather than deleted,
// because if the toggle ever goes the reason not to show one number alone comes back with it.
//
// ‼️ THE VALUE STACK IS STILL THE ARGUMENT, AND IT IS STILL SHOWN BEFORE THE PRICE IS JUSTIFIED.
// The price sits under the headline and the deliverables sit under the button, which is the order
// the card already used. Adding a figure did not reorder the case.
//
// ‼️ EVERY FIGURE COMES FROM config/pitch.ts AND NOT ONE IS TYPED HERE. That file is the single
// home for a price, and its header records what happened the last time a number was copied into a
// second file: /chatgpt-ads quoted $499 while pitch.ts said $349, both reached one prospect, and
// the fix was one price or a contradiction. The two billing states live there too, in PAID_BILLING.
//
// ‼️ MOBILE REORDERS, AND IT IS NOT A STYLE PREFERENCE. The house order on a phone is headline,
// then tagline, then the CTA, then the detail. A card that puts six ticked lines above its button
// means the button is below the fold on every card, and the visitor scrolls past the thing they
// came to do. `order-*` classes do this at the flex level so the DOM order stays reading order for
// anything that does not paint: the button follows the headline it belongs to, which is also the
// correct tab order.

import { useState } from "react";
import {
  DEFAULT_BILLING,
  FUNNEL_OFFERS,
  GUARANTEE_COMMITMENT_NOTE,
  PAID_BILLING,
  PRICE_CONCIERGE,
  SAVE_YEARLY_AMOUNT,
  type BillingState,
  type FunnelLine,
  type Offer,
  type OfferKey,
} from "@/config/pitch";

const REEF = "#00C9A7";
/** The strike. Tailwind has no red at this value in this file's palette, and it is used three ways. */
const RED = "#ef4444";

/**
 * What a pick or a toggle is reported as.
 *
 * ‼️ fbq IS THE ONLY ANALYTICS ON THIS SUBTREE, and it is loaded by onboarding2/layout.tsx rather
 * than by any helper, so there is nothing to import. It is called through a guard because the pixel
 * is blocked by a good many browsers and an undefined call would take the card's own click handler
 * down with it.
 *
 * ‼️ AND A CustomEvent GOES OUT REGARDLESS. It costs nothing, it is what a future analytics layer can
 * listen to without editing this file, and it is the half that still fires when the pixel is blocked.
 * TODO: if a real client-side analytics module ever lands, call it here and keep the event.
 */
function track(event: "pricing_toggle" | "pricing_cta_click", value: string): void {
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: { value } }));
  } catch {
    // A browser without CustomEvent is a browser this card is not going to convert anyway.
  }
  try {
    const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
    if (typeof fbq === "function") fbq("trackCustom", event, { value });
  } catch {
    // Pixel blocked, or loaded and broken. Never the card's problem.
  }
}

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
  const [billing, setBilling] = useState<BillingState>(DEFAULT_BILLING);

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
            billing={billing}
            onBilling={(next) => {
              setBilling(next);
              track("pricing_toggle", next.plan);
            }}
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
  billing,
  onBilling,
  busy,
  pending,
  disabled,
  onChoose,
}: {
  offer: Offer;
  billing: BillingState;
  onBilling: (next: BillingState) => void;
  busy: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: (offer: OfferKey, conciergeInterest?: boolean) => void;
}) {
  // The guaranteed plan is the one being recommended, so it carries the border and the badge.
  const featured = offer.guarantee !== null;

  // ‼️ THE PAID CARD IS THE ONE THE TOGGLE OWNS, AND IT SELECTS A DIFFERENT OFFER PER STATE. The free
  // card reads its own row and never sees `billing`. Everything below that comes off `billing` rather
  // than off `offer` is a thing the toggle changes; everything still on `offer` is a thing it does not.
  const plan = featured ? billing.plan : "free";
  const chosenOffer = featured ? billing.offer : offer.key;
  const headline = featured ? billing.headline : offer.funnelHeadline;
  const name = featured ? billing.name : offer.name;
  const tagline = featured ? billing.tagline : offer.tagline;
  const cta = featured ? billing.cta : offer.funnelCta;

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
      {/* ── The headline, and on the paid card the toggle and the price above the detail. ── */}
      <div className="order-1 text-center">
        {featured ? (
          <span
            className="mb-3 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: REEF, color: "#04252b" }}
          >
            Most take this
          </span>
        ) : null}

        {featured ? <BillingToggle current={billing} onBilling={onBilling} disabled={disabled} /> : null}

        <div className="text-2xl font-bold leading-tight text-white sm:text-[26px]">{headline}</div>

        <h2 className="mt-2 text-base font-semibold" style={{ color: REEF }}>
          {name}
        </h2>

        {featured ? <Price billing={billing} /> : null}
      </div>

      <p className="order-2 mt-3 text-center text-sm text-white/70">{tagline}</p>

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
          onClick={() => {
            track("pricing_cta_click", plan);
            onChoose(chosenOffer);
          }}
          className={[
            "w-full rounded-lg px-5 py-3.5 text-sm font-bold transition disabled:cursor-not-allowed",
            featured
              ? "bg-[#00C9A7] text-[#04252b] hover:opacity-90"
              : "bg-white/10 text-white hover:bg-white/15",
          ].join(" ")}
        >
          {pending ? "One moment" : cta}
        </button>
      </div>

      {/* ── What is in it. Last on mobile, above the button on desktop. ── */}
      <ul className="order-5 mt-6 space-y-3 lg:order-4 lg:mt-6">
        {offer.funnelIncludes.map((line) => {
          // ‼️ THE GUARANTEE LINE IS THE ONLY ONE THE TOGGLE TOUCHES, AND IT IS FOUND BY `strong`
          // RATHER THAN BY POSITION OR BY MATCHING ITS TEXT. It is the only bold line on the card by
          // construction; an index would silently pick the wrong line the first time somebody adds a
          // deliverable, and matching the sentence would break on a copy edit in pitch.ts.
          const isGuarantee = Boolean(line.strong);
          const struck = isGuarantee && featured && !billing.guaranteed;
          return (
            <li key={line.text} className="flex gap-2.5 text-sm">
              {struck ? <Cross /> : <Tick />}
              <Line
                line={line}
                struck={struck}
                onConcierge={() => onChoose(chosenOffer, true)}
                disabled={busy || disabled}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Yearly or monthly.
 *
 * ‼️ A radiogroup OF BUTTONS, NOT TWO TOGGLES. "Yearly" and "Monthly" are one choice with two
 * answers, and a screen reader is told that: `aria-checked` says which is on, and the group carries
 * the label so it is announced as a billing choice rather than as two unrelated controls.
 *
 * ‼️ THE PILL SLIDES WITH A TRANSFORM RATHER THAN THE BUTTONS CHANGING COLOUR, so the movement says
 * which way the choice went. It is one element behind both labels, which also means the labels never
 * reflow: a background that moved between two differently sized buttons would jog the text.
 */
function BillingToggle({
  current,
  onBilling,
  disabled,
}: {
  current: BillingState;
  onBilling: (next: BillingState) => void;
  disabled: boolean;
}) {
  const index = PAID_BILLING.findIndex((b) => b.plan === current.plan);

  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="mx-auto mb-4 grid w-full max-w-[280px] grid-cols-2 gap-1 rounded-full bg-black/40 p-1 ring-1 ring-white/10"
      style={{ position: "relative" }}
    >
      {/* The moving pill. Behind the labels, and hidden from the reader. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full transition-transform duration-200 ease-out"
        style={{
          backgroundColor: REEF,
          top: 4,
          bottom: 4,
          left: 4,
          width: "calc(50% - 4px)",
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {PAID_BILLING.map((state) => {
        const on = state.plan === current.plan;
        return (
          <button
            key={state.plan}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onBilling(state)}
            className={[
              "relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition-colors duration-200",
              on ? "text-[#04252b]" : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            {state.label}
            {state.save ? (
              /*
                ‼️ THE BADGE FLIPS TO DARK WHEN ITS OWN SIDE IS SELECTED. A teal badge sitting on the
                teal pill is invisible, which is exactly when a reader is most likely to look for it.
              */
              <span
                className={[
                  "whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                  on ? "bg-[#04252b]/15 text-[#04252b]" : "text-[#00C9A7]",
                ].join(" ")}
                style={on ? undefined : { backgroundColor: "rgba(0,201,167,0.15)" }}
              >
                {state.save}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The price, and what it works out to.
 *
 * ‼️ KEYED ON THE PLAN SO REACT REMOUNTS IT, which is what makes the animation run at all. Changing
 * the text of a live node animates nothing; replacing the node lets the mount transition play. The
 * whole block is 150ms, which is under the threshold where a reader starts waiting for it.
 */
function Price({ billing }: { billing: BillingState }) {
  return (
    <div className="mt-4 min-h-[58px]" aria-live="polite">
      <div key={billing.plan} className="animate-[priceIn_150ms_ease-out]">
        <div className="text-[28px] font-bold leading-none text-white sm:text-[32px]">
          {billing.price}
        </div>
        <div className="mt-1.5 text-xs text-white/50">{billing.priceNote}</div>
      </div>
      {/*
        Scoped here rather than in a stylesheet, because onboarding2 has no CSS file by a decision
        recorded in its layout.tsx and this is the only keyframe on the subtree.
      */}
      <style>{`@keyframes priceIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

/**
 * One ticked line, with its struck-through value where it has one.
 *
 * ‼️ THE STRIKE IS THE ARGUMENT ON THE PAID CARD. "AI Booking Bot, $199 / month, FREE" says in
 * one line what a paragraph would say worse: this is a real product with a real price and you are
 * not paying it. The figure is struck rather than omitted precisely because a reader has to see
 * the number to know what was given up.
 *
 * ‼️ AND IT IS STILL TAPPABLE. Matthew's ask, and the reason is a real segment: some clinics only
 * want the Concierge. A figure they cannot tap is a dead end for exactly the person most ready to
 * buy something. Tapping records `review_free` plus Concierge interest, because somebody asking
 * about the Concierge has not agreed to a year of AI visibility work and must not be recorded as
 * though they had. The Slack card reads the flag and titles them a Concierge enquiry.
 *
 * ‼️ `struck` IS A DIFFERENT STRIKE ENTIRELY AND THE TWO MUST NOT BE CONFUSED. `line.was` strikes a
 * PRICE to say it is not being charged, which is good news. `struck` strikes the whole LINE in red
 * to say the guarantee is not included on monthly, which is not. They can appear on one card at once.
 */
function Line({
  line,
  struck,
  onConcierge,
  disabled,
}: {
  line: FunnelLine;
  struck: boolean;
  onConcierge: () => void;
  disabled: boolean;
}) {
  const conciergePrice = line.was === PRICE_CONCIERGE;
  return (
    <span
      className={[
        "transition-opacity duration-300",
        line.strong ? "font-semibold text-white" : "text-white/80",
        struck ? "opacity-50" : "",
      ].join(" ")}
    >
      {/*
        ‼️ THE RED RULE IS A BACKGROUND THAT GROWS, NOT `line-through` AND NOT A POSITIONED BAR.
        A text-decoration cannot be animated, it is on or it is off, and Matthew asked for it to draw
        across. The first attempt was an absolutely positioned 2px bar scaled from 0, and a browser at
        375px caught it: the sentence wraps to two lines there, and an absolute child of a wrapped
        INLINE box is laid out against the first line fragment only, so the strike covered 109px of a
        241px sentence and simply stopped mid-air. It looked correct at every desktop width.
        A background gradient is painted per line fragment, so it strikes every line, and animating
        background-size from 0% gives the same left to right draw. 300ms out, 300ms back.
      */}
      <span
        className="transition-[background-size] duration-300 ease-out"
        style={{
          backgroundImage: `linear-gradient(${RED}, ${RED})`,
          backgroundRepeat: "no-repeat",
          // 55% rather than 50%: an optical centre on lower-case text sits just below the true middle.
          backgroundPosition: "0 55%",
          backgroundSize: struck ? "100% 2px" : "0% 2px",
        }}
      >
        {line.text}
      </span>

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

      {line.tag && !struck ? (
        <span
          className="ml-1.5 whitespace-nowrap text-xs font-bold uppercase tracking-wide"
          style={{ color: REEF }}
        >
          {line.tag}
        </span>
      ) : null}

      {struck ? (
        <>
          <span
            className="ml-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: "rgba(239,68,68,0.15)", color: RED }}
          >
            Yearly only
          </span>
          {/* Said, not drawn. A red rule and a 50% opacity are nothing to a screen reader. */}
          <span className="sr-only">Not included on the monthly plan.</span>
          {/*
            ‼️ WHY IT IS YEARLY ONLY, BESIDE THE THING BEING TAKEN AWAY. Matthew, 2026-09-26: the
            guarantee needs a six month commitment because organic customers take 30 to 90 days to
            start showing up. As small print under the card it would answer the objection after the
            reader had already formed it.
          */}
          <span className="mt-1.5 block text-xs font-normal not-italic text-white/40">
            {GUARANTEE_COMMITMENT_NOTE} You save {SAVE_YEARLY_AMOUNT} on the year.
          </span>
        </>
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

/** The tick's opposite, same box and same weight so the list does not shift when it swaps. */
function Cross() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-1 h-4 w-4 shrink-0"
      fill="none"
      stroke={RED}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
