// The buyer profile each Workflow C run is judged against, one per vertical.
//
// ‼️ IT LIVES HERE AND NOT IN qualify.ts, BECAUSE THAT FILE IS DELIBERATELY VERTICAL-AGNOSTIC.
// Its system prompt says "Judge ONLY against the profile you are given", which is what lets the
// same sweep serve a second vertical without a fork. A med-spa paragraph compiled into the judge
// would quietly make that false. src/data/disposable-domains.ts is the precedent: prompt-shaped
// constants get their own file.
//
// ‼️ THE TEXT IS COPIED ONTO THE RUN, NOT REFERENCED FROM IT. list_pipeline_runs.icp_text stores
// it verbatim at startRun, because a run whose ICP is not on file cannot be argued with after the
// fact and the next run cannot be compared to it. Editing this constant therefore changes what
// FUTURE runs are judged against and rewrites nothing that already happened, which is the point.
//
// ‼️ NO EM DASHES. This string reaches a model that copies the punctuation it is shown, and the
// drop reasons it writes are read by a person and pasted into Slack.

/**
 * Med spas, the AEO offer's buyer.
 *
 * Every line is drawn from something this repo already believes rather than invented:
 * `EXCLUDED_TYPES` and `CHAIN_DOMAINS` in src/lib/medspa.ts, and the US-only rule that
 * beginScoreWorkflow already enforces on geography.
 *
 * ‼️ THE CHAINS ARE NAMED RATHER THAN DESCRIBED. "Not a chain" invites the model to apply its own
 * idea of what a chain is, and it will drop a three-location local group that is exactly the
 * buyer. Naming the eight medspa.ts already filters on makes our list and the model's list the
 * same list.
 *
 * ‼️ THE KEEP-ON-DOUBT RULE IS NOT RESTATED HERE. qualify.ts's system prompt already owns it, and
 * two authorities on the same question is how a prompt starts contradicting itself.
 */
export const MED_SPA_ICP = `We sell AI-search visibility to med spas: we get them named when
somebody asks ChatGPT or Google's AI for the best med spa in their city.

KEEP a business if all of these hold:
- It is a med spa, aesthetics clinic, or skin clinic offering injectables, laser treatment, or
  body contouring under its own brand.
- It is owner operated or a small local group, roughly one to three locations.
- It is in the United States.
- It has its own website on its own domain.
- It has at least some reviews, so we can tell it is still trading.

DROP a business if any of these hold:
- It is a location of a national franchise. The ones we see most: Ideal Image, Milan Laser,
  Sono Bello, LaserAway, European Wax Center, Skin Laundry, Restore Hyper Wellness, The DRIPBaR.
  Treat any other business that is plainly a national chain the same way.
- It is a dermatology practice, a plastic surgery group, or a hospital system, including one with
  a med spa attached. A physician practice buys differently and is not our buyer.
- It is outside the United States.
- It has no website of its own, or its only web presence is a Facebook page, an Instagram link,
  a Linktree, or a booking platform subdomain.
- It is a salon, nail bar, day spa, massage studio, barber, or gym with no medical aesthetics.
- It is permanently closed, or it is a directory listing rather than a business.

When you drop one, write the reason as a short phrase describing the business, not the rule.
Write "national chain location" rather than "fails criterion 1", and write "dermatology practice"
rather than "excluded type". Those phrases get grouped and counted, so two businesses dropped for
the same thing should read the same way.`;

/**
 * Dentists, the second vertical.
 *
 * Built the same way as the med spa profile: the exclusions name the DSOs rather than describing
 * them, for the same reason. "Not a chain" invites the model to apply its own idea of a chain and
 * it will drop a two-location family practice that is exactly the buyer.
 *
 * ‼️ ORTHODONTIC AND PEDIATRIC PRACTICES ARE KEPT, DELIBERATELY. The med spa profile drops
 * dermatology and plastic surgery because a physician practice buys differently, and it would be
 * easy to read that as "drop the specialists" and carry it over. It does not carry over: every
 * practice here is a physician practice, and an orthodontist competes for "best orthodontist near
 * me" on exactly the offer we sell. The med spa exclusion was about a different BUYER, not about
 * a narrower specialty.
 */
