// Two-pipeline structure matching GHL setup
// New Deals: Initial lead intake (form fills → qualification)
// Active Deals: Post-approval pipeline (underwriting → funding)

export const NEW_DEALS_PIPELINE = {
  id: "eNMzDiNKRgmvkZUc8Nid",
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
  id: "Jhkxtrseqgm1qwMJGe7A",
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

export const GHL_CUSTOM_FIELDS = [
  { name: "business_name", dataType: "TEXT" },
  { name: "dba", dataType: "TEXT" },
  { name: "entity_type", dataType: "SINGLE_OPTIONS", options: ["LLC", "Corporation", "Sole Proprietorship", "Partnership", "S-Corp", "Non-Profit"] },
  { name: "industry", dataType: "TEXT" },
  { name: "business_address", dataType: "TEXT" },
  { name: "business_phone", dataType: "PHONE" },
  { name: "ein", dataType: "TEXT" },
  { name: "business_start_date", dataType: "DATE" },
  { name: "time_in_business", dataType: "SINGLE_OPTIONS", options: ["Less than 6 months", "6-12 months", "1-2 years", "2-5 years", "5+ years"] },
  { name: "annual_revenue", dataType: "SINGLE_OPTIONS", options: ["Under $120K", "$120K-$250K", "$250K-$500K", "$500K-$1M", "$1M+"] },
  { name: "owner_ssn_last4", dataType: "TEXT" },
  { name: "owner_dob", dataType: "DATE" },
  { name: "owner_home_address", dataType: "TEXT" },
  { name: "credit_score_range", dataType: "SINGLE_OPTIONS", options: ["500-599", "600-649", "650-699", "700-749", "750+"] },
  { name: "ownership_percentage", dataType: "TEXT" },
  { name: "funding_amount_requested", dataType: "TEXT" },
  { name: "use_of_funds", dataType: "SINGLE_OPTIONS", options: ["Working Capital", "Equipment Purchase", "Expansion", "Inventory", "Payroll", "Marketing", "Debt Refinance", "Other"] },
  { name: "financing_type", dataType: "SINGLE_OPTIONS", options: ["Working Capital", "Line of Credit", "Hybrid LOC", "Equipment Financing", "Not Sure"] },
  { name: "avg_monthly_bank_balance", dataType: "TEXT" },
  { name: "existing_loans", dataType: "SINGLE_OPTIONS", options: ["Yes", "No"] },
  { name: "application_source", dataType: "TEXT" },
  { name: "deal_folder_url", dataType: "TEXT" },
  { name: "submission_date", dataType: "DATE" },
  { name: "approved_amount", dataType: "TEXT" },
  { name: "approved_lender", dataType: "TEXT" },
  { name: "funding_date", dataType: "DATE" },
];
