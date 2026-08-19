import { supabaseAdmin } from "./db";
import { microsoft } from "./microsoft";
import { renderTemplate, type TemplateContext } from "./template-renderer";
import { normalizePhone } from "./phone";
import { slack } from "./slack-bot";
import { cancelPendingSuggestion } from "./imessage-suggestion";
import { dispatchOutbound } from "./imessage-transport";
import { scheduleFollowup } from "./imessage-followups";
import { CRM_TOOLS, CRM_TOOL_NAMES, executeCrmTool } from "./crm-tools";

// Structured result returned from executeTool — content goes to Claude, structuredData goes to the UI
export interface ToolExecutionResult {
  content: string;        // JSON string sent to Claude (unchanged behavior)
  structuredData: unknown; // Parsed data for rendering rich cards in the chat UI
}

// Tool definitions for the Anthropic API
const BASE_TOOLS = [
  {
    name: "send_sms",
    description:
      "Send an iMessage to a contact via LoopMessage. Looks up the contact's active SMS conversation and sends the message through their Slack-monitored channel.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The contact ID to send to",
        },
        message: {
          type: "string",
          description: "The SMS message to send",
        },
      },
      required: ["contact_id", "message"],
    },
  },
  {
    name: "schedule_followup",
    description:
      "Schedule a follow-up reminder for a contact on a future date. On the due date this auto-posts a reminder header AND a Vektor-drafted check-in suggestion card into the lead's OWN Slack channel (which then arms the 2-minute auto-send), and it opens a task on the lead. Use when asked to 'follow up with [contact] tomorrow', 'remind me to check on [name] in 3 days', or 'set a follow-up for [date]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The contact ID to schedule the follow-up for",
        },
        reason: {
          type: "string",
          description: "Short reason / context for the follow-up, e.g. 'check if they sent statements'",
        },
        due_date: {
          type: "string",
          description: "When to follow up. Accepts ISO datetime, YYYY-MM-DD, or relative phrases like 'tomorrow', 'in 3 days', 'next week'.",
        },
        create_crm_task: {
          type: "boolean",
          description: "Whether to also open a task on the lead. Default true.",
        },
      },
      required: ["contact_id", "reason", "due_date"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email to a contact via Microsoft 365. Use when asked to email a client.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The contact ID to send to",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        message: {
          type: "string",
          description: "Email body content (HTML supported)",
        },
      },
      required: ["contact_id", "subject", "message"],
    },
  },
  {
    name: "get_templates",
    description:
      "List available SMS and Email templates. Use when asked about available templates or when you need a template to send.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description: "Filter by type: 'SMS' or 'Email'. Optional.",
        },
        category: {
          type: "string",
          description: "Filter by category/stage. Optional.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "send_template",
    description:
      "Send a pre-built template message to a contact. Automatically renders variables. Use when asked to send a specific template like 'send the welcome email to John'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The contact ID",
        },
        template_slug: {
          type: "string",
          description: "The template slug to send",
        },
        variables: {
          type: "object",
          description:
            "Variable values for the template, e.g. { first_name: 'John', business_name: 'Smith LLC' }",
        },
      },
      required: ["contact_id", "template_slug"],
    },
  },
  {
    name: "get_recent_activity",
    description:
      "Get recent system activity and automation logs. Use when asked about what happened recently, recent actions, or automation history.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "How many entries to return. Default 20.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_contact_profile",
    description:
      "Get a complete contact dossier: contact details, active email sequences, and recent timeline. Use when asked to 'show me [name]', 'pull up [business]', or 'what's the file on [contact]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Name, business name, email, or phone to search",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "enroll_in_sequence",
    description:
      "Enroll a contact in an email drip sequence. Use when asked to 'start the follow-up for [contact]' or 'enroll [name] in a sequence'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string" },
        contact_email: { type: "string" },
        contact_name: { type: "string" },
        sequence_slug: {
          type: "string",
          description: "Sequence slug. Call get_sequences first if you are not sure which ones exist.",
        },
      },
      required: ["contact_id", "contact_email", "contact_name", "sequence_slug"],
    },
  },
];

// The CRM tools (worklist, lead lookup, call logging, follow-ups, open query)
// live in crm-tools.ts — this file is already long enough, and keeping them
// separate makes the Zoho-replacement surface reviewable on its own.
//
// Merging here rather than at each call site means every existing consumer
// picks them up automatically: the web chat, the Telegram webhook, and — the
// one that matters — the free-form Slack handler in
// src/app/api/slack/events/route.ts, which passes no tool overrides at all.
export const AI_TOOLS = [...BASE_TOOLS, ...CRM_TOOLS];

