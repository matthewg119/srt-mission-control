import { supabaseAdmin } from "./db";
import { microsoft } from "./microsoft";
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
      "Get all deals in a specific pipeline stage. Returns deal details including contact name, business name, amount, and days in stage. Use when asked about specific stage status like 'who has Pending Stips?' or 'show me In Funding deals'.",
    input_schema: {
      type: "object" as const,
      properties: {
        stage: {
          type: "string",
          description:
            "The stage name, e.g. 'Open - Not Contacted', 'Working - Contacted', 'Converted', 'Underwriting', 'Shopping', 'Pre-Approved', 'Approved', 'VC / DL', 'Contracts Out', 'Contracts In', 'Pending Stips', 'Funding Call', 'In Funding', 'Closed', 'Deal Lost'",
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
      "Move a deal to a different stage. Use when asked to update a deal's stage, like 'move John to Approved' or 'advance Smith Construction to Contracts Out'. ALWAYS confirm with the user before executing this.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: {
          type: "string",
          description: "The deal ID to move",
        },
        new_stage: {
          type: "string",
          description: "The target stage name",
        },
      },
      required: ["deal_id", "new_stage"],
    },
  },
  {
    name: "send_sms",
    description:
      "Send an SMS message to a contact. Currently unavailable — Twilio integration coming soon.",
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
        contact_id: { type: "string", description: "Contact ID" },
        note: { type: "string", description: "The note content to add" },
        deal_id: { type: "string", description: "Optional: deal ID to associate with" },
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
        contact_id: { type: "string", description: "Contact ID" },
        deal_id: { type: "string", description: "Optional: filter to a specific deal" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_lenders",
    description:
      "Look up lenders in the database. Use when asked about lenders, 'who funds equipment deals', 'find a lender for [situation]', 'what lenders do we have', 'show me Tier 1 lenders', or 'which lenders accept portal submissions'. Can filter by product type, keyword, tier, or submission method.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          description: "Optional: product type, minimum credit score, or keyword to filter lenders",
        },
        tier: {
          type: "number",
          description: "Optional: filter by tier (1 = A paper/best rates, 2 = B paper/moderate, 3 = high risk/last resort)",
        },
        submission_method: {
          type: "string",
          description: "Optional: filter by submission method — 'email', 'portal', or 'both'",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "underwrite_deal",
    description:
      "Analyze a deal's profile and generate an SOS (Statement of Scenario) document. Pulls deal data and contact fields, assesses viability, and stores the SOS. Use when asked to 'underwrite [deal]', 'analyze [business]', 'create SOS for [contact]', or 'run underwriting on [deal]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: {
          type: "string",
          description: "The deal ID to underwrite",
        },
        additional_context: {
          type: "string",
          description: "Optional: extra info like bank statement summary, credit details, or notes to include",
        },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "match_lenders",
    description:
      "Given a deal's profile, return a ranked list of matching lenders from the database. Filters by credit score, revenue, product type, industry, amount, and TIB. Ranks by tier (Tier 1 first). Use when asked 'which lenders fit this deal', 'match lenders for [business]', or 'who should we submit to'.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: {
          type: "string",
          description: "The deal ID to match lenders against",
        },
        product_type: {
          type: "string",
          description: "Optional: specific product type to match (e.g. 'Working Capital', 'Line of Credit')",
        },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "submit_to_lender",
    description:
      "Create an email submission draft to a lender for a deal. Uses the latest SOS document to compose the email. Creates a draft in email_drafts for user approval before sending. Use when asked to 'submit [deal] to [lender]' or 'send this deal to [lender]'.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: {
          type: "string",
          description: "The deal ID",
        },
        lender_id: {
          type: "string",
          description: "The lender UUID from the lenders table",
        },
        custom_notes: {
          type: "string",
          description: "Optional: additional notes for the submission email",
        },
      },
      required: ["deal_id", "lender_id"],
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
    // Support both old opportunity_id and new deal_id parameter names
    const dealId = (input.deal_id || input.opportunity_id) as string | undefined;
    switch (toolName) {
      case "get_pipeline_overview":
        content = await getPipelineOverview(); break;
      case "get_deals_in_stage":
        content = await getDealsInStage(input.stage as string, input.pipeline as string | undefined); break;
      case "search_deals":
        content = await searchDeals(input.query as string); break;
      case "move_deal":
        content = await moveDeal(dealId as string, input.new_stage as string); break;
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
        content = await addDealNote(input.contact_id as string, input.note as string, (input.deal_id || input.opportunity_id) as string | undefined); break;
      case "get_deal_notes":
        content = await getDealNotes(input.contact_id as string, (input.deal_id || input.opportunity_id) as string | undefined); break;
      case "get_lenders":
        content = await getLenders(input.filter as string | undefined, input.tier as number | undefined, input.submission_method as string | undefined); break;
      case "underwrite_deal":
        content = await underwriteDeal(dealId as string, input.additional_context as string | undefined); break;
      case "match_lenders":
        content = await matchLenders(dealId as string, input.product_type as string | undefined); break;
      case "submit_to_lender":
        content = await submitToLender(dealId as string, input.lender_id as string, input.custom_notes as string | undefined); break;
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
    .from("deals")
    .select("id, stage, pipeline, amount, updated_at, contact_id, contacts(first_name, last_name, business_name)")
    .order("updated_at", { ascending: false });

  if (!deals || deals.length === 0) {
    return JSON.stringify({
      message: "No deals in the pipeline yet.",
      total: 0,
    });
  }

  const now = Date.now();
  const stageGroups: Record<string, { count: number; totalAmount: number; staleCount: number }> = {};

  for (const deal of deals) {
    const key = `${deal.pipeline || "Unknown"} → ${deal.stage}`;
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
      "New Deals": deals.filter((d) => d.pipeline === "New Deals").length,
      "Active Deals": deals.filter((d) => d.pipeline === "Active Deals").length,
    },
  });
}

