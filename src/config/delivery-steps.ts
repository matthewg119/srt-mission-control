// The 33 delivery steps. One constant, one file — Runner v3 section 1.
//
// ‼️ THIS LIVES IN config/ RATHER THAN NEXT TO THE CODE THAT RENDERS IT, AND THE REASON IS A
// BUILD FAILURE, NOT TIDINESS.
//
// The dashboard's checklist form is a "use client" component and it needs these labels. While
// the array lived in delivery-checklist.ts, importing it dragged that whole module — and
// everything it reaches — into the client bundle. That was survivable until step-engine gained
// an auto-step runner, which reaches site-intel.ts, which imports node:dns/promises, which
// webpack cannot bundle for the browser at all:
//
//   UnhandledSchemeError: Reading from "node:dns/promises" is not handled by plugins
//   ./src/lib/clients/site-intel.ts -> registry.ts -> step-engine.ts -> delivery-checklist.ts
//   -> delivery-checklist-form.tsx
//
// Pure data with no server imports cannot cause that. delivery-checklist.ts re-exports both
// names, so every existing import keeps working.

/**
 * The Day 0 wall's step key.
 *
 * ‼️ DEFINED HERE, IMPORTED BY day-zero.ts — NOT THE OTHER WAY ROUND, AND NOT BY ACCIDENT.
 *
 * It used to live in day-zero.ts and be imported from there. That made this pure-data config
 * module depend on a module that imports supabaseAdmin AND @/lib/slack-bot, so the dashboard's
 * client bundle shipped the Slack bot to the browser purely to learn one string. It did not
 * crash (@/lib/db is guarded on `typeof window`), it was just dead weight on every page load.
 *
 * The direction has to be config -> day-zero. The reverse is what CLAUDE.md forbids: day-zero
 * must never import the checklist, because delivery-checklist calls stampDay0() and the cycle
 * leaves one module half-initialised.
 */
export const DAY_ZERO_STEP_KEY = "day_zero_archive";

export interface DeliveryStep {
  key: string;
  label: string;
  phase: string;
  /** The system completes this one itself. */
  auto?: boolean;
  /** Nothing after this may legitimately happen before it. */
  gate?: boolean;
  /**
   * Runner v3 §2. 'auto' runs itself when ready; 'manual' and 'auto_then_manual' post to
   * Slack and wait for a button. Distinct from `auto`, which only says the SYSTEM ticks it:
   * a step can be auto_then_manual (the system does the work, a person confirms it landed).
   */
  mode?: "auto" | "manual" | "auto_then_manual";
  /**
   * Keys that must be complete before this one is honestly startable.
   *
   * ADVISORY, not enforcement, and that is deliberate. This list FLAGS out-of-order work in
   * the Slack render — the same doctrine as the Measure gate. The single exception is
   * day_zero_archive, which really does refuse, in code, in day-zero.ts. Everything else is
   * a judgement somebody made about their own week.
   */
  blockedBy?: readonly string[];
}

/**
 * ‼️ `as const satisfies` RATHER THAN A `DeliveryStep[]` ANNOTATION, AND THE REASON IS
 * step-verify.ts.
 *
 * The annotation widened every `key` to `string`, so `STEP_VERIFIERS` could only be typed
 * `Record<string, Verifier>` — which accepts a map that is missing a step, and accepts a
 * typo'd key as if it were a new one. A step with no verifier can never be ticked, so the
 * failure would be a delivery step that silently refuses forever, discovered on a live client.
 *
 * `as const` makes `StepKey` a union of the 33 literals and `Record<StepKey, Verifier>` a
 * compile-time proof of coverage: adding a 34th step here breaks the build until somebody
 * says what evidence confirms it. That is the whole point.
 *
 * `satisfies` keeps the shape checked. A plain `as const` would not have caught a typo'd
 * `phase` or a `mode` that is not one of the three.
 *
 * ‼️ IT IS DECLARED PRIVATELY AND RE-EXPORTED WIDE, and that is not ceremony. `as const`
 * narrows every element to its OWN literal shape, so a step with no `blockedBy` has no
 * `blockedBy` property at all and `step.blockedBy` stops compiling across fifteen read sites
 * that are perfectly correct. The literal is only needed for the key union; everything that
 * READS a step wants the wide `DeliveryStep` shape with its optional fields intact.
 */
