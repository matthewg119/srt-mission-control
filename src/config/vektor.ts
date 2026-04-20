export const VEKTOR = {
  name: "VeKtor",
  tagline: "SRT Agency's AI Intelligence Layer",
  avatarUrl: "/vektor.png",
  brandColor: "#E8792B",
  emoji: ":vektor:",
  fallbackEmoji: ":shark:",
};

export const VEKTOR_CHANNELS = {
  main: process.env.SLACK_VEKTOR_CHANNEL || "",
  deals: process.env.SLACK_VEKTOR_DEALS_CHANNEL || "",
  workingLeads: process.env.SLACK_VEKTOR_WORKING_LEADS_CHANNEL || "",
  renewals: process.env.SLACK_VEKTOR_RENEWALS_CHANNEL || "",
  matthew: process.env.SLACK_VEKTOR_MATTHEW_DM || "",
  // #pipeline-new — per-deal Slack threads. Every deal's parent message lives
  // here; all stage changes and funder-reply summaries are thread replies.
  pipeline: process.env.SLACK_PIPELINE_CHANNEL || "",
};

export type VektorCategory =
  | "merchant_state"
  | "inbound_email"
  | "deal_submission"
  | "approval_required"
  | "bank_statement_analysis"
  | "deal_approved"
  | "deal_declined"
  | "renewal"
  | "working_lead"
  | "daily_digest"
  | "misc";

export function routeToChannel(category: VektorCategory): string {
  switch (category) {
    case "deal_submission":
    case "deal_approved":
    case "deal_declined":
    case "bank_statement_analysis":
      return VEKTOR_CHANNELS.deals || VEKTOR_CHANNELS.main;
    case "working_lead":
    case "merchant_state":
    case "inbound_email":
      return VEKTOR_CHANNELS.workingLeads || VEKTOR_CHANNELS.main;
    case "renewal":
      return VEKTOR_CHANNELS.renewals || VEKTOR_CHANNELS.main;
    case "approval_required":
      return VEKTOR_CHANNELS.matthew || VEKTOR_CHANNELS.main;
    case "daily_digest":
    case "misc":
    default:
      return VEKTOR_CHANNELS.main;
  }
}
