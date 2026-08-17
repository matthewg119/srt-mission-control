// Presentation metadata only — stage is owned by Zoho (`deals.zoho_stage`).
// This file exists so UI components can render ordered stage pickers + colors
// without having to round-trip to Zoho's picklist API on every render. Keep it
// in rough sync with Zoho's Lead_Status picklist; treat the list as advisory,
// not authoritative.

export interface StageMeta {
  name: string;
  color: string;
}

export interface StagePipeline {
  name: string;
  stages: readonly StageMeta[];
}

export const NEW_DEALS_PIPELINE: StagePipeline = {
  name: "New Deals",
  stages: [
    { name: "Open - Not Contacted", color: "#1B65A7" },
    { name: "Working - Contacted", color: "#9C27B0" },
    { name: "Working - Application Out", color: "#00BCD4" },
    { name: "Closed - Not Converted", color: "#E74C3C" },
    { name: "Converted", color: "#00C9A7" },
  ],
} as const;

export const ACTIVE_DEALS_PIPELINE: StagePipeline = {
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

export const STAGE_PIPELINES: readonly StagePipeline[] = [
  NEW_DEALS_PIPELINE,
  ACTIVE_DEALS_PIPELINE,
];

/** Terminal Zoho stages — not editable, not eligible for cadence/nurture. */
export const ZOHO_TERMINAL_STAGES: readonly string[] = [
  // Hard closed / dead
  "Closed - Not Converted",
  "Closed",
  "Closed - Converted",
  "Dead Declined",
  "Deal Lost",
  "Funded",
  "Declined",
  "Not Interested",
  "Unresponsive",
  "Lost",
  "Bad Lead",
  "Wrong Number",
  "Duplicate",
  "Junk Lead",
  "Lost Lead",
  // Values confirmed live on Zoho leads 2026-08-16 that nothing here caught.
  // "Take Off List" is an explicit do-not-call and matched none of the
  // substring keywords below; "Converted" is won business, not a lead to work.
  "Take Off List",
  "Converted",
  // Pre-contact stages — no outreach has happened yet; guardian has nothing to act on.
  // These were flooding Zoho webhook quota because the guardian processed them daily.
  "Open - Not Contacted",
  "Not Contacted",
  "Working - No Contact",
  "New",
];

// Matching is CASE-INSENSITIVE, and that is not cosmetic. Zoho's stored values
// do not follow its own picklist casing: "Not interested" is live on 29 of a
// 2,400-lead sample while this list says "Not Interested", so the exact-match
// test returned false and none of the substring keywords below rescued it.
// Those leads were fully workable as far as every caller was concerned.
const TERMINAL_STAGES_LOWER = new Set(
  ZOHO_TERMINAL_STAGES.map((s) => s.toLowerCase())
);

export function isTerminalStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  const lower = String(stage).trim().toLowerCase();
  if (TERMINAL_STAGES_LOWER.has(lower)) return true;
  return ["declined", "dead", "dnq", "lost", "junk", "duplicate", "not interested"].some(
    (k) => lower.includes(k)
  );
}

/**
 * Stages that are pre-contact rather than closed.
 *
 * ZOHO_TERMINAL_STAGES lumps these in with the dead ones because the AI
 * guardian has nothing to act on for a lead nobody has called yet. The
 * worklist has the opposite need: an untouched lead is the single most
 * important thing on the call board. So the two ideas need separate tests —
 * use isDeadStage() for "stop working this", isTerminalStage() for "the
 * guardian should skip this".
 */
export const PRE_CONTACT_STAGES: readonly string[] = [
  "Open - Not Contacted",
  "Not Contacted",
  "Working - No Contact",
  "New",
  "New Lead",
];

/** Genuinely closed out — lost, declined, junk, or funded. Never call these. */
const PRE_CONTACT_LOWER = new Set(PRE_CONTACT_STAGES.map((s) => s.toLowerCase()));

export function isDeadStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  // Case-insensitive for the same reason isTerminalStage is: Zoho stores
  // "New lead" where this list says "New Lead".
  if (PRE_CONTACT_LOWER.has(String(stage).trim().toLowerCase())) return false;
  return isTerminalStage(stage);
}

