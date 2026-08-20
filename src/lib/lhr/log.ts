// The `system_logs.event_type` /LHR opt-ins are recorded under.
//
// ‼️ THIS CANNOT MOVE INTO THE ROUTE FILE. Next validates route module exports against
// a fixed list, so a `route.ts` exporting a plain constant fails `next build`. Same
// reason ONBOARDING_FREE_EVENT lives in src/lib/onboarding-free/log.ts.
//
// That row is two things at once: the per-IP rate-limit ledger the submit route counts,
// and the durable copy of the submission. There is no /LHR table and there must not be
// one, the same way /onboardingfree needed no migration.

export const LHR_OPTIN_EVENT = "lhr_optin";

/** `contacts.source` for a lead that came through this funnel. */
export const LHR_SOURCE = "lhr_vsl";
