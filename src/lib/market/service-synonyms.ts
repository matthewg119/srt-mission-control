// Which service slugs mean the SAME MARKET. Curated by hand, signed off by Matthew 2026-09-03.
//
// ‼️ THIS IS THE FILE service.ts SENDS YOU TO, AND IT IS DELIBERATELY NOT service.ts.
// serviceKey() squashes punctuation and nothing else, and its header bans it from ever growing
// into a synonym map: "Squashing punctuation is a fact about the string. Deciding
// 'medical-aesthetics' and 'medspa' are one market is a claim about the business, and if it is
// wrong this starts naming a day spa's rivals to a med spa as measured fact. If those should
// merge, the right shape is an explicit curated table somebody signed off on, not a looser regex."
//
// This is that table. It is a claim about businesses, so every merge below carries the number that
// justified it and the name of the person who accepted the cost.
//
// ‼️ QUERY TIME, NOT STORED. Callers widen a lookup with .in(), they do not rewrite a row.
// market_mentions.service and .service_key keep the slug the report actually typed, so a card can
// still print it, the dataset can be re-clustered without a rebuild, and unwinding a merge that
// turns out to be wrong is a one line diff instead of a migration.
//
// ‼️ EQUIVALENCE CLASSES, NOT ALIASES INTO A CANONICAL KEY. Looking up "medical-aesthetics" returns
// the whole cluster, exactly as looking up "medspa" does. An asymmetric map would mean a lookup
// found competitors or not depending on which spelling the caller happened to hold, which is the
// same invisible split that made this file necessary.

import { serviceKey } from "./service";

/**
 * MEASURED ON PRODUCTION 2026-09-03, before any merge.
 *
 * "name evidence" is the fraction of a slug's businesses whose OWN NAME contains a med spa word
 * (medspa, medical spa, aesthetic, skin, derm, beauty, glow, rejuven, laser, botox, inject). It is
 * the only independent signal available: it reads what the business calls itself rather than what
 * one classifier typed on one day. `medspa` itself scores 49 percent, so that is the bar, not 100.
 *
 *   key                 businesses  cities                              name evidence
 *   medspa                     111  Fleming Island FL, Newburgh NY,              49%
 *                                   Ocala FL, St Johns FL
 *   medicalaesthetics           68  Jacksonville FL, St Augustine FL             57%
 *   bhrtmedspa                  31  Jacksonville FL                              35%
 *   skincarespa                 21  Fernandina Beach FL                          38%
 *   dermatologyclinic           16  Bedford NH                                   75%
 *
 * Cluster total: 212 distinct businesses across 8 cities. Before the merge a "medspa" lookup
 * reached 111 businesses in 4 cities.
 *
 * ‼️ TWO OF THESE FIVE ARE MATTHEW'S CALL AGAINST MY RECOMMENDATION, AND THE COST IS RECORDED
 * HERE SO NOBODY LATER READS THE LIST AS UNANIMOUS:
 *
 *   bhrtmedspa          Adds NO new city. 11 of its 31 businesses already arrive via
 *                       medicalaesthetics in the same city, so the merge nets 20, and those 20 are
 *                       the hormone half: North Florida Gynecology Specialists, Metabolic Research
 *                       Center, Direct NP. A med spa owner shown a gynecology practice as a
 *                       measured rival is the exact failure service.ts warns about.
 *   dermatologyclinic   Highest name evidence in the table at 75 percent, and a derm group does
 *                       compete for injectables. But it is a physician practice, and it adds only
 *                       Bedford NH.
 *
 * Do not widen this list further without a measurement of the same shape.
 */
const CLUSTERS: readonly (readonly string[])[] = [
  ["medspa", "medicalaesthetics", "bhrtmedspa", "skincarespa", "dermatologyclinic"],
];

/**
 * The service_keys that mean the same market as `service`, always including its own key.
 *
 * Returns [] for a blank service, matching competitorAmmo's existing guard: an empty list must
 * never widen into "every market", which is what returning all clusters would do.
 *
 * Pure, so the probe proves the mapping with no database.
 */
export function marketKeys(service: string | null | undefined): string[] {
  const key = serviceKey(service);
  if (!key) return [];

  for (const cluster of CLUSTERS) {
    if (cluster.includes(key)) return [...cluster];
  }
  return [key];
}

/** Whether two services are the same market under the curated table. For probes and cards. */
export function sameService(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = serviceKey(b);
  return key.length > 0 && marketKeys(a).includes(key);
}
