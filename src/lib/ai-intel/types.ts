export type MerchantState =
  | "funded"
  | "declined"
  | "dead"
  | "approved_no_response"
  | "underwriting_stale"
  | "active_application"
  | "missing_stips"
  | "normal_nurture";

export type AIAction = "suppress" | "submit_deal" | "draft_email" | "slack_alert" | "clean_zoho_data" | "none";

export type AIUrgency = "high" | "medium" | "low";

export type TriggerType = "cron" | "webhook_zoho" | "inbound_email" | "slack_command";

export type ActionType = "send_email" | "submit_deal" | "update_zoho" | "reply_funder";

export interface GuardianDecision {
  merchant_id: string;
  zoho_id: string | null;
  state: MerchantState;
  days_since_last_touch: number;
  action: AIAction;
  urgency: AIUrgency;
  draft_subject?: string | null;
  draft_body?: string | null;
  slack_message?: string | null;
  suppress_sequences: boolean;
  fire_meta_capi_event?: "Purchase" | "DealDeclined" | null;
  reasoning: string;
}

export interface PendingActionPayload {
  action_type: ActionType;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  is_html?: boolean;
  attachments?: Array<{ name: string; url: string; contentType: string }>;
  deal_id?: string;
  lender_id?: string;
  zoho_id?: string;
  requires_matthew?: boolean;
  amount?: number;
  [key: string]: unknown;
}