export const DENTIST_ICP = `We sell AI-search visibility to dental practices: we get them named
when somebody asks ChatGPT or Google's AI for the best dentist in their city.

KEEP a business if all of these hold:
- It is a dental practice: general, family, cosmetic, implant, orthodontic, periodontal, endodontic
  or pediatric, treating patients under its own brand.
- It is owner operated or a small local group, roughly one to three locations.
- It is in the United States.
- It has its own website on its own domain.
- It has at least some reviews, so we can tell it is still trading.

DROP a business if any of these hold:
- It is a location of a dental support organisation or national chain. The ones we see most: Aspen
  Dental, Heartland Dental, Pacific Dental Services, Smile Brands, Western Dental, Great
  Expressions, Dental Care Alliance, Affordable Dentures, SmileDirectClub. Treat any other business
  that is plainly a national chain the same way.
- It is a dental school clinic, a university teaching clinic, a hospital dental department, or a
  public health or community clinic. They do not buy marketing.
- It is outside the United States.
- It has no website of its own, or its only web presence is a Facebook page, an Instagram link, a
  Linktree, or a booking platform subdomain.
- It is a dental laboratory, a supply company, an insurance network, a billing service, or a
  directory listing rather than a practice that treats patients.
- It is permanently closed.

When you drop one, write the reason as a short phrase describing the business, not the rule. Write
"dental support organisation location" rather than "fails criterion 1", and write "dental school
clinic" rather than "excluded type". Those phrases get grouped and counted, so two businesses
dropped for the same thing should read the same way.`;

/**
 * Vertical slug to profile.
 *
 * ‼️ THE KEY IS serviceKey() SHAPED, not classify.ts's kebab-case `vertical_slug`. `medspa` is what
 * service-synonyms.ts treats as the canonical member of the med-spa cluster, and a qualified row
 * keyed on anything else is a dead end for campaign building later. serviceKey() lowercases and
 * strips every non-alphanumeric, so `dentist` is already in that shape and `med-spa` is not.
 *
 * ‼️ ADDING A VERTICAL IS THIS OBJECT PLUS AN ALIAS LINE BELOW. It is deliberately not a new table,
 * a new cron, or a new lib. The TRT vertical was added by forking medspa.ts into a 485 line twin
 * with its own table, rotation, cron and webhook, and the column names drifted apart inside a week
 * (search_term/search_city against search_query/search_metro). Workflow C exists so that does not
 * happen again: raw_leads.vertical_slug carries the vertical and qualify.ts judges against whatever
 * profile it is handed.
 */
export const ICP_BY_VERTICAL: Record<string, string> = {
  medspa: MED_SPA_ICP,
  dentist: DENTIST_ICP,
};

/** The vertical a Workflow C run assumes when the drop caption names none. */
export const DEFAULT_VERTICAL = "medspa";

/**
 * The profile for a vertical, or null when there is none.
 *
 * ‼️ NULL RATHER THAN THE MED SPA DEFAULT. This used to fall back to MED_SPA_ICP for any unknown
 * key, which reads as helpful and is the exact bug family that has now bitten this codebase four
 * separate times: a `?? "medspa"` that makes a wrong vertical look like a working one. Judging a
 * list of dentists against the med spa profile would drop every row for a reason that sounds
 * plausible ("not a med spa"), and the grouped drop reasons on the review card would look like a
 * bad list rather than a bad lookup. Callers refuse instead.
 */
export function icpFor(vertical: string | null | undefined): string | null {
  const key = (vertical || "").trim().toLowerCase();
  return ICP_BY_VERTICAL[key] ?? null;
}

/** Every vertical this lane can build a list for, for cards and refusal messages. */
export function knownVerticals(): string[] {
  return Object.keys(ICP_BY_VERTICAL).sort();
}

/**
 * Drop caption to vertical.
 *
 * The caption is what the operator types when dropping the CSV in #srt-scraper. It is already
 * stored verbatim as `scraper_batches.batch_label` and already reused as the run's `source_query`,
 * so it is the one piece of operator intent the lane carries end to end without a new input.
 *
 * ‼️ LONGEST ALIAS WINS, so "cosmetic dentistry" cannot be beaten by a shorter alias that happens
 * to appear later in the object. Insertion order is not a contract anybody should have to hold.
 *
 * ‼️ MATCHED IS RETURNED, NOT SWALLOWED. An unmatched caption still yields the default so a drop
 * never dead ends, but the caller has to be able to SAY that on the card. A silent default is how
 * somebody drops a dentist list captioned "Dallas batch 3" and reads 500 med-spa drop reasons.
 */
const VERTICAL_ALIASES: Record<string, string> = {
  medspa: "medspa",
  "med spa": "medspa",
  "med-spa": "medspa",
  "medical spa": "medspa",
  "medical aesthetics": "medspa",
  aesthetics: "medspa",
  "skin clinic": "medspa",
  dentist: "dentist",
  dentists: "dentist",
  dental: "dentist",
  dentistry: "dentist",
  "dental practice": "dentist",
  "dental clinic": "dentist",
  "family dentistry": "dentist",
  "cosmetic dentistry": "dentist",
  orthodontist: "dentist",
};

export function resolveVertical(
  label: string | null | undefined
): { slug: string; matched: boolean } {
  const text = (label || "").trim().toLowerCase();
  if (!text) return { slug: DEFAULT_VERTICAL, matched: false };

  const hit = Object.keys(VERTICAL_ALIASES)
    .filter((alias) => text.includes(alias))
    .sort((a, b) => b.length - a.length)[0];

  if (!hit) return { slug: DEFAULT_VERTICAL, matched: false };
  return { slug: VERTICAL_ALIASES[hit], matched: true };
}
