// Two-pipeline structure for SRT Mission Control CRM
// New Deals: Lead intake (form fills → qualification → conversion)
// Active Deals: Post-conversion pipeline (contracts → stips → funding)

export const NEW_DEALS_PIPELINE = {
  name: "New Deals",
  stages: [
    { name: "Open - Not Contacted", color: "#1B65A7" },
    { name: "Working - Contacted", color: "#9C27B0" },
    { name: "Working - Application Out", color: "#00BCD4" },
    { name: "Closed - Not Converted", color: "#E74C3C" },
    { name: "Converted", color: "#00C9A7" },
  ],
} as const;

export const ACTIVE_DEALS_PIPELINE = {
  name: "Active Deals",
  stages: [
    { name: "Contract In", color: "#00BCD4" },
    { name: "Pending Stips", color: "#f59e0b" },
    { name: "Funding Call", color: "#9C27B0" },
    { name: "In Funding", color: "#1B65A7" },
    { name: "Funded", color: "#4CAF50" },
    { name: "Deal Lost", color: "#E74C3C" },
  ],
} as const;

export const PIPELINES = [NEW_DEALS_PIPELINE, ACTIVE_DEALS_PIPELINE] as const;

// All stage names across both pipelines
export type NewDealStage = (typeof NEW_DEALS_PIPELINE.stages)[number]["name"];
export type ActiveDealStage = (typeof ACTIVE_DEALS_PIPELINE.stages)[number]["name"];
export type PipelineStage = NewDealStage | ActiveDealStage;

// For backwards compat — flat list of all stages
export const PIPELINE_STAGES = [
  ...NEW_DEALS_PIPELINE.stages,
  ...ACTIVE_DEALS_PIPELINE.stages,
];

// Terminal stages (deal is done)
export const TERMINAL_STAGES: PipelineStage[] = [
  "Closed - Not Converted",  // New Deals terminal
  "Funded", "Deal Lost",     // Active Deals terminals
];

// Stages that mean "active" (not terminal)
export const ACTIVE_NEW_DEAL_STAGES: NewDealStage[] = [
  "Open - Not Contacted", "Working - Contacted", "Working - Application Out", "Converted",
];

export const ACTIVE_DEAL_STAGES: ActiveDealStage[] = [
  "Contract In", "Pending Stips", "Funding Call", "In Funding",
];
