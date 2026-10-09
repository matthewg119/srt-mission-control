// The free rules, and where a judged lead goes. Pure, so it can be proved offline.
//
// ‼️ FREE BEFORE PAID, THE SAME ORDER filter.ts ALREADY USES for its string checks ahead of a DNS
// lookup. Every rule in this file is answerable from columns already on the row, so a row it
// decides is a row the model is never asked about, and the model costs about four cents a batch.
//
// ‼️ BUT A FREE RULE MAY NOT REPLACE THE MODEL, AND THAT IS MEASURED. Over the Dallas 500 the free
// filter (core category AND website) kept 255 and Haiku kept 256, and the two lists disagree on 165
// rows: 82 free-yes/Haiku-no, 83 free-no/Haiku-yes. The counts match and the businesses do not. So
// the free rules here are deliberately narrow: they answer "can this be emailed at all" and "how
// big is it", never "is this the buyer".
//
// ‼️ AND NOT ONE OF THEM DELETES ANYTHING. Matthew's rule: do not throw away leads without an
// email. A business with no website, an Instagram-only presence or a domain that cannot receive mail
// is unreachable BY THIS CHANNEL, which is a fact about the channel. For a three-person clinic a
// phone call often beats a cold email, and scripts/export-cold-call-leads.ts already produces that
// CSV. So the outcome of a free rule is a ROUTE, never a bin.

import { domainKey } from "./dedup";
import { normalizeHost } from "@/lib/company-identity";

/**
 * Where a lead goes.
 *
 *   email  there is a domain worth crawling for an address
 *   call   there is a business worth ringing but no address this lane can find
 *   drop   nobody there can buy, so neither channel is worth the attempt
 */
export type LeadRoute = "email" | "call" | "drop";

export interface FreeRuleInput {
  website: string | null;
  domain: string | null;
  reviewCount: number | null;
  /**
   * How many OTHER rows in the same pull share this row's domain, aggregator hosts excluded.
   *
   * ‼️ COUNTED BY THE CALLER, AND EXCLUDING AGGREGATORS IS THE WHOLE POINT. Measured on the Dallas
   * 500: 15 domains appear at 2+ locations covering 47 rows, and 15 of those 47 are
   * `instagram.com` (9), `vagaro.com` (4) and `facebook.com` (2). A naive "same domain means chain"
   * rule deletes nine unrelated businesses as one franchise. The real multi-location rows are about
   * 32: usdermatologypartners.com 6, handandstone.com 4, thefacehaus.com 3,
   * locations.massageenvy.com 3, then pairs.
   */
  sameDomainCount: number;
}

export interface FreeVerdict {
  route: LeadRoute;
  /** Prose a person reads in bulk, in the same voice the model writes. Grouped by groupDrops. */
  reason: string;
}

/**
 * Whether a website identifies a business, or only a platform it rents space on.
 *
 * ‼️ IT ASKS dedup.ts's `domainKey`, WHICH IS WHERE THE HOST LIST ALREADY LIVES. That function
 * returns null for exactly three reasons (a bare hostname, an IP literal, or a host in
 * NON_IDENTIFYING_HOSTS) and the set is already 27 entries long, covering the three that actually
 * bit this pull (instagram.com 9 rows, vagaro.com 4, facebook.com 2) plus two dozen that would bite
 * the next one. A second list here would start out agreeing and then stop.
 *
 * ‼️ "NO DOMAIN" AND "A DOMAIN THAT IDENTIFIES NOBODY" ARE DIFFERENT AND ARE SEPARATED HERE. A
 * blank cell is answered by the website check in freeVerdict; this returns true only when the row
 * DID give us something and the something was somebody else's platform. Collapsing the two would
 * report every websiteless clinic as "Instagram only", which is a claim about the market the data
 * does not support.
 */
export function isAggregatorDomain(website: string | null | undefined): boolean {
  const given = normalizeHost(website);
  if (!given) return false;
  return domainKey(website) === null;
}