async function getDealsInStage(stage: string, pipeline?: string): Promise<string> {
  let query = supabaseAdmin
    .from("deals")
    .select("id, stage, pipeline, amount, updated_at, contact_id, contacts(first_name, last_name, business_name)")
    .eq("stage", stage);

  if (pipeline) query = query.eq("pipeline", pipeline);

  const { data: deals } = await query;

  if (!deals || deals.length === 0) {
    return JSON.stringify({ message: `No deals in "${stage}" stage.`, deals: [] });
  }

  const now = Date.now();
  return JSON.stringify({
    stage,
    count: deals.length,
    deals: deals.map((d) => {
      const c = d.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
      return {
        id: d.id,
        contact: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown",
        business: c?.business_name || "",
        amount: d.amount,
        pipeline: d.pipeline,
        days_in_stage: Math.floor((now - new Date(d.updated_at).getTime()) / (1000 * 60 * 60 * 24)),
      };
    }),
  });
}

async function searchDeals(query: string): Promise<string> {
  // Search deals by joining contacts and matching on name or business
  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, stage, pipeline, amount, updated_at, contact_id, contacts(first_name, last_name, business_name)")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (!deals || deals.length === 0) {
    return JSON.stringify({ message: `No deals found matching "${query}".`, deals: [] });
  }

  // Filter client-side since Supabase doesn't support ilike on joined tables easily
  const lowerQuery = query.toLowerCase();
  const filtered = deals.filter((d) => {
    const c = d.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
    if (!c) return false;
    const fullName = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
    const biz = (c.business_name || "").toLowerCase();
    return fullName.includes(lowerQuery) || biz.includes(lowerQuery);
  });

  if (filtered.length === 0) {
    return JSON.stringify({ message: `No deals found matching "${query}".`, deals: [] });
  }

  return JSON.stringify({
    query,
    count: filtered.length,
    deals: filtered.map((d) => {
      const c = d.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
      return {
        id: d.id,
        contact: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown",
        business: c?.business_name || "",
        amount: d.amount,
        stage: d.stage,
        pipeline: d.pipeline,
      };
    }),
  });
}

