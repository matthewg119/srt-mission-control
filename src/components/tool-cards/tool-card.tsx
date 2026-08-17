"use client";

import { ContactCard } from "./contact-card";
import { MessageSentCard } from "./message-sent-card";
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
    case "add_lead_note":
    case "enroll_in_sequence":
    case "set_lead_status":
      return <MessageSentCard tool={tool} data={data as Record<string, unknown>} />;

    default:
      return null;
  }
}
