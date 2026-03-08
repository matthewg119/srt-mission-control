// Two-pipeline structure for SRT Mission Control CRM
// New Deals: Initial lead intake (form fills → qualification)
// Active Deals: Post-approval pipeline (underwriting → funding)

export const NEW_DEALS_PIPELINE = {
  name: "New Deals",
  stages: [
    { name: "New Lead", color: "#1B65A7" },
    { name: "No Contact", color: "#9C27B0" },
    { name: "Interested", color: "#00BCD4" },
    { name: "Not Interested", color: "#E74C3C" },
    { name: "Converted", color: "#00C9A7" },
    { name: "DNQ", color: "#F5A623" },
    { name: "Take Off List", color: "#757575" },
  ],
} as const;

export const ACTIVE_DEALS_PIPELINE = {
  name: "Active Deals",
  stages: [
    { name: "Pre-Approval", color: "#00BCD4" },
    { name: "Underwriting", color: "#1B65A7" },
    { name: "Submitted", color: "#9C27B0" },
    { name: "Approved", color: "#4CAF50" },
    { name: "Contracts Out", color: "#00C9A7" },
    { name: "Contracts In", color: "#009688" },
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
  "Not Interested", "DNQ", "Take Off List", // New Deals terminals
  "Funded", "Deal Lost",                     // Active Deals terminals
];

// Stages that mean "active" (not terminal)
export const ACTIVE_NEW_DEAL_STAGES: NewDealStage[] = [
  "New Lead", "No Contact", "Interested", "Converted",
];

export const ACTIVE_DEAL_STAGES: ActiveDealStage[] = [
  "Pre-Approval", "Underwriting", "Submitted", "Approved", "Contracts Out", "Contracts In",
];
