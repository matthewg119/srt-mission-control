// Stage 4: find a named person's address, cheapest and most accurate first.
//
// Matthew, 2026-09-17: "Waterfall enrichment on the kept file only. Single source covers 50-60%,
// stacked reaches 85%+ ... Clay is a provider. This is a workflow. Clay plugs into step 4 tomorrow
// and can swap out next quarter without touching steps 1-3 or 5-10."
//
// ‼️ THE SEAM IS THE POINT AND IT STAYS OURS. A provider is one object in PROVIDERS below. Nothing
// else in the pipeline knows a vendor's name, so swapping one is a one-line change and comparing two
// is a query rather than an argument.
//
// ‼️ EVERY RUNG RECORDS ITS OWN ATTEMPT, EVEN THE MISSES. sendable_leads.attempts keeps what each
// provider was asked and what it said, because a waterfall is only swappable if the trail survives
// the swap. Without it "Prospeo covers 55%" is a thing somebody remembers rather than a thing the
// database says.
//
// ‼️ IT DEGRADES TO "NOT ENRICHED", IT NEVER THROWS. The same posture MILLIONVERIFIER_API_KEY and
// DATAFORSEO_LOGIN already take: an unconfigured or failing provider is a rung that returns nothing,
// not a dead pipeline. A missing key is reported once on the card rather than per row.
//
// ‼️ AND IT RUNS ON THE KEPT FILE ONLY. qualify.ts is stage 2 and this is stage 4. Anything that
// calls this before a verdict exists has undone the reorder that pays for the whole build.

import { ROLE_PATTERN } from "./rules";

export interface EnrichTarget {
  id: string;
  businessName: string;
  domain: string;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  /** The site to crawl. Distinct from `domain`, which is the normalised key. */
  website?: string | null;
  /** An address the SOURCE FILE already carried, if it did. Cheapest possible rung. */
  fileEmail?: string | null;
  /**
   * What a crawl of this site ALREADY found, so the site-scrape rung does not fetch it again.
   *
   * THREE STATES, AND ALL THREE ARE LOAD BEARING:
   *   undefined  nobody has crawled it, so the rung should crawl.
   *   null       it HAS been crawled and there was nothing, so the rung must report a miss.
   *   an object  use this.
   *
   * With only two states a pre-crawled miss is indistinguishable from "not crawled yet", so the
   * rung re-downloads every site that had no address on it, which is the 38% of them that cost the
   * most to visit. sweepEnrich sets this from one `crawlSite` pass.
   */
  siteEmail?: { email: string; source: string | null } | null;
}

export interface EnrichHit {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  provider: string;
  costUsd: number;
  /**
   * Where the rung actually found it, when it can say. `scrapeEmail` returns things like
   * `scrape:/contact:mailto`, and losing that would mean the attempt trail records WHICH rung
   * answered but not WHAT it looked at, which is half of what makes a waterfall swappable.
   */
  sourceDetail?: string | null;
}

export interface EnrichAttempt {
  provider: string;
  ok: boolean;
  found: boolean;
  detail: string;
  ms: number;
}

export interface EnrichResult {
  id: string;
  hit: EnrichHit | null;
  attempts: EnrichAttempt[];
}

/**
 * How a rung is turned on.
 *
 * ‼️ A FREE RUNG HAS NO CREDENTIAL AND MUST NOT PRETEND TO HAVE ONE. `envKey: string` forced every
 * provider to name an env var, so wiring our own site crawler in meant inventing something like
 * FREE_SCRAPE_ENABLED. That is the worst of both: the rung is DARK on a fresh deploy, and
 * `enrichLines` tells the operator to go set a key for a thing that needs no key. Making the gate
 * a union instead lets the honest answer be expressible.
 */
export type ProviderGate =
  /** A vendor. Dark until the key is set, and the card says so once. */
  | { kind: "env"; envKey: string }
  /** Ours, self-hosted, nothing to buy. Always live. */
  | { kind: "free" };

export interface Provider {
  key: string;
  label: string;
  gate: ProviderGate;
  /** Roughly what one lookup costs, for the spend estimate shown before the gate. */
  costPerLookup: number;
  /**
   * Whether a role address from THIS rung counts as a hit.
   *
   * ‼️ IT IS A PROPERTY OF THE SOURCE, NOT A WORKAROUND. A role address from a named-person
   * DATABASE is a miss: you paid for a person and got a mailbox, and the next rung may still have
   * the person. A role address from a SITE CRAWL is the target: `pickBestEmail` ranks a same-domain
   * role address first precisely because a single-location clinic reads info@ itself, and
   * email-scrape.ts calls those "monitored front-office inboxes, the best outreach targets".
   *
   * Wiring the crawl rung with this false is the highest-severity silent bug available here: the
   * rung reports "0 found, N role address" on a list it actually solved, and the obvious reading is
   * that the crawler is broken.
   */
  acceptsRole?: boolean;
  find(target: EnrichTarget): Promise<EnrichHit | null>;
}