/**
 * ‼️ THREE PHASES, NOT FIVE, AND THEY ARE BEFORE / DURING / AFTER THE CALL (2026-08-25).
 *
 * `Measure` + `Prepare` became **Before the call**, `The call` became **During the call**, and
 * `Day 0` + `Build` became **After the call**. Matthew's call. The five old names described what
 * the WORK was; these describe WHEN it happens relative to the only fixed point in the job, which
 * is the thing he actually needs to know while looking at a board.
 *
 * ‼️ ONLY THE `phase` STRING CHANGED. Step order, numbering, `blockedBy`, `gate` and every key are
 * untouched, because all four are load-bearing elsewhere and none of them meant "phase".
 *
 * Two things that look like they should have broken and did not, both checked:
 *  - **Nothing keys on the literal `"Day 0"`.** The wall keys on `step.gate` and
 *    `DAY_ZERO_STEP_KEY`, and headerText's Day-0 warning uses `DELIVERY_STEPS.find(s => s.gate)`.
 *    The `call`/`build` strings in the client board's `page.tsx` belong to the EIGHT pilot stages,
 *    a different list at a different altitude.
 *  - **Phases must stay CONTIGUOUS in this array.** `delivery-checklist-form.tsx` groups with a
 *    running-string sentinel (`step.phase !== phase`), not a groupBy, so a phase that reappeared
 *    after an interruption would render its header twice. The three groups below are contiguous
 *    and a fourth added out of order is a rendering bug, not a data one.
 */
export const PHASE_BEFORE = "Before the call";
export const PHASE_DURING = "During the call";
export const PHASE_AFTER = "After the call";

