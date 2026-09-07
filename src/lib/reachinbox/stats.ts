// The funnel arithmetic for the campaign card, and the gate that stops it lying.
//
// ‼️ A RATE IS PRINTED ONLY WHEN ITS DENOMINATOR WAS MEASURED. This is the same rule the audit
// engine's coverage gate enforces and the same one campaign-digest.ts enforced by printing no
// rates at all while ReachInbox's API was out of reach. It matters more now, not less: the send
// events arrive on a PRO free trial that ends 2026-09-15, so the denominator can disappear
// mid-week without anything else changing. When it does, these functions return null and the card
// prints a count and says why. Dividing by a partial send number would produce a reply rate that
// looks plausible, reads high, and is wrong in the flattering direction.
//
// Pure: no DB, no Slack, no env. scripts/_probe-reachinbox.ts asserts every branch offline.

export interface CampaignFunnel {
  campaign: string;
  /** Distinct addresses a `sent` event was seen for. Null means never measured for this campaign. */
  sent: number | null;
  replied: number;
  bounced: number;
  opened: number;
  clicked: number;
  /** Repliers who then booked a call. */
  booked: number;
  /** Bookings that became a client row. */
  closed: number;
}

/**
 * A percentage, or null when there is nothing honest to divide by.
 *
 * A null denominator means "never measured" and a zero denominator means "measured, and nothing
 * happened". Both are unprintable as a rate, and they are kept distinct because the card says
 * different things about them.
 */
export function rate(numerator: number, denominator: number | null): number | null {
  if (denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

/** One decimal place, and no trailing ".0" on a whole number. */
export function formatPct(value: number | null): string | null {
  if (value === null) return null;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/**
 * `9 of 412 (2.2%)`, degrading to a bare count when there is nothing to divide by.
 *
 * A zero denominator degrades the same way a null one does. "0 of 0" is not a smaller truth than
 * "0", it is just harder to read, and the distinction between never-measured and measured-as-zero
 * is carried by formatFunnel in words rather than smuggled into a number.
 */
export function countOf(numerator: number, denominator: number | null): string {
  if (denominator === null || denominator <= 0) return String(numerator);
  const pct = formatPct(rate(numerator, denominator));
  return `${numerator} of ${denominator}${pct ? ` (${pct})` : ""}`;
}

export interface FunnelLines {
  /** The campaign name, already bolded for Slack. */
  header: string;
  lines: string[];
}

/**
 * Render one campaign's funnel.
 *
 * Reply, booking and close each name their own denominator in words. Three rates over three
 * different bases in one card is exactly where a reader guesses wrong, so none of them is printed
 * as a bare percentage.
 */
export function formatFunnel(f: CampaignFunnel): FunnelLines {
  const lines: string[] = [];

  const reach = [
    f.sent === null ? null : `${f.sent} sent`,
    `${f.replied} replied`,
    f.bounced ? `${f.bounced} bounced` : null,
  ].filter(Boolean) as string[];
  lines.push(reach.join("  ·  "));

  if (f.sent === null) {
    // Named, not silent. "No reply rate" with no reason reads like a bug in the card.
    lines.push("_No send events for this campaign, so no reply rate._");
  } else {
    lines.push(`Reply rate: ${countOf(f.replied, f.sent)} of the people we emailed.`);
  }

  // The trailing clause names the denominator, so it has to disappear along with it. "Closed: 0 of
  // the people who booked" when nobody booked reads like a sentence that got cut off.
  const over = (n: number, d: number, what: string) =>
    d > 0 ? `${countOf(n, d)} of the people who ${what}.` : `${n}.`;

  lines.push(`Booked: ${over(f.booked, f.replied, "replied")}`);
  lines.push(`Closed: ${over(f.closed, f.booked, "booked")}`);

  return { header: `*${f.campaign}*`, lines };
}

/**
 * Most replies first, then most sent. A campaign nobody answered sinks whatever its volume was,
 * which is the order the reader wants when deciding what to keep running.
 */
export function sortFunnels(funnels: CampaignFunnel[]): CampaignFunnel[] {
  return [...funnels].sort(
    (a, b) => b.replied - a.replied || (b.sent ?? 0) - (a.sent ?? 0) || a.campaign.localeCompare(b.campaign)
  );
}

/** The name a campaign gets on the card when the events carried none. */
export const UNATTRIBUTED = "(no campaign on the event)";
