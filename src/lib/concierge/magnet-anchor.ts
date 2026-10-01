// The client's ONE anchor offer, and the shape a page's framing of it is stored in.
//
// ‼️ THIS IS WHAT SURVIVED magnet-drafts.ts, WHICH WAS DELETED ON 2026-09-29. That module
// wrote five invented offers per page into lead_magnets, through
// approveMagnetCandidate and the page_magnet_candidates table. Matthew's call: a page does
// not get its own invented offer. There are house offers, and there are tools.
//
// Four things came across because they were never part of the minting lane and are read by
// six modules that have nothing to do with it:
//
//   CTA_MAX       the pill budget, which the concierge probe enforces table-wide
//   PlannedFrame  the shape page_plan.magnet_frame is stored in
//   readFrame     reading one back, dropping rather than repairing
//   anchorFor     which house offer this client's pages hand over to
//
// ‼️ NOTHING HERE WRITES TO lead_magnets, AND NOTHING MAY BE ADDED THAT DOES. The table is
// seeded by docs/2026-09-29-tool-lane.sql with the house offers and nothing in src/ inserts
// into it any more. `grep -rn "from(\"lead_magnets\")" src/` should show reads only; the day
// it shows an insert, per-page invention has come back under a new name.

import { magnetByKey, type LeadMagnet } from "@/lib/concierge/magnets";
import type { Audience } from "@/lib/concierge/magnets";

/**
 * The pill budget.
 *
 * ‼️ ENFORCED TABLE-WIDE BY _probe-concierge-lane.ts §9b, WITH NO CLIENT FILTER, so one row
 * over budget turns the check red for every client. It is the width of a button on a phone,
 * not a style preference.
 */
export const CTA_MAX = 28;

/** How a page's planned framing of the anchor is stored on page_plan.magnet_frame. */
export interface PlannedFrame {
  title: string;
  ctaLabel: string;
  conciergeEntry: string;
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A stored frame, validated. Drop, never repair, same as readOffer. */
export function readFrame(raw: unknown): PlannedFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  const title = trimmed(bag.title);
  const ctaLabel = trimmed(bag.ctaLabel);
  const conciergeEntry = trimmed(bag.conciergeEntry);
  if (!title || !ctaLabel || !conciergeEntry) return null;
  return { title, ctaLabel, conciergeEntry };
}

/**
 * The anchor for this client and this audience, or null.
 *
 * Reads offer.magnetKey, which setAnchorMagnet in offers.ts writes, and resolves it
 * audience-scoped exactly like every other keyed lookup, so an owner anchor can never be
 * framed into the patient catalogue.
 */
export async function anchorFor(clientId: string, audience: Audience): Promise<LeadMagnet | null> {
  const { loadOffer } = await import("@/lib/clients/offers");
  const offer = await loadOffer(clientId);
  if (!offer.magnetKey) return null;
  return magnetByKey(offer.magnetKey, audience);
}