/**
 * The waterfall, in order.
 *
 * ‼️ VERIFIED-ONLY PROVIDERS FIRST, BROAD DATABASES SECOND, AND THE ORDER IS THE BOUNCE RATE.
 * A verified-only source returns less and what it returns is deliverable; a broad database returns
 * more, older, and with more role addresses. Running the broad one first would fill the file with
 * rows the verified one never has to be asked about, which looks like better coverage and is worse
 * mail.
 *
 * ‼️ THE TWO FREE RUNGS COME FIRST AND THAT IS THE SAME RULE, NOT AN EXCEPTION TO IT. An address
 * the source file already carried, and an address published on the company's own contact page, are
 * as verified-only as it gets: nobody inferred them from a pattern. A paid database slots in
 * BENEATH them, where it is asked only about the companies neither free rung could answer, which is
 * also the only place its coverage number means anything.
 *
 * No paid rung today: no vendor is chosen, and inventing an adapter for one nobody has signed up to
 * would be a file that compiles and lies. Adding one is a single object here plus its env key.
 */
export const PROVIDERS: Provider[] = [
  {
    key: "file",
    label: "the dropped file",
    gate: { kind: "free" },
    costPerLookup: 0,
    // A Maps scraper that already found the address published it from the same contact page our
    // own crawl would fetch. Same provenance, so the same answer on role addresses.
    acceptsRole: true,
    async find(t) {
      const email = (t.fileEmail || "").trim().toLowerCase();
      if (!email || !email.includes("@")) return null;
      return {
        email,
        firstName: firstNameOf(t.ownerName),
        lastName: lastNameOf(t.ownerName),
        title: null,
        provider: "file",
        costUsd: 0,
      };
    },
  },
  {
    key: "site-scrape",
    label: "their own website",
    gate: { kind: "free" },
    costPerLookup: 0,
    acceptsRole: true,
    async find(t) {
      // Already crawled by the caller: reuse the answer, and a null is a real answer meaning
      // "crawled, nothing there". Re-crawling it would double the fetch budget for the sites that
      // are slowest to visit.
      if (t.siteEmail !== undefined) {
        if (!t.siteEmail) return null;
        return {
          email: t.siteEmail.email.toLowerCase(),
          firstName: firstNameOf(t.ownerName),
          lastName: lastNameOf(t.ownerName),
          title: null,
          provider: "site-scrape",
          costUsd: 0,
          sourceDetail: t.siteEmail.source,
        };
      }

      const site = t.website || (t.domain ? "https://" + t.domain : null);
      if (!site) return null;
      // Imported lazily: email-scrape.ts pulls in the fetch stack, and enrich.ts is imported by an
      // offline probe that must not need it.
      const { scrapeEmail } = await import("@/lib/email-scrape");
      const found = await scrapeEmail(site, t.ownerName);
      if (!found) return null;
      return {
        email: found.email.toLowerCase(),
        firstName: firstNameOf(t.ownerName),
        lastName: lastNameOf(t.ownerName),
        title: null,
        provider: "site-scrape",
        costUsd: 0,
        sourceDetail: found.source,
      };
    },
  },
];

