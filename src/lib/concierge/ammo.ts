// What the owner concierge is allowed to say about a market, and what it must say when it cannot.
//
// ‼️ THIS FILE ADDS NO NEW SUPPLY AND NO NEW LEDGER. competitorAmmo, signalAmmo, spentAmmo,
// unspentAmmo and ammoKey already exist and already work. What was missing was a caller shaped like
// a conversation rather than like an email: ammoForProspect() takes a prospect id, and a stranger
// reading a page is not a prospect anybody enrolled.
//
// ‼️ IT CALLS unspentAmmo(), NOT nextAmmo(), AND THE DIFFERENCE IS THE WHOLE POINT.
// nextAmmo() narrows to one item because operator-rules.ts forbids stacking in a cold email
// sequence, where two findings in one message burn tomorrow's material. A visitor reading a page
// has no tomorrow's message to burn. Matthew settled this 2026-09-03. Nothing in spend.ts changed;
// unspentAmmo() was already exported and already returned the whole ordered list.
//
// ‼️ THE OWNER AUDIENCE ONLY. A patient does not want to hear which rival clinic ChatGPT names, and
// handing that list to one would be repeating a market analysis we did FOR the clinic back to the
// clinic's own customer. The guard is here rather than at the call site so no future caller can
// forget it.

import { competitorAmmo, signalAmmo, type AmmoCandidate } from "@/lib/ammo/supply";
import { unspentAmmo } from "@/lib/ammo/spend";
import type { AmmoSpent } from "@/lib/followup-operator/types";
import { displayPlace, type Place } from "@/lib/market/place";
import type { Audience } from "./magnets";

export interface ConciergeAmmoInput {
  audience: Audience;
  /** The VISITOR's market, never the tenant's. SRT's own vertical is aeo-agency-med-spa. */
  place: Place | null;
  service: string | null;
  /** Already spent, from the session ledger seeded off the prospect ledger. */
  spent: readonly AmmoSpent[];
  /** Names that mean the visitor. They are never returned as their own competitor. */
  excludeNames?: Array<string | null | undefined>;
  /** Only present when we happen to have already scored this exact business. Usually absent. */
  scoreComponents?: unknown;
  optimizationComponents?: unknown;
}

export interface ConciergeAmmo {
  /** Unspent, competitor lines first, strongest first inside each kind. */
  candidates: AmmoCandidate[];
  place: Place | null;
  service: string | null;
  /** Why there is nothing, when there is nothing. Null when there is something. */
  reason: string | null;
  /** What the model must SAY when candidates is empty. Never a number, never a guess. */
  degradeLine: string | null;
}

/**
 * The honest sentence for an unmeasured market.
 *
 * ‼️ THIS IS NOT A CONSOLATION STRING, IT IS THE MAJORITY PATH, AND IT IS WHY THIS FUNCTION EXISTS.
 * Measured 2026-09-03: the dataset holds 47 real cities, and the med spa family occupies 8 of them
 * after the curated service merges. Every other city has nothing city-specific and there is not
 * supposed to be one, because the alternative is naming a rival in a market nobody measured.
 *
 * It also happens to be the strongest thing we can offer, and that is not a rationalisation. /scan
 * produces the audit_runs rows that scripts/build-market-dataset.ts turns into market_mentions, so
 * "we have not measured your city" is literally the pitch for the thing that measures it.
 *
 * ‼️ IT PROMISES NOTHING ABOUT WHEN. Widening the dataset means re-running a batch script against
 * new target cities, which is a cost decision and not automatic. The copy says we have not measured
 * it and offers the scan. It does not say we will, or soon.
 */
function degradeFor(place: Place | null): string {
  const where = place ? displayPlace(place) : "your city";
  return (
    `We have not put ${where} through the engines yet, so I have no measured list of who ChatGPT ` +
    `names there and I am not going to invent one. The scan is how that gets measured.`
  );
}

/**
 * Everything true, specific and not yet said, for one visitor.
 *
 * Empty is a NORMAL answer and callers must read `degradeLine` rather than treating it as failure.
 */
export async function conciergeAmmo(input: ConciergeAmmoInput): Promise<ConciergeAmmo> {
  if (input.audience !== "owner") {
    return {
      candidates: [],
      place: input.place,
      service: input.service,
      reason: "competitor evidence is not offered to a patient audience",
      degradeLine: null,
    };
  }

  // ‼️ SIGNAL AMMO IS NOT THE DEGRADE PATH FOR A STRANGER, AND ASSUMING IT WAS IS THE EASY MISTAKE.
  // signalAmmo() reads score_components, which are the SCRAPER's measurements of a business we
  // already put through the scraper lane. It needs a measurement of THEIR business, not of their
  // city. A visitor who has never been scraped has neither, so these are usually empty too, and the
  // real third rung is degradeLine.
  const signals = signalAmmo({
    scoreComponents: input.scoreComponents,
    optimizationComponents: input.optimizationComponents,
  });

  let competitors: AmmoCandidate[] = [];
  let reason: string | null = null;

  if (!input.place) reason = "the visitor has not told us their city yet";
  else if (!input.service) reason = "we do not know what this business sells yet";
  else {
    competitors = await competitorAmmo({
      place: input.place,
      service: input.service,
      excludeNames: input.excludeNames,
    });
    if (!competitors.length) reason = "no engine has named anyone in this city and service yet";
  }

  const candidates = unspentAmmo([...input.spent], [...competitors, ...signals]);

  return {
    candidates,
    place: input.place,
    service: input.service,
    reason: candidates.length ? null : (reason ?? "every measured line has already been used"),
    degradeLine: candidates.length ? null : degradeFor(input.place),
  };
}
