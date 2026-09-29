"use client";

// The free-first funnel. ONE CARD, AND THE OFFER BEHIND ITS BUTTON.
//
// ‼️ THIS IS NOT THE PICKER WITH A CARD REMOVED, AND THE DIFFERENCE IS THE WHOLE POINT. The picker
// at /onboarding2 puts free and paid side by side, so a reader who arrived from a free audit report
// is asked to price a $3,300 decision in the same glance as a free one. This screen shows free
// alone, takes the yes, and only then asks the second question. The offer is identical; the order
// is the experiment.
//
// ‼️ THE FREE BUTTON DOES NOT OPEN A SESSION. It opens step one. Nothing is written until one of
// the three terminal buttons is tapped, which means somebody can look at all six variants and walk
// both modals without burning a row or one of the five daily starts this IP is allowed. That is
// also what makes the six previews comparable by hand.
//
// ‼️ EVERY FIGURE COMES FROM config/pitch.ts. Not one is typed here. See that file's header for
// what it cost the last time a price was copied into a second file.
//
// ‼️ THE PRICING PARTS ARE IMPORTED FROM offer-cards.tsx RATHER THAN REBUILT. BillingToggle, Price,
// Line, Tick and Cross carry about ninety lines of decision commentary between them, including the
// one that matters most here: the red strike is a growing BACKGROUND rather than `line-through`,
// because the first attempt used an absolutely positioned bar and at 375px, where the sentence
// wraps, it covered 109px of a 241px line and stopped mid-air. Rebuilding them here would rebuild
// that bug. The five `export` keywords in offer-cards.tsx are the entire cost of not doing so.

import { useCallback, useState } from "react";
import {
  DEFAULT_BILLING,
  PAID_BILLING,
  PRICE_YEAR,
  PRICE_YEAR_EQUIV,
  UPSELL,
  offerFor,
  type BillingState,
  type OfferKey,
} from "@/config/pitch";
import { BillingToggle, Cross, Line, Price, Tick } from "../offer-cards";
import { UpsellSurface } from "./upsell-surface";
import type { FunnelVariant } from "./variants";

const REEF = "#00C9A7";

/**
 * Where in the ladder somebody stopped. Written to onboarding2_signings.upsell_outcome.
 *
 * ‼️ `declined` IS NOT A FAILURE AND MUST NOT BE READ AS ONE. It means they took the free engine
 * after seeing both offers, which is a real deliverable they keep forever. The column exists to
 * tell the six variants apart, not to score the visitor.
 */
export type UpsellOutcome = "accepted_year" | "accepted_month" | "declined" | "free_direct";

/**
 * Which step is on screen.
 *
 * ‼️ THIS IS DELIBERATELY NOT PART OF THE FUNNEL'S `Stage` UNION. That type describes the
 * relationship to the SERVER SESSION: `loading` is a resume in flight, `chat` is a session that
 * exists, `limited` is the server refusing. The ladder happens entirely before the first byte is
 * sent, so folding it in would mean that type no longer answers one question.
 */
type Phase = "card" | "one" | "two";

/**
 * What step two opens on.
 *
 * ‼️ MONTHLY, WHICH IS THE OPPOSITE OF THE /onboarding2 PICKER, AND THE DIFFERENCE IS DELIBERATE
 * (Matthew, 2026-09-29). `DEFAULT_BILLING` in pitch.ts is the YEARLY state, because that card opens
 * cold and the guaranteed year is what it argues for. Step two is not cold: the reader has just
 * been shown the year at PRICE_YEAR and said no to it. Opening on the same number they already
 * declined asks the same question twice, which is the one thing a second screen must not do.
 * Landing on PRICE_MONTH makes step two an actual alternative, and the toggle is right there for
 * anybody who wants to reconsider the guarantee.
 *
 * ‼️ IT IS DERIVED FROM PAID_BILLING RATHER THAN CHANGING DEFAULT_BILLING, because that constant
 * is what the live two-card picker opens on and this route must not reach across and move it.
 * Falls back to DEFAULT_BILLING if the monthly state is ever removed, so this cannot render an
 * empty toggle.
 */
const FALLBACK_BILLING = PAID_BILLING.find((b) => b.plan === "monthly") ?? DEFAULT_BILLING;

