// ‼️ THE PRICE AND THE CTA COME FROM config/pitch.ts, NOT FROM A LITERAL HERE (2026-08-25).
//
// This file used to carry "$349/month" and "$499/month" as literals plus two hardcoded
// buy.stripe.com URLs, and srt-agwb/pricing/index.html carried the same four strings again with
// only a prose comment connecting them. That is three copies of a price with no build step between
// them, and it is how src/app/v2/page.tsx ended up quoting $299 for months without anyone noticing.
//
// ‼️ THERE IS NO CHECKOUT LINK ANY MORE. Nothing is charged up front under the current offer, so a
// "pay now" button here would contradict the free period that the report, the video and the call
// all promise. The CTA books the onboarding call instead. The old Stripe payment links still exist
// inside Stripe; they are simply not linked from anywhere.
//
// BOOKING_LINK is tri-state and null is a real state. With none configured this renders the offer
// WITHOUT a button rather than a dead `href="#"`, for the same reason the Loom script prints a
// correction instead of the close: a link that goes nowhere is discovered by the prospect.
import { BOOKING_LINK, FREE_UNTIL_LINE, OFFER_INCLUDES, PRICE_RETAINER } from "@/config/pitch";

export function PricingCta() {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4">
      {BOOKING_LINK ? (
        <a
          href={BOOKING_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-3 block w-full rounded-lg bg-reef py-3 text-center text-sm font-semibold text-midnight transition hover:opacity-90"
        >
          Book the onboarding call
        </a>
      ) : null}
      <div className="text-sm text-text-secondary">
        <p className="font-semibold text-text-primary">AI Visibility</p>
        <p className="text-text-primary">{PRICE_RETAINER}</p>
        {/* FREE_UNTIL_LINE is written to be spoken mid-sentence, so it starts lowercase. */}
        <p className="mb-2">{`${FREE_UNTIL_LINE.charAt(0).toUpperCase()}${FREE_UNTIL_LINE.slice(1)}.`}</p>
        <ul className="list-disc space-y-1 pl-4">
          {OFFER_INCLUDES.map((item) => (
            <li key={item.work}>{item.work}.</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
