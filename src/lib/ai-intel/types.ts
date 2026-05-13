export type MerchantState =
  | "funded"
  | "declined"
  | "dead"
  | "approved_no_response"
  | "underwriting_stale"
  | "active_application"
  | "missing_stips"
  | "awaiting_statements"
  | "needs_data_cleanup"
  | "normal_nurture";

export type AIAction = "suppress" | "submit_deal" | "draft_email" | "slack_alert" | "clean_zoho_data" | "none";

export type AIUrgency = "high" | "medium" | "low";

export type TriggerType = "cron" | "webhook_zoho" | "inbound_email" | "slack_command";

export type ActionType =
  | "send_email"
  | "submit_deal"
  | "update_zoho"
  | "reply_funder"
  | "send_marketing_email"
  | "send_submission"
  | "clear_lead_amounts"
  | "add_lender";

export type CadenceTrack =
  | "new_lead"
  | "awaiting_statements"
  | "approved_nurture"
  | "confirmation"
  | "paused"
  | "done";

export type MarketingCampaignKey =
  | "new_lead_d1"
  | "new_lead_d2"
  | "new_lead_d3"
  | "confirmation_daily"
  | "awaiting_statements"
  | "approved_nurture"
  | "custom";

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
  contact_id?: string;
  requires_matthew?: boolean;
  amount?: number;
  stage?: string;
  zoho_fields?: Record<string, unknown>;
  note?: { title: string; content: string };
  // send_submission specific — draft posted in deal thread, resolved when
  // Matt replies with lender names in the same thread.
  draft_subject?: string;
  draft_body?: string;
  onedrive_folder_url?: string;
  bank_stmt_drive_item_ids?: string[];
  lender_ids?: string[];
  revenue_table?: Array<{
    month: string;
    deposits: number | null;
    avg_daily_ledger: number | null;
    deposit_count: number | null;
    nsf_count: number | null;
  }>;
  // Instructs execute-action to post a follow-up card after `update_zoho`
  // finishes (e.g. "draft_submission" chains the submission email draft
  // after a bank-statement approval).
  followup?: "draft_submission" | null;
  // send_marketing_email specific
  campaign_key?: MarketingCampaignKey;
  cadence_day?: number;
  sequence_position?: number;
  magic_link_redirect?: string;
  // links back to sequence_enrollments so the runner can advance the step after send
  enrollment_id?: string;
  [key: string]: unknown;
}