/**
 * ‼️ MIRRORS OfferCards' SIGNATURE ON PURPOSE. Same `onPick` and `busy`, so this drops into the
 * existing `stage === "offer"` branch of onboarding2-client.tsx as a straight swap and `start()`
 * does not learn a new shape.
 */
export function FreeFirstPicker({
  onPick,
  busy,
  variant,
  business,
}: {
  onPick: (offer: OfferKey, conciergeInterest: boolean, outcome: UpsellOutcome) => void;
  busy: boolean;
  variant: FunnelVariant;
  /** From the report params, for the hero that names them. Null on cold ad traffic. */
  business: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("card");
  const [picked, setPicked] = useState(false);
  const [billing, setBilling] = useState<BillingState>(FALLBACK_BILLING);

  const free = offerFor("review_free");
  const year = offerFor("year_3300");

  const choose = useCallback(
    (offer: OfferKey, outcome: UpsellOutcome) => {
      if (busy || picked) return;
      setPicked(true);
      track(outcome === "declined" ? "upsell_decline" : "upsell_accept", variant.key, outcome);
      onPick(offer, false, outcome);
    },
    [busy, picked, onPick, variant.key]
  );

  function openLadder() {
    if (busy || picked) return;
    track("upsell_shown", variant.key, null);
    setPhase("one");
  }

  function toStepTwo() {
    track("upsell_step2", variant.key, null);
    setPhase("two");
  }

  const title = heroTitle(variant.title, business);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 sm:py-16">
      {/* ── The title, in one of three places. ── */}
      {variant.titlePlacement === "hero" && title ? (
        <header className="mb-8">
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{title}</h1>
          <div className="mt-4 h-0.5 w-12 rounded-full" style={{ backgroundColor: REEF }} />
          {variant.subtitle ? (
            <p className="mt-4 max-w-md text-sm text-white/60 sm:text-base">{variant.subtitle}</p>
          ) : null}
        </header>
      ) : null}

      {variant.titlePlacement === "above" && title ? (
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          {variant.subtitle ? (
            <p className="mx-auto mt-3 max-w-md text-sm text-white/60 sm:text-base">
              {variant.subtitle}
            </p>
          ) : null}
        </header>
      ) : null}

      {/* ── The free card. ── */}
      <section className="flex flex-col rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10 sm:p-7">
        <div className="order-1 text-center">
          <div className="text-2xl font-bold leading-tight text-white sm:text-[26px]">
            {free.funnelHeadline}
          </div>
          <h2 className="mt-2 text-base font-semibold" style={{ color: REEF }}>
            {free.name}
          </h2>
        </div>

        <p className="order-2 mt-3 text-center text-sm text-white/70">{free.tagline}</p>

        {/*
          ‼️ THIRD ON MOBILE, LAST ON DESKTOP, DONE AT THE FLEX LEVEL. The house order on a phone is
          headline, tagline, CTA, then the detail: six ticked lines above the button puts the button
          below the fold and the visitor scrolls past the thing they came to do. `order-*` rather
          than reordering the DOM, so reading order and tab order stay the reading order.
        */}
        <div className="order-4 mt-5 lg:order-last lg:mt-auto lg:pt-6">
          <button
            type="button"
            disabled={busy || picked}
            onClick={openLadder}
            className="w-full rounded-lg bg-[#00C9A7] px-5 py-3.5 text-sm font-bold text-[#04252b] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {picked ? "One moment" : variant.freeCta}
          </button>
        </div>

        <ul className="order-5 mt-6 space-y-3 lg:order-4">
          {free.funnelIncludes.map((line) => (
            <li key={line.text} className="flex gap-2.5 text-sm">
              <Tick />
              {/*
                ‼️ onConcierge IS A NO-OP HERE AND THAT IS NOT LAZINESS. On the paid card it exists
                because `was: PRICE_CONCIERGE` makes the struck $199 tappable. No line on the free
                card carries `was`, so nothing on this list is tappable and the handler is
                unreachable. Passing a no-op states that, rather than wiring a path that cannot be
                taken to a behaviour nobody checked.
              */}
              <Line line={line} struck={false} onConcierge={() => {}} disabled />
            </li>
          ))}
        </ul>

        {free.funnelFooter ? (
          <p className="order-5 mt-4 text-sm font-semibold text-white lg:order-4">
            {free.funnelFooter}
          </p>
        ) : null}

        {/* The inline presentations grow here, inside the card, under everything. */}
        {variant.presentation === "inline" && phase !== "card" ? (
          <div className="order-last">
            <Ladder
              phase={phase}
              variant={variant}
              billing={billing}
              onBilling={setBilling}
              year={year}
              busy={busy || picked}
              onAccept={() => choose("year_3300", "accepted_year")}
              onDecline={toStepTwo}
              onPlan={() =>
                choose(billing.offer, billing.plan === "yearly" ? "accepted_year" : "accepted_month")
              }
              onRefuse={() => choose("review_free", "declined")}
              onDismiss={null}
            />
          </div>
        ) : null}
      </section>

      <p className="mx-auto mt-8 max-w-md text-center text-xs text-white/40">
        Nothing is charged here and no card is taken. We go through everything together on the call
        before anything is signed.
      </p>

      {/* The overlay presentations. Same ladder, different container. */}
      {variant.presentation !== "inline" && phase !== "card" ? (
        <Ladder
          phase={phase}
          variant={variant}
          billing={billing}
          onBilling={setBilling}
          year={year}
          busy={busy || picked}
          onAccept={() => choose("year_3300", "accepted_year")}
          onDecline={toStepTwo}
          onPlan={() =>
            choose(billing.offer, billing.plan === "yearly" ? "accepted_year" : "accepted_month")
          }
          onRefuse={() => choose("review_free", "declined")}
          /*
            ‼️ DISMISSING GOES BACK TO THE CARD, IT DOES NOT START A SESSION. Escape and a backdrop
            tap are "I am not ready to answer this", and reading either as a decision would record
            an offer nobody chose.
          */
          onDismiss={() => setPhase("card")}
        />
      ) : null}
    </div>
  );
}

