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
  // Pre-contact stages — no outreach has happened yet; guardian has nothing to act on.
  // These were flooding Zoho webhook quota because the guardian processed them daily.
  "Open - Not Contacted",
  "Not Contacted",
  "Working - No Contact",
  "New",
];

export function isTerminalStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  if (ZOHO_TERMINAL_STAGES.includes(stage)) return true;
  const lower = String(stage).toLowerCase();
  return ["declined", "dead", "dnq", "lost", "junk", "duplicate"].some((k) => lower.includes(k));
}
