// Which mailboxes cold outreach goes out from, in what order, and how much each may send per day.
//
// WHY THIS IS CONFIG AND NOT A CONSTANT
// The stated reason for a second mailbox was: never send cold from your primary mailbox, because
// a complaint spike on Microsoft's shared outbound pool can throttle the whole tenant, including
// client mail. submissions@srtagency.com does NOT achieve that. Same domain, same tenant, same
// outbound pool, same domain reputation. It spreads per-mailbox volume, which is worth having, but
// it does not isolate the tenant and it does not protect client mail.
//
// Only a separate sending domain on separate infrastructure does. So the list is an ordered,
// env-overridable array rather than two hardcoded addresses: adding matthew@srtoutreach.com later
// is then a config change, and the warm-up ramp is a cap change without a deploy.

export interface OutreachMailbox {
  /** Full address, lowercased. */
  address: string;
  /** SENDS per Eastern day. Not drafts: a draft sitting in Outlook costs deliverability nothing. */
  dailyCap: number;
}

const DEFAULT_CAP = 30;

/** The connected Microsoft account. Graph reaches it as /me; every other mailbox needs
 *  /users/{address} plus Mail.Send.Shared, which the delegated token does hold. */
export function connectedMailbox(): string {
  return (process.env.OUTREACH_MAILBOX || "matthew@srtagency.com").toLowerCase();
}

function defaultCap(): number {
  return Math.max(1, Number(process.env.OUTREACH_MAILBOX_DAILY_CAP) || DEFAULT_CAP);
}

/**
 * ORDERED. The first entry fills first; when it is at its cap the next one takes over; when every
 * one is full nothing is drafted and the card says so.
 *
 * OUTREACH_MAILBOXES="matthew@srtagency.com:30,submissions@srtagency.com:30"
 * The ":n" is optional and falls back to OUTREACH_MAILBOX_DAILY_CAP.
 */
export function outreachMailboxes(): OutreachMailbox[] {
  const raw = (process.env.OUTREACH_MAILBOXES || "").trim();
  if (!raw) {
    return [
      { address: connectedMailbox(), dailyCap: defaultCap() },
      { address: (process.env.SUBMISSIONS_MAILBOX || "submissions@srtagency.com").toLowerCase(), dailyCap: defaultCap() },
    ];
  }

  const parsed: OutreachMailbox[] = [];
  for (const entry of raw.split(",")) {
    const [addr, cap] = entry.split(":").map((s) => s.trim());
    if (!addr) continue;
    parsed.push({ address: addr.toLowerCase(), dailyCap: Math.max(0, Number(cap) || defaultCap()) });
  }
  // An unparseable env var must not silently mean "no mailboxes and therefore no outreach".
  return parsed.length > 0 ? parsed : [{ address: connectedMailbox(), dailyCap: defaultCap() }];
}

/** Graph wants `undefined` for the connected account and an address for anything else. */
export function toGraphMailbox(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  return address.toLowerCase() === connectedMailbox() ? undefined : address.toLowerCase();
}
