// The strategy map: nine pillars, six supports each, built from the keywords a person PICKED.
//
// Matthew, 2026-09-29: "in reality then I need to pick 9 keywords (pillars) and 6 support pillars
// for each keyword, this is how we can introduce this to our current strategy."
//
// ‼️ THIS IS NOT clusterFinalists AND IT DELIBERATELY KNOWS NOTHING ABOUT SERP READINGS.
// `clusterFinalists` in keyword-strategy-rules.ts opens with
// `rows.filter(r => r.verdict && r.verdict !== "unclear")`, so with no screenshots on file it returns
// zero clusters and the whole pillar model is unreachable by typing. That gate is right for a MODEL's
// proposal: a phrase nobody has looked at must not become a page. It is wrong for a phrase a person
// chose, which is the same substitution the page pool already makes when it treats a picked keyword
// as relevant by decision. So this groups picks, and the screenshot lane stays an optional enrichment
// that adds verdicts, page kinds and magnet judgements on top.
//
// ‼️ PURE AND DETERMINISTIC. The same picks give the same map twice, which is what lets the card's
// numbers be typed at and what lets a probe assert the shape without a database.

import { normalizePhrase } from "./phrase-quality";
import type { StoredKeyword } from "./keyword-expansion";

/**
 * Nine subjects the site is built around.
 *
 * ‼️ NOT PLAN_KEYWORDS_NEEDED, AND NOT PRE_CALL_SUPPORTS. Those two describe ONE batch: the pillar
 * and six supports step 21 drafts before the call. This is the whole strategy, and step 21 keeps
 * drawing its seven pages from the top of it. Tying the two together is the mistake the
 * `over_delivery` rank already records: a contract is not a batch size.
 */
export const STRATEGY_PILLARS = 9;

/** Six ways into each subject. One pillar plus six supports is the cluster shape step 21 drafts. */
export const SUPPORTS_PER_PILLAR = 6;

/** 9 + 54. What step 12 asks for before the map is complete. */
export const STRATEGY_KEYWORDS = STRATEGY_PILLARS * (1 + SUPPORTS_PER_PILLAR);

/** One subject: the phrase the cluster is named by, and the ways into it. */
export interface MappedCluster {
  pillar: StoredKeyword;
  supports: StoredKeyword[];
  /** How many of the six supports are still missing. */
  short: number;
}

export interface StrategyMap {
  clusters: MappedCluster[];
  /** Picked rows that are not a pillar and did not fit under one, in rank order. */
  unplaced: StoredKeyword[];
  /** Picked rows that could be a pillar but are past the ninth, so they wait. */
  spare: StoredKeyword[];
  /** How many pillars are still missing. */
  pillarsShort: number;
  /** How many support slots are still empty, across every cluster that exists. */
  supportsShort: number;
  /** True when there are nine pillars and every one of them has six supports. */
  complete: boolean;
}

/**
 * Words that carry no subject, so two phrases sharing only these share nothing.
 *
 * ‼️ NOT A STEMMER AND NOT A SYNONYM TABLE. `sameSubject` next door already refuses that, in writing,
 * and for the same reason: synonymy is a judgement a person or an approved keyword row makes, never a
 * string comparison. This list only stops "how much does it cost" and "how long does it take" reading
 * as one subject because they share "how", "does" and "it".
 */
