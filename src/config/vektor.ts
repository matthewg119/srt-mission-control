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
  // #vektor-email-director — VeKtor's personal marketing channel with Matt.
  // Draft merchant emails, daily metrics, weekly strategy proposals land here.
  emailDirector: process.env.SLACK_VEKTOR_EMAIL_DIRECTOR_CHANNEL || "",
  // #content — drop screenshots + one-line brief, VeKtor returns a full
  // Viral Video Decoder production package in the thread (caption, VO
  // script, image/animation prompts, timeline, music). No video gen.
  content: process.env.SLACK_CONTENT_CHANNEL || "",
  // #content-full — same trigger as #content, but VeKtor runs the full
  // FAL.ai + ElevenLabs + ffmpeg pipeline and posts the finished MP4.
  contentFull: process.env.SLACK_CONTENT_FULL_CHANNEL || "",
  // #content-analyzer — drop a video, get a shot-by-shot storyboard + pest remake.
  contentAnalyzer: process.env.SLACK_CONTENT_ANALYZER_CHANNEL || "",
  // #ai-content-pest-control — the SIMPLE daily lane, pinned to the pest_control
  // avatar: drop media + copy -> workflow match -> MP4 + caption; 3x/day prompt
  // drops; workflow reference feedback. (drop-studio.ts)
  aiContentPestControl: process.env.SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL || "",
  // #agent-wokrflow-creator — workflow CREATION agent: go -> avatar -> report ->
  // audio + media + copy -> 3 render variations as Claude Code prompts -> keep N.
  // (workflow-agent.ts; channel name typo is Matthew's, keep it.)
  agentWorkflowCreator: process.env.SLACK_AGENT_WORKFLOW_CREATOR_CHANNEL || "",
  // #srt-scraper (was #srt-sub) - drop an Apollo export, get clean.csv + junk.csv back and the
  // survivors sent to MillionVerifier. src/lib/scraper/lane.ts.
  scraper: process.env.SLACK_SCRAPER_CHANNEL || "",
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
  | "marketing_email"
  | "marketing_metrics"
  | "marketing_strategy"
  | "handoff_to_rep"
  | "daily_digest"
  | "content_package"
  | "content_full_video"
  | "lender_mgmt"
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
    case "lender_mgmt":
      return VEKTOR_CHANNELS.matthew || VEKTOR_CHANNELS.main;
    case "marketing_email":
    case "marketing_metrics":
    case "marketing_strategy":
    case "handoff_to_rep":
      return VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
    case "content_package":
      return VEKTOR_CHANNELS.content || VEKTOR_CHANNELS.main;
    case "content_full_video":
      return VEKTOR_CHANNELS.contentFull || VEKTOR_CHANNELS.content || VEKTOR_CHANNELS.main;
    case "daily_digest":
    case "misc":
    default:
      return VEKTOR_CHANNELS.main;
  }
}
