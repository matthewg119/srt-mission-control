// Whose hat a piece of work is under, and roughly how long it takes.
//
// Matthew, 2026-09-23: "label the tasks for different roles ... so when I need to do an onboarding
// you say today we have to do X onboarding, write x amount of pages for all of these clients,
// follow up here, send these emails to these people we haven't contacted."
//
// ‼️ THERE IS NO ROLE CONCEPT ANYWHERE ELSE IN THIS SYSTEM, AND THIS FILE IS NOT INVENTING ONE IN
// THE DATABASE. `users.role` is an auth flag with two values; `tasks.assignee` is free text
// defaulting to the literal string "Matthew"; `tasks.department` is written by an AI pulse and never
// read back; no unit of work joins to a user. A column would be a second answer to "whose job is
// this" that nothing keeps in step with the code. A role is a property of the KIND of work, which is
// something the code already knows, so it is derived here and stored nowhere.
//
// ‼️ Record<StepKey, DayRole>, SO A 42ND STEP DOES NOT COMPILE UNTIL SOMEBODY SAYS WHOSE JOB IT IS.
// The same mechanism STEP_VERIFIERS and STEP_ACTIONS rely on, and do-this-now.ts writes down why: a
// default arm would have let forty steps go unwritten and looked fine.
//
// ‼️ NOT DERIVED FROM `phase`. Phase is close, and wrong ten times: six PHASE_BEFORE steps build
// infrastructure and four write copy. A derived role with ten exceptions is a map with extra steps.

import type { StepKey } from "@/config/delivery-steps";
import type { ActionVerb } from "@/lib/clients/do-this-now";

export type DayRole = "onboarder" | "writer" | "delivery" | "outreach";

export const DAY_ROLES: readonly DayRole[] = ["onboarder", "writer", "delivery", "outreach"];

export const ROLE_LABEL: Record<DayRole, string> = {
  onboarder: "Onboarding",
  writer: "Writing",
  delivery: "Delivery",
  outreach: "Outreach",
};

/** The order the day is read in: what unblocks other people first, what can wait last. */
export const ROLE_ORDER: readonly DayRole[] = ["onboarder", "writer", "delivery", "outreach"];

/**
 * ‼️ "outreach" IS PROSPECT-FACING ONLY. Talking to a CLIENT (weekly_report, referral_engine_handed)
 * is delivery. If client comms ever become their own hat, that is a fifth role and a diff, not a
 * quiet reinterpretation of this one.
 *
 * ‼️ ZERO STEPS ARE OUTREACH, AND THAT IS THE HONEST ANSWER rather than a gap. No delivery step is
 * prospect-facing. The Outreach lane is fed entirely by lead_tasks and the follow-up operator.
 */
export const STEP_ROLE: Record<StepKey, DayRole> = {
  // ── Before the call: the onboarding decisions ───────────────────────────────
  intake_received: "onboarder",
  baseline_scan: "onboarder",
  site_dns_intel: "onboarder",
  nap_sweep: "onboarder",
  presence_sweep_manual: "onboarder",
  competitor_shortlist: "onboarder",
  avatar_confirmed: "onboarder",
  review_audit: "onboarder",
  offer_proposed: "onboarder",
  // The prep call. A client call, not a prospect call.
  offer_locked: "onboarder",
  custom_question_set: "onboarder",
  call_sheet: "onboarder",

  // ── Before the call: the copy pipeline. These four ARE the writing. ─────────
  avatar_harvest: "writer",
  keyword_set: "writer",
  page_candidates: "writer",
  pre_call_pages: "writer",

  // ── Before the call: building things rather than deciding them ─────────────
  citation_cleanup_list: "delivery",
  hub_preview: "delivery",
  referral_engine_preview: "delivery",
  concierge_preview: "delivery",
  site_replica: "delivery",
  review_card_pdf: "delivery",

  // ── During the call ────────────────────────────────────────────────────────
  call_booked: "onboarder",
  call_held: "onboarder",
  access_granted: "onboarder",
  // Chasing the client for DNS records is onboarding, not outreach: they are already a client.
  dns_records: "onboarder",
  agreement_signed: "onboarder",

  // ── After the call ─────────────────────────────────────────────────────────
  first_page: "writer",
  day_zero_archive: "delivery",
  gbp_buildout: "delivery",
  citation_cleanup: "delivery",
  subdomain_live: "delivery",
  cards_printed: "delivery",
  review_request_configured: "delivery",
  referral_engine_handed: "delivery",
  concierge_live: "delivery",
  tracking_installed: "delivery",
  self_report_field: "delivery",
  time_log_entries: "delivery",
  weekly_report: "delivery",
  day_30_date: "delivery",
};

export function roleForStep(key: StepKey): DayRole {
  return STEP_ROLE[key];
}

/**
 * Is this step waiting on a PERSON right now?
 *
 * ‼️ THE SAME TWO STATES stepDigest CHOSE, and that is deliberate rather than convenient. Today and
 * the 09:00 Slack digest must not disagree about what counts as outstanding, or one of them becomes
 * the thing people stop believing. `ready` and `running` are the machine's work; `pending` and
 * `blocked` are the future.
 */
export function isOwnerWork(status: string | null | undefined): boolean {
  return status === "awaiting_me" || status === "error";
}

/**
 * Roughly how long, in minutes.
 *
 * ‼️ AN ASSUMPTION, NOT A MEASUREMENT, AND EVERY SURFACE MUST RENDER IT AS "est." time_log is the
 * only real size signal in this system: it is retrospective, it carries no step_key and no page_id,
 * and the verification block in docs/2026-09-19-referral-engine-rename.sql records ZERO rows in
 * production. Learning from it would produce a confident number with nothing behind it, which is
 * exactly what the photograph-versus-measurement doctrine exists to prevent.
 *
 * ‼️ IT CAPS THE DAY. IT DOES NOT RANK IT. Nobody sorts a day by duration descending. What makes a
 * task big here is how much it unblocks, which DELIVERY_STEPS[].blockedBy already knows.
 */
export const EFFORT_BY_VERB: Record<ActionVerb, number> = {
  run: 5,
  confirm: 10,
  screenshot: 10,
  send: 10,
  decide: 15,
  pick: 20,
  paste: 25,
  // Never surfaces: isOwnerWork() has already excluded the steps that only wait.
  wait: 0,
};

export const EFFORT_BY_SOURCE = {
  page_write: 45,
  followup: 10,
  ops_task: 20,
} as const;
