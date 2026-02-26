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
    id: "new-lead-welcome",
    pipeline: "New Deals",
    stage: "New Lead",
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
    id: "no-contact-followup",
    pipeline: "New Deals",
    stage: "No Contact",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "no-contact-followup-sms" },
      { type: "send_email", templateSlug: "no-contact-followup-email", delayMinutes: 30 },
    ],
    enabled: true,
    description: "Follow-up SMS + delayed email for unreachable leads",
  },
  {
    id: "interested-next-steps",
    pipeline: "New Deals",
    stage: "Interested",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "interested-next-steps-sms" },
      { type: "add_tag", tag: "interested" },
      { type: "remove_tag", tag: "new-lead" },
    ],
    enabled: true,
    description: "Send next steps when lead shows interest",
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
    id: "dnq-notification",
    pipeline: "New Deals",
    stage: "DNQ",
    trigger: "on_enter",
    actions: [
      { type: "send_email", templateSlug: "dnq-notification-email" },
      { type: "add_tag", tag: "dnq" },
    ],
    enabled: true,
    description: "Send DNQ email with alternative options",
  },
  {
    id: "new-lead-stale",
    pipeline: "New Deals",
    stage: "New Lead",
    trigger: "stale",
    staleDays: 3,
    actions: [
      { type: "notify_team", message: "New lead has been sitting for 3+ days without contact" },
    ],
    enabled: true,
    description: "Alert team when new leads go cold",
  },

  // === ACTIVE DEALS PIPELINE ===
  {
    id: "pre-approval-congrats",
    pipeline: "Active Deals",
    stage: "Pre-Approval",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "pre-approval-congrats-sms" },
      { type: "send_email", templateSlug: "pre-approval-email" },
    ],
    enabled: true,
    description: "Pre-approval congratulations SMS + Email",
  },
  {
    id: "submitted-update",
    pipeline: "Active Deals",
    stage: "Submitted",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "submitted-lenders-sms" },
      { type: "send_email", templateSlug: "submitted-lenders-email" },
      { type: "add_tag", tag: "submitted" },
    ],
    enabled: true,
    description: "Notify contact when submitted to lenders",
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
    description: "Confirm contracts received, funding in progress",
  },
  {
    id: "funded-congrats",
    pipeline: "Active Deals",
    stage: "Funded",
    trigger: "on_enter",
    actions: [
      { type: "send_sms", templateSlug: "funded-congrats-sms" },
      { type: "send_email", templateSlug: "funded-congrats-email" },
      { type: "add_tag", tag: "funded" },
      { type: "notify_team", message: "DEAL FUNDED!" },
    ],
    enabled: true,
    description: "Funded celebration — full notification suite",
  },
  {
    id: "submitted-stale",
    pipeline: "Active Deals",
    stage: "Submitted",
    trigger: "stale",
    staleDays: 5,
    actions: [
      { type: "notify_team", message: "Deal submitted 5+ days ago with no lender response" },
    ],
    enabled: true,
    description: "Alert when lender response is taking too long",
  },
];
