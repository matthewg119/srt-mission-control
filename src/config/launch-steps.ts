// The 16 Launch Lane steps. The second board, for a client with no website, in any niche.
//
// ‼️ THIS IS NOT A VARIANT OF THE 41-STEP BOARD. IT IS A SECOND BOARD.
// src/config/delivery-steps.ts owns the Slack delivery lane and is untouched by this file.
// Nothing here imports it, and nothing in src/lib/launch/ imports step-engine, step-verify,
// step-board or delivery-checklist. scripts/_probe-launch-isolation.ts fails the build if that
// stops being true, because two lanes that quietly grow back together are one lane with twice
// the surface area.
//
// WHY NOT A `track` FLAG ON THE EXISTING LIST. Two reasons, both load-bearing and both already
// written down in the Slack lane's own files:
//   - `STEP_VERIFIERS` is `Record<StepKey, Verifier>` and exhaustive BY TYPE. A shared registry
//     that dropped a step would break the Slack board's build; one that added a step would
//     demand a Slack verifier for work that never happens in Slack.
//   - `seedDeliverySteps()` re-seeds whenever a client holds fewer rows than
//     DELIVERY_STEPS.length, so a client who legitimately skipped nine steps would have them
//     silently re-created on the next board read.
//
// WHAT IS SHARED IS THE DATA, AND DELIBERATELY ALL OF IT: clients, client_audiences,
// client_offers, audience_documents, page_sources, client_keywords, client_hosts, client_pages,
// concierge_configs, and the whole draft -> gate -> publishPage() chain. A client onboarded here
// is an ordinary `clients` row. The lanes differ in HOW THE WORK IS DRIVEN, never in what the
// product is.

/**
 * The Day 0 wall's step key, spelled the same as the Slack lane's.
 *
 * ‼️ THE SAME STRING ON PURPOSE, AND IT IS SAFE BECAUSE THE WALL IS NOT A STEP ROW.
 * `assertDay0Archived()` and `stampDay0()` in src/lib/clients/day-zero.ts read and write
 * `clients.day_0_archived_at` — a column on the client, not a row in either step table. So the
 * same wall guards both lanes with no second implementation, and `publishPage()` already calls
 * it, which means a Launch Lane page cannot be published before the archive either.
 *
 * It is declared here rather than imported so this file stays pure data with no cross-lane
 * import, matching the direction delivery-steps.ts documents for its own copy.
 */
export const LAUNCH_DAY_ZERO_STEP_KEY = "day_zero_archive";

export interface LaunchStep {
  key: string;
  label: string;
  phase: string;
  /** The system completes this one itself. */
  auto?: boolean;
  /** Nothing after this may legitimately happen before it. */
  gate?: boolean;
  /**
   * 'auto' runs itself when ready; 'manual' and 'auto_then_manual' wait for a person on the
   * dashboard. Distinct from `auto`, which only says the SYSTEM ticks it: a step can be
   * auto_then_manual (the system does the work, a person confirms it landed).
   */
  mode?: "auto" | "manual" | "auto_then_manual";
  /**
   * Keys that must be complete before this one is honestly startable.
   *
   * ADVISORY, exactly as in the Slack lane. It flags out-of-order work in the render. The single
   * exception is day_zero_archive, which really does refuse, in code, in day-zero.ts.
   */
  blockedBy?: readonly string[];
  /**
   * One line on what "done" means here, shown under the step.
   *
   * The Slack lane carries this in card copy assembled by step-engine. This lane has no cards,
   * so it lives with the step.
   */
  detail?: string;
  /**
   * True when the step is only meaningful for a client who arrived with no website.
   *
   * A client who already has a site runs the same lane with these skipped — see §8 of the plan.
   * It is a render hint, never an enforcement: `skipStep()` records a reason either way.
   */
  noWebsiteOnly?: boolean;
}

/**
 * ‼️ `as const satisfies`, FOR THE REASON delivery-steps.ts GIVES AT LENGTH.
 * A `LaunchStep[]` annotation widens every `key` to `string`, and then
 * `Record<LaunchStepKey, LaunchVerifier>` accepts a map that is missing a step or carries a
 * typo. A step with no verifier can never be ticked, so the failure mode is a step that
 * silently refuses forever and is discovered on a live client.
 *
 * Declared privately and re-exported wide: `as const` narrows each element to its own literal
 * shape, so a step with no `blockedBy` has no such property and every read site stops compiling.
 */
