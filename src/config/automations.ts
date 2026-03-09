// Pipeline automation rules — define what happens when a deal enters a stage
// Each rule maps a stage to actions that fire on entry

export interface AutomationAction {
  type: "send_sms" | "send_email" | "add_tag" | "remove_tag" | "notify_team";
  templateSlug?: string;
  tag?: string;
  message?: string;
  delayMinutes?: number; // 0 = immediate
}

export interface AutomationRule {
  id: string;
  pipeline: "New Deals" | "Active Deals";
  stage: string;
  trigger: "on_enter" | "stale";
  staleDays?: number; // Only for stale trigger
  actions: AutomationAction[];
  enabled: boolean;
  description: string;
}

export const DEFAULT_AUTOMATIONS: AutomationRule[] = [
  // === NEW DEALS PIPELINE ===
  {
    id: "open-not-contacted-welcome",
    pipeline: "New Deals",
    stage: "Open - Not Contacted",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "new-lead-welcome-sms" },
      { type: "send_email", templateSlug: "new-lead-welcome-email" },
      { type: "add_tag", tag: "new-lead" },
    ],
    enabled: true,
    description: "Welcome SMS + Email when a new lead comes in",
  },
  {
    id: "open-not-contacted-stale",
    pipeline: "New Deals",
    stage: "Open - Not Contacted",
    trigger: "stale",
    staleDays: 3,
    actions: [
      { type: "notify_team", message: "Lead has been sitting for 3+ days without contact" },
    ],
    enabled: true,
    description: "Alert team when new leads go cold",
  },
  {
    id: "working-contacted-followup",
    pipeline: "New Deals",
    stage: "Working - Contacted",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "contacted-followup-sms" },
      { type: "send_email", templateSlug: "contacted-followup-email", delayMinutes: 30 },
      { type: "remove_tag", tag: "new-lead" },
      { type: "add_tag", tag: "contacted" },
    ],
    enabled: true,
    description: "Follow-up SMS + delayed email after first contact",
  },
  {
    id: "working-application-out",
    pipeline: "New Deals",
    stage: "Working - Application Out",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "application-sent-sms" },
      { type: "add_tag", tag: "application-out" },
    ],
    enabled: true,
    description: "Confirm application was sent to lead",
  },
  {
    id: "converted-notification",
    pipeline: "New Deals",
    stage: "Converted",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "converted-active-sms" },
      { type: "add_tag", tag: "converted" },
      { type: "notify_team", message: "Lead converted to active deal" },
    ],
    enabled: true,
    description: "Notify contact and team when lead converts",
  },
  {
    id: "closed-not-converted",
    pipeline: "New Deals",
    stage: "Closed - Not Converted",
    trigger: "on_enter",
    actions: [
      { type: "send_email", templateSlug: "not-converted-email" },
      { type: "add_tag", tag: "not-converted" },
    ],
    enabled: true,
    description: "Send rejection email with alternative options",
  },

  // === ACTIVE DEALS PIPELINE ===
  {
    id: "underwriting",
    pipeline: "Active Deals",
    stage: "Underwriting",
    trigger: "on_enter",
    actions: [
      { type: "send_email", templateSlug: "underwriting-email" },
      { type: "add_tag", tag: "underwriting" },
    ],
    enabled: true,
    description: "Notify contact file is under review",
  },
  {
    id: "shopping",
    pipeline: "Active Deals",
    stage: "Shopping",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "shopping-sms" },
      { type: "add_tag", tag: "shopping" },
    ],
    enabled: true,
    description: "Notify contact deal is being shopped to lenders",
  },
  {
    id: "pre-approved",
    pipeline: "Active Deals",
    stage: "Pre-Approved",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "pre-approved-sms" },
      { type: "send_email", templateSlug: "pre-approved-email" },
      { type: "add_tag", tag: "pre-approved" },
    ],
    enabled: true,
    description: "Pre-approval congratulations",
  },
  {
    id: "approved-congrats",
    pipeline: "Active Deals",
    stage: "Approved",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "approved-sms" },
      { type: "send_email", templateSlug: "approved-email" },
      { type: "add_tag", tag: "approved" },
      { type: "notify_team", message: "Deal APPROVED!" },
    ],
    enabled: true,
    description: "Approval celebration — SMS, Email, team notification",
  },
  {
    id: "vc-dl",
    pipeline: "Active Deals",
    stage: "VC / DL",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "vc-dl-sms" },
    ],
    enabled: true,
    description: "Notify contact about verification call / DocuSign link",
  },
  {
    id: "contracts-out",
    pipeline: "Active Deals",
    stage: "Contracts Out",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "contracts-out-sms" },
    ],
    enabled: true,
    description: "Send contracts signing instructions",
  },
  {
    id: "contracts-out-stale",
    pipeline: "Active Deals",
    stage: "Contracts Out",
    trigger: "stale",
    staleDays: 2,
    actions: [
      { type: "send_sms", templateSlug: "contracts-reminder-sms" },
      { type: "notify_team", message: "Contracts unsigned for 2+ days" },
    ],
    enabled: true,
    description: "Remind when contracts aren't signed after 2 days",
  },
  {
    id: "contracts-in",
    pipeline: "Active Deals",
    stage: "Contracts In",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "contracts-in-sms" },
    ],
    enabled: true,
    description: "Confirm contracts received",
  },
  {
    id: "pending-stips",
    pipeline: "Active Deals",
    stage: "Pending Stips",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "pending-stips-sms" },
      { type: "send_email", templateSlug: "pending-stips-email" },
      { type: "add_tag", tag: "pending-stips" },
    ],
    enabled: true,
    description: "Notify contact about required stipulations",
  },
  {
    id: "pending-stips-stale",
    pipeline: "Active Deals",
    stage: "Pending Stips",
    trigger: "stale",
    staleDays: 3,
    actions: [
      { type: "send_sms", templateSlug: "stips-reminder-sms" },
      { type: "notify_team", message: "Stips pending for 3+ days" },
    ],
    enabled: true,
    description: "Remind when stips haven't been satisfied after 3 days",
  },
  {
    id: "funding-call",
    pipeline: "Active Deals",
    stage: "Funding Call",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "funding-call-sms" },
    ],
    enabled: true,
    description: "Notify contact about funding call",
  },
  {
    id: "in-funding",
    pipeline: "Active Deals",
    stage: "In Funding",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "in-funding-sms" },
      { type: "send_email", templateSlug: "in-funding-email" },
      { type: "add_tag", tag: "in-funding" },
    ],
    enabled: true,
    description: "Funding in progress notification",
  },
  {
    id: "closed-won",
    pipeline: "Active Deals",
    stage: "Closed",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "funded-congrats-sms" },
      { type: "send_email", templateSlug: "funded-congrats-email" },
      { type: "add_tag", tag: "funded" },
      { type: "notify_team", message: "DEAL CLOSED!" },
    ],
    enabled: true,
    description: "Closed/funded celebration — full notification suite",
  },
  {
    id: "deal-lost",
    pipeline: "Active Deals",
    stage: "Deal Lost",
    trigger: "on_enter",
    actions: [
      { type: "add_tag", tag: "deal-lost" },
      { type: "notify_team", message: "Deal lost" },
    ],
    enabled: true,
    description: "Tag and notify team when deal is lost",
  },
];