// ── Follow-up cadence ────────────────────────────────────────────────
// How long a lead in each stage may sit untouched before the worklist
// surfaces it. Lives next to the pipelines it describes, and next to
// isDeadStage(), because src/lib/worklist.ts uses all three together.
//
// firstTouchHours applies when there has been no activity at all;
// repeatDays applies after the first touch.

export interface StageCadence {
  firstTouchHours: number;
  repeatDays: number;
}

export const STAGE_CADENCE: Record<string, StageCadence> = {
  // Speed to lead: a brand-new lead is worth 15 minutes, not a day.
  "Open - Not Contacted": { firstTouchHours: 0.25, repeatDays: 1 },
  "Not Contacted": { firstTouchHours: 0.25, repeatDays: 1 },
  New: { firstTouchHours: 0.25, repeatDays: 1 },
  "New Lead": { firstTouchHours: 0.25, repeatDays: 1 },

  "Working - Contacted": { firstTouchHours: 24, repeatDays: 3 },
  "Working - Application Out": { firstTouchHours: 24, repeatDays: 2 },
  "Application Complete": { firstTouchHours: 12, repeatDays: 2 },
  "Hot Lead": { firstTouchHours: 1, repeatDays: 1 },

  Underwriting: { firstTouchHours: 24, repeatDays: 2 },
  Shopping: { firstTouchHours: 12, repeatDays: 1 },
  "Pre-Approved": { firstTouchHours: 4, repeatDays: 1 },
  Approved: { firstTouchHours: 2, repeatDays: 1 },
  "VC / DL": { firstTouchHours: 4, repeatDays: 1 },
  "Contracts Out": { firstTouchHours: 4, repeatDays: 1 },
  "Contracts In": { firstTouchHours: 4, repeatDays: 1 },
  "Pending Stips": { firstTouchHours: 4, repeatDays: 1 },
  "Funding Call": { firstTouchHours: 2, repeatDays: 1 },
  "In Funding": { firstTouchHours: 12, repeatDays: 1 },

  // Revival cadence, not a working cadence.
  "Deal Lost": { firstTouchHours: 168, repeatDays: 14 },

  // ── Values actually in use on Zoho leads (sampled 2026-08-16) ────────
  // Everything above was written against the DEAL pipelines. The Zoho LEAD
  // picklist is a different vocabulary, and none of these appeared here, so
  // every imported lead fell through to DEFAULT_CADENCE and the whole table
  // was decorative for 8,307 of 8,541 records.
  "Attempted to Contact": { firstTouchHours: 4, repeatDays: 2 },
  "Intro Text Guide": { firstTouchHours: 4, repeatDays: 2 },
  Contacted: { firstTouchHours: 24, repeatDays: 3 },
  Working: { firstTouchHours: 24, repeatDays: 3 },
  "Pre-Qualified": { firstTouchHours: 4, repeatDays: 1 },
  "Contact in Future": { firstTouchHours: 168, repeatDays: 30 },
  "Statements Received": { firstTouchHours: 4, repeatDays: 1 },

  // Portal funnel states. These live in the same column (contacts sets them
  // directly, and 32 of them have reached Zoho's Lead_Status too), so the
  // cadence table has to speak this vocabulary as well.
  "Funnel Lead Captured": { firstTouchHours: 0.25, repeatDays: 1 },
  "Email Captured": { firstTouchHours: 0.25, repeatDays: 1 },
  "Name Captured": { firstTouchHours: 0.25, repeatDays: 1 },
  "No Business Checking": { firstTouchHours: 168, repeatDays: 30 },
};

export const DEFAULT_CADENCE: StageCadence = { firstTouchHours: 24, repeatDays: 5 };

// Lookup is case-insensitive: Zoho stores "New lead" where the table above
// says "New Lead", which silently cost that stage its 15-minute first touch.
const CADENCE_LOWER = new Map(
  Object.entries(STAGE_CADENCE).map(([k, v]) => [k.toLowerCase(), v])
);

export function cadenceFor(stage: string | null | undefined): StageCadence {
  if (!stage) return STAGE_CADENCE["Open - Not Contacted"];
  return CADENCE_LOWER.get(String(stage).trim().toLowerCase()) ?? DEFAULT_CADENCE;
}

/** Stages where money is on the table and a missed day actually costs a deal. */
export const HOT_STAGES: readonly string[] = [
  "Approved",
  "Pre-Approved",
  "Contracts Out",
  "Contracts In",
  "Pending Stips",
  "Funding Call",
  "VC / DL",
];
