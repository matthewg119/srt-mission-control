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
 * Vertical slug to profile.
 *
 * ‼️ THE KEY IS THE SAME TAXONOMY THE AUDIT CLASSIFIER WRITES, not a parallel one. `medspa` is
 * what service-synonyms.ts treats as the canonical member of the med-spa cluster, and a qualified
 * row keyed on anything else is a dead end for campaign building later.
 */
export const ICP_BY_VERTICAL: Record<string, string> = {
  medspa: MED_SPA_ICP,
};

/** The vertical a Workflow C run assumes when nothing has said otherwise. */
export const DEFAULT_VERTICAL = "medspa";

/** The profile for a vertical, falling back to the default rather than to an empty string. */
export function icpFor(vertical: string | null | undefined): string {
  const key = (vertical || "").trim().toLowerCase();
  return ICP_BY_VERTICAL[key] ?? MED_SPA_ICP;
}
