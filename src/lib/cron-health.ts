// What "is that cron actually working?" means, in one place.
//
// Vercel reports a cron as successful whenever the route returns 2xx, so a route
// that catches its own error, logs it and returns 200 looks perfectly healthy from
// the dashboard. /api/cron/crm-exclusion-sync did exactly that every morning for
// weeks ("META_AUDIENCE_ID not set") and nothing ever said so out loud.
//
// So health is checked two ways:
//   1. SILENCE  — a cron with a known success event that has not written one inside
//                 its window either never ran or died before it could log.
//   2. ERRORS   — any system_logs row whose event_type ends in _error/_failed since
//                 the last sweep. Deliberately generic: it covers routes not listed
//                 below and ones that do not exist yet.
//
// Only crons that log a success event UNCONDITIONALLY belong in WATCHED_CRONS.
// /api/cron/outreach-sender is the cautionary case — it writes outreach_sender_tick
// only when it actually sent something, so an idle queue is indistinguishable from
// a dead cron and listing it here would alert every hour forever.

export interface CronWatch {
  /** Route path as it appears in vercel.json. */
  path: string;
  /** Label shown on the guardian card and stored as code_guardian_fixes.workflow_name. */
  name: string;
  /** system_logs.event_type written on a healthy run. */
  successEvent: string;
  /** Alert when no successEvent has landed within this many hours. */
  maxGapHours: number;
}

// Daily crons get 26h rather than 24h so ordinary scheduling jitter, a slow run or
// a DST shift does not produce a false alarm.
export const WATCHED_CRONS: CronWatch[] = [
  { path: "/api/cron/crm-exclusion-sync", name: "crm-exclusion-sync", successEvent: "cron_crm_exclusion_sync", maxGapHours: 26 },
  { path: "/api/cron/daily-recap", name: "daily-recap", successEvent: "daily_recap", maxGapHours: 26 },
  { path: "/api/cron/medspa-credit-reminder", name: "medspa-credit-reminder", successEvent: "cron_medspa_credit_reminder", maxGapHours: 26 },
  { path: "/api/cron/sms-followups", name: "sms-followups", successEvent: "cron_sms_followups", maxGapHours: 26 },
];

/** system_logs event written by each sweep; doubles as the "last checked" marker. */
export const CRON_HEALTH_EVENT = "cron_health_sweep";

/** Error-ish event types the generic sweep treats as a failure signal. */
export const ERROR_EVENT_SUFFIXES = ["_error", "_failed"] as const;

export function isErrorEvent(eventType: string): boolean {
  return ERROR_EVENT_SUFFIXES.some((s) => eventType.endsWith(s));
}
