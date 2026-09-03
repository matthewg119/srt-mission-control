// The block the audit report ends on. THREE LINKS AND NOTHING ELSE.
//
// ‼️ NO PRICE AND NO OFFER TERMS LIVE HERE ANY MORE (2026-09-03, on the founder's call).
//
// This block used to print PRICE_RETAINER, FREE_UNTIL_LINE and the OFFER_INCLUDES bullets under
// the buttons. Every one of those is gone and none of them may come back. The reason is not
// cosmetic. The report renders from `main`, so every report already sent quotes whatever `main`
// says, and `main` said "$349 / month" and "5 qualified AI-sourced inquiries inside the first 30
// days" while the onboarding agreement said $499 and "5 new qualified appointments" with no
// window. Two documents reach the same prospect. Somebody reads one figure and signs another.
//
// A report that states no terms cannot contradict the agreement. The terms are stated ONCE, in
// the agreement, at the moment of signing, where they are actually binding. Restoring a price or
// a guarantee here re-opens the contradiction, and it re-opens it in the one document that has
// ALREADY BEEN SENT and cannot be corrected.
//
// ‼️ config/pitch.ts IS STILL THE ONLY HOME FOR A FIGURE. Nothing changed about that rule. This
// file simply no longer displays one. Do not read the missing import as an invitation.
//
// ── One link, and the ramp is gone ───────────────────────────────────────────
// The report used to end on a bare booking link, and /chatgpt-ads was added as a step in between
// on the argument that asking somebody who has just been told they are invisible to commit in one
// jump is too much. That second link was REMOVED on 2026-09-03, on the founder call, and the
// report now offers exactly one way forward.
//
// ‼️ THE COUNTER-ARGUMENT IS RECORDED HERE ON PURPOSE, because it was raised and overruled rather
// than missed. /onboarding2 ends in a SIGNATURE, which is a larger commitment than the booking
// link the ramp was originally built for, so on the original reasoning the ramp applies more here
// and not less. What carries it is that nothing is charged at signing and the button names the
// outcome rather than the mechanism, so it self-selects. If report-to-signing conversion falls,
// restoring a second, softer link is the first thing to try, and buildAdsFunnelUrl() in
// lib/onboarding2-link.ts is deliberately left in place for exactly that.
//
// BOOKING_LINK is tri-state and null is a real state. With none configured this renders WITHOUT
// that button rather than a dead `href="#"`, for the same reason the Loom script prints a
// correction instead of the close: a link that goes nowhere is discovered by the prospect.
//
// ‼️ EVERY PROP IS OPTIONAL AND THE COMPONENT STILL RENDERS WITHOUT THEM. A pending or failed
// report has no score, no competitor and no counts. A missing param renders the generic hero on
// the destination, which is documented behaviour over there, so there is nothing to guard here.
import { BOOKING_LINK } from "@/config/pitch";
import { buildOnboarding2Url, scaleToSample } from "@/lib/onboarding2-link";

export function PricingCta({
  score,
  city,
  business,
  competitor,
  mentioned,
  totalPrompts,
  reportSlug,
}: {
  score?: number | null;
  city?: string | null;
  business?: string | null;
  competitor?: string | null;
  mentioned?: number;
  totalPrompts?: number;
  reportSlug?: string | null;
} = {}) {
  const userShowed =
    typeof mentioned === "number" && typeof totalPrompts === "number"
      ? scaleToSample(mentioned, totalPrompts)
      : null;

  const params = {
    score: score ?? null,
    city: city ?? null,
    business: business ?? null,
    competitor: competitor ?? null,
    userShowed,
    // What the competitor scored is not carried. The report knows how many prompts named them,
    // but not out of the same denominator this scale uses, and a number that looks precise and is
    // not is worse here than no number: the whole pitch is that everything in this report is
    // something they can go and check themselves.
    compShowed: null,
    reportSlug: reportSlug ?? null,
  };

  return (
    <div className="rounded-lg border border-surface-border bg-surface p-4">
      <a
        href={buildOnboarding2Url(params)}
        className="mb-3 block w-full rounded-lg bg-reef py-3 text-center text-sm font-semibold text-midnight transition hover:opacity-90"
      >
        Get Started
      </a>
      {BOOKING_LINK ? (
        <a
          href={BOOKING_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block w-full rounded-lg border border-surface-border py-3 text-center text-sm font-semibold text-text-secondary transition hover:opacity-90"
        >
          Or book the onboarding call
        </a>
      ) : null}
    </div>
  );
}