export const PHASE_SETUP = "Set up";
export const PHASE_BUILD = "Build";
export const PHASE_LIVE = "Live";

const STEP_LIST = [
  // ── SET UP: everything that can happen before anything is built ─────────────
  {
    key: "launch_intake",
    phase: PHASE_SETUP,
    label: "Business details captured, niche declared",
    detail:
      "Name, address, phone, hours, and what this business actually sells. The website field is optional here, which is the whole point of this lane.",
    auto: true,
    mode: "auto",
  },
  {
    key: "documents_uploaded",
    phase: PHASE_SETUP,
    label: "The four foundation documents uploaded",
    detail:
      "Deep research and avatar sheet for the audience; short offer and necessary beliefs for the offer. They become audience_documents rows AND page_sources client-library rows, which is what replaces a website crawl as evidence for every page this client will ever publish.",
    mode: "manual",
    blockedBy: ["launch_intake"],
  },
  {
    key: "audience_confirmed",
    phase: PHASE_SETUP,
    label: "Audience and its vocabulary confirmed",
    detail:
      "The words this niche uses for its buyer, its offer, its premises and its visit, proposed from the documents and confirmed once. This is the step that makes the lane niche-agnostic: a roofer arrives as documents, not as a new code entry.",
    auto: true,
    mode: "auto_then_manual",
    blockedBy: ["documents_uploaded"],
  },
  {
    key: "offer_confirmed",
    phase: PHASE_SETUP,
    label: "The one offer confirmed",
    detail:
      "Read from the short offer document: what is sold, to whom, and the promise. Written to client_offers under the confirmed audience.",
    auto: true,
    mode: "auto_then_manual",
    blockedBy: ["audience_confirmed"],
  },
  {
    key: "domain_bought",
    phase: PHASE_SETUP,
    label: "Domain chosen, bought and attached",
    detail:
      "Searched and priced through the Vercel registrar, bought on confirmation, then the apex is attached to the project and www is attached as a redirect to it. SRT holds the domain, so there is no client DNS step and nothing to wait for.",
    mode: "auto_then_manual",
    blockedBy: ["launch_intake"],
    noWebsiteOnly: true,
  },

  // ── BUILD ───────────────────────────────────────────────────────────────────
  //
  // ‼️ THE WALL SITS AT THE TOP OF THIS PHASE AND NOT LOWER DOWN.
  // Everything above is measurement and paperwork and changes nothing a search engine or an
  // answer engine can see. Everything below puts words on the internet under the client's name.
  // The archive has to be the last thing that happens before the first of those.
  {
    key: LAUNCH_DAY_ZERO_STEP_KEY,
    phase: PHASE_BUILD,
    label: "Day-0 scan archived, before any change lands",
    detail:
      "Where this business stands in AI answers today, recorded before we touch anything. Every later claim that we moved them is measured against this row, and publishPage() refuses while it is missing.",
    gate: true,
    mode: "manual",
    blockedBy: ["launch_intake"],
  },
  {
    key: "site_pasted",
    phase: PHASE_BUILD,
    label: "Website pasted in and sanitised",
    detail:
      "The HTML built elsewhere, pasted per page. Scripts, event handlers and off-site form actions are stripped on the way in and what was removed is recorded. Marketing pages only: the answer pages keep their own renderer.",
    mode: "manual",
    blockedBy: ["launch_intake"],
    noWebsiteOnly: true,
  },
  {
    key: "site_live",
    phase: PHASE_BUILD,
    label: "The site answers on its own domain",
    detail:
      "A real request to the apex returns 200 over HTTPS and the body carries this client's own name. Observed, not asserted.",
    auto: true,
    mode: "auto",
    blockedBy: ["domain_bought", "site_pasted"],
  },
  {
    key: "concierge_live",
    phase: PHASE_BUILD,
    label: "Concierge named for this business and switched on",
    detail:
      "It calls itself whatever this niche calls it, speaks the confirmed vocabulary, honours the hard lines, and has somewhere to send a booking.",
    mode: "manual",
    blockedBy: ["audience_confirmed", "site_live"],
  },
  {
    key: "keyword_set",
    phase: PHASE_BUILD,
    label: "Keywords built from the documents",
    detail:
      "The ways this offer is actually said, taken from the research rather than from a crawl of a site that does not exist.",
    auto: true,
    mode: "auto_then_manual",
    blockedBy: ["offer_confirmed"],
  },
  {
    key: "pages_drafted",
    phase: PHASE_BUILD,
    label: "Answer pages drafted",
    detail:
      "Drafted against the client library the four documents filled, so every claim has a first-party source behind it.",
    auto: true,
    mode: "auto_then_manual",
    blockedBy: ["keyword_set", "audience_confirmed"],
  },
  {
    key: "pages_published",
    phase: PHASE_BUILD,
    label: "Answer pages published",
    detail:
      "Through publishPage(), so both existing rails hold: the Day-0 wall and the quality gate. They land under /answers on the same domain as the site.",
    mode: "manual",
    blockedBy: [LAUNCH_DAY_ZERO_STEP_KEY, "pages_drafted", "site_live"],
  },

  // ── LIVE: the presence work, which for a new business is CREATION, not cleanup ──
  {
    key: "gbp_access",
    phase: PHASE_LIVE,
    label: "Google Business Profile exists, and we manage it",
    detail:
      "Either it already exists and we are added as a manager, or the owner creates it and completes Google's verification themselves. There is no Business Profile API here, so a screenshot in the step is the evidence. We never ask for a password.",
    mode: "manual",
    blockedBy: ["launch_intake"],
  },
  {
    key: "gbp_buildout",
    phase: PHASE_LIVE,
    label: "Profile built out: categories, services, photos, Q&A",
    detail:
      "For a business with no website this is usually the only place it exists today, which is why it survived the cut.",
    mode: "manual",
    blockedBy: [LAUNCH_DAY_ZERO_STEP_KEY, "gbp_access"],
  },
  {
    key: "reviews_live",
    phase: PHASE_LIVE,
    label: "Referral engine live and cards in their hands",
    detail:
      "The review surface on their domain, the printed cards handed over, and a named person who knows what to do with them.",
    mode: "manual",
    blockedBy: ["site_live"],
  },
  {
    key: "day_30_date",
    phase: PHASE_LIVE,
    label: "Day-30 report date set",
    detail: "Measured against the Day-0 archive, which is why that step is a wall and not a checkbox.",
    mode: "manual",
    blockedBy: [LAUNCH_DAY_ZERO_STEP_KEY],
  },
] as const satisfies readonly LaunchStep[];

