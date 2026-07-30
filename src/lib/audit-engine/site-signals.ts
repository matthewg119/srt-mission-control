// The "one thing on your site actively working against you" hook.
//
// Cold email 1 gets ONE finding, and the strongest one is usually not the audit score at
// all — it's something the owner already half-knows is true and can verify in five seconds
// ("your site was last updated January 17, 2012"). It reads as curiosity instead of insult,
// and it's the line that earns the "yes, send it".
//
// Every check here is a pure function over the homepage HTML that site-research.ts ALREADY
// fetched during classification. No extra request, no new dependency, and nothing here can
// fail the audit — a signal we can't compute is simply absent.
//
// NO GUESSING RULE (same spirit as run-prompts.ts): a signal is only emitted when the
// markup literally shows it. We never infer "probably outdated" from a vibe, because Matthew
// pastes these findings into an email a stranger will fact-check.

export interface SiteSignal {
  /** Stable machine key, so a future email template can branch without string matching. */
  kind: "stale_copyright" | "no_viewport" | "insecure" | "no_schema" | "no_phone";
  /** One clause, written to be pasted into an email as-is. No leading capital needed. */
  detail: string;
}

/** Years older than this are the interesting finding; anything recent is just a stale footer. */
const STALE_AFTER_YEARS = 3;

/** Lowest plausible copyright year for a website. Guards against matching a street address
 *  or a price that happens to look like a year. */
const EARLIEST_PLAUSIBLE_YEAR = 1995;

/**
 * Newest copyright year anywhere in the markup, or null.
 *
 * Takes the MAX rather than the first match on purpose: plenty of sites have a stale
 * hardcoded year in one template and a current one in another, and reporting the stale one
 * as "last updated" would be the kind of overstatement that gets the whole email dismissed.
 */
function newestCopyrightYear(html: string): number | null {
  const matches = [
    ...html.matchAll(/(?:©|&copy;|&#169;|copyright)[^0-9]{0,20}((?:19|20)\d{2})/gi),
  ];
  const years = matches
    .map((m) => parseInt(m[1], 10))
    .filter((y) => y >= EARLIEST_PLAUSIBLE_YEAR);
  return years.length > 0 ? Math.max(...years) : null;
}

function hasViewportMeta(html: string): boolean {
  return /<meta[^>]+name=["']viewport["']/i.test(html);
}

/** A tel: link or a formatted number in the visible markup. */
function hasPhone(html: string): boolean {
  if (/href=["']tel:/i.test(html)) return true;
  return /(?:\(\d{3}\)\s*|\b\d{3}[.\s-])\d{3}[.\s-]\d{4}\b/.test(html);
}

export interface DetectSignalsInput {
  html: string;
  /** Final URL after normalization, used for the https check. */
  website: string;
  /** Already-parsed LocalBusiness/Organization JSON-LD blocks from site-research.ts. */
  schemaHints: Record<string, unknown>[];
  /** Current year. Passed in rather than read from the clock so this stays a pure function. */
  currentYear: number;
}

/**
 * All signals worth mentioning, ordered most damning first — the caller can take [0] as
 * "the one thing" without re-ranking. Returns an empty array when the site is clean, which
 * is a real answer and not a failure.
 */
export function detectSiteSignals(input: DetectSignalsInput): SiteSignal[] {
  const { html, website, schemaHints, currentYear } = input;
  const signals: SiteSignal[] = [];

  const year = newestCopyrightYear(html);
  if (year !== null && currentYear - year >= STALE_AFTER_YEARS) {
    signals.push({
      kind: "stale_copyright",
      detail: `the copyright in the site footer still reads ${year}, so the newest date a buyer or an AI engine can see on the site is ${currentYear - year} years old`,
    });
  }

  if (!hasViewportMeta(html)) {
    signals.push({
      kind: "no_viewport",
      detail: "the site has no mobile viewport tag, so it renders desktop-width on a phone",
    });
  }

  if (website.startsWith("http://")) {
    signals.push({
      kind: "insecure",
      detail: "the site is still served over http, so browsers label it Not Secure",
    });
  }

  if (schemaHints.length === 0) {
    signals.push({
      kind: "no_schema",
      detail:
        "there is no LocalBusiness or Organization structured data on the site, which is the machine-readable record engines look for first",
    });
  }

  if (!hasPhone(html)) {
    signals.push({
      kind: "no_phone",
      detail: "there is no phone number in the homepage markup for an engine to pick up",
    });
  }

  return signals;
}