/** Both steps, in whichever surface the variant asked for. */
function Ladder({
  phase,
  variant,
  billing,
  onBilling,
  year,
  busy,
  onAccept,
  onDecline,
  onPlan,
  onRefuse,
  onDismiss,
}: {
  phase: Phase;
  variant: FunnelVariant;
  billing: BillingState;
  onBilling: (next: BillingState) => void;
  year: ReturnType<typeof offerFor>;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onPlan: () => void;
  onRefuse: () => void;
  onDismiss: (() => void) | null;
}) {
  const headingId = `upsell-${variant.key}-${phase}`;
  return (
    <UpsellSurface presentation={variant.presentation} labelledBy={headingId} onDismiss={onDismiss}>
      {phase === "one" ? (
        <StepOne
          id={headingId}
          variant={variant}
          year={year}
          busy={busy}
          onAccept={onAccept}
          onDecline={onDecline}
        />
      ) : (
        <StepTwo
          id={headingId}
          variant={variant}
          billing={billing}
          onBilling={onBilling}
          year={year}
          busy={busy}
          onPlan={onPlan}
          onRefuse={onRefuse}
        />
      )}
    </UpsellSurface>
  );
}

/**
 * Step one. The add-on, in one of three reading orders.
 *
 * ‼️ THE ORDER IS THE EXPERIMENT AND THE WORDS ARE NOT. `guarantee`, `price` and `objection` change
 * which block is in the largest type and which comes first. Every block is the same copy in all
 * three, because a variant that also changed the sentences would be testing two things at once and
 * the winner would say which.
 */
