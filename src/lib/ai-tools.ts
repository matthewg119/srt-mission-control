import { supabaseAdmin } from "./db";
import { ghl } from "./ghl";
import { ghlMessaging } from "./ghl-messaging";
import { renderTemplate, type TemplateContext } from "./template-renderer";
import { PIPELINES } from "@/config/pipeline";

// Structured result returned from executeTool — content goes to Claude, structuredData goes to the UI
export interface ToolExecutionResult {
  content: string;        // JSON string sent to Claude (unchanged behavior)
  structuredData: unknown; // Parsed data for rendering rich cards in the chat UI
}

// Tool definitions for the Anthropic API
export const AI_TOOLS = [
  {
    name: "get_pipeline_overview",
    description:
      "Get an overview of all deals across both pipelines (New Deals and Active Deals). Returns deal counts per stage, total values, and stale deals. Use this when asked about pipeline status, how many deals we have, or general business health.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "get_deals_in_stage",
    description:
      "Get all deals in a specific pipeline stage. Returns deal details including contact name, business name, amount, and days in stage. Use when asked about specific stage status like 'who is in Underwriting?' or 'show me Approved deals'.",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: {
          type: "string",
          description:
            "The stage name, e.g. 'New Lead', 'Interested', 'Pre-Approval', 'Underwriting', 'Submitted', 'Approved', 'Contracts Out', 'Contracts In', 'Funded', 'Deal Lost'",
        },
        pipeline: {
          type: "string",
          description: "Pipeline name: 'New Deals' or 'Active Deals'. Optional — if not provided, searches both.",
        },
      },
      required: ["stage"],
    },
  },
  {
    name: "search_deals",
    description:
      "Search for deals by contact name or business name. Use when asked about a specific client or business.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search term — will match against contact name and business name",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "move_deal",
    description:
      "Move a deal to a different stage in GHL. Use when asked to update a deal's stage, like 'move John to Approved' or 'advance Smith Construction to Contracts Out'. ALWAYS confirm with the user before executing this.",
    input_schema: {
      type: "object" as const,
      properties: {
        opportunity_id: {
          type: "string",
          description: "The GHL opportunity ID of the deal to move",
        },
        new_stage: {
          type: "string",
          description: "The target stage name",
        },
      },
      required: ["opportunity_id", "new_stage"],
    },
  },
  {
    name: "send_sms",
    description:
      "Send an SMS message to a contact via GHL. Use when asked to text/message a client. Can use a template or custom message.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The GHL contact ID to send to",
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
    name: "send_email",
    description:
      "Send an email to a contact via GHL. Use when asked to email a client.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The GHL contact ID to send to",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        message: {
          type: "string",
          description: "Email body content",
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
      "Send a pre-built template message to a contact. Automatically renders variables. Use when asked to send a specific template like 'send the welcome SMS to John'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: {
          type: "string",
          description: "The GHL contact ID",
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
      "Get a complete contact dossier: contact details, open deals, active email sequences, and recent notes. Use when asked to 'show me [name]', 'pull up [business]', or 'what's the file on [contact]'.",
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
    name: "add_deal_note",
    description:
      "Add a note to a deal or contact. Use when asked to 'make a note', 'log that [client] said...', or 'add a note to [deal]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "GHL contact ID" },
        note: { type: "string", description: "The note content to add" },
        opportunity_id: { type: "string", description: "Optional: GHL opportunity ID to associate with" },
      },
      required: ["contact_id", "note"],
    },
  },
  {
    name: "get_deal_notes",
    description:
      "Get notes for a contact or deal. Use when asked 'what notes do we have on [contact]' or 'show me the history for [deal]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "GHL contact ID" },
        opportunity_id: { type: "string", description: "Optional: filter to a specific deal" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_lenders",
    description:
      "Look up lenders in the database. Use when asked about lenders, 'who funds equipment deals', 'find a lender for [situation]', or 'what lenders do we have'. Can filter by product type or keyword.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          description: "Optional: product type, minimum credit score, or keyword to filter lenders",
        },
      },
      required: [] as string[],
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
          description: "Sequence slug: 'website-lead-nurture', 'application-completed-nurture', 'application-abandoned', or 'website-lead-to-application'",
        },
      },
      required: ["contact_id", "contact_email", "contact_name", "sequence_slug"],
    },
  },
];

