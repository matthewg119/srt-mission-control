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
}

export interface EnrichHit {
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  provider: string;
  costUsd: number;
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

export interface Provider {
  key: string;
  label: string;
  /** The env var that turns it on. Absent means the rung is skipped and said so once. */
  envKey: string;
  /** Roughly what one lookup costs, for the spend estimate shown before the gate. */
  costPerLookup: number;
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
 * Empty today on purpose: no provider is chosen yet, and inventing an adapter for a vendor nobody
 * has signed up to would be a file that compiles and lies. `enrichOne` below handles an empty
 * waterfall correctly and says so, which is the honest state of stage 4 right now.
 */
export const PROVIDERS: Provider[] = [];

/** Which rungs are actually usable, and which are dark for want of a key. */
export function configuredProviders(): { live: Provider[]; dark: Provider[] } {
  const live: Provider[] = [];
  const dark: Provider[] = [];
  for (const p of PROVIDERS) (process.env[p.envKey] ? live : dark).push(p);
  return { live, dark };
}

/**
 * Walk the waterfall for one company, stopping at the first deliverable named address.
 *
 * ‼️ A ROLE ADDRESS DOES NOT STOP THE WALK. info@ and booking@ are what an Instagram bio and a
 * contact page hand over, and step 7 strips them anyway when a named person is wanted. Accepting one
 * here would end the walk on the thing the next stage is about to throw away, so it is recorded as a
 * miss with the reason and the next rung is asked.
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
      if (ROLE_PATTERN.test(hit.email)) {
        attempts.push({ provider: p.key, ok: true, found: false, detail: `role address (${hit.email})`, ms });
        continue;
      }

      attempts.push({ provider: p.key, ok: true, found: true, detail: hit.email, ms });
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

  if (!live.length) {
    return [
      ":warning: *No enrichment provider is configured*, so nothing was enriched and nothing was spent.",
      dark.length
        ? `Set one of ${dark.map((p) => `\`${p.envKey}\``).join(", ")} to turn a rung on.`
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
    lines.push(`  _${dark.length} rung${dark.length === 1 ? "" : "s"} dark for want of a key: ${dark.map((p) => p.envKey).join(", ")}_`);
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