function StepOne({
  id,
  variant,
  year,
  busy,
  onAccept,
  onDecline,
}: {
  id: string;
  variant: FunnelVariant;
  year: ReturnType<typeof offerFor>;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const headline = (
    <h2 id={id} className="text-xl font-bold leading-snug text-white sm:text-2xl">
      {UPSELL.one.headline}
    </h2>
  );

  const priceBlock = (
    <div>
      <div className="text-[28px] font-bold leading-none text-white sm:text-[32px]">
        {PRICE_YEAR}
      </div>
      <div className="mt-1.5 text-xs text-white/50">Works out at {PRICE_YEAR_EQUIV}.</div>
    </div>
  );

  return (
    <div>
      <div className="mb-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: REEF }}>
        {UPSELL.one.eyebrow}
      </div>

      {/* ‼️ WHEN THE PRICE LEADS, THE HEADLINE STILL CARRIES THE id. The heading is what the dialog
          is announced as, and moving the label onto a number would announce "$3,300 a year" to a
          screen reader with no idea what it buys. */}
      {variant.leadsWith === "price" ? (
        <>
          {priceBlock}
          <div className="mt-4">{headline}</div>
        </>
      ) : variant.leadsWith === "objection" ? (
        <>
          <p className="text-lg font-semibold leading-snug text-white">{UPSELL.one.objection}</p>
          <div className="mt-4">{headline}</div>
          <div className="mt-4">{priceBlock}</div>
        </>
      ) : (
        <>
          {headline}
          <div className="mt-4">{priceBlock}</div>
        </>
      )}

      {/* What they already have, beside what is being added. The split variant only. */}
      {variant.split ? (
        <div className="mt-5 rounded-xl bg-white/5 p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
            You have
          </div>
          <div className="flex gap-2.5 text-sm text-white/85">
            <Tick />
            <span>The AI Referral Engine, free, set up for you.</span>
          </div>
        </div>
      ) : null}

      <p className="mt-5 text-sm leading-6 text-white/70">
        {variant.leadsWith === "objection" ? UPSELL.one.framing : UPSELL.one.objection}
      </p>

      {/*
        ‼️ THE `strong` LINE IS DROPPED HERE, AND IT IS THE ONLY LINE THIS SCREEN OMITS.
        Two reasons, and either alone would be enough:

        1. IT IS THE HEADLINE AGAIN. `UPSELL.one.headline` is already "5 booked appointments in 90
           days, guaranteed", in the largest type on the surface. Rendering the bullet as well says
           the same sentence twice in one eyeful, which reads as padding.
        2. IT IS THE ONE LINE ON THIS CARD THAT NAMES A REMEDY. Its text is "...or your money
           back", and Matthew's instruction for this screen was to keep the guarantee vague. The
           headline names the OUTCOME, which is sayable; "money back" is a remedy, and the one in
           the signed agreement is narrower and specific (REFUND_LINE: the first three months back
           and we keep working the rest of the year). A modal promising more than the document
           underneath it is the fault PricingCta.tsx's header was written about.

        ‼️ IT IS NOT DROPPED IN STEP TWO, AND THAT IS NOT AN INCONSISTENCY. There the line is what
        the red strike ACTS ON: striking it is how monthly is shown to have no guarantee. Removing
        it there would silently delete the strike and leave month_349 looking guaranteed.

        Found by `Boolean(line.strong)`, never by index and never by matching the sentence, which is
        the same rule offer-cards.tsx states where it finds the same line.
      */}
      <ul className="mt-4 space-y-2.5">
        {year.funnelIncludes
          .filter((line) => !line.strong)
          .map((line) => (
            <li key={line.text} className="flex gap-2.5 text-sm">
              <Tick />
              <Line line={line} struck={false} onConcierge={() => {}} disabled />
            </li>
          ))}
      </ul>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="w-full rounded-lg bg-[#00C9A7] px-5 py-3.5 text-sm font-bold text-[#04252b] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {variant.acceptCta}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="w-full rounded-lg px-5 py-3 text-sm font-medium text-white/50 transition hover:text-white disabled:cursor-not-allowed"
        >
          {variant.declineCta}
        </button>
      </div>

      <p className="mt-4 text-xs leading-5 text-white/35">{UPSELL.one.terms}</p>
    </div>
  );
}

/**
 * Step two. The same offer, second look, with the monthly alternative beside it.
 *
 * ‼️ IDENTICAL IN ALL SIX VARIANTS EXCEPT FOR THE SURFACE AND THE BUTTON WORDS. The toggle is what
 * does the arguing here, and six wordings of one toggle is a test of nothing.
 *
 * ‼️ THE GUARANTEE LINE IS STRUCK WHEN MONTHLY IS SELECTED, AND THIS IS THE HIGHEST-CONSEQUENCE
 * LINE IN THE FILE. It is found by `Boolean(line.strong)`, never by index and never by matching its
 * text, exactly as offer-cards.tsx finds it. Rendering `struck={false}` unconditionally would show
 * "5 booked appointments in 90 days, or your money back" as a live promise on month_349, an offer
 * whose contract has `guarantee: null` and whose own includes list says "No guarantee and no
 * refunds". That is a misrepresentation at the moment of purchase and it would look completely
 * fine on screen.
 */
function StepTwo({
  id,
  variant,
  billing,
  onBilling,
  year,
  busy,
  onPlan,
  onRefuse,
}: {
  id: string;
  variant: FunnelVariant;
  billing: BillingState;
  onBilling: (next: BillingState) => void;
  year: ReturnType<typeof offerFor>;
  busy: boolean;
  onPlan: () => void;
  onRefuse: () => void;
}) {
  return (
    <div>
      <div className="mb-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: REEF }}>
        {UPSELL.two.eyebrow}
      </div>

      <h2 id={id} className="text-lg font-bold leading-snug text-white sm:text-xl">
        {UPSELL.two.headline}
      </h2>

      {/*
        GUARANTEE_COMMITMENT_NOTE verbatim. The brief asked for a 60 to 90 day window; this constant
        already says 30 to 90 and already ships on the live paid card, and one claim told two ways
        to one reader is the fault config/pitch.ts exists to prevent.

        ‼️ HIDDEN ON MONTHLY, BECAUSE THE STRUCK LINE BELOW ALREADY CARRIES IT. `Line` renders this
        exact constant under the guarantee when it strikes it, which is where a reader is looking at
        the thing being taken away. Printing it here as well put the same two sentences on screen
        twice, about nine lines apart, the moment the toggle moved.
      */}
      {billing.guaranteed ? (
        <p className="mt-3 text-sm leading-6 text-white/60">{UPSELL.two.turnaround}</p>
      ) : null}

      <p className="mt-5 text-center text-sm text-white/70">{UPSELL.two.togglePrompt}</p>

      <div className="mt-3 text-center">
        <BillingToggle
          current={billing}
          onBilling={(next) => onBilling(next)}
          disabled={busy}
        />
        <Price billing={billing} />
      </div>

      <ul className="mt-5 space-y-2.5">
        {year.funnelIncludes.map((line) => {
          const isGuarantee = Boolean(line.strong);
          const struck = isGuarantee && !billing.guaranteed;
          return (
            <li key={line.text} className="flex gap-2.5 text-sm">
              {struck ? <Cross /> : <Tick />}
              <Line line={line} struck={struck} onConcierge={() => {}} disabled />
            </li>
          );
        })}
      </ul>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={onPlan}
          className="w-full rounded-lg bg-[#00C9A7] px-5 py-3.5 text-sm font-bold text-[#04252b] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {billing.cta}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRefuse}
          className="w-full rounded-lg px-5 py-3 text-sm font-medium text-white/50 transition hover:text-white disabled:cursor-not-allowed"
        >
          {variant.refuseCta}
        </button>
      </div>

      {/* ‼️ THE LAST EXIT LEADS SOMEWHERE GOOD AND SAYS SO. Somebody who taps it keeps the whole
          free engine. It is not a dismissal, and the ban on attaching scarcity to the free offer
          (see the note over OFFERS in pitch.ts) reaches this line too. */}
      <p className="mt-4 text-center text-xs leading-5 text-white/35">{UPSELL.refuseNote}</p>
    </div>
  );
}

/**
 * Fill `{business}` from the report, or drop the clause.
 *
 * ‼️ THE WHOLE CLAUSE GOES, NOT JUST THE NAME. `?business=` is absent on cold ad traffic, and a
 * headline reading "Your free AI Referral Engine is ready ." with a hanging space is worse than one
 * that never promised to know who they are.
 */
function heroTitle(title: string | null, business: string | null): string | null {
  if (!title) return null;
  return title.replace("{business}", business ? `, ${business}` : "");
}

/**
 * The ladder's own events.
 *
 * Same shape as track() in offer-cards.tsx and for the same reasons: a CustomEvent that costs
 * nothing and still fires when the pixel is blocked, plus a guarded fbq. Both in try/catch, because
 * an undefined fbq would take the button's own click handler down with it and the button is the
 * only thing on screen that matters.
 */
function track(
  event: "upsell_shown" | "upsell_step2" | "upsell_accept" | "upsell_decline",
  variant: string,
  outcome: UpsellOutcome | null
): void {
  const detail = { variant, outcome };
  try {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  } catch {
    // A browser without CustomEvent is not one this funnel is going to convert.
  }
  try {
    const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
    if (typeof fbq === "function") fbq("trackCustom", event, detail);
  } catch {
    // Pixel blocked, or loaded and broken. Never the button's problem.
  }
}