// Tool execution functions
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<ToolExecutionResult> {
  try {
    let content: string;
    switch (toolName) {
      case "get_pipeline_overview":
        content = await getPipelineOverview(); break;
      case "get_deals_in_stage":
        content = await getDealsInStage(input.stage as string, input.pipeline as string | undefined); break;
      case "search_deals":
        content = await searchDeals(input.query as string); break;
      case "move_deal":
        content = await moveDeal(input.opportunity_id as string, input.new_stage as string); break;
      case "send_sms":
        content = await sendSms(input.contact_id as string, input.message as string); break;
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
      case "add_deal_note":
        content = await addDealNote(input.contact_id as string, input.note as string, input.opportunity_id as string | undefined); break;
      case "get_deal_notes":
        content = await getDealNotes(input.contact_id as string, input.opportunity_id as string | undefined); break;
      case "get_lenders":
        content = await getLenders(input.filter as string | undefined); break;
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

async function getPipelineOverview(): Promise<string> {
  const { data: deals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("stage, pipeline_name, amount, updated_at, contact_name, business_name");

  if (!deals || deals.length === 0) {
    return JSON.stringify({
      message: "No deals in the pipeline yet. Sync from GHL to load deals.",
      total: 0,
    });
  }

  const now = Date.now();
  const stageGroups: Record<string, { count: number; totalAmount: number; staleCount: number }> = {};

  for (const deal of deals) {
    const key = `${deal.pipeline_name || "Unknown"} → ${deal.stage}`;
    if (!stageGroups[key]) {
      stageGroups[key] = { count: 0, totalAmount: 0, staleCount: 0 };
    }
    stageGroups[key].count++;
    stageGroups[key].totalAmount += deal.amount || 0;

    const daysSinceUpdate = Math.floor((now - new Date(deal.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate > 3) stageGroups[key].staleCount++;
  }

  return JSON.stringify({
    total_deals: deals.length,
    stages: stageGroups,
    pipelines: {
      "New Deals": deals.filter((d) => d.pipeline_name === "New Deals").length,
      "Active Deals": deals.filter((d) => d.pipeline_name === "Active Deals").length,
    },
  });
}

async function getDealsInStage(stage: string, pipeline?: string): Promise<string> {
  let query = supabaseAdmin
    .from("pipeline_cache")
    .select("*")
    .eq("stage", stage);

  if (pipeline) query = query.eq("pipeline_name", pipeline);

  const { data: deals } = await query;

  if (!deals || deals.length === 0) {
    return JSON.stringify({ message: `No deals in "${stage}" stage.`, deals: [] });
  }

  const now = Date.now();
  return JSON.stringify({
    stage,
    count: deals.length,
    deals: deals.map((d) => ({
      id: d.ghl_opportunity_id,
      contact: d.contact_name,
      business: d.business_name,
      amount: d.amount,
      pipeline: d.pipeline_name,
      days_in_stage: Math.floor((now - new Date(d.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
    })),
  });
}

async function searchDeals(query: string): Promise<string> {
  const { data: deals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("*")
    .or(`contact_name.ilike.%${query}%,business_name.ilike.%${query}%`);

  if (!deals || deals.length === 0) {
    return JSON.stringify({ message: `No deals found matching "${query}".`, deals: [] });
  }

  return JSON.stringify({
    query,
    count: deals.length,
    deals: deals.map((d) => ({
      id: d.ghl_opportunity_id,
      contact: d.contact_name,
      business: d.business_name,
      amount: d.amount,
      stage: d.stage,
      pipeline: d.pipeline_name,
    })),
  });
}

async function moveDeal(opportunityId: string, newStage: string): Promise<string> {
  // Find the stage ID in GHL
  const pipelinesResponse = await ghl.getPipelines();
  const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];

  let targetStageId: string | null = null;
  let targetPipelineName: string | null = null;

  for (const pipeline of allPipelines) {
    const stages = (pipeline.stages as Array<Record<string, unknown>>) || [];
    const matchingStage = stages.find(
      (s) => (s.name as string).toLowerCase() === newStage.toLowerCase()
    );
    if (matchingStage) {
      targetStageId = matchingStage.id as string;
      targetPipelineName = pipeline.name as string;
      break;
    }
  }

  if (!targetStageId) {
    return JSON.stringify({ error: `Stage "${newStage}" not found in any pipeline.` });
  }

  try {
    await ghl.updateOpportunityStage(opportunityId, targetStageId);

    // Update local cache
    await supabaseAdmin
      .from("pipeline_cache")
      .update({ stage: newStage, pipeline_name: targetPipelineName, updated_at: new Date().toISOString() })
      .eq("ghl_opportunity_id", opportunityId);

    // Log it
    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI moved deal ${opportunityId} to "${newStage}" in ${targetPipelineName}`,
      metadata: { opportunityId, newStage, pipeline: targetPipelineName },
    });

    return JSON.stringify({ success: true, message: `Deal moved to "${newStage}" in ${targetPipelineName}.` });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Failed to move deal" });
  }
}

async function sendSms(contactId: string, message: string): Promise<string> {
  try {
    await ghlMessaging.sendMessage({ contactId, type: "SMS", message });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI sent SMS to contact ${contactId}: "${message.slice(0, 50)}..."`,
      metadata: { contactId, type: "SMS", message },
    });

    return JSON.stringify({ success: true, message: "SMS sent successfully." });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Failed to send SMS" });
  }
}

async function sendEmail(contactId: string, subject: string, message: string): Promise<string> {
  try {
    await ghlMessaging.sendMessage({ contactId, type: "Email", subject, message });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI sent email to contact ${contactId}: "${subject}"`,
      metadata: { contactId, type: "Email", subject },
    });

    return JSON.stringify({ success: true, message: "Email sent successfully." });
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

  const context: TemplateContext = {
    agent_name: "Benjamin",
    agent_phone: "(786) 282-2937",
    agent_email: "matthew@srtagency.com",
    company_name: "SRT Agency",
    ...variables,
  };

  const renderedBody = renderTemplate(template.body, context);
  const renderedSubject = template.subject ? renderTemplate(template.subject, context) : undefined;

  try {
    await ghlMessaging.sendMessage({
      contactId,
      type: template.type as "SMS" | "Email",
      message: renderedBody,
      subject: renderedSubject,
    });

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI sent template "${templateSlug}" (${template.type}) to contact ${contactId}`,
      metadata: { contactId, templateSlug, type: template.type },
    });

    return JSON.stringify({
      success: true,
      message: `${template.type} template "${template.name}" sent successfully.`,
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

// ── New tools ──────────────────────────────────────────────────────────────

async function getContactProfile(query: string): Promise<string> {
  let contact: Record<string, unknown> | null = null;
  try {
    const searchResult = await ghl.searchContacts(query);
    const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
    if (contacts.length > 0) contact = contacts[0];
  } catch { /* fall through */ }

  if (!contact) {
    return JSON.stringify({ error: `No contact found for "${query}"` });
  }

  const contactId = contact.id as string;
  const contactName = (contact.contactName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unknown") as string;
  const businessName = (contact.companyName || "") as string;

  const searchTerm = businessName || contactName;
  const { data: deals } = await supabaseAdmin
    .from("pipeline_cache")
    .select("ghl_opportunity_id, stage, pipeline_name, amount, updated_at, business_name, contact_name")
    .or(`contact_name.ilike.%${searchTerm}%,business_name.ilike.%${searchTerm}%`)
    .limit(10);

  let enrollments: unknown[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("sequence_enrollments")
      .select("status, current_step, next_send_at, email_sequences(name, slug)")
      .eq("contact_id", contactId)
      .in("status", ["active"]);
    enrollments = data || [];
  } catch { /* table may not exist yet */ }

  let notes: unknown[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("deal_notes")
      .select("body, author, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(5);
    notes = data || [];
  } catch { /* table may not exist yet */ }

  return JSON.stringify({
    contact: {
      id: contactId,
      name: contactName,
      email: contact.email,
      phone: contact.phone,
      tags: contact.tags || [],
      businessName,
    },
    deals: deals || [],
    sequences: enrollments,
    notes,
  });
}

async function addDealNote(contactId: string, note: string, opportunityId?: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("deal_notes")
      .insert({ contact_id: contactId, opportunity_id: opportunityId || null, body: note, author: "AI Office Manager" })
      .select()
      .single();
    return JSON.stringify({ success: true, note_id: data?.id, stored: "supabase" });
  } catch {
    try {
      const result = await ghl.addNote(contactId, note);
      return JSON.stringify({ success: true, note_id: (result as Record<string, unknown>).id, stored: "ghl" });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to add note" });
    }
  }
}

async function getDealNotes(contactId: string, opportunityId?: string): Promise<string> {
  try {
    let query = supabaseAdmin
      .from("deal_notes")
      .select("id, body, author, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (opportunityId) query = query.eq("opportunity_id", opportunityId);
    const { data: notes } = await query;
    return JSON.stringify({ notes: notes || [], count: (notes || []).length });
  } catch {
    try {
      const result = await ghl.getNotes(contactId);
      return JSON.stringify({ notes: (result as Record<string, unknown>).notes || [], source: "ghl" });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get notes" });
    }
  }
}

async function getLenders(filter?: string): Promise<string> {
  const { data, error } = await supabaseAdmin.from("lenders").select("*").order("name");
  if (error) return JSON.stringify({ error: "Failed to query lenders database" });

  let lenders = data || [];
  if (filter) {
    const lf = filter.toLowerCase();
    lenders = lenders.filter((l: Record<string, unknown>) => {
      const text = [
        l.name, l.notes,
        ...(Array.isArray(l.products) ? l.products : []),
        ...(Array.isArray(l.product_types) ? l.product_types : []),
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(lf);
    });
  }
  return JSON.stringify({ lenders, count: lenders.length });
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