// Tool execution functions
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  if (CRM_TOOL_NAMES.has(toolName)) return executeCrmTool(toolName, input);
  try {
    let content: string;
    switch (toolName) {
      case "send_sms":
        content = await sendSms(input.contact_id as string, input.message as string); break;
      case "schedule_followup":
        content = await scheduleFollowupTool(input.contact_id as string, input.reason as string, input.due_date as string, input.create_crm_task as boolean | undefined); break;
      case "send_email":
        content = await sendEmail(input.contact_id as string, input.subject as string, input.message as string); break;
      case "get_templates":
        content = await getTemplates(input.type as string | undefined, input.category as string | undefined); break;
      case "send_template":
        content = await sendTemplate(input.contact_id as string, input.template_slug as string, (input.variables as Record<string, string>) || {}); break;
      case "get_recent_activity":
        content = await getRecentActivity((input.limit as number) || 20); break;
      case "get_contact_profile":
        content = await getContactProfile(input.query as string); break;
      case "enroll_in_sequence":
        content = await enrollInSequence(input.contact_id as string, input.contact_email as string, input.contact_name as string, input.sequence_slug as string); break;
      default:
        content = JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    let structuredData: unknown = null;
    try { structuredData = JSON.parse(content); } catch { structuredData = null; }
    return { content, structuredData };
  } catch (error) {
    const content = JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" });
    return { content, structuredData: null };
  }
}
async function sendSms(contactId: string, message: string): Promise<string> {
  try {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("phone, mobile_phone, first_name, last_name")
      .eq("id", contactId)
      .maybeSingle();

    const rawPhone = contact?.phone || contact?.mobile_phone || null;
    if (!rawPhone) {
      return JSON.stringify({ error: "Contact not found or has no phone number on file." });
    }

    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .select("id, contact_id, outcome, close_stage, slack_channel_id")
      .eq("contact_id", contactId)
      .maybeSingle();

    if (!conv) {
      return JSON.stringify({
        error: "No SMS conversation exists for this contact yet. Initiate one from the pipeline first.",
      });
    }

    if (conv.outcome === "dead") {
      return JSON.stringify({ error: "This conversation is marked dead — cannot send." });
    }

    // Outbound via the active transport (Mac outbox by default, or LoopMessage).
    // This tool is only reached on an explicit instruction/approval through the AI
    // tool loop (Vektor never auto-texts unattended), so the transport switch
    // changes only HOW it is delivered, not WHO triggers a send.
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return JSON.stringify({ error: "Contact phone is not a valid number." });
    }

    const result = await dispatchOutbound({
      conversationId: conv.id as string,
      contactId: (conv.contact_id as string | null) ?? contactId,
      phone,
      body: message,
      source: "ai_tool",
    });
    if (!result.ok) {
      return JSON.stringify({ error: `Send failed: ${result.error ?? "unknown"}` });
    }

    // On the Mac transport the bridge's is_from_me read loop mirrors the sent
    // message into Slack + logs sms_messages, so we don't post here (avoids a
    // double-mirror). On LoopMessage dispatchOutbound already logged sms_messages;
    // mirror the confirmation + retire any live suggestion.
    if (!result.queued && conv.slack_channel_id) {
      const preview = message.length > 200 ? message.slice(0, 200) + "…" : message;
      await slack.postMessage(conv.slack_channel_id as string, `✅ Sent (iMessage): "${preview}"`);
      await cancelPendingSuggestion(conv.id as string);
    }

    return JSON.stringify({
      success: true,
      message: result.queued
        ? `Text queued for ${phone} — the Mac will deliver it.`
        : `Text sent to ${phone}.`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "SMS send failed" });
  }
}