const STEP_LIST = [
  // ── BEFORE THE CALL: measure ──────────────────────────────────────────────
  { key: "intake_received", phase: PHASE_BEFORE, label: "Intake received, canonical NAP locked, audit attached if one exists", auto: true, mode: "auto" },
  { key: "baseline_scan", phase: PHASE_BEFORE, label: "Photograph I: universal_v1 across the keyed engines", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  { key: "site_dns_intel", phase: PHASE_BEFORE, label: "Site, hosting and DNS intelligence", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  // Key kept from the 14-step list, where it was "NAP sweep across the directory list".
  // Renaming the KEY would orphan every row already carrying it.
  { key: "nap_sweep", phase: PHASE_BEFORE, label: "Presence sweep: automated tier", auto: true, mode: "auto", blockedBy: ["intake_received"] },
  { key: "presence_sweep_manual", phase: PHASE_BEFORE, label: "Presence sweep: manual tier, screenshots in the thread", mode: "manual", blockedBy: ["nap_sweep"] },
  { key: "presence_pdf", phase: PHASE_BEFORE, label: "Presence and consistency PDF report", auto: true, mode: "auto", blockedBy: ["presence_sweep_manual"] },
  { key: "competitor_shortlist", phase: PHASE_BEFORE, label: "Competitor shortlist of 10, top 3 pre-picked, I confirm", mode: "manual", blockedBy: ["baseline_scan"] },
  // ‼️ MOVED HERE FROM POSITION 11 ON 2026-08-25, AND THE MOVE IS THE WHOLE POINT.
  //
  // Matthew: "i see avatar is proposed in step 11 but this should be before step 9 for the actual
  // deep research for the avatar that we actually want." The avatar decides what the phrase
  // harvest RESEARCHES and what the deep-research brief is written about, so confirming it after
  // that step ran meant the research was always about a customer nobody had chosen yet.
  //
  // ‼️ THE KEY DID NOT CHANGE AND MUST NOT. Renaming it would orphan every client_delivery_steps
  // row already carrying it, including the one on the live client where this came out `skipped`.
  // The ARRAY owns the numbering, so moving the element renumbers the board and nothing else.
  //
  // blockedBy is baseline_scan rather than avatar_harvest: the candidates come from
  // niche_briefs.avatars, which is keyed on the vertical the baseline scan adopts, so step 2 is
  // genuinely the only thing it waits on.
  { key: "avatar_confirmed", phase: PHASE_BEFORE, label: "Avatar confirmed: which customer this whole build is aimed at", mode: "manual", blockedBy: ["baseline_scan"] },
  // ‼️ auto_then_manual, NOT auto, and presence-platforms.ts is the reason.
  // `api: false` on all nineteen platforms: Google Places, Bing, Foursquare and Yelp Fusion were
  // each checked and none is keyed here. There is no automated path to a review count, so the
  // runner seeds the rows and composes the searches and a PERSON reads the listings. Ticking
  // this as plain `auto` would mark a measurement complete that measured nothing, and findings
  // section 3 goes to the client.
  { key: "review_audit", phase: PHASE_BEFORE, label: "Review audit: them plus the three I picked", auto: true, mode: "auto_then_manual", blockedBy: ["competitor_shortlist"] },
  // Two halves, and only one of them runs itself. The cited-source harvest is automatic:
  // audit_runs.citations already holds every URL every engine cited, so there is a real corpus
  // and no key needed. The deep-research brief is generated automatically too, but somebody
  // then has to RUN it and paste the result back, so the step waits on a person. Reddit is not
  // in either half: no credentials, and A2 section 9 records that commercial Data API use
  // needs Reddit's approval. See src/lib/clients/artifacts/deep-research-run.ts.
  //
  // ‼️ THE LABEL WAS RENAMED BECAUSE IT READ AS A DUPLICATE OF THE AUDIT, AND THE KEY WAS NOT.
  // Matthew asked whether this step repeats the AI visibility audit and burns tokens. It makes
  // ZERO model calls (harvest.ts imports supabaseAdmin and nothing else) and it CONSUMES the
  // audit rather than repeating it: it reads audit_runs.citations and fetches the pages the
  // engines actually cited.
  //
  // ‼️ THE AVATAR IS NOW CONFIRMED BEFORE THIS RUNS, WHICH REVERSED WHAT THIS COMMENT SAID.
  // It used to read "the avatars are not here either, and question_bank.avatar stays NULL until
  // step 11 confirms one". True while the confirmation came two steps later; false now. The
  // avatars still live in niche_briefs.avatars per vertical, but a client has picked one by the
  // time this runs, so every phrase this step writes is TAGGED with that avatar slug.
  //
  // Renaming the KEY would orphan every row already carrying it. Labels are free; keys are not.
  { key: "avatar_harvest", phase: PHASE_BEFORE, label: "Buyer-phrase harvest for the confirmed avatar, plus the deep-research brief to run", auto: true, mode: "auto_then_manual", blockedBy: ["baseline_scan", "avatar_confirmed"] },
  { key: "findings_doc", phase: PHASE_BEFORE, label: "Findings written up and attached", auto: true, mode: "auto", blockedBy: ["presence_pdf", "review_audit"] },

  // ── BEFORE THE CALL: prepare. None of it touches their properties ─────────
  { key: "custom_question_set", phase: PHASE_BEFORE, label: "Custom question set drafted for approval", auto: true, mode: "auto", blockedBy: ["avatar_confirmed"] },
  // ‼️ The label no longer promises a hundred. `prompt_library` does not exist -- the corpus is
  // question_bank plus this client's own twenty -- so 100 is the CEILING the artifact prints
  // against, not a number it can deliver. The KEY is unchanged, because renaming a key orphans
  // every row already carrying it; labels are free.
  { key: "page_candidates", phase: PHASE_BEFORE, label: "Page candidates scored and ranked for the call", auto: true, mode: "auto", blockedBy: ["avatar_confirmed"] },
  { key: "citation_cleanup_list", phase: PHASE_BEFORE, label: "Citation cleanup list built and ranked", auto: true, mode: "auto", blockedBy: ["presence_pdf"] },
  // `auto: true` as of the hub runner: the system really does attach both hostnames to Vercel
  // and seed the three DNS rows. The half that stays manual is the THEME, which is why this is
  // auto_then_manual and why [Done] refuses until somebody has confirmed it.
  { key: "hub_preview", phase: PHASE_BEFORE, label: "Hub built, themed, preview live, theme confirmed by me", auto: true, mode: "auto_then_manual", blockedBy: ["intake_received"] },
  { key: "review_tool_preview", phase: PHASE_BEFORE, label: "Review tool preview live, themed to match", auto: true, mode: "auto", blockedBy: ["hub_preview"] },
  { key: "review_card_pdf", phase: PHASE_BEFORE, label: "Review card PDF generated", auto: true, mode: "auto", blockedBy: ["hub_preview"] },
  { key: "call_sheet", phase: PHASE_BEFORE, label: "Call sheet PDF generated and attached", auto: true, mode: "auto", blockedBy: ["findings_doc", "custom_question_set", "page_candidates", "hub_preview"] },

  // ── DURING THE CALL ───────────────────────────────────────────────────────
  { key: "call_booked", phase: PHASE_DURING, label: "Call booked", mode: "manual" },
  { key: "call_held", phase: PHASE_DURING, label: "Call held: NAP aloud, question set approved, consent confirmed, preview walked, pages picked", mode: "manual", blockedBy: ["call_sheet"] },
  { key: "access_granted", phase: PHASE_DURING, label: "Access granted: GBP manager, Search Console, Analytics", mode: "manual", blockedBy: ["call_held"] },
  // THREE records, and the phrasing is deliberate. "CNAME and TXT" read as two, which is
  // where the two-versus-three drift came from: there are two CNAMEs, not one.
  { key: "dns_records", phase: PHASE_DURING, label: "DNS: three records added by the client, two CNAMEs and one TXT", mode: "manual", blockedBy: ["call_held"] },

  // ── AFTER THE CALL: day 0 ─────────────────────────────────────────────────
  // ‼️ THE ONE STEP THAT BLOCKS RATHER THAN FLAGS. See src/lib/clients/day-zero.ts and
  // docs/2026-08-18-day-zero-wall.sql. Completing it stamps clients.day_0_archived_at and
  // opens the publish path; unticking it clears the stamp again.
  // ‼️ `mode: "manual"`, AND IT USED TO BE `"auto"` WITH NOTHING BEHIND IT.
  // postReadySteps skips every `mode === "auto"` step on the first line of its loop, and
  // runReadyAutoSteps only runs a step with an AUTO_RUNNERS entry. This has neither, so the
  // ONE step in the whole checklist that hard-blocks publishing never posted a card, never
  // ran, and was tickable only from a checkbox on the dashboard that nobody is looking at
  // during a call. It is a thing a person asserts, so it is manual and it says so.
  { key: DAY_ZERO_STEP_KEY, phase: PHASE_AFTER, label: "Day-0 scan archived, before any change lands", gate: true, mode: "manual", blockedBy: ["call_held"] },

  // ── AFTER THE CALL: build. Unblocked by Day 0, not before ─────────────────
  { key: "gbp_buildout", phase: PHASE_AFTER, label: "Google Business Profile buildout: categories, services, photos, Q&A seeded", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY, "access_granted"] },
  { key: "citation_cleanup", phase: PHASE_AFTER, label: "Citation cleanup executed from the list", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY, "citation_cleanup_list"] },
  { key: "subdomain_live", phase: PHASE_AFTER, label: "Subdomain live and verified in Search Console", auto: true, mode: "auto_then_manual", blockedBy: ["dns_records"] },
  // ‼️ `mode: "manual"`, AND IT WAS `"auto_then_manual"` WITH NOTHING BEHIND IT (fixed 2026-08-25).
  // Exactly the shape day_zero_archive was in, one line down from where that was fixed.
  //
  // The only writer of `status: "ready"` is runReadyAutoSteps, and it will not claim a step with
  // no AUTO_RUNNERS entry. postReadySteps then skips every auto_then_manual row that is not
  // `ready`. This step has no runner and never could have one — publishing happens on the board's
  // Hub panel, behind the Day 0 wall — so the card at step-engine.ts's `first_page` case was dead
  // code on the normal path. It only ever appeared in Slack because _debug-post-all-steps.ts
  // calls postStep directly, which is how it looked like it worked.
  //
  // It also slipped past unreachableAutoSteps(), which filtered on `s.auto === true` while this
  // carried `mode` and no `auto`. That predicate is widened in artifacts/registry.ts so the next
  // one is caught at build rather than on a live client.
  { key: "first_page", phase: PHASE_AFTER, label: "First pages published, measured track first", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY, "subdomain_live"] },
  { key: "cards_printed", phase: PHASE_AFTER, label: "Cards printed and handed to the clinic", mode: "manual", blockedBy: ["review_card_pdf"] },
  { key: "review_request_configured", phase: PHASE_AFTER, label: "Automated request configured in their booking system, or card_only recorded", mode: "manual", blockedBy: ["call_held"] },
  { key: "review_tool_handed", phase: PHASE_AFTER, label: "Review tool handed to the named person", mode: "manual", blockedBy: ["subdomain_live"] },
  { key: "time_log_entries", phase: PHASE_AFTER, label: "Time log has entries from day 0", auto: true, mode: "auto", blockedBy: [DAY_ZERO_STEP_KEY] },
  { key: "weekly_report", phase: PHASE_AFTER, label: "Weekly report firing", auto: true, mode: "auto", blockedBy: ["first_page"] },
  { key: "day_30_date", phase: PHASE_AFTER, label: "Day-30 report date set", mode: "manual", blockedBy: [DAY_ZERO_STEP_KEY] },
] as const satisfies readonly DeliveryStep[];

export const DELIVERY_STEPS: readonly DeliveryStep[] = STEP_LIST;

/**
 * The 33 keys as a union. Consumed by step-verify.ts's exhaustive verifier map.
 *
 * Anything that stores a step key still stores plain text — `client_delivery_steps.step_key`
 * has no enum and must not get one, because renaming a key orphans every row already carrying
 * it and the config comments above say so twice. This is a compile-time shape only.
 */
export type StepKey = (typeof STEP_LIST)[number]["key"];

/** Runtime companion to `StepKey`, for narrowing a key that arrived as text. */
export function isStepKey(key: string): key is StepKey {
  return STEP_LIST.some((s) => s.key === key);
}