/**
 * The review band, as a HINT for the model and never as a verdict.
 *
 * ‼️ A HINT, BECAUSE THE DISTRIBUTION SAYS IT CANNOT BE A VERDICT. Measured over the 48 sendable
 * rows and the 155 re-qualified ones:
 *
 *                      n    0 rev  1-24  25-99  100-299  300+   avg
 *   sendable           48    0      9     22      13       4    101
 *   re-qualified 155  155    8     50     43      30      24    144
 *
 * The 1-99 band is 65% of sendable and 60% of the 155. A rule that dropped it would delete most of
 * the list, and a rule that preferred the 300+ tail would preferentially email the salons and nail
 * bars the widened ICP admitted. The count belongs in the prompt as context, which is where it
 * already is: qualify.ts's `describe` has fed reviews to the model since it was written.
 */
export function reviewBand(reviewCount: number | null): "none" | "small" | "mid" | "large" | "huge" {
  const n = reviewCount ?? -1;
  if (n < 0) return "none";
  if (n === 0) return "none";
  if (n < 25) return "small";
  if (n < 100) return "mid";
  if (n < 300) return "large";
  return "huge";
}

/**
 * The free verdict, or null when only the model can answer.
 *
 * ‼️ null IS THE COMMON ANSWER AND IT MEANS "ASK THE MODEL". Three rules fire here; everything else
 * falls through at full price, which is four cents a batch of twenty and is the correct spend. A
 * free rule that guessed would be the measured 165-row disagreement, applied silently.
 */
export function freeVerdict(lead: FreeRuleInput): FreeVerdict | null {
  const site = (lead.website ?? "").trim();

  // 1. No website. The only enrichment rung this lane has is crawling one, so there is no address
  //    to find, at any price. The call list, and arguably the best prospects in the pull for an AEO
  //    pitch: a clinic with no website has the most to gain and the least to defend.
  if (!site) return { route: "call", reason: "no website on the row" };

  // 2. A domain that is somebody else's platform. Same outcome and a different reason, because the
  //    reason is read in bulk: "Instagram or booking page only" is a signal about the MARKET, and
  //    folding it into "no website" would hide it.
  if (isAggregatorDomain(lead.domain ?? site)) {
    // The reason names the platform family rather than the exact host, because it is GROUPED: six
    // rows on vagaro.com and four on instagram.com are one signal, not two.
    return { route: "call", reason: "Instagram or booking page only, no own domain" };
  }

  // 3. A domain at several locations, aggregators already excluded above. A location manager cannot
  //    buy anything and the marketing is set at head office.
  //
  //    ‼️ THRESHOLD IS 2 OTHERS, NOT 1, BECAUSE THE BUYER IS "ONE TO THREE LOCATIONS". The ICP says
  //    so in words. A pair sharing a domain is a two-site local group, which is exactly the buyer;
  //    three or more is a group that has a head office. usdermatologypartners.com at 6 and
  //    handandstone.com at 4 are caught, and the pairs are left for the model to judge on the name.
  if (lead.sameDomainCount >= 2) {
    return {
      route: "drop",
      reason: "domain shared by " + (lead.sameDomainCount + 1) + " locations in this pull",
    };
  }

  return null;
}

/**
 * The route a TIER implies, for a lead the model judged.
 *
 * ‼️ TIER C IS 'call', NOT 'drop', AND THIS FUNCTION IS THE ONLY PLACE THAT SAYS SO. A nail bar has
 * a front desk and a phone and no reason to read a cold email about AI search. Dropping it would
 * throw away a lead with no email, which is the one thing the operator has asked not to happen.
 *
 * ‼️ AND AN UNTIERED KEEP IS 'email'. Every one of the 256 kept rows on the Dallas run was judged
 * before tiering existed. Reading a missing tier as C would stop mailing the only list there is.
 */
export function routeForTier(tier: "A" | "B" | "C" | null, keep: boolean): LeadRoute {
  if (!keep) return "drop";
  if (tier === "C") return "call";
  return "email";
}