async function scheduleFollowupTool(
  contactId: string,
  reason: string,
  dueDate: string,
  createCrmTask?: boolean
): Promise<string> {
  try {
    const result = await scheduleFollowup({ contactId, reason, dueDate, createCrmTask });
    if (!result.ok) {
      return JSON.stringify({ error: result.error ?? "Failed to schedule follow-up." });
    }
    return JSON.stringify({
      success: true,
      followup_id: result.followupId,
      message: `Follow-up scheduled. On the due date a reminder + check-in draft will post in the lead's Slack channel${createCrmTask === false ? "" : " and a task was opened on the lead"}.`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to schedule follow-up" });
  }
}

async function sendEmail(contactId: string, subject: string, message: string): Promise<string> {
  try {
    // Look up contact email
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("email, first_name, last_name")
      .eq("id", contactId)
      .single();

    if (!contact || !contact.email) {
      return JSON.stringify({ error: `Contact ${contactId} not found or has no email address.` });
    }

    await microsoft.sendMail({
      to: contact.email,
      subject,
      body: message,
      isHtml: true,
    });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI sent email to ${contact.first_name || ""} ${contact.last_name || ""} (${contact.email}): "${subject}"`,
      metadata: { contactId, type: "Email", subject, to: contact.email },
    });

    return JSON.stringify({ success: true, message: `Email sent to ${contact.email}.` });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Failed to send email" });
  }
}

async function getTemplates(type?: string, category?: string): Promise<string> {
  let query = supabaseAdmin.from("message_templates").select("name, slug, type, category, subject, is_active");
  if (type) query = query.eq("type", type);
  if (category) query = query.eq("category", category);

  const { data } = await query;
  return JSON.stringify({ templates: data || [] });
}

async function sendTemplate(
  contactId: string,
  templateSlug: string,
  variables: Record<string, string>
): Promise<string> {
  const { data: template } = await supabaseAdmin
    .from("message_templates")
    .select("*")
    .eq("slug", templateSlug)
    .eq("is_active", true)
    .single();

  if (!template) {
    return JSON.stringify({ error: `Template "${templateSlug}" not found or inactive.` });
  }

  // Look up contact
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("email, first_name, last_name, phone")
    .eq("id", contactId)
    .single();

  if (!contact) {
    return JSON.stringify({ error: `Contact ${contactId} not found.` });
  }

  const context: TemplateContext = {
    agent_name: "Benjamin",
    agent_phone: "(786) 282-2937",
    agent_email: "matthew@srtagency.com",
    company_name: "SRT Agency",
    first_name: contact.first_name || "",
    contact_name: `${contact.first_name || ""} ${contact.last_name || ""}`.trim(),
    ...variables,
  };

  const renderedBody = renderTemplate(template.body, context);
  const renderedSubject = template.subject ? renderTemplate(template.subject, context) : undefined;

  try {
    if (template.type === "SMS") {
      if (!contact.phone) {
        return JSON.stringify({ error: "Contact has no phone number on file." });
      }
      const result = await sendSms(contactId, renderedBody);
      return result;
    }

    // Email via Microsoft Graph
    if (!contact.email) {
      return JSON.stringify({ error: `Contact has no email address on file.` });
    }

    await microsoft.sendMail({
      to: contact.email,
      subject: renderedSubject || templateSlug,
      body: renderedBody,
      isHtml: true,
    });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI sent template "${templateSlug}" (Email) to ${contact.email}`,
      metadata: { contactId, templateSlug, type: "Email", to: contact.email },
    });

    return JSON.stringify({
      success: true,
      message: `Email template "${template.name}" sent to ${contact.email}.`,
      rendered_body: renderedBody,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Failed to send template" });
  }
}

async function getRecentActivity(limit: number): Promise<string> {
  const { data: logs } = await supabaseAdmin
    .from("system_logs")
    .select("event_type, description, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  return JSON.stringify({ activity: logs || [] });
}

// ── Contact & Deal Tools ──────────────────────────────────────────────────────

async function getContactProfile(query: string): Promise<string> {
  // Search contacts table by name, email, phone, or business
  const lowerQuery = query.toLowerCase();
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("*")
    .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,business_name.ilike.%${query}%`)
    .limit(5);

  if (!contacts || contacts.length === 0) {
    return JSON.stringify({ error: `No contact found for "${query}"` });
  }

  const contact = contacts[0];
  const contactId = contact.id;
  const contactName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || "Unknown";

  // Get active sequences
  let enrollments: unknown[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("sequence_enrollments")
      .select("status, current_step, next_send_at, email_sequences(name, slug)")
      .eq("contact_id", contactId)
      .eq("status", "active");
    enrollments = data || [];
  } catch { /* table may not exist yet */ }

  // Recent timeline. Reads lead_activities, not the retired deal_notes table.
  let notes: unknown[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("lead_activities")
      .select("activity_type, subject, body, actor, occurred_at")
      .eq("contact_id", contactId)
      .order("occurred_at", { ascending: false })
      .limit(5);
    notes = data || [];
  } catch { /* table may not exist yet */ }

  return JSON.stringify({
    contact: {
      id: contactId,
      name: contactName,
      email: contact.email,
      phone: contact.phone,
      businessName: contact.business_name || "",
      industry: contact.industry || "",
      website: contact.website || "",
      stage: contact.application_stage || "",
      source: contact.source || "",
    },
    sequences: enrollments,
    notes,
  });
}

async function enrollInSequence(contactId: string, contactEmail: string, contactName: string, sequenceSlug: string): Promise<string> {
  try {
    const { enrollContact } = await import("./sequence-engine");
    const result = await enrollContact(sequenceSlug, contactId, contactEmail, contactName);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to enroll in sequence" });
  }
}