function firstNameOf(owner: string | null): string | null {
  const parts = (owner || "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[0] : null;
}

function lastNameOf(owner: string | null): string | null {
  const parts = (owner || "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

/**
 * Which rungs are actually usable, and which are dark for want of a key.
 *
 * A `free` rung is unconditionally live: there is no key to be missing, so it can never be dark,
 * and `enrichLines` must never invite somebody to configure it.
 */
export function configuredProviders(): { live: Provider[]; dark: Provider[] } {
  const live: Provider[] = [];
  const dark: Provider[] = [];
  for (const p of PROVIDERS) {
    if (p.gate.kind === "free") live.push(p);
    else (process.env[p.gate.envKey] ? live : dark).push(p);
  }
  return { live, dark };
}

/**
 * Walk the waterfall for one company, stopping at the first deliverable named address.
 *
 * ‼️ A ROLE ADDRESS DOES NOT STOP THE WALK, UNLESS THE RUNG SAYS IT SHOULD. info@ and booking@ are
 * what a broad DATABASE hands over when it has no person, and accepting one there would end the
 * walk on the thing the next rung might have answered properly, so it is recorded as a miss with
 * the reason and the next rung is asked.
 *
 * A rung that sets `acceptsRole` is making the opposite claim about its own source, and for a site
 * crawl the claim is correct: a same-domain role address published on a clinic's contact page is
 * the mailbox the owner actually reads, and it is `pickBestEmail`'s FIRST choice rather than its
 * fallback. Treating that as a miss would throw away most of what the free rungs find and report
 * the crawler as broken. See `Provider.acceptsRole`.
 */
export async function enrichOne(target: EnrichTarget): Promise<EnrichResult> {
  const attempts: EnrichAttempt[] = [];
  const { live } = configuredProviders();

  for (const p of live) {
    const started = Date.now();
    try {
      const hit = await p.find(target);
      const ms = Date.now() - started;

      if (!hit) {
        attempts.push({ provider: p.key, ok: true, found: false, detail: "no match", ms });
        continue;
      }
      if (ROLE_PATTERN.test(hit.email) && !p.acceptsRole) {
        attempts.push({ provider: p.key, ok: true, found: false, detail: `role address (${hit.email})`, ms });
        continue;
      }

      attempts.push({
        provider: p.key,
        ok: true,
        found: true,
        detail: hit.sourceDetail ? `${hit.email} (${hit.sourceDetail})` : hit.email,
        ms,
      });
      return { id: target.id, hit, attempts };
    } catch (e) {
      attempts.push({
        provider: p.key,
        ok: false,
        found: false,
        detail: (e as Error).message,
        ms: Date.now() - started,
      });
    }
  }

  return { id: target.id, hit: null, attempts };
}

export interface EnrichSummary {
  attempted: number;
  found: number;
  costUsd: number;
  byProvider: Record<string, { found: number; missed: number; failed: number }>;
}

export function summarize(results: readonly EnrichResult[]): EnrichSummary {
  const byProvider: EnrichSummary["byProvider"] = {};
  let found = 0;
  let costUsd = 0;

  for (const r of results) {
    if (r.hit) {
      found += 1;
      costUsd += r.hit.costUsd;
    }
    for (const a of r.attempts) {
      const b = (byProvider[a.provider] ??= { found: 0, missed: 0, failed: 0 });
      if (!a.ok) b.failed += 1;
      else if (a.found) b.found += 1;
      else b.missed += 1;
    }
  }

  return { attempted: results.length, found, costUsd, byProvider };
}

/** The funnel line for the card. Counts, never rates. */
export function enrichLines(s: EnrichSummary): string[] {
  const { live, dark } = configuredProviders();

  // ‼️ `dark` HOLDS ONLY `env` RUNGS BY CONSTRUCTION, so naming a key here is always possible.
  // A free rung can never be dark, which is why this branch cannot print "dark for want of a key:
  // undefined" the way it would have if a free rung had been given a fake env var to satisfy the
  // old `envKey: string`.
  const darkKeys = dark.map((p) => (p.gate.kind === "env" ? p.gate.envKey : p.key));

  if (!live.length) {
    return [
      ":warning: *No enrichment provider is configured*, so nothing was enriched and nothing was spent.",
      dark.length
        ? `Set one of ${darkKeys.map((k) => `\`${k}\``).join(", ")} to turn a rung on.`
        : "The waterfall is empty. A provider has to be chosen and added to PROVIDERS in enrich.ts.",
    ];
  }

  const lines = [
    `*Enrichment:* ${s.found} named addresses from ${s.attempted} companies, $${s.costUsd.toFixed(2)}.`,
  ];
  for (const [key, b] of Object.entries(s.byProvider)) {
    const label = PROVIDERS.find((p) => p.key === key)?.label ?? key;
    lines.push(`  • ${label}: ${b.found} found, ${b.missed} no match${b.failed ? `, ${b.failed} failed` : ""}`);
  }
  if (dark.length) {
    lines.push(`  _${dark.length} rung${dark.length === 1 ? "" : "s"} dark for want of a key: ${darkKeys.join(", ")}_`);
  }
  return lines;
}

/** What the enrichment WOULD cost, shown before the gate rather than after the bill. */
export function estimateCost(rows: number): { usd: number; perRow: number; live: number } {
  const { live } = configuredProviders();
  // The waterfall stops at the first hit, so the true cost sits between one rung and all of them.
  // The estimate names the ceiling, because an estimate that is optimistic is one nobody trusts twice.
  const perRow = live.reduce((sum, p) => sum + p.costPerLookup, 0);
  return { usd: rows * perRow, perRow, live: live.length };
}