async function moveDeal(dealId: string, newStage: string): Promise<string> {
  // Validate stage exists in our pipeline config
  const allStages = PIPELINES.flatMap((p) => p.stages.map((s) => ({ pipeline: p.name, stage: s.name })));
  const target = allStages.find((s) => s.stage.toLowerCase() === newStage.toLowerCase());

  if (!target) {
    return JSON.stringify({ error: `Stage "${newStage}" not found in any pipeline. Valid stages: ${allStages.map(s => s.stage).join(", ")}` });
  }

  try {
    // Get current deal to log the change
    const { data: currentDeal } = await supabaseAdmin
      .from("deals")
      .select("stage, pipeline")
      .eq("id", dealId)
      .single();

    if (!currentDeal) {
      return JSON.stringify({ error: `Deal ${dealId} not found.` });
    }

    const oldStage = currentDeal.stage;

    // Update the deal
    await supabaseAdmin
      .from("deals")
      .update({
        stage: target.stage,
        pipeline: target.pipeline,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dealId);

    // Log the stage change as a deal event
    await supabaseAdmin.from("deal_events").insert({
      deal_id: dealId,
      event_type: "stage_change",
      description: `Moved from "${oldStage}" to "${target.stage}" (${target.pipeline})`,
      metadata: { old_stage: oldStage, new_stage: target.stage, pipeline: target.pipeline, moved_by: "AI" },
    });

    // System log
    await supabaseAdmin.from("system_logs").insert({
      event_type: "ai_action",
      description: `AI moved deal ${dealId} from "${oldStage}" to "${target.stage}" in ${target.pipeline}`,
      metadata: { dealId, oldStage, newStage: target.stage, pipeline: target.pipeline },
    });

    return JSON.stringify({ success: true, message: `Deal moved from "${oldStage}" to "${target.stage}" in ${target.pipeline}.` });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Failed to move deal" });
  }
}

async function sendSms(_contactId: string, _message: string): Promise<string> {
  return JSON.stringify({
    error: "SMS is not available yet. Twilio integration coming soon. Use send_email instead to reach this contact.",
  });
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
      return JSON.stringify({ error: "SMS is not available yet. Twilio integration coming soon." });
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

  // Get deals for this contact
  const { data: deals } = await supabaseAdmin
    .from("deals")
    .select("id, stage, pipeline, amount, updated_at, source, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(10);

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

  // Get recent notes
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
      businessName: contact.business_name || "",
      industry: contact.industry || "",
      credit_score_range: contact.credit_score_range || "",
      source: contact.source || "",
      lead_score: contact.lead_score || 0,
    },
    deals: (deals || []).map((d) => ({
      id: d.id,
      stage: d.stage,
      pipeline: d.pipeline,
      amount: d.amount,
      source: d.source,
      days_in_pipeline: Math.floor((Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    })),
    sequences: enrollments,
    notes,
  });
}

async function addDealNote(contactId: string, note: string, dealId?: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("deal_notes")
      .insert({ contact_id: contactId, opportunity_id: dealId || null, body: note, author: "AI Office Manager" })
      .select()
      .single();
    return JSON.stringify({ success: true, note_id: data?.id });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to add note" });
  }
}

