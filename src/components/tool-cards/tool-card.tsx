"use client";

import { DealListCard } from "./deal-list-card";
import { ContactCard } from "./contact-card";
import { PipelineOverviewCard } from "./pipeline-overview-card";
import { MessageSentCard } from "./message-sent-card";
import { LenderListCard } from "./lender-list-card";
import { ActivityFeedCard } from "./activity-feed-card";

interface ToolResult {
  tool: string;
  data: unknown;
  input: Record<string, unknown>;
}

interface Props {
  toolResult: ToolResult;
  onAction?: (prompt: string) => void;
}

export function ToolCard({ toolResult, onAction }: Props) {
  const { tool, data } = toolResult;

  switch (tool) {
    case "search_deals":
    case "get_deals_in_stage":
      return <DealListCard data={data as Record<string, unknown>} />;

    case "get_pipeline_overview":
      return <PipelineOverviewCard data={data as Record<string, unknown>} />;

    case "get_contact_profile":
      return (
        <ContactCard
          data={data as Record<string, unknown>}
          onAction={onAction}
        />
      );

    case "get_recent_activity":
      return <ActivityFeedCard data={data as Record<string, unknown>} />;

    case "send_sms":
    case "send_email":
    case "send_template":
    case "add_deal_note":
    case "enroll_in_sequence":
    case "move_deal":
      return <MessageSentCard tool={tool} data={data as Record<string, unknown>} />;

    case "get_lenders":
      return <LenderListCard data={data as Record<string, unknown>} />;

    default:
      return null;
  }
}
