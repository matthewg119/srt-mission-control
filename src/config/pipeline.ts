// @deprecated — Mission Control's pipeline is no longer the source of truth.
// Zoho CRM owns deal stage. New code must key off `deals.zoho_stage` (mirrored
// by the Zoho webhook + reconciliation cron). The legacy constants below exist
// only because the Kanban UI at /dashboard/pipeline has not yet been rewritten
// as a read-only Zoho mirror. When that UI is rewritten, delete this file.
//
// DO NOT import `LEGACY_*` in new code. The intended shape for all new code
// is `ZohoStage` (a free-form string, validated at the handler layer).

/** Zoho Lead Stage — free-form string as returned by Zoho. Validate at the
 *  handler layer (stage-handler.ts), never by TypeScript enum. */
export type ZohoStage = string;

// ─── LEGACY — do not use in new code ─────────────────────────────────────────

/** @deprecated Use Zoho stage. Retained for the /dashboard/pipeline UI only. */
export const LEGACY_NEW_DEALS_PIPELINE = {
  name: "New Deals",
  stages: [
    { name: "Open - Not Contacted", color: "#1B65A7" },
    { name: "Working - Contacted", color: "#9C27B0" },
    { name: "Working - Application Out", color: "#00BCD4" },
    { name: "Closed - Not Converted", color: "#E74C3C" },
    { name: "Converted", color: "#00C9A7" },
  ],
} as const;

/** @deprecated Use Zoho stage. Retained for the /dashboard/pipeline UI only. */
export const LEGACY_ACTIVE_DEALS_PIPELINE = {
  name: "Active Deals",
  stages: [
    { name: "Underwriting", color: "#1B65A7" },
    { name: "Shopping", color: "#9C27B0" },
    { name: "Pre-Approved", color: "#00BCD4" },
    { name: "Approved", color: "#4CAF50" },
    { name: "VC / DL", color: "#f59e0b" },
    { name: "Contracts Out", color: "#00C9A7" },
    { name: "Contracts In", color: "#009688" },
    { name: "Pending Stips", color: "#F5A623" },
    { name: "Funding Call", color: "#9C27B0" },
    { name: "In Funding", color: "#1B65A7" },
    { name: "Closed", color: "#4CAF50" },
    { name: "Dead Declined", color: "#E74C3C" },
    { name: "Deal Lost", color: "#E74C3C" },
  ],
} as const;

/** @deprecated */
export const LEGACY_PIPELINES = [
  LEGACY_NEW_DEALS_PIPELINE,
  LEGACY_ACTIVE_DEALS_PIPELINE,
] as const;

/** @deprecated Kept so `guardian.ts` and ad-hoc "is this terminal?" checks
 *  keep working until the Zoho-stage handler owns that logic. */
export const LEGACY_TERMINAL_STAGES: string[] = [
  "Closed - Not Converted",
  "Closed",
  "Dead Declined",
  "Deal Lost",
];