export const LAUNCH_STEPS: readonly LaunchStep[] = STEP_LIST;

/**
 * Every key as a union. Consumed by the exhaustive verifier map in src/lib/launch/verify.ts.
 *
 * Anything that STORES a key still stores plain text: `client_launch_steps.step_key` has no
 * enum and must not get one, for the reason the Slack lane learned the hard way — renaming a
 * key orphans every row already carrying it.
 */
export type LaunchStepKey = (typeof STEP_LIST)[number]["key"];

/** Runtime companion to `LaunchStepKey`, for narrowing a key that arrived as text. */
export function isLaunchStepKey(key: string): key is LaunchStepKey {
  return STEP_LIST.some((s) => s.key === key);
}

/** A step by key, or undefined. */
export function launchStepByKey(key: string): LaunchStep | undefined {
  return LAUNCH_STEPS.find((s) => s.key === key);
}

/**
 * The 1-based board position of a step, computed rather than written down.
 *
 * ‼️ ANY COPY THAT NAMES A STEP NUMBER MUST CALL THIS. Inserting a step renumbers every step
 * after it, and the Slack lane has already paid for that lesson once: ten hardcoded numbers in
 * card copy each silently started pointing at the wrong step.
 */
export function launchStepNumber(key: LaunchStepKey): number {
  return STEP_LIST.findIndex((s) => s.key === key) + 1;
}

/**
 * The steps that only mean something for a client who arrived with no website.
 *
 * A client who already has one runs this same lane with these skipped and their existing domain
 * pointed at the hub, exactly as the Slack lane does it today.
 */
export const NO_WEBSITE_ONLY_STEPS: readonly string[] = STEP_LIST.filter(
  (s) => "noWebsiteOnly" in s && s.noWebsiteOnly
).map((s) => s.key);