async function getDealNotes(contactId: string, dealId?: string): Promise<string> {
  try {
    let query = supabaseAdmin
      .from("deal_notes")
      .select("id, body, author, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (dealId) query = query.eq("opportunity_id", dealId);
    const { data: notes } = await query;
    return JSON.stringify({ notes: notes || [], count: (notes || []).length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get notes" });
  }
}

async function getLenders(filter?: string, tier?: number, submissionMethod?: string): Promise<string> {
  let query = supabaseAdmin.from("lenders").select("*").eq("is_active", true).order("tier").order("name");
  if (tier) query = query.eq("tier", tier);
  if (submissionMethod) query = query.eq("submission_method", submissionMethod);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: "Failed to query lenders database" });

  let lenders = data || [];
  if (filter) {
    const lf = filter.toLowerCase();
    lenders = lenders.filter((l: Record<string, unknown>) => {
      const text = [
        l.name, l.notes,
        ...(Array.isArray(l.products) ? l.products : []),
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(lf);
    });
  }

  const TIER_LABELS: Record<number, string> = { 1: "A Paper", 2: "B Paper", 3: "High Risk" };
  return JSON.stringify({
    lenders: lenders.map((l: Record<string, unknown>) => ({
      ...l,
      tier_label: TIER_LABELS[(l.tier as number) || 2] || "B Paper",
    })),
    count: lenders.length,
    tier_breakdown: {
      tier_1: lenders.filter((l: Record<string, unknown>) => l.tier === 1).length,
      tier_2: lenders.filter((l: Record<string, unknown>) => l.tier === 2).length,
      tier_3: lenders.filter((l: Record<string, unknown>) => l.tier === 3).length,
    },
  });
}

// ── Deal Processing & Submissions ────────────────────────────────────────────

async function getDealProfile(dealId: string) {
  // Get deal with contact info
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("*, contacts(*)")
    .eq("id", dealId)
    .single();

  if (!deal) return null;

  const contact = (deal.contacts || {}) as Record<string, unknown>;

  // Get notes
  let notes: string[] = [];
  try {
    const { data: noteData } = await supabaseAdmin
      .from("deal_notes")
      .select("body, author, created_at")
      .eq("contact_id", deal.contact_id)
      .order("created_at", { ascending: false })
      .limit(5);
    notes = (noteData || []).map((n: Record<string, unknown>) => `[${n.author}] ${n.body}`);
  } catch { /* ok */ }

  return { deal, contact, notes };
}

async function underwriteDeal(dealId: string, additionalContext?: string): Promise<string> {
  const profile = await getDealProfile(dealId);
  if (!profile) return JSON.stringify({ error: `Deal ${dealId} not found.` });

  const { deal, contact, notes } = profile;

  // Build SOS document using contacts table columns directly
  const sos = {
    business_profile: {
      business_name: contact.business_name || contact.legal_name || "Unknown",
      dba: contact.dba || "",
      industry: contact.industry || "Not specified",
      ein: contact.ein ? "On file" : "Not provided",
      incorporation_date: contact.incorporation_date || "Not specified",
    },
    owner_profile: {
      name: `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || "Unknown",
      email: contact.email || "Not provided",
      phone: contact.phone || "Not provided",
      credit_score_range: contact.credit_score_range || "Not specified",
      ownership_percentage: contact.ownership_pct || "Not specified",
      ssn_last4: contact.ssn_last4 ? "On file" : "Not provided",
      dob: contact.dob ? "On file" : "Not provided",
      home_address: contact.home_address || "Not provided",
    },
    funding_request: {
      amount_requested: deal.amount || contact.funding_amount_requested || "Not specified",
      use_of_funds: contact.use_of_funds || "Not specified",
      financing_type: deal.product_type || "Working Capital",
    },
    financial_summary: {
      monthly_deposits: contact.monthly_deposits || "Not provided",
      existing_loans: contact.existing_loans || "Unknown",
    },
    additional_context: additionalContext || null,
    notes: notes.length > 0 ? notes : ["No notes on file"],
    pipeline_info: {
      stage: deal.stage,
      pipeline: deal.pipeline,
      days_in_pipeline: Math.floor((Date.now() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    },
  };

  // Generate text version for emails
  const sosText = [
    `=== STATEMENT OF SCENARIO (SOS) ===`,
    ``,
    `BUSINESS PROFILE`,
    `Business: ${sos.business_profile.business_name}`,
    sos.business_profile.dba ? `DBA: ${sos.business_profile.dba}` : "",
    `Industry: ${sos.business_profile.industry}`,
    `Incorporation: ${sos.business_profile.incorporation_date}`,
    ``,
    `OWNER PROFILE`,
    `Name: ${sos.owner_profile.name}`,
    `Credit Score: ${sos.owner_profile.credit_score_range}`,
    `Ownership: ${sos.owner_profile.ownership_percentage}`,
    ``,
    `FUNDING REQUEST`,
    `Amount: $${typeof sos.funding_request.amount_requested === 'number' ? sos.funding_request.amount_requested.toLocaleString() : sos.funding_request.amount_requested}`,
    `Use of Funds: ${sos.funding_request.use_of_funds}`,
    `Product: ${sos.funding_request.financing_type}`,
    ``,
    `FINANCIAL SUMMARY`,
    `Monthly Deposits: ${sos.financial_summary.monthly_deposits}`,
    `Existing Loans: ${sos.financial_summary.existing_loans}`,
    additionalContext ? `\nADDITIONAL CONTEXT\n${additionalContext}` : "",
    ``,
    `--- SRT Agency | srtagency.com ---`,
  ].filter(Boolean).join("\n");

  // Store in deal_sos table
  try {
    await supabaseAdmin.from("deal_sos").insert({
      opportunity_id: dealId,
      contact_id: deal.contact_id,
      business_name: sos.business_profile.business_name,
      sos_content: sos,
      sos_text: sosText,
      status: "draft",
    });
  } catch { /* table may not exist yet, still return the SOS */ }

  // Log it
  await supabaseAdmin.from("system_logs").insert({
    event_type: "ai_action",
    description: `AI generated SOS for ${sos.business_profile.business_name} (${dealId})`,
    metadata: { dealId, businessName: sos.business_profile.business_name },
  });

  return JSON.stringify({
    tool: "underwrite_deal",
    sos,
    sos_text: sosText,
    message: `SOS generated for ${sos.business_profile.business_name}. Review the details and use match_lenders to find suitable funders.`,
  });
}

async function matchLenders(dealId: string, productType?: string): Promise<string> {
  const profile = await getDealProfile(dealId);
  if (!profile) return JSON.stringify({ error: `Deal ${dealId} not found.` });

  const { deal, contact } = profile;

  // Parse deal criteria from contact columns
  const creditRange = (contact.credit_score_range as string) || "";
  const creditMin = creditRange ? parseInt(creditRange.split("-")[0]) || 0 : 0;
  const monthlyDeposits = (contact.monthly_deposits as string) || "";
  const monthlyRev = monthlyDeposits.includes("1M") ? 100000 : monthlyDeposits.includes("500K") ? 50000 : monthlyDeposits.includes("250K") ? 25000 : monthlyDeposits.includes("120K") ? 10000 : 5000;
  const incDate = (contact.incorporation_date as string) || "";
  // Estimate TIB from incorporation date
  let tibMonths = 6;
  if (incDate) {
    const inc = new Date(incDate);
    if (!isNaN(inc.getTime())) {
      tibMonths = Math.floor((Date.now() - inc.getTime()) / (1000 * 60 * 60 * 24 * 30));
    }
  }
  const industry = ((contact.industry as string) || "").toLowerCase();
  const amount = deal.amount || 0;
  const product = productType || deal.product_type || "Working Capital";

  // Get all active lenders
  const { data: allLenders } = await supabaseAdmin
    .from("lenders")
    .select("*")
    .eq("is_active", true)
    .order("tier")
    .order("name");

  if (!allLenders || allLenders.length === 0) {
    return JSON.stringify({ error: "No active lenders in database. Seed lenders first." });
  }

  // Match and score
  const matches: Array<{
    lender: Record<string, unknown>;
    score: number;
    reasons: string[];
    warnings: string[];
  }> = [];

  for (const lender of allLenders) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = 50;

    if (lender.tier === 1) score += 30;
    else if (lender.tier === 2) score += 15;

    if (lender.min_credit_score && creditMin > 0) {
      if (creditMin >= lender.min_credit_score) {
        reasons.push(`Credit ${creditMin}+ meets min ${lender.min_credit_score}`);
        score += 10;
      } else {
        warnings.push(`Credit ${creditMin} below min ${lender.min_credit_score}`);
        score -= 20;
      }
    }

    if (lender.min_monthly_revenue) {
      if (monthlyRev >= lender.min_monthly_revenue) {
        reasons.push(`Revenue $${(monthlyRev/1000).toFixed(0)}K/mo meets min $${(lender.min_monthly_revenue/1000).toFixed(0)}K`);
        score += 10;
      } else {
        warnings.push(`Revenue $${(monthlyRev/1000).toFixed(0)}K/mo below min $${(lender.min_monthly_revenue/1000).toFixed(0)}K`);
        score -= 15;
      }
    }

    if (lender.max_amount && amount > 0) {
      if (amount <= lender.max_amount) {
        reasons.push(`Amount $${(amount/1000).toFixed(0)}K within max $${(lender.max_amount/1000).toFixed(0)}K`);
        score += 5;
      } else {
        warnings.push(`Amount $${(amount/1000).toFixed(0)}K exceeds max $${(lender.max_amount/1000).toFixed(0)}K`);
        score -= 25;
      }
    }

    if (lender.min_time_in_business_months) {
      if (tibMonths >= lender.min_time_in_business_months) {
        reasons.push(`TIB ${tibMonths}mo meets min ${lender.min_time_in_business_months}mo`);
        score += 5;
      } else {
        warnings.push(`TIB ${tibMonths}mo below min ${lender.min_time_in_business_months}mo`);
        score -= 15;
      }
    }

    const products = (lender.products as string[]) || [];
    if (products.length > 0 && product) {
      if (products.some((p: string) => p.toLowerCase().includes(product.toLowerCase()) || product.toLowerCase().includes(p.toLowerCase()))) {
        reasons.push(`Offers ${product}`);
        score += 10;
      }
    }

    const blocked = (lender.blocked_industries as string[]) || [];
    if (industry && blocked.some((b: string) => industry.includes(b.toLowerCase()))) {
      warnings.push(`Industry "${industry}" is blocked`);
      score -= 50;
    }

    if (lender.response_time_days && lender.response_time_days <= 2) {
      reasons.push(`Fast response: ${lender.response_time_days}d`);
      score += 5;
    }

    if (score > 20) {
      matches.push({ lender, score, reasons, warnings });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  const TIER_LABELS: Record<number, string> = { 1: "A Paper", 2: "B Paper", 3: "High Risk" };

  return JSON.stringify({
    tool: "match_lenders",
    deal_summary: {
      business: contact.business_name || "Unknown",
      amount: deal.amount,
      credit: creditRange || "Unknown",
      product,
    },
    matches: matches.slice(0, 15).map((m) => ({
      id: m.lender.id,
      name: m.lender.name,
      tier: m.lender.tier,
      tier_label: TIER_LABELS[(m.lender.tier as number) || 2],
      submission_method: m.lender.submission_method || "email",
      submission_email: m.lender.submission_email,
      score: m.score,
      reasons: m.reasons,
      warnings: m.warnings,
      products: m.lender.products,
    })),
    total_matches: matches.length,
    message: `Found ${matches.length} matching lenders for ${contact.business_name || "this deal"}. Top matches shown ranked by fit score.`,
  });
}

async function submitToLender(dealId: string, lenderId: string, customNotes?: string): Promise<string> {
  const { data: lender } = await supabaseAdmin
    .from("lenders")
    .select("*")
    .eq("id", lenderId)
    .single();

  if (!lender) return JSON.stringify({ error: `Lender ${lenderId} not found.` });
  if (!lender.submission_email && lender.submission_method === "email") {
    return JSON.stringify({ error: `Lender ${lender.name} has no submission email on file. Add one in the Lenders page.` });
  }

  // Get the latest SOS for this deal
  const { data: sos } = await supabaseAdmin
    .from("deal_sos")
    .select("*")
    .eq("opportunity_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!sos) {
    return JSON.stringify({ error: `No SOS found for deal ${dealId}. Run underwrite_deal first to generate the SOS document.` });
  }

  const businessName = sos.business_name || "Unknown Business";
  const sosContent = sos.sos_content as Record<string, unknown>;
  const fundingRequest = sosContent?.funding_request as Record<string, unknown> || {};
  const amount = fundingRequest.amount_requested || "TBD";
  const product = fundingRequest.financing_type || "Working Capital";

  const subject = `SOS - ${businessName} - ${product} - $${typeof amount === 'number' ? amount.toLocaleString() : amount}`;
  const body = sos.sos_text + (customNotes ? `\n\nADDITIONAL NOTES:\n${customNotes}` : "");

  // Create email draft
  const { data: draft, error: draftErr } = await supabaseAdmin
    .from("email_drafts")
    .insert({
      agent: "submissions",
      opportunity_id: dealId,
      contact_id: sos.contact_id,
      to_email: lender.submission_email || "",
      subject,
      body,
      attachments: [],
      deal_data: { sos_id: sos.id, lender_id: lenderId, lender_name: lender.name, business_name: businessName },
      status: "draft",
    })
    .select()
    .single();

  if (draftErr) return JSON.stringify({ error: `Failed to create email draft: ${draftErr.message}` });

  // Create submission task
  try {
    await supabaseAdmin.from("submission_tasks").insert({
      opportunity_id: dealId,
      contact_id: sos.contact_id,
      lender_id: lenderId,
      lender_name: lender.name,
      submission_method: "email",
      status: "draft_created",
      email_draft_id: draft?.id,
    });
  } catch { /* table may not exist yet */ }

  // Log it
  await supabaseAdmin.from("system_logs").insert({
    event_type: "ai_action",
    description: `AI created submission draft: ${businessName} → ${lender.name}`,
    metadata: { dealId, lenderId, lenderName: lender.name, draftId: draft?.id },
  });

  return JSON.stringify({
    tool: "submit_to_lender",
    success: true,
    draft_id: draft?.id,
    lender_name: lender.name,
    to_email: lender.submission_email,
    subject,
    message: `Email draft created for submission to ${lender.name} (${lender.submission_email}). Review and approve in the Submissions page to send.`,
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