const NO_SUBJECT = new Set([
  "a", "about", "after", "am", "an", "and", "any", "are", "as", "at", "be", "before", "best", "but",
  "by", "can", "cost", "did", "do", "does", "for", "from", "get", "getting", "good", "has", "have",
  "how", "i", "if", "in", "is", "it", "long", "many", "me", "much", "my", "near", "of", "on", "or",
  "our", "should", "so", "that", "the", "their", "them", "there", "they", "this", "to", "up", "us",
  "was", "we", "what", "when", "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

/** The words in a phrase that say what it is about. */
export function subjectWords(phrase: string): Set<string> {
  const out = new Set<string>();
  for (const w of normalizePhrase(phrase).split(" ")) {
    if (!w || w.length < 3 || NO_SUBJECT.has(w)) continue;
    out.add(w);
  }
  return out;
}

/** How strongly a support belongs under a pillar. 0 means it shares no subject word with it. */
export function affinity(support: StoredKeyword, pillar: StoredKeyword): number {
  const a = subjectWords(support.phrase);
  const b = subjectWords(pillar.phrase);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  // The category counts for one word's worth: two price questions belong together even when they
  // share no noun, which is exactly the case the four buying questions produce.
  const sameCategory = support.category === pillar.category ? 1 : 0;
  return shared * 2 + sameCategory;
}

/**
 * Group the picks into pillars and supports.
 *
 * `namingKey` is the category that names what the client sells, which is the only thing a pillar may
 * be: a page has to be aimed at the offer, and a support is a way into it. Everything else the person
 * picked becomes a support, or waits as unplaced with the card saying so.
 *
 * ‼️ A PILLAR IS NEVER ALSO A SUPPORT, and the order of the two loops is what guarantees it.
 */
export function mapStrategy(
  picks: readonly StoredKeyword[],
  opts: { namingKey: string | null; pillars?: number; perPillar?: number }
): StrategyMap {
  const wantPillars = opts.pillars ?? STRATEGY_PILLARS;
  const perPillar = opts.perPillar ?? SUPPORTS_PER_PILLAR;

  const live = [...picks].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const namingKey = opts.namingKey;

  // ‼️ SAME TEST selectOfferPlan USES, which is what stops step 12 accepting a map step 21 would
  // then refuse. There, `naming: r.category === naming` decides the pillar; here it decides
  // eligibility. One rule, so a complete map is a plannable map.
  const eligible = namingKey ? live.filter((r) => r.category === namingKey) : [];
  const chosen = eligible.slice(0, wantPillars);
  const spare = eligible.slice(wantPillars);

  const pillarIds = new Set(chosen.map((r) => r.id));
  const clusters: MappedCluster[] = chosen.map((pillar) => ({ pillar, supports: [], short: perPillar }));

  // ‼️ A SPARE NAMING PHRASE IS HELD, NOT FILED UNDER SOMEBODY ELSE'S PILLAR. It names the offer
  // itself, so as a support of a DIFFERENT pillar it competes with that pillar's own page rather than
  // feeding it, which is the same reason `supports` is never "a naming variant" at step 21. It waits
  // instead, and the card says it is waiting, so swapping it in is a decision somebody takes on
  // purpose. Caught by _probe-keywords.ts §5b, which asserted the documented rule before the code did
  // it.
  const spareIds = new Set(spare.map((r) => r.id));
  const rest = live.filter((r) => !pillarIds.has(r.id) && !spareIds.has(r.id));
  const unplaced: StoredKeyword[] = [];

  // Best fit first, so a support that clearly belongs somewhere is not taken by a cluster that
  // merely had room. Deterministic: ties fall to the earlier cluster, and rows come in rank order.
  for (const row of rest) {
    let best = -1;
    let score = 0;
    clusters.forEach((c, i) => {
      if (c.supports.length >= perPillar) return;
      const a = affinity(row, c.pillar);
      if (a > score) {
        score = a;
        best = i;
      }
    });

    // Nothing in common with any cluster that has room. It is not lost: it stays picked, it stays
    // approved, and the card lists it so a person can re-aim it or add the pillar it wants.
    if (best < 0 || score === 0) {
      unplaced.push(row);
      continue;
    }
    clusters[best].supports.push(row);
  }

  for (const c of clusters) c.short = Math.max(0, perPillar - c.supports.length);

  const pillarsShort = Math.max(0, wantPillars - clusters.length);
  const supportsShort = clusters.reduce((n, c) => n + c.short, 0) + pillarsShort * perPillar;

  return {
    clusters,
    unplaced,
    spare,
    pillarsShort,
    supportsShort,
    complete: pillarsShort === 0 && supportsShort === 0,
  };
}

/** What the map still needs, in one sentence, or null when it is done. */
export function mapGap(map: StrategyMap): string | null {
  if (map.complete) return null;
  const bits: string[] = [];
  if (map.pillarsShort > 0) {
    bits.push(
      `${map.pillarsShort} more pillar${map.pillarsShort === 1 ? "" : "s"} (a pillar has to NAME what they sell)`
    );
  }
  if (map.supportsShort > 0) {
    bits.push(`${map.supportsShort} more support${map.supportsShort === 1 ? "" : "s"}`);
  }
  return bits.join(" and ");
}
